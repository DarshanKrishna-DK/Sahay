"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const events = require("../src/events");
const customers = require("../src/sell/customers");
const khata = require("../src/sell/khata");
const agent = require("../src/agora/agent");

const DAY = 24 * 60 * 60 * 1000;

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

function captureEvents(t, businessId) {
  const seen = [];
  const off = events.subscribe(businessId, (e) => seen.push(e));
  t.after(off);
  return seen;
}

test("spokenRupees says amounts the Indian way in each language, paise included", () => {
  assert.equal(khata.spokenRupees(12550000, "hi-IN"), "1 लाख 25 हज़ार 500 रुपये");
  assert.equal(khata.spokenRupees(12550000, "kn-IN"), "1 ಲಕ್ಷ 25 ಸಾವಿರ 500 ರೂಪಾಯಿ");
  assert.equal(khata.spokenRupees(12550000, "en-IN"), "1 lakh 25 thousand 500 rupees");
  assert.equal(khata.spokenRupees(200000, "hi-IN"), "2 हज़ार रुपये");
  assert.equal(khata.spokenRupees(3_00_00_000_00, "en-IN"), "3 crore rupees");
  assert.equal(khata.spokenRupees(100, "en-IN"), "1 rupee");
  assert.equal(khata.spokenRupees(100, "hi-IN"), "1 रुपया");
  assert.equal(khata.spokenRupees(205050, "kn-IN"), "2 ಸಾವಿರ 50 ರೂಪಾಯಿ 50 ಪೈಸೆ");
  assert.equal(khata.spokenRupees(50, "en-IN"), "0 rupees 50 paise");
  assert.equal(khata.formatRupees(12500000), "₹1,25,000");
  assert.equal(khata.formatRupees(12500050), "₹1,25,000.50");
});

test("toPaise refuses zero, negatives, three decimals, text and more than 1 crore", () => {
  assert.equal(khata.toPaise(2000), 200000);
  assert.equal(khata.toPaise(19.99), 1999);
  assert.equal(khata.toPaise("150.5"), 15050);
  for (const bad of [0, -5, 1.234, "abc", NaN, Infinity, null, undefined, 10_000_001]) {
    assert.throws(() => khata.toPaise(bad), { code: "INVALID_AMOUNT" }, String(bad));
  }
});

test("owed = issued invoices minus receipts, largest first, oldest open bill after FIFO, invoice statuses move forward", (t) => {
  const businessId = seedBusiness();
  const seen = captureEvents(t, businessId);
  const ramesh = customers.save(businessId, { name: "रमेश", phone: "9845012345" }).customer;
  const suresh = customers.save(businessId, { name: "सुरेश" }).customer;
  const now = Date.now();
  const old = issueInvoice(businessId, ramesh.id, 300000, new Date(now - 12 * DAY).toISOString());
  const newer = issueInvoice(businessId, ramesh.id, 200000, new Date(now - 2 * DAY).toISOString());
  issueInvoice(businessId, suresh.id, 150000, new Date(now - 5 * DAY).toISOString());

  let rows = khata.owed(businessId, { at: now });
  assert.deepEqual(rows.map((r) => [r.customer.name, r.amount, r.days]), [["रमेश", 5000, 12], ["सुरेश", 1500, 5]]);

  // ₹3,500 on account: covers the oldest bill (3,000) and 500 of the newer one.
  const onAccount = khata.recordReceipt(businessId, { customerId: ramesh.id, amount: 3500, mode: "cash" });
  assert.equal(onAccount.invoice_id, null);
  assert.equal(onAccount.recorded_via, "button");
  rows = khata.owed(businessId, { at: now });
  assert.deepEqual(rows.map((r) => [r.customer.name, r.amount, r.days]), [["सुरेश", 1500, 5], ["रमेश", 1500, 2]]);
  assert.deepEqual(rows[1].invoices.map((i) => [i.id, i.open]), [[newer.id, 1500]]);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(old.id).status, "paid");
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(newer.id).status, "part_paid");

  const last = seen.filter((e) => e.type === "receipt.recorded").at(-1);
  assert.equal(last.data.receipt.id, onAccount.id);
  assert.equal(last.data.owed, 1500);
  assert.equal(last.actor, "owner");

  // Against the newer bill exactly: Ramesh is clear and drops off the list.
  khata.recordReceipt(businessId, { customerId: ramesh.id, amount: 1500, mode: "upi", invoiceId: newer.id });
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(newer.id).status, "paid");
  assert.deepEqual(khata.owed(businessId).map((r) => r.customer.name), ["सुरेश"]);

  const summary = khata.summary(businessId);
  assert.deepEqual(Object.keys(summary).sort(), ["owed", "receipts"]);
  assert.equal(summary.receipts.length, 2);
  assert.equal(summary.receipts[0].customer_name, "रमेश");
  assert.equal(summary.receipts[0].invoice_number, newer.number);
});

