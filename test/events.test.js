"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const express = require("express");

const auth = require("../src/auth");
const db = require("../src/db");
const events = require("../src/events");
const repo = require("../src/db/repo");

function seedBusiness(name = "Asha Stores") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name });
  return id;
}

function seedQuote(businessId, source) {
  const requirement = repo.createRequirement(businessId, { item: "rice", quantity: 50, unit: "kg" });
  const vendor = repo.createVendor(businessId, { requirement_id: requirement.id, source, name: "Vendor" });
  return { vendor, quote: repo.createQuote(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, unit_price: 62, unit: "kg" }) };
}

const hasCode = (code) => (err) => err.code === code;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, what, ms = 3000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

test("emit writes the audit row and hands the same event to the business's subscribers", () => {
  const businessId = seedBusiness();
  const session = repo.createSession(businessId, { kind: "owner" });
  const received = [];
  const unsubscribe = events.subscribe(businessId, (event) => received.push(event));

  const event = events.emit(businessId, "requirement.saved", { requirementId: "req_1", missing: [] }, { sessionId: session.id, actor: "agent" });
  unsubscribe();

  assert.deepEqual(Object.keys(event), ["id", "ts", "businessId", "sessionId", "actor", "type", "data"]);
  assert.equal(event.businessId, businessId);
  assert.equal(event.type, "requirement.saved");
  assert.deepEqual(event.data, { requirementId: "req_1", missing: [] });
  assert.deepEqual(received, [event]);

  const [row] = repo.listAudit(businessId);
  assert.deepEqual(
    { id: row.id, ts: row.ts, session_id: row.session_id, actor: row.actor, type: row.type, detail: row.detail },
    { id: event.id, ts: event.ts, session_id: session.id, actor: "agent", type: "requirement.saved", detail: event.data },
  );
});

test("subscribers hear only their own business, and not after unsubscribing", () => {
  const first = seedBusiness("First");
  const second = seedBusiness("Second");
  const heardByFirst = [];
  const heardBySecond = [];
  const heardByAll = [];
  const stopFirst = events.subscribe(first, (event) => heardByFirst.push(event.type));
  const stopSecond = events.subscribe(second, (event) => heardBySecond.push(event.type));
  const stopAll = events.subscribeAll((event) => heardByAll.push(event.businessId));
  assert.equal(events.subscriberCount(first), 1);

  events.emit(first, "job.started", { jobId: "job_1" });
  events.emit(second, "job.done", { jobId: "job_2" });
  stopFirst();
  stopFirst();
  events.emit(first, "job.failed", { jobId: "job_1" });
  stopSecond();
  stopAll();
  events.emit(second, "job.failed", { jobId: "job_2" });

  assert.deepEqual(heardByFirst, ["job.started"]);
  assert.deepEqual(heardBySecond, ["job.done"]);
  assert.deepEqual(heardByAll, [first, second, first]);
  assert.equal(events.subscriberCount(first), 0);
  assert.equal(repo.listAudit(first).length, 2, "events are recorded with or without a listener");
});

test("a failing subscriber is reported and does not stop the event or the other subscribers", async (t) => {
  const businessId = seedBusiness();
  const reported = t.mock.method(console, "error", () => {});
  const heard = [];
  const stops = [
    events.subscribe(businessId, () => {
      throw new Error("sync listener broke");
    }),
    events.subscribe(businessId, async () => {
      throw new Error("async listener broke");
    }),
    events.subscribe(businessId, (event) => heard.push(event.type)),
  ];

  const event = events.emit(businessId, "error", { message: "something upstream failed" });
  await sleep(5);
  stops.forEach((stop) => stop());

  assert.deepEqual(heard, ["error"]);
  assert.equal(repo.listAudit(businessId).at(-1).id, event.id);
  const messages = reported.mock.calls.map((call) => call.arguments[0]);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /sync listener broke/);
  assert.match(messages[1], /async listener broke/);
});

