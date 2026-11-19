"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  SAHAY_ACCESS_CODE: "",
});

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const express = require("express");

const { createApiRouter, errorHandler } = require("../src/routes/api");
const repo = require("../src/db/repo");
const events = require("../src/events");
const limits = require("../src/limits");
const rules = require("../src/agent/rules");

beforeEach(() => limits.reset());

/** The API router on its own app, so these tests do not depend on server.js. */
async function withApp(run) {
  const app = express();
  app.use(createApiRouter());
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(base, method, path, { cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null };
}

async function signUp(base, details = { name: "Asha Kirana", city: "Bengaluru", language: "hi-IN" }) {
  const out = await call(base, "POST", "/api/session", { body: details });
  assert.equal(out.status, 200);
  return { cookie: out.res.headers.get("set-cookie").split(";")[0], business: out.json.business };
}

test("the agent routes need the session cookie", async () => {
  await withApp(async (base) => {
    for (const [method, path] of [["GET", "/api/agent"], ["PUT", "/api/agent/profile"], ["POST", "/api/agent/rules/rul_x/decision"]]) {
      const out = await call(base, method, path, method === "GET" ? {} : { body: {} });
      assert.equal(out.status, 401, `${method} ${path}`);
    }
  });
});

test("GET /api/agent returns the defaults for a fresh business and only its own rules", async () => {
  await withApp(async (base) => {
    const me = await signUp(base, { name: "Asha Kirana", city: "Bengaluru", language: "kn-IN" });
    const other = await signUp(base, { name: "Other Shop", city: "Mysuru", language: "hi-IN" });
    rules.propose(other.business.id, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
    const mine = rules.propose(me.business.id, { kind: "prefer_vendor", params: { name: "Lakshmi Traders" }, source: "owner_said" });

    const out = await call(base, "GET", "/api/agent", { cookie: me.cookie });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json.profile, { business_id: me.business.id, voice_speed: "normal", bargain_style: "balanced", language: "kn-IN" });
    assert.deepEqual(out.json.rules.map((r) => r.id), [mine.id]);
    assert.deepEqual(out.json.memories, []);
  });
});

test("PUT /api/agent/profile validates and saves; a business id in the body is refused, never used", async () => {
  await withApp(async (base) => {
    const me = await signUp(base);
    const other = await signUp(base, { name: "Other Shop", city: "Mysuru", language: "hi-IN" });

    const ok = await call(base, "PUT", "/api/agent/profile", { cookie: me.cookie, body: { voice_speed: "slow", bargain_style: "gentle", language: "en-IN" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.profile, { business_id: me.business.id, voice_speed: "slow", bargain_style: "gentle", language: "en-IN" });

    for (const body of [{ voice_speed: "fast" }, { bargain_style: 3 }, { language: "fr-FR" }, {}, { business_id: other.business.id, voice_speed: "slow" }]) {
      const bad = await call(base, "PUT", "/api/agent/profile", { cookie: me.cookie, body });
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(bad.json.code, "INVALID");
    }
    const theirs = await call(base, "GET", "/api/agent", { cookie: other.cookie });
    assert.equal(theirs.json.profile.voice_speed, "normal", "the other business is untouched");
  });
});

test("POST /api/agent/rules/:id/decision keeps or forgets this business's rule; another's is 404", async () => {
  await withApp(async (base) => {
    const me = await signUp(base);
    const other = await signUp(base, { name: "Other Shop", city: "Mysuru", language: "hi-IN" });
    const mine = rules.propose(me.business.id, { kind: "max_price", params: { item: "चावल", unit: "kg", price: 80 }, source: "owner_said" });
    const theirs = rules.propose(other.business.id, { kind: "max_price", params: { item: "चावल", unit: "kg", price: 80 }, source: "owner_said" });

    const kept = await call(base, "POST", `/api/agent/rules/${mine.id}/decision`, { cookie: me.cookie, body: { decision: "keep" } });
    assert.equal(kept.status, 200);
    assert.equal(kept.json.rule.status, "active");
    assert.equal(kept.json.rule.id, mine.id);

    const foreign = await call(base, "POST", `/api/agent/rules/${theirs.id}/decision`, { cookie: me.cookie, body: { decision: "keep" } });
    assert.equal(foreign.status, 404);
    assert.equal(rules.get(other.business.id, theirs.id).status, "suggested");

    const bad = await call(base, "POST", `/api/agent/rules/${mine.id}/decision`, { cookie: me.cookie, body: { decision: "yes" } });
    assert.equal(bad.status, 400);

    const forgot = await call(base, "POST", `/api/agent/rules/${mine.id}/decision`, { cookie: me.cookie, body: { decision: "forget" } });
    assert.equal(forgot.json.rule.status, "off");
    const again = await call(base, "POST", `/api/agent/rules/${mine.id}/decision`, { cookie: me.cookie, body: { decision: "keep" } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "RULE_ALREADY_DECIDED");
    assert.ok(again.json.say, "a spoken line for the owner");
  });
});

test("a button decision is recorded in the audit log as the owner's", async () => {
  await withApp(async (base) => {
    const me = await signUp(base);
    const rule = rules.propose(me.business.id, { kind: "bargain_style", params: { style: "gentle" }, source: "owner_said" });
    await call(base, "POST", `/api/agent/rules/${rule.id}/decision`, { cookie: me.cookie, body: { decision: "keep" } });
    const row = repo.listAudit(me.business.id, { type: "rule.decided" }).at(-1);
    assert.equal(row.actor, "owner");
    assert.equal(row.detail.rule.id, rule.id);
    assert.equal(row.detail.via, "button");
  });
});

test("GET /api/state ranks vendors as the agent does: an avoided vendor is marked and unranked, a preferred one wins a tie", async () => {
  await withApp(async (base) => {
    const me = await signUp(base);
    const biz = me.business.id;
    const need = repo.createRequirement(biz, { item: "rice", quantity: 10, unit: "kg", city: "Bengaluru" });
    const avoided = repo.createVendor(biz, { requirement_id: need.id, source: "indiamart", name: "Ravi Traders", score: 0.9 });
    const a = repo.createVendor(biz, { requirement_id: need.id, source: "indiamart", name: "Anand Stores", score: 0.5 });
    const z = repo.createVendor(biz, { requirement_id: need.id, source: "indiamart", name: "Zeal Foods", score: 0.5 });
    for (const [kind, params] of [["avoid_vendor", { name: "Ravi Traders" }], ["prefer_vendor", { name: "Zeal Foods" }]]) {
      const rule = rules.propose(biz, { kind, params, source: "owner_said" });
      rules.decide(biz, rule.id, "keep", { via: "button" });
    }
    const state = await call(base, "GET", "/api/state", { cookie: me.cookie });
    assert.deepEqual(state.json.vendors.map((v) => [v.id, v.rank, v.avoided]), [[z.id, 1, false], [a.id, 2, false], [avoided.id, null, true]]);
  });
});