test("a receipt is refused for another business's customer, another customer's bill, more than a bill has open, or a bad mode", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const ramesh = customers.save(a, { name: "Ramesh" }).customer;
  const mohan = customers.save(a, { name: "Mohan" }).customer;
  const stranger = customers.save(b, { name: "Ramesh" }).customer;
  const bill = issueInvoice(a, ramesh.id, 100000);

  assert.throws(() => khata.recordReceipt(a, { customerId: stranger.id, amount: 10, mode: "cash" }), { code: "CUSTOMER_NOT_FOUND", status: 404 });
  assert.throws(() => khata.recordReceipt(b, { customerId: ramesh.id, amount: 10, mode: "cash" }), { code: "CUSTOMER_NOT_FOUND" });
  assert.throws(() => khata.recordReceipt(a, { customerId: mohan.id, amount: 10, mode: "cash", invoiceId: bill.id }), { code: "INVOICE_NOT_FOUND" });
  assert.throws(() => khata.recordReceipt(a, { customerId: ramesh.id, amount: 1000.01, mode: "cash", invoiceId: bill.id }), { code: "AMOUNT_EXCEEDS_INVOICE" });
  assert.throws(() => khata.recordReceipt(a, { customerId: ramesh.id, amount: 10, mode: "razorpay_test" }), { code: "INVALID_MODE" });
  assert.throws(() => khata.recordReceipt(a, { customerId: ramesh.id, amount: 10, mode: "cheque" }), { code: "INVALID_MODE" });
  assert.throws(() => khata.recordReceipt("", { customerId: ramesh.id, amount: 10, mode: "cash" }), { code: "BUSINESS_REQUIRED" });

  const draftBill = db.prepare("SELECT id FROM invoices WHERE business_id = ? AND status = 'draft'").get(a);
  assert.equal(draftBill, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(a).n, 0, "nothing was written");
});

test("the database refuses a cross-business receipt and any change or deletion of a receipt", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const ramesh = customers.save(a, { name: "Ramesh" }).customer;
  const insert = (businessId) =>
    db.prepare("INSERT INTO receipts (id, business_id, customer_id, amount_paise, mode, recorded_via, created_at) VALUES (?, ?, ?, 100, 'cash', 'button', ?)").run(repo.newId("rcp"), businessId, ramesh.id, new Date().toISOString());
  assert.throws(() => insert(b), /customer of the same business/);
  const r = khata.recordReceipt(a, { customerId: ramesh.id, amount: 5, mode: "cash" });
  assert.throws(() => db.prepare("UPDATE receipts SET amount_paise = 1 WHERE id = ?").run(r.id), /cannot be changed/);
  assert.throws(() => db.prepare("DELETE FROM receipts WHERE id = ?").run(r.id), /cannot be deleted/);
  assert.throws(
    () => db.prepare("INSERT INTO receipts (id, business_id, customer_id, amount_paise, mode, recorded_via, created_at) VALUES (?, ?, ?, 100, 'razorpay_test', 'button', ?)").run(repo.newId("rcp"), a, ramesh.id, new Date().toISOString()),
    /CHECK constraint/,
    "razorpay_test only with recorded_via razorpay",
  );
  const bill = issueInvoice(a, ramesh.id, 1000);
  assert.throws(
    () => db.prepare("INSERT INTO receipts (id, business_id, customer_id, invoice_id, amount_paise, mode, recorded_via, created_at) VALUES (?, ?, ?, ?, 100, 'razorpay_test', 'razorpay', ?)").run(repo.newId("rcp"), a, ramesh.id, bill.id, new Date().toISOString()),
    /CHECK constraint/,
    "a Razorpay receipt names its payment id",
  );
});