test("an invalid event is refused and nothing is written", () => {
  const businessId = seedBusiness();
  assert.throws(() => events.emit(businessId, "Job Started", {}), hasCode("INVALID_TYPE"));
  assert.throws(() => events.emit(businessId, "", {}), hasCode("INVALID_TYPE"));
  assert.throws(() => events.emit(businessId, "job.started", {}, { actor: "hacker" }), hasCode("INVALID_ACTOR"));
  assert.throws(() => events.emit(businessId, "job.started", "text"), hasCode("INVALID_DATA"));
  assert.throws(() => events.emit(businessId, "job.started", [1, 2]), hasCode("INVALID_DATA"));
  assert.throws(() => events.emit("biz_does_not_exist", "job.started", {}), /FOREIGN KEY/);
  assert.throws(() => events.emit("", "job.started", {}), hasCode("BUSINESS_REQUIRED"));
  assert.deepEqual(repo.listAudit(businessId), []);
  assert.throws(() => events.subscribe(businessId, "not a function"), hasCode("INVALID_SUBSCRIBER"));
  assert.throws(() => events.subscribe("", () => {}), hasCode("BUSINESS_REQUIRED"));
});

test("an event about a simulated vendor is labelled in the audit log whatever the caller says", () => {
  const businessId = seedBusiness();
  const other = seedBusiness("Other");
  const simulated = seedQuote(businessId, "simulated");
  const listed = seedQuote(businessId, "indiamart");

  const labelled = events.emit(businessId, "quote.recorded", { quoteId: simulated.quote.id, simulated: false });
  assert.equal(labelled.data.simulated, true);
  assert.equal(labelled.data.vendorLabel, "simulated vendor");
  assert.equal(repo.listAudit(businessId).at(-1).detail.vendorLabel, "simulated vendor");

  assert.equal(events.emit(businessId, "vendor.found", { vendorId: simulated.vendor.id }).data.vendorLabel, "simulated vendor");
  assert.equal(
    events.emit(businessId, "job.progress", { jobId: "job_1", data: { deals: [{ quoteId: listed.quote.id }, { quoteId: simulated.quote.id }] } }).data.vendorLabel,
    "simulated vendor",
    "a reference nested inside the event counts",
  );
  assert.equal(
    events.emit(businessId, "job.started", { jobId: "job_2", input: { vendorId: listed.vendor.id, counterpart: "simulated" } }).data.simulated,
    true,
    "a simulated counterpart for a listed vendor counts",
  );
  assert.equal(events.emit(businessId, "job.started", { jobId: "job_3", input: { vendorId: listed.vendor.id, counterpart: "human" } }).data.simulated, undefined);
  assert.deepEqual(events.emit(businessId, "quote.recorded", { quoteId: listed.quote.id }).data, { quoteId: listed.quote.id });
  assert.deepEqual(
    events.emit(other, "quote.recorded", { quoteId: simulated.quote.id }).data,
    { quoteId: simulated.quote.id },
    "another business's ids resolve to nothing",
  );
});

test("what subscribers receive is what the audit log stores", () => {
  const businessId = seedBusiness();
  const received = [];
  const stop = events.subscribe(businessId, (event) => received.push(event));
  events.emit(businessId, "job.progress", { at: new Date("2026-01-02T03:04:05.000Z"), skipped: undefined, nested: { n: 1 } });
  stop();
  assert.deepEqual(received[0].data, { at: "2026-01-02T03:04:05.000Z", nested: { n: 1 } });
  assert.deepEqual(repo.listAudit(businessId)[0].detail, received[0].data);
});

test("inside a transaction, subscribers hear the event after the commit and never after a rollback", () => {
  const businessId = seedBusiness();
  const heard = [];
  const stop = events.subscribe(businessId, (event) => heard.push(event.type));

  db.transaction(() => {
    events.emit(businessId, "order.created", { orderId: "ord_1" });
    assert.deepEqual(heard, [], "not before the commit");
  });
  assert.deepEqual(heard, ["order.created"]);

  assert.throws(() =>
    db.transaction(() => {
      events.emit(businessId, "payment.link", { orderId: "ord_1" });
      throw new Error("rolled back");
    }),
  );
  stop();
  assert.deepEqual(heard, ["order.created"]);
  assert.deepEqual(repo.listAudit(businessId).map((row) => row.type), ["order.created"]);
});

/* ------------------------------------------------------------ SSE --- */

let server;
let base;

