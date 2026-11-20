"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const calls = require("../src/tools/calls");

test("calls: a running tool is in flight until its end() runs, once, whatever the outcome", () => {
  calls.reset();
  const end = calls.begin("biz_a", "confirm_invoice");
  assert.equal(calls.inFlight("biz_a"), true);
  assert.equal(calls.inFlight("biz_a", ["confirm_invoice"]), true);
  assert.equal(calls.inFlight("biz_a", ["record_payment"]), false);
  assert.equal(calls.inFlight("biz_b"), false, "per business");
  end();
  end();
  assert.equal(calls.inFlight("biz_a"), false);
});

test("calls: startedSince answers whether a tool started at or after a time, by name", () => {
  let now = 1_000_000;
  calls.reset({ now: () => now });
  calls.begin("biz_a", "draft_invoice")();
  now += 4000;
  assert.equal(calls.startedSince("biz_a", ["draft_invoice"], now - 6000), true);
  assert.equal(calls.startedSince("biz_a", ["draft_invoice"], now - 3000), false);
  assert.equal(calls.startedSince("biz_a", ["save_requirement"], 0), false);
  assert.equal(calls.startedSince("biz_b", ["draft_invoice"], 0), false);
  calls.reset();
});

test("calls: registry.callTool marks every tool call, also one that is refused", async () => {
  process.env.DB_FILE = ":memory:";
  const registry = require("../src/tools/registry");
  const repo = require("../src/db/repo");
  calls.reset();
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Stores", city: "Bengaluru", language: "en-IN" });
  const ctx = { businessId, sessionId: null, agentId: null, actor: "agent", toolScope: "owner" };
  const since = Date.now() - 1;
  await assert.rejects(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), (err) => err.code === "NO_PENDING_INVOICE");
  assert.equal(calls.startedSince(businessId, ["confirm_invoice"], since), true);
  assert.equal(calls.inFlight(businessId), false, "ended after the refusal");
});

test("calls: startedSince with no names counts any tool, except the ones named in except", () => {
  let now = 1000;
  calls.reset({ now: () => now });
  calls.begin("biz_e", "confirm_invoice")();
  assert.equal(calls.startedSince("biz_e", null, 1000), true);
  assert.equal(calls.startedSince("biz_e", null, 1000, { except: ["confirm_invoice"] }), false);
  now = 2000;
  calls.begin("biz_e", "get_stock")();
  assert.equal(calls.startedSince("biz_e", null, 1500, { except: ["confirm_invoice"] }), true);
  assert.equal(calls.startedSince("biz_e", null, 2001), false);
  calls.reset();
});
