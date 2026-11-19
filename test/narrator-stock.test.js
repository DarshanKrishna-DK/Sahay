"use strict";

// The narrator's STK hook: the reorder question holds other lines and tells the model which
// tool answers it, until the owner decides; liveCall names the call the question goes into.
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const repo = require("../src/db/repo");
const narrator = require("../src/agora/narrator");

test("stock.reorder_spoken holds narration and sets the call status; stock.reorder_decided releases both", async () => {
  const statuses = [];
  narrator.configure({ speak: async () => {}, status: async (_agentId, text) => statuses.push(text), rules: async () => {} });
  const biz = repo.newId("biz");
  repo.createBusiness(biz, { name: "Asha Kirana", language: "hi-IN" });
  assert.equal(narrator.liveCall(biz), null);
  narrator.attach(biz, { agentId: "AGN", sessionId: "ses_1", language: "kn-IN" });
  try {
    assert.deepEqual(narrator.liveCall(biz), { agentId: "AGN", sessionId: "ses_1", language: "kn-IN" });
    narrator.onEvent({ businessId: biz, type: "stock.reorder_spoken", data: { proposalId: "rop_1" } });
    assert.equal(narrator.isHeld(biz), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(statuses.at(-1), /confirm_reorder/);
    assert.match(statuses.at(-1), /never an order/);
    narrator.onEvent({ businessId: biz, type: "stock.reorder_decided", data: { proposalId: "rop_other", status: "closed" } });
    assert.equal(narrator.isHeld(biz), true, "another proposal's decision does not end this hold");
    narrator.onEvent({ businessId: biz, type: "stock.reorder_decided", data: { proposalId: "rop_1", status: "accepted" } });
    assert.equal(narrator.isHeld(biz), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotMatch(statuses.at(-1) ?? "", /confirm_reorder/);
  } finally {
    narrator.detach(biz);
  }
  assert.equal(narrator.liveCall(biz), null);
});