before(async () => {
  const app = express();
  app.get("/api/events", auth.requireSession, events.createSseHandler({ heartbeatMs: 40 }));
  app.get("/unguarded", events.sseHandler);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  events.closeStreams();
  await new Promise((resolve) => server.close(resolve));
});

const browserToken = (businessId, seconds = 3600) =>
  auth.signSession({ businessId, sessionId: "ses_browser", scope: "browser", exp: Math.floor(Date.now() / 1000) + seconds });

/** Open the SSE stream as a browser would and collect its frames. */
async function openStream(businessId, { headers = {}, seconds } = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, {
    headers: { cookie: `${auth.COOKIE_NAME}=${browserToken(businessId, seconds)}`, ...headers },
    signal: controller.signal,
  });
  const stream = { response, frames: [], ended: false, close: () => controller.abort() };
  stream.events = () => stream.frames.filter((frame) => frame.startsWith("id: ")).map((frame) => JSON.parse(frame.slice(frame.indexOf("\ndata: ") + 7)));
  (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          stream.frames.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") stream.error = err;
    }
    stream.ended = true;
  })();
  return stream;
}

test("the SSE route refuses a request without a session", async () => {
  const noCookie = await fetch(`${base}/api/events`);
  assert.equal(noCookie.status, 401);
  const unguarded = await fetch(`${base}/unguarded?businessId=biz_victim`);
  assert.equal(unguarded.status, 401, "the handler never takes the business from the request");
});

test("the SSE stream carries this business's events, heartbeats, and nothing from other businesses", async () => {
  const businessId = seedBusiness();
  const other = seedBusiness("Other");
  const stream = await openStream(businessId);
  assert.equal(stream.response.status, 200);
  assert.match(stream.response.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(stream.response.headers.get("cache-control"), "no-cache, no-transform");
  await until(() => events.subscriberCount(businessId) === 1, "the stream to subscribe");

  events.emit(other, "job.started", { jobId: "job_other" });
  const emitted = events.emit(businessId, "job.progress", { jobId: "job_mine", message: "3 vendors found" }, { actor: "agent" });

  await until(() => stream.events().length === 1, "the event");
  assert.deepEqual(stream.events(), [emitted]);
  assert.ok(stream.frames.some((frame) => frame === `id: ${emitted.id}\ndata: ${JSON.stringify(emitted)}`), "sent as a default message with the audit id");
  await until(() => stream.frames.filter((frame) => frame === ": heartbeat").length >= 2, "two heartbeats");

  stream.close();
  await until(() => events.subscriberCount(businessId) === 0, "the subscription to be released");
});

test("a reconnecting client receives what it missed, in order, and only its own", async () => {
  const businessId = seedBusiness();
  const other = seedBusiness("Other");
  const seen = events.emit(businessId, "job.started", { jobId: "job_1" });
  events.emit(other, "job.started", { jobId: "job_other" });
  const missed = [];
  for (let n = 1; n <= 205; n += 1) missed.push(events.emit(businessId, "job.progress", { jobId: "job_1", message: `step ${n}` }));

  const stream = await openStream(businessId, { headers: { "last-event-id": String(seen.id) } });
  await until(() => stream.events().length === missed.length, "the replay");
  assert.deepEqual(stream.events().map((event) => event.id), missed.map((event) => event.id));
  assert.ok(stream.events().every((event) => event.businessId === businessId));

  const live = events.emit(businessId, "job.done", { jobId: "job_1" });
  await until(() => stream.events().at(-1).id === live.id, "the live event after the replay");
  stream.close();

  const fresh = await openStream(businessId);
  await until(() => events.subscriberCount(businessId) >= 1, "the fresh stream to subscribe");
  await sleep(30);
  assert.deepEqual(fresh.events(), [], "without Last-Event-ID nothing is replayed");
  fresh.close();
});

test("the SSE stream ends when the session that opened it expires", async () => {
  const businessId = seedBusiness();
  const stream = await openStream(businessId, { seconds: 1 });
  await until(() => events.subscriberCount(businessId) === 1, "the stream to subscribe");
  await until(() => stream.ended, "the stream to end at session expiry", 4000);
  assert.equal(stream.error, undefined);
  await until(() => events.subscriberCount(businessId) === 0, "the subscription to be released");
});