test("invoice.paid from a Razorpay test checkout becomes one razorpay_test receipt, however often it is heard", (t) => {
  const businessId = seedBusiness();
  const other = seedBusiness();
  const seen = captureEvents(t, businessId);
  const ramesh = customers.save(businessId, { name: "Ramesh" }).customer;
  const bill = issueInvoice(businessId, ramesh.id, 250000);
  const event = { type: "invoice.paid", businessId, data: { invoiceId: bill.id, customerId: ramesh.id, amountPaise: 250000, razorpayPaymentId: "pay_Test0001", testMode: true } };

  // The event names another business: nothing (the invoice is not that business's).
  assert.equal(khata.onInvoicePaid({ ...event, businessId: other }), null);
  const receipt = khata.onInvoicePaid(event);
  assert.equal(receipt.mode, "razorpay_test");
  assert.equal(receipt.recorded_via, "razorpay");
  assert.equal(receipt.amount, 2500);
  assert.equal(khata.onInvoicePaid(event), null, "heard twice: still one receipt");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(businessId).n, 1);
  assert.equal(db.prepare("SELECT razorpay_payment_id AS p FROM receipts WHERE id = ?").get(receipt.id).p, "pay_Test0001");
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(bill.id).status, "paid");
  assert.deepEqual(khata.owed(businessId), []);
  assert.equal(seen.filter((e) => e.type === "receipt.recorded").at(-1).actor, "system");

  // A part payment online, then the rest: two payment ids, two receipts on one bill.
  const split = issueInvoice(businessId, ramesh.id, 100000);
  assert.equal(khata.invoiceOpenPaise(businessId, { id: split.id, customerId: ramesh.id }), 100000, "SELL's invoice shape");
  khata.onInvoicePaid({ type: "invoice.paid", businessId, data: { invoiceId: split.id, amountPaise: 40000, razorpayPaymentId: "pay_Part1", testMode: true } });
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(split.id).status, "part_paid");
  assert.equal(khata.invoiceOpenPaise(businessId, { id: split.id, customer_id: ramesh.id }), 60000);
  khata.onInvoicePaid({ type: "invoice.paid", businessId, data: { invoiceId: split.id, amountPaise: 60000, razorpayPaymentId: "pay_Part2", testMode: true } });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE invoice_id = ?").get(split.id).n, 2);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(split.id).status, "paid");
  assert.equal(khata.invoiceOpenPaise(businessId, { id: split.id, customerId: ramesh.id }), 0);
  assert.equal(khata.invoiceOpenPaise(other, { id: split.id, customerId: ramesh.id }), 0, "another business sees nothing open");
  // No payment id: refused, nothing written.
  const noId = issueInvoice(businessId, ramesh.id, 5000);
  assert.throws(() => khata.onInvoicePaid({ type: "invoice.paid", businessId, data: { invoiceId: noId.id, amountPaise: 5000 } }), { code: "PAYMENT_ID_MISSING" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE invoice_id = ?").get(noId.id).n, 0);

  // Through the bus (start() is idempotent): emitted invoice.paid of a fresh bill is recorded.
  const stop = khata.start();
  assert.equal(khata.start(), stop);
  t.after(stop);
  const second = issueInvoice(businessId, ramesh.id, 10000);
  events.emit(businessId, "invoice.paid", { invoiceId: second.id, customerId: ramesh.id, amountPaise: 10000, razorpayPaymentId: "pay_Test0002", testMode: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ? AND invoice_id = ?").get(businessId, second.id).n, 1);
});

test("a reminder has the text in the owner's language, a free wa.me link and a Telegram copy; nothing owed is refused", async (t) => {
  const businessId = seedBusiness({ language: "hi-IN", name: "आशा किराना" });
  const seen = captureEvents(t, businessId);
  const ramesh = customers.save(businessId, { name: "रमेश", phone: "+91 98450 12345" }).customer;
  const walkIn = customers.save(businessId, { name: "मोहन" }).customer;
  issueInvoice(businessId, ramesh.id, 200000, new Date(Date.UTC(2026, 10, 7, 6)).toISOString(), { payUrl: "https://sahay.test/pay/tok123" });
  issueInvoice(businessId, walkIn.id, 5000);

  const sentCopies = [];
  const telegram = { sendToOwner: async (b, text) => (sentCopies.push([b, text]), { sent: true, messageId: 7 }) };
  const out = await khata.remind(businessId, ramesh.id, { language: "hi-IN", telegram });
  assert.match(out.text, /^नमस्ते रमेश जी, आशा किराना की ओर से याद दिला रहे हैं: आपके ₹2,000 बाकी हैं \(बिल INV\/\S+, 07\/11\/2026\)। ऑनलाइन भुगतान: https:\/\/sahay\.test\/pay\/tok123 धन्यवाद।$/);
  assert.equal(out.shareUrl, `https://wa.me/919845012345?text=${encodeURIComponent(out.text)}`);
  assert.deepEqual(out.telegram, { sent: true });
  assert.equal(sentCopies.length, 1);
  assert.equal(sentCopies[0][0], businessId);
  assert.ok(sentCopies[0][1].includes(out.shareUrl));
  const ev = seen.find((e) => e.type === "reminder.sent");
  assert.equal(ev.data.customerId, ramesh.id);
  assert.equal(ev.data.shareUrl, out.shareUrl);

  // No phone: the owner picks the chat. Telegram failing does not lose the reminder.
  const failing = { sendToOwner: async () => { throw Object.assign(new Error("Telegram sendMessage refused"), { code: "REFUSED" }); } };
  const plain = await khata.remind(businessId, walkIn.id, { language: "en-IN", telegram: failing });
  assert.match(plain.shareUrl, /^https:\/\/wa\.me\/\?text=Hello%20/);
  assert.deepEqual(plain.telegram, { sent: false, reason: "error" });
  assert.ok(seen.some((e) => e.type === "error" && e.data.scope === "telegram"));

  khata.recordReceipt(businessId, { customerId: walkIn.id, amount: 50, mode: "cash" });
  await assert.rejects(khata.remind(businessId, walkIn.id, { telegram }), { code: "NOTHING_OWED" });
  await assert.rejects(khata.remind(seedBusiness(), ramesh.id, { telegram }), { code: "CUSTOMER_NOT_FOUND" });
  assert.equal(sentCopies.length, 1, "no copy for a refused reminder");
});

test("shareUrl of an issued invoice carries its summary and pay link to the customer's phone", () => {
  const businessId = seedBusiness({ language: "en-IN", name: "Asha Stores" });
  const ramesh = customers.save(businessId, { name: "Ramesh", phone: "9845012345" }).customer;
  const url = khata.shareUrl(businessId, { number: "INV/2026-27/0001", customerId: ramesh.id, totals: { totalPaise: 123450 }, payUrl: "https://sahay.test/pay/x" });
  assert.equal(url, `https://wa.me/919845012345?text=${encodeURIComponent("Hello Ramesh, your bill INV/2026-27/0001 from Asha Stores: ₹1,234.50. Pay online: https://sahay.test/pay/x Thank you.")}`);
  assert.equal(khata.shareUrl(businessId, { number: null, customerId: ramesh.id, totals: { totalPaise: 1 } }), null);
  assert.equal(khata.shareUrl(seedBusiness(), { number: "INV/1", customerId: ramesh.id, totals: { totalPaise: 1 } }), null, "another business's customer");
});

test("a heard payment is written only after the owner's spoken yes to the read-back the server spoke", async (t) => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const ramesh = customers.save(businessId, { name: "रमेश" }).customer;
  issueInvoice(businessId, ramesh.id, 500000);
  const call = fakeCall(t);

  const { draft } = khata.draftReceipt(businessId, { customerId: ramesh.id, amount: 2000, mode: "cash" }, { language: "hi-IN" });
  assert.equal(draft.readback, "रमेश से 2 हज़ार रुपये नकद मिले, उनके खाते में।");
  const history = () => call.items.slice();

  // Not spoken yet: no yes counts.
  call.owner("हाँ");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "READBACK_NOT_SPOKEN" });

  call.speak(draft.readback);
  khata.markDraftSpoken(businessId, draft.id, { agentId: "AGV", text: draft.readback });
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "NO_ANSWER_YET" }, "the earlier yes was before the read-back");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGX", history: history() }), { code: "READBACK_NOT_SPOKEN" }, "another call");
  call.owner("शायद");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "NOT_AFFIRMATIVE" });
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "cancel", agentId: "AGV", history: [...history(), { role: "user", content: "हाँ", metadata: { source: "asr" }, turn_id: 99 }] }), { code: "NOT_NEGATIVE" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(businessId).n, 0);

  // Security review r2 #3: the first answer after the read-back was a maybe; a later yes is not an answer to it.
  call.owner("हाँ जी");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "NOT_AFFIRMATIVE" });
  // Read out again, the next spoken yes answers it.
  call.speak(draft.readback);
  khata.markDraftSpoken(businessId, draft.id, { agentId: "AGV", text: draft.readback });
  call.owner("हाँ जी");
  const out = khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() });
  assert.equal(out.receipt.recorded_via, "voice");
  assert.equal(out.receipt.evidence_utterance, "हाँ जी");
  assert.equal(out.draft.status, "recorded");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "NO_PENDING_PAYMENT" });
  assert.equal(khata.owed(businessId)[0].amount, 3000);

  // A new draft withdraws an older one still waiting.
  const first = khata.draftReceipt(businessId, { customerId: ramesh.id, amount: 100, mode: "upi" }, { language: "en-IN" }).draft;
  const second = khata.draftReceipt(businessId, { customerId: ramesh.id, amount: 200, mode: "upi" }, { language: "en-IN" }).draft;
  assert.equal(khata.getDraft(businessId, first.id).status, "withdrawn");
  assert.equal(khata.pendingDraft(businessId).id, second.id);
  assert.equal(second.readback, "रमेश paid 200 rupees by UPI, on their account.");
  assert.throws(() => db.prepare("UPDATE receipt_readbacks SET amount_paise = 1 WHERE id = ?").run(second.id), /cannot be changed/);

  // The other gates see a payment read-back as a question the server asked: a yes after it does
  // not answer a deal read out before it.
  call.speak("Order from Lakshmi Traders: total 3250 rupees.");
  call.speak(second.readback);
  khata.markDraftSpoken(businessId, second.id, { agentId: "AGV", text: second.readback });
  call.owner("हाँ");
  assert.throws(
    () => require("../src/approvals").answerAfterSpoken(businessId, history(), { agentId: "AGV", spoken: ["Order from Lakshmi Traders: total 3250 rupees."], subject: {} }),
    { code: "READBACK_SUPERSEDED" },
  );
});

