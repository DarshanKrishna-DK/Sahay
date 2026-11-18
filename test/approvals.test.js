"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const approvals = require("../src/approvals");
const repo = require("../src/db/repo");

function seedBusiness({ name = "Asha Stores", language = "hi-IN" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, city: "Bengaluru", language });
  return id;
}

/** A quote for 50 kg of rice at 62 per kg, freight 150, landed 3250, 3 days. Overrides change any part. */
function seedQuote(businessId, { source = "indiamart", counterpart = "human", requirement = {}, quote = {}, vendorName = "Lakshmi Traders" } = {}) {
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", ...requirement });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source, name: vendorName });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart });
  return repo.createQuote(businessId, {
    requirement_id: need.id,
    vendor_id: vendor.id,
    negotiation_id: negotiation.id,
    unit_price: 62,
    unit: "kg",
    lead_time_days: 3,
    freight: 150,
    landed_cost: 3250,
    ...quote,
  });
}

const refuses = (code) => (err) => err instanceof approvals.ApprovalError && err.code === code;
const auditTypes = (businessId) => repo.listAudit(businessId).map((row) => row.type);

/* ------------------------------------------------------------ readback --- */

test("the read-back states vendor, quantity, unit price, freight, landed total and lead time from the database, in Hindi", () => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const quote = seedQuote(businessId);
  const { approval, deal, created } = approvals.requestApproval(businessId, quote.id);

  assert.equal(created, true);
  assert.equal(approval.status, "pending");
  assert.equal(approval.total_amount, 3250);
  assert.equal(deal.total, 3250);
  assert.equal(
    approval.readback,
    "Lakshmi Traders से ऑर्डर: 50 किलो basmati rice, 62 रुपये प्रति किलो के भाव पर। भाड़ा 150 रुपये। कुल 3250 रुपये। डिलीवरी 3 दिन में। क्या मैं यह ऑर्डर पक्का करूँ?",
  );
  assert.doesNotMatch(approval.readback, /सिम्युलेटेड|simulated/);
});

test("the read-back is in Kannada script for a Kannada business and in English for an English one", () => {
  const kannada = seedBusiness({ language: "kn-IN" });
  assert.equal(
    approvals.requestApproval(kannada, seedQuote(kannada).id).approval.readback,
    "Lakshmi Traders ಅವರಿಂದ ಆರ್ಡರ್: 50 ಕೆಜಿ basmati rice, ಒಂದು ಕೆಜಿ ಬೆಲೆ 62 ರೂಪಾಯಿ. ಸಾಗಣೆ ವೆಚ್ಚ 150 ರೂಪಾಯಿ. ಒಟ್ಟು 3250 ರೂಪಾಯಿ. 3 ದಿನಗಳಲ್ಲಿ ಡೆಲಿವರಿ. ಈ ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲೇ?",
  );

  const english = seedBusiness({ language: "en-IN" });
  assert.equal(
    approvals.requestApproval(english, seedQuote(english).id).approval.readback,
    "Order from Lakshmi Traders: 50 kg of basmati rice at 62 rupees per kg. Freight 150 rupees. Total 3250 rupees. Delivery in 3 days. Shall I confirm this order?",
  );
});

test("native-script read-backs contain no romanised Hindi or Kannada words", () => {
  const deal = { vendorName: "विक्रेता", simulated: true, item: "चावल", quantity: 2, unit: "bag", unitPrice: 900.5, freight: 0, total: 1801, leadTimeDays: 1 };
  const hindi = approvals.buildReadback({ ...deal, language: "hi" });
  const kannada = approvals.buildReadback({ ...deal, vendorName: "ಮಾರಾಟಗಾರ", item: "ಅಕ್ಕಿ", language: "kn" });
  assert.doesNotMatch(hindi, /[A-Za-z]/);
  assert.doesNotMatch(kannada, /[A-Za-z]/);
  assert.match(hindi, /2 बोरी चावल, 900\.5 रुपये प्रति बोरी/);
  assert.match(hindi, /भाड़ा नहीं लगेगा। कुल 1801 रुपये/);
  assert.match(kannada, /2 ಚೀಲ ಅಕ್ಕಿ, ಒಂದು ಚೀಲ ಬೆಲೆ 900\.5 ರೂಪಾಯಿ/);
  assert.match(kannada, /1 ದಿನದಲ್ಲಿ ಡೆಲಿವರಿ/);
  assert.match(approvals.buildReadback({ ...deal, language: "en" }), /2 bags of चावल at 900\.5 rupees per bag\. No freight charge\. Total 1801 rupees\. Delivery in 1 day\./);
  assert.throws(() => approvals.buildReadback({ ...deal, language: "ta" }), refuses("UNSUPPORTED_LANGUAGE"));
});

