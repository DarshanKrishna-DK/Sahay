"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  SESSION_SIGNING_SECRET: "test-secret-".padEnd(48, "x"),
  PUBLIC_URL: "https://sahay.test",
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210", // fake test value
  AGORA_CUSTOMER_ID: "test-customer",
  AGORA_CUSTOMER_SECRET: "test-customer-secret",
  MURF_API_KEY: "test-murf-key",
  TELEGRAM_BOT_TOKEN: "",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const events = require("../src/events");
const agent = require("../src/agora/agent");
const registry = require("../src/tools/registry");
const customers = require("../src/sell/customers");
const khata = require("../src/sell/khata");
const khataTools = require("../src/tools/khata");
const { scriptProblems } = require("../src/agora/script");

/* ------------------------------------------------- fixtures (this test) --- */

function seedBusiness({ language = "en-IN", name = "Asha Stores" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, city: "Bengaluru", language });
  return id;
}

let seq = 0;
/**
 * An invoice issued the way SELL's gate leaves it: a draft, asked, approved, consumed and then
 * issued with a number, written straight to the tables because only its total and dates matter here.
 */
function issueInvoice(businessId, customerId, totalPaise, issuedAt = new Date().toISOString(), { payUrl = null } = {}) {
  const id = repo.newId("inv");
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO invoices (id, business_id, customer_id, kind, status, supplier_state, place_of_supply, intra_state,
       taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at)
     VALUES (?, ?, ?, 'bill', 'draft', '29', '29', 1, ?, 0, 0, 0, ?, ?)`,
  ).run(id, businessId, customerId, totalPaise, totalPaise, at);
  db.prepare("UPDATE invoices SET status = 'pending' WHERE id = ?").run(id);
  const approvalId = repo.newId("iap");
  db.prepare("INSERT INTO invoice_approvals (id, business_id, invoice_id, status, readback, total_paise, requested_at) VALUES (?, ?, ?, 'pending', 'test', ?, ?)").run(approvalId, businessId, id, totalPaise, at);
  db.prepare("UPDATE invoice_approvals SET status = 'approved', decided_via = 'button', decided_at = ? WHERE id = ?").run(at, approvalId);
  db.prepare("UPDATE invoice_approvals SET status = 'consumed' WHERE id = ?").run(approvalId);
  seq += 1;
  const number = `INV/2026-27/${String(seq).padStart(4, "0")}`;
  db.prepare("UPDATE invoices SET status = 'issued', number = ?, fy = '2026-27', seq = ?, approval_id = ?, issued_at = ?, pay_url = ? WHERE id = ?").run(number, seq, approvalId, issuedAt, payUrl, id);
  return { id, number };
}

/**
 * A live call at the Agora REST boundary: /speak lines show up in /history as server lines
 * (source "command"), and call.owner(words) adds the owner's ASR turn.
 */
function fakeCall(t, { failSpeak = false } = {}) {
  const call = { spoken: [], speakBodies: [], items: [], turn: 0 };
  call.owner = (content) => call.items.push({ role: "user", content, metadata: { source: "asr" }, turn_id: ++call.turn });
  call.speak = (content) => call.items.push({ role: "assistant", content, metadata: { source: "command" }, turn_id: ++call.turn });
  agent.setFetch(async (url, init) => {
    let out;
    if (/\/speak$/.test(url)) {
      if (failSpeak) out = { status: 503, json: { reason: "busy" } };
      else {
        const body = JSON.parse(init.body);
        call.speakBodies.push(body);
        call.spoken.push(body.text);
        call.speak(body.text);
        out = { json: { agent_id: "AG" } };
      }
    } else if (/\/history$/.test(url)) out = { json: { contents: call.items.slice() } };
    else throw new Error(`unexpected Agora call ${url}`);
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  });
  t.after(() => agent.setFetch(null));
  return call;
}

function ownerCtx(businessId, { agentId = null } = {}) {
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: session.id, agentId, actor: "agent", toolScope: "owner" };
}

async function expectToolError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.name, "ToolError");
    assert.equal(err.code, code);
    assert.ok(err.say, "a refusal has a spoken line");
    return true;
  });
}

const receiptCount = (businessId) => db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(businessId).n;

test("the khata tools are owner tools in the registry, not negotiation tools", () => {
  for (const name of ["record_payment", "who_owes_me", "send_payment_reminder"]) {
    assert.ok(registry.toolNames("owner").includes(name), name);
    assert.ok(!registry.toolNames("negotiation").includes(name), name);
  }
});

test("record_payment in a call: the server reads the payment back itself, and only a spoken yes after it writes it down", async (t) => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const ramesh = customers.save(businessId, { name: "रमेश" }).customer;
  issueInvoice(businessId, ramesh.id, 500000);
  const ctx = ownerCtx(businessId, { agentId: "AGV" });
  const call = fakeCall(t);
  call.owner("रमेश ने 2000 रुपये नकद दिए");

  const asked = await registry.callTool(ctx, "record_payment", { customer: "रमेश", amount: 2000, mode: "cash", owner_words: "रमेश ने 2000 रुपये नकद दिए" });
  assert.equal(asked.status, "awaiting_answer");
  assert.equal(asked.say, "क्या मैं यह खाते में लिख दूँ?");
  assert.deepEqual(call.spoken, ["रमेश से 2 हज़ार रुपये नकद मिले, उनके खाते में।"]);
  assert.equal(call.speakBodies[0].priority, "APPEND");
  assert.equal(call.speakBodies[0].interruptable, false);
  assert.equal(asked.readback, undefined, "the model gets no figures to re-read");
  assert.equal(receiptCount(businessId), 0);

  // The model claims a yes before the owner answered: refused, even after the history retries.
  await expectToolError(registry.callTool(ctx, "record_payment", { decision: "confirm" }), "NO_ANSWER_YET");
  // No call, or another call: no voice evidence.
  await expectToolError(registry.callTool({ ...ctx, agentId: null }, "record_payment", { decision: "confirm" }), "NO_VOICE_EVIDENCE");
  await expectToolError(registry.callTool({ ...ctx, agentId: "AGX" }, "record_payment", { decision: "confirm" }), "READBACK_NOT_SPOKEN");
  call.owner("पता नहीं");
  await expectToolError(registry.callTool(ctx, "record_payment", { decision: "confirm" }), "NOT_AFFIRMATIVE");
  assert.equal(receiptCount(businessId), 0);

  call.owner("हाँ");
  const done = await registry.callTool(ctx, "record_payment", { decision: "confirm" });
  assert.equal(done.recorded, true);
  assert.equal(done.receipt.evidence_utterance, "हाँ");
  assert.equal(done.receipt.recorded_via, "voice");
  assert.equal(done.say, "लिख लिया: रमेश से 2 हज़ार रुपये। अब उनके 3 हज़ार रुपये बाकी हैं।");
  assert.equal(receiptCount(businessId), 1);
  await expectToolError(registry.callTool(ctx, "record_payment", { decision: "confirm" }), "NO_PENDING_PAYMENT");
});

test("record_payment refuses figures the owner did not say, never guesses a customer, and cancels on a no", async (t) => {
  const businessId = seedBusiness({ language: "en-IN" });
  const ramesh = customers.save(businessId, { name: "Ramesh Kumar" }).customer;
  customers.save(businessId, { name: "Ramesh Rao" });
  customers.save(businessId, { name: "Suresh" });
  issueInvoice(businessId, ramesh.id, 100000);
  const ctx = ownerCtx(businessId, { agentId: "AGE" });
  const call = fakeCall(t);

  call.owner("Ramesh Kumar paid me in cash");
  const noAmount = await registry.callTool(ctx, "record_payment", { customer: "Ramesh Kumar", amount: 500, mode: "cash" });
  assert.equal(noAmount.status, "not_heard");
  assert.deepEqual(noAmount.missing, ["amount"]);
  call.owner("one minute");
  call.owner("Suresh paid 500 cash");
  const wrongName = await registry.callTool(ctx, "record_payment", { customer: "Ramesh Kumar", amount: 500, mode: "cash" });
  assert.deepEqual(wrongName.missing, ["customer"]);
  assert.deepEqual(call.spoken, [], "nothing read back for unheard figures");

  call.owner("Ramesh paid 500 cash");
  await expectToolError(registry.callTool(ctx, "record_payment", { customer: "Ramesh", amount: 500, mode: "cash" }), "AMBIGUOUS_CUSTOMER");
  call.owner("Mohan paid 500 cash");
  await expectToolError(registry.callTool(ctx, "record_payment", { customer: "Mohan", amount: 500, mode: "cash" }), "CUSTOMER_NOT_FOUND");
  const missing = await registry.callTool(ctx, "record_payment", { customer: "Ramesh Kumar" });
  assert.equal(missing.status, "need_details");
  await expectToolError(registry.callTool(ctx, "record_payment", { customer: "Ramesh Kumar", amount: 500, mode: "cheque" }), "INVALID_ARGUMENTS");

  call.owner("Ramesh Kumar paid 500 by UPI");
  const asked = await registry.callTool(ctx, "record_payment", { customer: "Ramesh Kumar", amount: 500, mode: "upi" });
  assert.equal(call.spoken.at(-1), "Ramesh Kumar paid 500 rupees by UPI, on their account.");
  call.owner("no, it was cash");
  const cancelled = await registry.callTool(ctx, "record_payment", { decision: "cancel" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(khata.getDraft(businessId, asked.draftId).status, "withdrawn");
  assert.equal(receiptCount(businessId), 0);
});

test("record_payment off a call reads the payment back for the button and writes nothing; a failed read-back writes nothing", async (t) => {
  const businessId = seedBusiness({ language: "kn-IN" });
  const ramesh = customers.save(businessId, { name: "ರಮೇಶ್" }).customer;
  issueInvoice(businessId, ramesh.id, 100000);
  const off = await registry.callTool(ownerCtx(businessId), "record_payment", { customer: "ರಮೇಶ್", amount: 1500, mode: "cash", owner_words: "ರಮೇಶ್ 1500 ನಗದು ಕೊಟ್ಟರು" });
  assert.equal(off.status, "needs_button");
  assert.match(off.say, /^ರಮೇಶ್ ಅವರಿಂದ 1 ಸಾವಿರ 500 ರೂಪಾಯಿ ನಗದು ಬಂದಿದೆ, ಅವರ ಖಾತೆಗೆ\. /);
  assert.equal(khata.pendingDraft(businessId), null);

  fakeCall(t, { failSpeak: true });
  await expectToolError(
    registry.callTool(ownerCtx(businessId, { agentId: "AGK" }), "record_payment", { customer: "ರಮೇಶ್", amount: 1500, mode: "cash", owner_words: "ರಮೇಶ್ 1500 ನಗದು ಕೊಟ್ಟರು" }),
    "READBACK_NOT_SPOKEN",
  );
  await expectToolError(registry.callTool(ownerCtx(businessId, { agentId: "AGK" }), "record_payment", { decision: "confirm" }), "READBACK_NOT_SPOKEN");
  assert.equal(receiptCount(businessId), 0);
});

test("who_owes_me speaks the largest first in natural Indian numbering, in hi, kn and en", async () => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const a = customers.save(businessId, { name: "रमेश" }).customer;
  const b = customers.save(businessId, { name: "सुरेश" }).customer;
  issueInvoice(businessId, a.id, 12550000, new Date(now - 12 * day).toISOString());
  issueInvoice(businessId, b.id, 200000, new Date(now - 3 * day).toISOString());
  const ctx = ownerCtx(businessId);

  const hi = await registry.callTool(ctx, "who_owes_me", {});
  assert.equal(hi.say, "सबसे ज़्यादा बाकी: रमेश 1 लाख 25 हज़ार 500 रुपये, 12 दिन से; सुरेश 2 हज़ार रुपये, 3 दिन से। कुल 1 लाख 27 हज़ार 500 रुपये बाकी हैं, 2 लोगों से।");
  assert.deepEqual(hi.owed.map((r) => r.customer.name), ["रमेश", "सुरेश"]);
  assert.equal(hi.total, 127500);
  const kn = await registry.callTool(ctx, "who_owes_me", { reply_language: "kn-IN" });
  assert.match(kn.say, /^ಹೆಚ್ಚು ಬಾಕಿ ಇರುವವರು: रमेश 1 ಲಕ್ಷ 25 ಸಾವಿರ 500 ರೂಪಾಯಿ, 12 ದಿನಗಳಿಂದ; /);
  const en = await registry.callTool(ctx, "who_owes_me", { reply_language: "en-IN", customer: "सुरेश" });
  assert.equal(en.say, "सुरेश owes 2 thousand rupees, for 3 days.");

  khata.recordReceipt(businessId, { customerId: b.id, amount: 2000, mode: "cash" });
  assert.equal((await registry.callTool(ctx, "who_owes_me", { customer: "सुरेश" })).say, "सुरेश का कुछ बाकी नहीं है।");
  const empty = await registry.callTool(ownerCtx(seedBusiness({ language: "kn-IN" })), "who_owes_me", {});
  assert.equal(empty.say, "ಈಗ ಯಾರದೂ ಹಣ ಬಾಕಿ ಇಲ್ಲ.");
  assert.deepEqual(empty.owed, []);
});

test("send_payment_reminder gives the WhatsApp link and text and emits reminder.sent; another business's customer is not found", async (t) => {
  const businessId = seedBusiness({ language: "en-IN", name: "Asha Stores" });
  const ramesh = customers.save(businessId, { name: "Ramesh", phone: "9845012345" }).customer;
  issueInvoice(businessId, ramesh.id, 75000);
  const seen = [];
  t.after(events.subscribe(businessId, (e) => seen.push(e)));

  const out = await registry.callTool(ownerCtx(businessId), "send_payment_reminder", { customer: "Ramesh" });
  assert.match(out.shareUrl, /^https:\/\/wa\.me\/919845012345\?text=Hello%20Ramesh%2C%20a%20gentle%20reminder%20from%20Asha%20Stores/);
  assert.match(out.text, /₹750 is due/);
  assert.deepEqual(out.telegram, { sent: false, reason: "not_configured" });
  assert.equal(out.say, "The reminder for Ramesh is ready, 750 rupees due; the WhatsApp send button is on your screen.");
  assert.equal(seen.filter((e) => e.type === "reminder.sent").length, 1);
  assert.equal(seen.find((e) => e.type === "reminder.sent").actor, "agent");

  await expectToolError(registry.callTool(ownerCtx(seedBusiness()), "send_payment_reminder", { customer: "Ramesh" }), "CUSTOMER_NOT_FOUND");
  khata.recordReceipt(businessId, { customerId: ramesh.id, amount: 750, mode: "upi" });
  await expectToolError(registry.callTool(ownerCtx(businessId), "send_payment_reminder", { customer: "Ramesh" }), "NOTHING_OWED");
  await expectToolError(registry.callTool(ownerCtx(businessId), "send_payment_reminder", {}), "INVALID_ARGUMENTS");
});

test("every Hindi and Kannada line of the khata tools is in its own script (CLAUDE.md rule 5)", () => {
  const vars = { amount: "2", left: "1", readback: "", list: "", total: "3", count: 2, days: 3, telegram: true };
  for (const [key, lines] of Object.entries(khataTools.PHRASES)) {
    for (const lang of ["hi-IN", "kn-IN"]) {
      const text = lines[lang]({ ...vars, name: lang === "kn-IN" ? "ಹೆಸರು" : "नाम" });
      assert.deepEqual(scriptProblems(text, lang), { latin: [], foreign: false }, `${key} ${lang}: ${text}`);
    }
  }
  for (const [code, lines] of Object.entries(khataTools.SAY)) {
    for (const lang of ["hi-IN", "kn-IN"]) assert.deepEqual(scriptProblems(lines[lang], lang), { latin: [], foreign: false }, `${code} ${lang}`);
  }
  for (const lang of ["hi-IN", "kn-IN"]) {
    const readback = khata.receiptReadback(lang, { name: lang === "kn-IN" ? "ರಮೇಶ್" : "रमेश", amountPaise: 12550050, mode: "upi", invoice: true });
    assert.deepEqual(scriptProblems(readback, lang), { latin: [], foreign: false }, readback);
  }
});