test("a payment's yes is refused when any other question the server asked came after its read-back (shared approvals check, every *_readbacks table)", (t) => {
  const businessId = seedBusiness({ language: "hi-IN" });
  const ramesh = customers.save(businessId, { name: "रमेश" }).customer;
  issueInvoice(businessId, ramesh.id, 500000);
  const call = fakeCall(t);
  const history = () => call.items.slice();

  // An item's HSN/GST read-back spoken after the payment's: the yes answers the item, not the payment.
  const { draft } = khata.draftReceipt(businessId, { customerId: ramesh.id, amount: 2000, mode: "cash" }, { language: "hi-IN" });
  call.speak(draft.readback);
  khata.markDraftSpoken(businessId, draft.id, { agentId: "AGV", text: draft.readback });
  const tax = "बासमती चावल: एचएसएन 1006, जीएसटी 5 प्रतिशत। सही है?";
  require("../src/sell/item-tax").recordSpoken(businessId, { itemName: "बासमती चावल", hsn: "1006", gstRate: 5, agentId: "AGV", text: tax });
  call.speak(tax);
  call.owner("हाँ");
  assert.throws(() => khata.confirmDraft(businessId, draft.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "READBACK_SUPERSEDED" });

  // A rule read-back (a table the Sell-only check never looked at) supersedes it the same way.
  const second = khata.draftReceipt(businessId, { customerId: ramesh.id, amount: 1000, mode: "upi" }, { language: "hi-IN" }).draft;
  call.speak(second.readback);
  khata.markDraftSpoken(businessId, second.id, { agentId: "AGV", text: second.readback });
  const rules = require("../src/agent/rules");
  const rule = rules.propose(businessId, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  const ruleText = "मैं कड़ा मोलभाव करूँगी। क्या यह नियम रखूँ?";
  rules.recordSpoken(businessId, rule.id, { agentId: "AGV", text: ruleText });
  call.speak(ruleText);
  call.owner("हाँ जी");
  assert.throws(() => khata.confirmDraft(businessId, second.id, { decision: "confirm", agentId: "AGV", history: history() }), { code: "READBACK_SUPERSEDED" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(businessId).n, 0);
});

test("src/sell/spoken.js is gone: the khata uses only approvals.answerAfterSpoken", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  assert.equal(fs.existsSync(path.join(__dirname, "..", "src", "sell", "spoken.js")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "src", "sell", "khata.js"), "utf8"), /require\("\.\/spoken"\)/);
});