test("a simulated vendor is called a simulated vendor in every language and in the audit log", () => {
  const expectations = { "en-IN": /Sim Traders \(simulated vendor, not a real supplier\)/, "hi-IN": /Sim Traders \(सिम्युलेटेड वेंडर, असली विक्रेता नहीं\)/, "kn-IN": /Sim Traders \(ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್, ನಿಜವಾದ ಮಾರಾಟಗಾರ ಅಲ್ಲ\)/ };
  for (const [language, label] of Object.entries(expectations)) {
    const businessId = seedBusiness({ language });
    const quote = seedQuote(businessId, { source: "simulated", counterpart: "simulated", vendorName: "Sim Traders" });
    const { approval, deal } = approvals.requestApproval(businessId, quote.id);
    assert.match(approval.readback, label, language);
    assert.equal(deal.simulated, true);
    assert.equal(approval.simulated, true);
    const requested = repo.listAudit(businessId, { type: "approval.requested" })[0].detail;
    assert.equal(requested.simulated, true);
    assert.equal(requested.vendorLabel, "simulated vendor");
  }

  // A real listing negotiated against a simulated counterpart is just as simulated.
  const businessId = seedBusiness({ language: "en-IN" });
  const standIn = seedQuote(businessId, { source: "indiamart", counterpart: "simulated" });
  assert.match(approvals.requestApproval(businessId, standIn.id).approval.readback, /\(simulated vendor, not a real supplier\)/);
});

test("unknown freight and unknown lead time are said as unknown, and freight is never counted as zero", () => {
  const businessId = seedBusiness({ language: "en-IN" });
  const quote = seedQuote(businessId, { quote: { freight: undefined, landed_cost: undefined, lead_time_days: undefined } });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  assert.equal(approval.total_amount, 3100);
  assert.match(approval.readback, /Freight is not quoted and is not in this total\. Total 3100 rupees\. Delivery time is not confirmed\./);

  const hindi = seedBusiness({ language: "hi-IN" });
  const hindiQuote = seedQuote(hindi, { quote: { freight: undefined, landed_cost: undefined, lead_time_days: undefined } });
  assert.match(approvals.requestApproval(hindi, hindiQuote.id).approval.readback, /भाड़ा बताया नहीं गया है और इस कुल में शामिल नहीं है। कुल 3100 रुपये। डिलीवरी का समय तय नहीं हुआ है।/);
});

test("a deal whose numbers cannot be trusted is refused before the owner hears a total", () => {
  const businessId = seedBusiness();
  const request = (overrides) => () => approvals.requestApproval(businessId, seedQuote(businessId, overrides).id);

  assert.throws(request({ quote: { unit: "quintal" } }), refuses("UNIT_MISMATCH"));
  assert.throws(request({ quote: { unit: undefined } }), refuses("UNIT_MISMATCH"));
  assert.throws(request({ requirement: { quantity: undefined } }), refuses("INCOMPLETE_DEAL"));
  assert.throws(request({ requirement: { item: undefined } }), refuses("INCOMPLETE_DEAL"));
  assert.throws(request({ quote: { landed_cost: 2000 } }), refuses("QUOTE_INCONSISTENT"));
  assert.throws(request({ quote: { freight: undefined, landed_cost: 3250 } }), refuses("QUOTE_INCONSISTENT"));
  assert.deepEqual(repo.listApprovals(businessId), []);

  // The same unit written differently is the same unit.
  assert.equal(request({ quote: { unit: "Kgs." }, requirement: { unit: "किलो" } })().approval.total_amount, 3250);

  const tamil = seedBusiness({ language: "ta-IN" });
  assert.throws(() => approvals.requestApproval(tamil, seedQuote(tamil).id), refuses("UNSUPPORTED_LANGUAGE"));
});

