"use strict";

// Stock REST (contract STK): GET /api/stock, POST /api/orders/:id/delivered, the reorder button.
Object.assign(process.env, {
  DB_FILE: ":memory:",
  SESSION_SIGNING_SECRET: "test-secret-".padEnd(48, "x"),
  PUBLIC_URL: "https://sahay.test",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createApp } = require("../server");
const auth = require("../src/auth");
const repo = require("../src/db/repo");
const events = require("../src/events");
const stock = require("../src/stock");
const items = require("../src/stock/items");
const reorder = require("../src/stock/reorder");

const realFetch = globalThis.fetch;

async function withApp(run) {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  const token = auth.signSession({ businessId: id, sessionId: repo.newId("web"), scope: "browser", exp: Math.floor(Date.now() / 1000) + 3600 });
  return { businessId: id, cookie: `${auth.COOKIE_NAME}=${token}` };
}

async function call(base, method, path, { cookie, body } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

function seedOrder(businessId, { item = "चावल", quantity = 100, unit = "kg" } = {}) {
  const requirement = repo.createRequirement(businessId, { item, quantity, unit, city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: requirement.id, source: "indiamart", name: "Lakshmi Traders", city: "Bengaluru" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, counterpart: "human" });
  const quote = repo.createQuote(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: 60, unit, landed_cost: 6000 });
  const approval = repo.createApproval(businessId, { quote_id: quote.id, readback: "read back", total_amount: 6000 });
  repo.decideApproval(businessId, approval.id, { status: "approved", decided_via: "button" });
  return repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
}

test("every stock route needs the session cookie", async () => {
  await withApp(async (base) => {
    assert.equal((await call(base, "GET", "/api/stock")).status, 401);
    assert.equal((await call(base, "POST", "/api/orders/ord_x/delivered")).status, 401);
    assert.equal((await call(base, "POST", "/api/stock/reorders/rop_x/decision", { body: { decision: "yes" } })).status, 401);
  });
});

test("GET /api/stock lists this business's items with on hand, level and low, the latest moves and open proposals", async () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const stop = reorder.start();
  try {
    const rice = items.upsert(a.businessId, { name: "rice", unit: "kg", reorder_level: 50 });
    stock.move(a.businessId, { itemId: rice.id, qty: 30, reason: "opening" });
    items.upsert(b.businessId, { name: "salt", unit: "kg" });
    await new Promise((resolve) => setImmediate(resolve));
    await withApp(async (base) => {
      const out = await call(base, "GET", "/api/stock", { cookie: a.cookie });
      assert.equal(out.status, 200);
      assert.equal(out.json.items.length, 1);
      const [row] = out.json.items;
      assert.deepEqual([row.name, row.unit, row.on_hand, row.level, row.low], ["rice", "kg", 30, 50, true]);
      assert.equal(out.json.moves.length, 1);
      assert.equal(out.json.proposals.length, 1);
      assert.equal(out.json.proposals[0].item.id, rice.id);
      const other = await call(base, "GET", "/api/stock", { cookie: b.cookie });
      assert.deepEqual(other.json.items.map((i) => i.name), ["salt"]);
      assert.deepEqual(other.json.proposals, []);
    });
  } finally {
    stop();
  }
});

test("POST /api/orders/:id/delivered brings the order into stock once; another business gets 404", async () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const order = seedOrder(a.businessId);
  await withApp(async (base) => {
    const foreign = await call(base, "POST", `/api/orders/${order.id}/delivered`, { cookie: b.cookie });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.json.code, "ORDER_NOT_FOUND");
    assert.equal(typeof foreign.json.say, "string");
    const out = await call(base, "POST", `/api/orders/${order.id}/delivered`, { cookie: a.cookie });
    assert.equal(out.status, 200);
    assert.deepEqual([out.json.status, out.json.added, out.json.on_hand, out.json.alreadyDelivered], ["delivered", 100, 100, false]);
    const again = await call(base, "POST", `/api/orders/${order.id}/delivered`, { cookie: a.cookie });
    assert.equal(again.json.alreadyDelivered, true);
    assert.equal(again.json.on_hand, 100);
  });
});

test("the reorder button: yes saves the need and starts the search (never an order); a bad decision is 400", async (t) => {
  const a = seedBusiness();
  globalThis.fetch = async () => new Response("not found", { status: 404 }); // IndiaMART: no listings here
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const stop = reorder.start();
  t.after(stop);
  repo.createRequirement(a.businessId, { item: "rice", quantity: 75, unit: "kg", city: "Bengaluru" });
  const rice = items.upsert(a.businessId, { name: "rice", unit: "kg", reorder_level: 10 });
  stock.move(a.businessId, { itemId: rice.id, qty: 5, reason: "opening" });
  await new Promise((resolve) => setImmediate(resolve));
  const [proposal] = reorder.listOpen(a.businessId);
  await withApp(async (base) => {
    const bad = await call(base, "POST", `/api/stock/reorders/${proposal.id}/decision`, { cookie: a.cookie, body: { decision: "maybe" } });
    assert.equal(bad.status, 400);
    const yes = await call(base, "POST", `/api/stock/reorders/${proposal.id}/decision`, { cookie: a.cookie, body: { decision: "yes" } });
    assert.equal(yes.status, 200);
    assert.equal(yes.json.status, "accepted");
    assert.equal(yes.json.sourcingStarted, true);
    assert.match(yes.json.jobId, /^job_/);
    assert.equal(repo.getRequirement(a.businessId, yes.json.requirementId).quantity, 75);
    const twice = await call(base, "POST", `/api/stock/reorders/${proposal.id}/decision`, { cookie: a.cookie, body: { decision: "no" } });
    assert.equal(twice.status, 409);
    await require("../src/jobs").whenSettled(yes.json.jobId);
  });
  assert.equal(repo.listOrders(a.businessId).length, 0);
});