test("a reminder for several open bills says the total owed and names which bill its pay link pays, with that bill's open amount", async () => {
  const telegram = { sendToOwner: async () => ({ sent: false, reason: "not_configured" }) };
  // E2E 2026-11-19: "आपके ₹20,500 बाकी हैं (बिल INV/2026-27/0001 ...)" linked a bill with only ₹5,400 open.
  for (const [language, expected] of [
    ["hi-IN", /^नमस्ते रमेश जी, आशा किराना की ओर से याद दिला रहे हैं: आपके कुल ₹20,500 बाकी हैं \(2 बिल\)। सबसे पुराने बिल (INV\/\S+) \(19\/11\/2026\) के ₹3,400 का ऑनलाइन भुगतान: https:\/\/sahay\.test\/pay\/inv_old धन्यवाद।$/],
    ["kn-IN", /^ನಮಸ್ಕಾರ ರಮೇಶ ಅವರೇ, ಆಶಾ ಕಿರಾಣ ಕಡೆಯಿಂದ ನೆನಪು: ನಿಮ್ಮ ಒಟ್ಟು ₹20,500 ಬಾಕಿ ಇದೆ \(2 ಬಿಲ್\)\. ಹಳೆಯ ಬಿಲ್ (INV\/\S+) \(19\/11\/2026\) ರ ₹3,400 ಆನ್‌ಲೈನ್ ಪಾವತಿ: https:\/\/sahay\.test\/pay\/inv_old ಧನ್ಯವಾದಗಳು\.$/],
    ["en-IN", /^Hello रमेश, a gentle reminder from \S+ \S+: ₹20,500 is due in all \(2 bills\)\. Pay the oldest bill, (INV\/\S+) \(19\/11\/2026\), ₹3,400 open, online: https:\/\/sahay\.test\/pay\/inv_old Thank you\.$/],
  ]) {
    const businessId = seedBusiness({ language, name: language === "kn-IN" ? "ಆಶಾ ಕಿರಾಣ" : "आशा किराना" });
    const ramesh = customers.save(businessId, { name: language === "kn-IN" ? "ರಮೇಶ" : "रमेश", phone: "9845012345" }).customer;
    const oldest = issueInvoice(businessId, ramesh.id, 540000, new Date(Date.UTC(2026, 10, 19, 6)).toISOString(), { payUrl: "https://sahay.test/pay/inv_old" });
    issueInvoice(businessId, ramesh.id, 1710000, new Date(Date.UTC(2026, 10, 19, 9)).toISOString(), { payUrl: "https://sahay.test/pay/inv_new" });
    khata.recordReceipt(businessId, { customerId: ramesh.id, amount: 2000, mode: "cash", invoiceId: oldest.id });

    const out = await khata.remind(businessId, ramesh.id, { language, telegram });
    const m = expected.exec(out.text);
    assert.ok(m, `${language}: ${out.text}`);
    assert.equal(m[1], oldest.number, "the link is the oldest open bill's");
    assert.equal(out.amount, 20500);
  }
});