test("approval cannot be requested for another business's quote or a quote that does not exist", () => {
  const owner = seedBusiness({ name: "Owner" });
  const other = seedBusiness({ name: "Other" });
  const quote = seedQuote(owner);
  assert.throws(() => approvals.requestApproval(other, quote.id), refuses("QUOTE_NOT_FOUND"));
  assert.throws(() => approvals.requestApproval(owner, "quo_missing"), refuses("QUOTE_NOT_FOUND"));
  assert.deepEqual(repo.listApprovals(owner), []);
  assert.deepEqual(repo.listApprovals(other), []);
});

test("asking twice for the same deal returns the open approval; a changed deal withdraws it and asks afresh", () => {
  const businessId = seedBusiness({ language: "en-IN" });
  const quote = seedQuote(businessId);
  const first = approvals.requestApproval(businessId, quote.id);
  const again = approvals.requestApproval(businessId, quote.id);
  assert.equal(again.created, false);
  assert.equal(again.approval.id, first.approval.id);
  assert.equal(repo.listApprovals(businessId).length, 1);

  // The owner changes the quantity; the quote is re-costed.
  repo.updateRequirement(businessId, quote.requirement_id, { quantity: 80 });
  assert.throws(() => approvals.requestApproval(businessId, quote.id), refuses("QUOTE_INCONSISTENT"), "stale landed cost");
  repo.setQuoteLandedCost(businessId, quote.id, 80 * 62 + 150);

  const fresh = approvals.requestApproval(businessId, quote.id);
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.approval.id, first.approval.id);
  assert.equal(fresh.approval.total_amount, 5110);
  assert.match(fresh.approval.readback, /80 kg of basmati rice .* Total 5110 rupees/);
  assert.equal(repo.getApproval(businessId, first.approval.id).status, "rejected");
  assert.deepEqual(auditTypes(businessId), ["approval.requested", "approval.decided", "approval.requested"]);
  assert.match(repo.listAudit(businessId)[1].detail.reason, /deal changed/);
});

/* ------------------------------------------------------ spoken consent --- */

test("isAffirmative accepts a clear yes in English, Hindi and Kannada", () => {
  const yes = [
    "haan", "Haan.", "हाँ", "हां", "हाँ जी", "जी हाँ, कर दो", "ठीक है", "हाँ, ऑर्डर पक्का करो", "बिल्कुल", "मंज़ूर है", "haan ji kar do", "theek hai",
    "ಹೌದು", "ಹೌದು, ಮಾಡಿ", "ಸರಿ", "ಆಯ್ತು", "ಹೌದು ಸರ್ ಆರ್ಡರ್ ಮಾಡಿ", "houdu",
    "yes", "Yes!", "yes go ahead", "Yes, go ahead.", "okay", "ok confirm it", "yes please place the order", "sure, go ahead", "that's fine", "I confirm",
  ];
  for (const utterance of yes) assert.equal(approvals.isAffirmative(utterance), true, utterance);
});

test("isAffirmative rejects hedges, negations, questions, conditions and anything it does not understand", () => {
  const notYes = [
    "maybe", "wait", "yes but wait", "ok wait", "maybe yes", "not now", "no", "No.", "nope", "don't", "do not confirm", "yes... no",
    "नहीं", "नही", "हाँ नहीं", "मत करो", "रुको", "शायद", "ना", "nahi", "nahin", "abhi nahi", "ruko", "shayad", "haan lekin kal",
    "ಬೇಡ", "ಇಲ್ಲ", "ಬೇಡ, ನಿಲ್ಲಿಸಿ", "ಬಹುಶಃ", "ಸ್ವಲ್ಪ ಇರಿ", "beda", "illa",
    "yes?", "हाँ?", "ok?", "yes if the freight is included", "yes but make it 80 kg", "haan 100 kilo", "what is the total", "kitna hua",
    "let me think", "call me later", "", "   ", "...", "12345", undefined, null,
  ];
  for (const utterance of notYes) assert.equal(approvals.isAffirmative(utterance), false, String(utterance));
});

test("classifyUtterance tells a no from an unclear reply", () => {
  assert.equal(approvals.classifyUtterance("हाँ, कर दो"), "affirmative");
  for (const no of ["no", "नहीं", "ಬೇಡ", "nahi, cancel", "do not"]) assert.equal(approvals.classifyUtterance(no), "negative", no);
  for (const unclear of ["maybe", "wait", "रुको", "yes?", "what", ""]) assert.equal(approvals.classifyUtterance(unclear), "unclear", unclear);
});

