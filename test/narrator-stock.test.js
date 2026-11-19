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

/* ------------------------------------------- E2E full run (voice fixes) --- */

const flush = () => new Promise((resolve) => setImmediate(resolve));

function liveBusiness() {
  const statuses = [];
  narrator.configure({ speak: async () => {}, status: async (_agentId, text) => statuses.push(text), rules: async () => {} });
  const biz = repo.newId("biz");
  repo.createBusiness(biz, { name: "Annapurna Kirana", language: "hi-IN" });
  narrator.attach(biz, { agentId: "AGN", sessionId: "ses_1", language: "hi-IN" });
  return { biz, statuses };
}

test("E2E full run bug 6a: a bill's read-back hold ends when the bill is decided, and the release listeners hear it", async () => {
  const { biz, statuses } = liveBusiness();
  const released = [];
  const off = narrator.onRelease((id) => released.push(id));
  try {
    narrator.holdForApproval(biz, "invoice:iap_1");
    narrator.onEvent({ businessId: biz, type: "invoice.spoken", data: { approvalId: "iap_1" } });
    await flush();
    assert.match(statuses.at(-1), /A bill has been read out[^.]*\. It is NOT made yet\./, "the waiting bill is in the system message");
    assert.match(statuses.at(-1), /call confirm_invoice/);
    narrator.onEvent({ businessId: biz, type: "invoice.decided", data: { approvalId: "iap_other", status: "approved" } });
    assert.equal(narrator.isHeld(biz), true, "another bill's decision does not end this hold");
    narrator.onEvent({ businessId: biz, type: "invoice.decided", data: { approvalId: "iap_1", status: "approved" } });
    assert.equal(narrator.isHeld(biz), false, "before: only an approval.decided ended it, so a low-stock question waited for nothing");
    assert.deepEqual(released, [biz]);
    await flush();
    assert.doesNotMatch(statuses.at(-1) ?? "", /A bill has been read out/);
  } finally {
    off();
    narrator.detach(biz);
  }
});

test("E2E full run bug 7b: a payment read-back stays in the system message until it is recorded or cancelled; its hold ends with it", async () => {
  const { biz, statuses } = liveBusiness();
  try {
    narrator.holdForApproval(biz, "receipt:rcd_1");
    narrator.onEvent({ businessId: biz, type: "receipt.spoken", data: { draftId: "rcd_1" } });
    await flush();
    assert.match(statuses.at(-1), /It is NOT written down yet[^]*record_payment with only decision/);
    narrator.onEvent({ businessId: biz, type: "receipt.recorded", data: { receipt: { id: "rcp_1" } } });
    assert.equal(narrator.isHeld(biz), false);
    await flush();
    assert.doesNotMatch(statuses.at(-1) ?? "", /NOT written down/);

    narrator.holdForApproval(biz, "receipt:rcd_2");
    narrator.onEvent({ businessId: biz, type: "receipt.cancelled", data: { draftId: "rcd_2" } });
    assert.equal(narrator.isHeld(biz), false);
  } finally {
    narrator.detach(biz);
  }
});

test("a rule read-back is in the system message until it is decided", async () => {
  const { biz, statuses } = liveBusiness();
  try {
    narrator.onEvent({ businessId: biz, type: "rule.spoken", data: { ruleId: "rul_1" } });
    await flush();
    assert.match(statuses.at(-1), /A rule has been read out[^]*confirm_rule[^]*Do not propose the same rule again/);
    narrator.onEvent({ businessId: biz, type: "rule.decided", data: { rule: { id: "rul_1", status: "active" } } });
    assert.equal(narrator.isHeld(biz), false);
    await flush();
    assert.doesNotMatch(statuses.at(-1) ?? "", /A rule has been read out/);
  } finally {
    narrator.detach(biz);
  }
});

test("a hold nobody answers still ends: the release listeners hear it when it times out", async () => {
  const { biz } = liveBusiness();
  const released = [];
  const off = narrator.onRelease((id) => released.push(id));
  try {
    narrator.holdForApproval(biz, "invoice:iap_slow", 30);
    assert.equal(narrator.isHeld(biz), true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(narrator.isHeld(biz), false);
    assert.deepEqual(released, [biz]);
  } finally {
    off();
    narrator.detach(biz);
  }
});