/* ------------------------------------------------------------ the gate --- */

test("a spoken yes approves, and the owner's words are stored on the approval and in the audit log", () => {
  const businessId = seedBusiness();
  const session = repo.createSession(businessId, { kind: "owner" });
  const { approval } = approvals.requestApproval(businessId, seedQuote(businessId).id, { sessionId: session.id });

  const decided = approvals.confirmApproval(businessId, approval.id, {
    decision: "approve", via: "voice", evidenceUtterance: "  हाँ, कर दो  ", evidenceAt: new Date(Date.now() + 1000).toISOString(), sessionId: session.id,
  });
  assert.equal(decided.status, "approved");
  assert.equal(decided.decided_via, "voice");
  assert.equal(decided.evidence_utterance, "हाँ, कर दो");
  assert.ok(decided.decided_at);

  const row = repo.listAudit(businessId, { type: "approval.decided" })[0];
  assert.equal(row.actor, "owner");
  assert.equal(row.session_id, session.id);
  assert.deepEqual(row.detail, {
    approvalId: approval.id, quoteId: approval.quote_id, status: "approved", readback: approval.readback,
    totalAmount: 3250, via: "voice", evidenceUtterance: "हाँ, कर दो",
  });
  assert.equal(approvals.assertApproved(businessId, approval.id).approval.id, approval.id);
});

test("a spoken reply that is not a clear yes leaves the approval pending", () => {
  const businessId = seedBusiness();
  const { approval } = approvals.requestApproval(businessId, seedQuote(businessId).id);
  const approve = (extra) => () => approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "voice", ...extra });

  assert.throws(approve({ evidenceUtterance: "maybe" }), refuses("NOT_AFFIRMATIVE"));
  assert.throws(approve({ evidenceUtterance: "रुको" }), refuses("NOT_AFFIRMATIVE"));
  assert.throws(approve({ evidenceUtterance: "नहीं" }), refuses("NOT_AFFIRMATIVE"));
  assert.throws(approve({ evidenceUtterance: "" }), refuses("EVIDENCE_REQUIRED"));
  assert.throws(approve({}), refuses("EVIDENCE_REQUIRED"));
  assert.throws(approve({ evidenceUtterance: "haan", evidenceAt: "2020-01-01T00:00:00.000Z" }), refuses("EVIDENCE_TOO_OLD"));
  assert.throws(approve({ evidenceUtterance: "haan", evidenceAt: "not a date" }), refuses("EVIDENCE_TOO_OLD"));
  assert.throws(() => approvals.confirmApproval(businessId, approval.id, { decision: "reject", via: "voice", evidenceUtterance: "हाँ" }), refuses("NOT_NEGATIVE"));
  assert.throws(() => approvals.confirmApproval(businessId, approval.id, { decision: "yes", via: "voice", evidenceUtterance: "haan" }), refuses("INVALID_DECISION"));
  assert.throws(() => approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "telepathy" }), refuses("INVALID_VIA"));

  assert.equal(repo.getApproval(businessId, approval.id).status, "pending");
  assert.deepEqual(auditTypes(businessId), ["approval.requested"]);
  assert.throws(() => approvals.assertApproved(businessId, approval.id), refuses("NOT_APPROVED"));
});

test("the button approves or rejects without an utterance, and a decision is final", () => {
  const businessId = seedBusiness();
  const approved = approvals.requestApproval(businessId, seedQuote(businessId).id).approval;
  const byButton = approvals.confirmApproval(businessId, approved.id, { decision: "approve", via: "button", evidenceUtterance: "ignored for a button" });
  assert.equal(byButton.status, "approved");
  assert.equal(byButton.decided_via, "button");
  assert.equal(byButton.evidence_utterance, null);
  assert.throws(() => approvals.confirmApproval(businessId, approved.id, { decision: "reject", via: "button" }), refuses("ALREADY_DECIDED"));
  assert.equal(repo.getApproval(businessId, approved.id).status, "approved");

  const rejected = approvals.requestApproval(businessId, seedQuote(businessId).id).approval;
  assert.equal(approvals.confirmApproval(businessId, rejected.id, { decision: "reject", via: "voice", evidenceUtterance: "नहीं, रहने दो" }).status, "rejected");
  assert.throws(() => approvals.confirmApproval(businessId, rejected.id, { decision: "approve", via: "button" }), refuses("ALREADY_DECIDED"));
  assert.throws(() => approvals.assertApproved(businessId, rejected.id), refuses("NOT_APPROVED"));
});

test("an approval of another business can be neither decided nor relied on", () => {
  const owner = seedBusiness({ name: "Owner" });
  const other = seedBusiness({ name: "Other" });
  const pending = approvals.requestApproval(owner, seedQuote(owner).id).approval;
  const approved = approvals.requestApproval(owner, seedQuote(owner).id).approval;
  approvals.confirmApproval(owner, approved.id, { decision: "approve", via: "button" });

  assert.throws(() => approvals.confirmApproval(other, pending.id, { decision: "approve", via: "button" }), refuses("APPROVAL_NOT_FOUND"));
  assert.throws(() => approvals.assertApproved(other, approved.id), refuses("APPROVAL_NOT_FOUND"));
  assert.throws(() => approvals.assertApproved(owner, "apr_missing"), refuses("APPROVAL_NOT_FOUND"));
  assert.equal(repo.getApproval(owner, pending.id).status, "pending");
  assert.deepEqual(repo.listAudit(other), []);
});

test("an approval stops counting the moment the deal behind it changes", () => {
  const businessId = seedBusiness();
  const quote = seedQuote(businessId);
  const pending = approvals.requestApproval(businessId, quote.id).approval;

  repo.updateRequirement(businessId, quote.requirement_id, { quantity: 80 });
  repo.setQuoteLandedCost(businessId, quote.id, 80 * 62 + 150);
  assert.throws(() => approvals.confirmApproval(businessId, pending.id, { decision: "approve", via: "button" }), refuses("APPROVAL_STALE"));
  assert.equal(repo.getApproval(businessId, pending.id).status, "pending");
  // Rejecting a stale approval is still possible.
  assert.equal(approvals.confirmApproval(businessId, pending.id, { decision: "reject", via: "button" }).status, "rejected");

  const fresh = approvals.requestApproval(businessId, quote.id).approval;
  approvals.confirmApproval(businessId, fresh.id, { decision: "approve", via: "button" });
  assert.ok(approvals.assertApproved(businessId, fresh.id));

  repo.updateRequirement(businessId, quote.requirement_id, { quantity: 81 });
  repo.setQuoteLandedCost(businessId, quote.id, 81 * 62 + 150);
  assert.throws(() => approvals.assertApproved(businessId, fresh.id), refuses("APPROVAL_STALE"));

  const renewed = approvals.requestApproval(businessId, quote.id);
  assert.equal(renewed.created, true);
  assert.equal(repo.getApproval(businessId, fresh.id).status, "rejected", "the approved-but-stale approval is withdrawn");
});

test("an approval survives a change of the business language, because the deal is the same", () => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const quote = seedQuote(businessId);
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  repo.updateBusiness(businessId, { language: "kn-IN" });
  assert.ok(approvals.assertApproved(businessId, approval.id));
  assert.equal(approvals.requestApproval(businessId, quote.id).approval.id, approval.id);
});

test("assertOrderApproved accepts only an order that rests on its own used approval", () => {
  const businessId = seedBusiness();
  const quote = seedQuote(businessId);
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  const order = repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "TEST/2026/" });

  assert.equal(approvals.assertOrderApproved(businessId, order).id, approval.id);
  const wrong = refuses("ORDER_NOT_APPROVED");
  assert.throws(() => approvals.assertOrderApproved(seedBusiness({ name: "Other" }), order), wrong);
  assert.throws(() => approvals.assertOrderApproved(businessId, { ...order, amount: order.amount + 1 }), wrong);
  assert.throws(() => approvals.assertOrderApproved(businessId, { ...order, quote_id: "quo_other" }), wrong);
  assert.throws(() => approvals.assertOrderApproved(businessId, { ...order, approval_id: "apr_missing" }), wrong);

  assert.throws(() => approvals.assertApproved(businessId, approval.id), refuses("APPROVAL_CONSUMED"));
  assert.throws(() => approvals.requestApproval(businessId, quote.id), refuses("ALREADY_ORDERED"));
});
