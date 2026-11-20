"use strict";

/**
 * The khata: money customers paid the shop (receipts) and what each still owes (contract SELL,
 * the khata parts). Every function takes businessId first; the tenant comes from the caller's
 * signed session or tool ctx, never from a body.
 *
 * Money is integer paise inside, rupees at the edges (`amount`), and spoken in natural Indian
 * numbering (lakh, crore) in the owner's language.
 *
 * What a customer owes = their issued invoices (issued, part_paid, paid) minus their receipts.
 * Receipts are applied to invoices for the "oldest due" date: a receipt for an invoice goes to
 * that invoice first; on-account money and anything over an invoice's balance go to the oldest
 * open invoices. A receipt is append-only (schema KHATA section).
 *
 * Paths into the khata:
 * - recordReceipt(..., {via: "button"}): the owner pressed the button (POST /api/receipts);
 * - draftReceipt -> markDraftSpoken -> confirmDraft: the agent heard a payment, the server read it
 *   back into the call, and the owner said yes to that read-back (record_payment);
 * - onInvoicePaid: a verified Razorpay test-mode checkout of an invoice (SELL's invoice.paid).
 *
 * GET /api/sell (SELL's handler) calls summary(businessId) for `owed` and `receipts`.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const customers = require("./customers");

const MAX_PAISE = 1_000_000_000; // ₹1 crore per receipt: a bigger figure is a mishearing
const NOTE_MAX = 200;
const RECEIPTS_SHOWN = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const BILLED = ["issued", "part_paid", "paid"];
const MODES = ["cash", "upi"];
const LANGS = ["hi-IN", "kn-IN", "en-IN"];
const langKey = (language) => (LANGS.includes(language) ? language : "en-IN");

class KhataError extends Error {
  /** `status` is the HTTP status a route answers with. */
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = "KhataError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const now = () => new Date().toISOString();

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") throw new KhataError("BUSINESS_REQUIRED", "A business id is required.");
  return businessId;
}

/* --------------------------------------------------------------- money --- */

/** Rupees (a number with at most two decimals) -> integer paise; anything else is refused. */
function toPaise(rupees) {
  const value = typeof rupees === "string" && rupees.trim() !== "" ? Number(rupees) : rupees;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new KhataError("INVALID_AMOUNT", "The amount is a number of rupees above zero.");
  const paise = Math.round(value * 100);
  if (Math.abs(paise - value * 100) > 1e-6) throw new KhataError("INVALID_AMOUNT", "The amount has at most two decimals (paise).");
  if (paise > MAX_PAISE) throw new KhataError("INVALID_AMOUNT", "A receipt is at most 1 crore rupees.");
  return paise;
}

const toRupees = (paise) => Math.round(paise) / 100;

/** ₹1,25,000 or ₹1,25,000.50: written Indian grouping, for messages and screens. */
function formatRupees(paise) {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(toRupees(paise));
}

const NUMBER_WORDS = {
  "hi-IN": { crore: "करोड़", lakh: "लाख", thousand: "हज़ार", rupee: "रुपया", rupees: "रुपये", paise: "पैसे" },
  "kn-IN": { crore: "ಕೋಟಿ", lakh: "ಲಕ್ಷ", thousand: "ಸಾವಿರ", rupee: "ರೂಪಾಯಿ", rupees: "ರೂಪಾಯಿ", paise: "ಪೈಸೆ" },
  "en-IN": { crore: "crore", lakh: "lakh", thousand: "thousand", rupee: "rupee", rupees: "rupees", paise: "paise" },
};

/**
 * An amount as an Indian owner says it, digits for the speech engine and the place words in the
 * language's own script: 12550000 paise -> "1 लाख 25 हज़ार 500 रुपये", "1 ಲಕ್ಷ 25 ಸಾವಿರ 500 ರೂಪಾಯಿ",
 * "1 lakh 25 thousand 500 rupees". Paise are said, never rounded away.
 */
function spokenRupees(paise, language) {
  const w = NUMBER_WORDS[langKey(language)];
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const parts = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const units = rupees % 1000;
  if (crore) parts.push(`${crore} ${w.crore}`);
  if (lakh) parts.push(`${lakh} ${w.lakh}`);
  if (thousand) parts.push(`${thousand} ${w.thousand}`);
  if (units || !parts.length) parts.push(String(units));
  const said = `${parts.join(" ")} ${rupees === 1 ? w.rupee : w.rupees}`;
  return rest ? `${said} ${rest} ${w.paise}` : said;
}

/* ----------------------------------------------------------- customers --- */

function requireCustomer(businessId, customerId) {
  const customer = customers.get(tenant(businessId), customerId);
  if (!customer) throw new KhataError("CUSTOMER_NOT_FOUND", "There is no such customer for this business.", { status: 404 });
  return customer;
}

/** The one customer `name` means. None: CUSTOMER_NOT_FOUND; several: AMBIGUOUS_CUSTOMER with the choices. */
function customerNamed(businessId, name) {
  const found = customers.match(tenant(businessId), name);
  if (!found.length) throw new KhataError("CUSTOMER_NOT_FOUND", `No customer is called "${name}".`, { status: 404 });
  if (found.length > 1) {
    throw new KhataError("AMBIGUOUS_CUSTOMER", `"${name}" may mean ${found.map((c) => c.name).join(", ")}.`, { status: 409, details: { choices: found.map((c) => ({ id: c.id, name: c.name })) } });
  }
  return found[0];
}

/* ------------------------------------------------------------ invoices --- */

const billedInvoices = (businessId, customerId = null) =>
  db
    .prepare(
      `SELECT id, customer_id, number, status, total_paise, issued_at, created_at, pay_url, pay_expires_at FROM invoices
       WHERE business_id = ? AND status IN ('issued', 'part_paid', 'paid') AND (? IS NULL OR customer_id = ?)
       ORDER BY COALESCE(issued_at, created_at), rowid`,
    )
    .all(businessId, customerId, customerId);

function getInvoice(businessId, invoiceId) {
  if (typeof invoiceId !== "string" || !invoiceId) return null;
  return db.prepare("SELECT id, customer_id, number, status, total_paise, issued_at, created_at, pay_url, pay_expires_at FROM invoices WHERE business_id = ? AND id = ?").get(businessId, invoiceId) ?? null;
}

/** An invoice money can be received against: issued (or part paid) to this customer. */
function payableInvoice(businessId, customerId, invoiceId) {
  const invoice = getInvoice(businessId, invoiceId);
  if (!invoice || invoice.customer_id !== customerId) throw new KhataError("INVOICE_NOT_FOUND", "There is no such invoice for this customer.", { status: 404 });
  if (!BILLED.includes(invoice.status)) throw new KhataError("INVOICE_NOT_OPEN", `This invoice is ${invoice.status}; money is received only against an issued invoice.`, { status: 409 });
  return invoice;
}

const customerReceipts = (businessId, customerId) =>
  db.prepare("SELECT invoice_id, amount_paise FROM receipts WHERE business_id = ? AND customer_id = ? ORDER BY created_at, rowid").all(businessId, customerId);

/**
 * What an invoice still has open after its customer's receipts are applied (openInvoices), in
 * paise. `invoice` is a row ({id, customer_id}) or SELL's invoices.get shape ({id, customerId});
 * SELL's pay page charges this. 0 for an invoice that is not billed or not this business's.
 */
function invoiceOpenPaise(businessId, invoice) {
  const customerId = invoice?.customer_id ?? invoice?.customerId;
  if (!invoice?.id || !customerId) return 0;
  const open = openInvoices(billedInvoices(tenant(businessId), customerId), customerReceipts(businessId, customerId));
  return open.find((inv) => inv.id === invoice.id)?.open_paise ?? 0;
}

/**
 * After money came in from a customer: each of their invoices moves issued -> part_paid -> paid as
 * the receipts cover it (applied as in openInvoices: its own money first, then on-account money
 * to the oldest bills), through SELL's invoices.setPaymentStatus, the only writer of an invoice's
 * status. Forward only; a paid or cancelled invoice is left as it is.
 */
function settleCustomer(businessId, customerId) {
  const invoices = billedInvoices(businessId, customerId);
  const open = new Map(openInvoices(invoices, customerReceipts(businessId, customerId)).map((inv) => [inv.id, inv.open_paise]));
  const setPaymentStatus = require("./invoices").setPaymentStatus;
  for (const inv of invoices) {
    if (inv.status !== "issued" && inv.status !== "part_paid") continue;
    const left = open.get(inv.id) ?? 0;
    const next = left <= 0 ? "paid" : left < inv.total_paise ? "part_paid" : "issued";
    if (next !== inv.status && next !== "issued") setPaymentStatus(businessId, inv.id, next);
  }
}

/* ------------------------------------------------------------ receipts --- */

function toReceipt(row, names = null) {
  if (!row) return null;
  const invoice = row.invoice_id ? getInvoice(row.business_id, row.invoice_id) : null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: names?.get(row.customer_id) ?? customers.get(row.business_id, row.customer_id)?.name ?? null,
    invoice_id: row.invoice_id,
    invoice_number: invoice?.number ?? null,
    amount: toRupees(row.amount_paise),
    amount_paise: row.amount_paise,
    mode: row.mode,
    note: row.note,
    recorded_via: row.recorded_via,
    evidence_utterance: row.evidence_utterance,
    created_at: row.created_at,
  };
}

function cleanNote(note) {
  if (note == null || note === "") return null;
  if (typeof note !== "string" || note.trim().length > NOTE_MAX) throw new KhataError("INVALID", `note is text of at most ${NOTE_MAX} characters.`);
  return note.trim() || null;
}

/**
 * Check a receipt's fields and resolve its customer and invoice. `amount` is rupees.
 * Money against an invoice may not be more than that invoice still has open (a bigger figure
 * is a mishearing or belongs on account).
 */
function checkReceipt(businessId, { customerId, amount, mode, invoiceId = null, note = null }, { modes = MODES } = {}) {
  const customer = requireCustomer(businessId, customerId);
  const amountPaise = toPaise(amount);
  if (!modes.includes(mode)) throw new KhataError("INVALID_MODE", `mode is one of: ${modes.join(", ")}.`);
  let invoice = null;
  if (invoiceId) {
    invoice = payableInvoice(businessId, customer.id, invoiceId);
    const open = invoiceOpenPaise(businessId, invoice);
    if (amountPaise > open) {
      throw new KhataError("AMOUNT_EXCEEDS_INVOICE", `This invoice has ${formatRupees(open)} open; record the rest on account.`, { status: 409, details: { open: toRupees(open) } });
    }
  }
  return { customer, invoice, amountPaise, mode, note: cleanNote(note) };
}

/**
 * Write one receipt (in the caller's transaction, or its own), move its invoice forward and emit
 * receipt.recorded {receipt, customer, owed}. Returns the receipt.
 */
function insertReceipt(businessId, fields, { via, evidenceUtterance = null, razorpayPaymentId = null, sessionId = null, actor = "owner" }) {
  return db.transaction(() => {
    const id = repo.newId("rcp");
    db.prepare(
      `INSERT INTO receipts (id, business_id, customer_id, invoice_id, amount_paise, mode, note, recorded_via, evidence_utterance, razorpay_payment_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, businessId, fields.customer.id, fields.invoice?.id ?? null, fields.amountPaise, fields.mode, fields.note, via, evidenceUtterance, razorpayPaymentId, now());
    settleCustomer(businessId, fields.customer.id);
    const receipt = toReceipt(db.prepare("SELECT * FROM receipts WHERE business_id = ? AND id = ?").get(businessId, id));
    const owedPaise = balancePaise(businessId, fields.customer.id);
    events.emit(
      businessId,
      "receipt.recorded",
      { receipt, customer: { id: fields.customer.id, name: fields.customer.name }, owed: toRupees(Math.max(owedPaise, 0)), owed_paise: Math.max(owedPaise, 0) },
      { sessionId, actor },
    );
    return receipt;
  });
}

/**
 * The owner's button (POST /api/receipts): the owner is looking at the form, so the press is the
 * confirmation. mode is cash or upi; razorpay_test comes only from a verified checkout.
 */
function recordReceipt(businessId, input = {}, { sessionId = null } = {}) {
  tenant(businessId);
  const fields = checkReceipt(businessId, input);
  return insertReceipt(businessId, fields, { via: "button", sessionId, actor: "owner" });
}

function listReceipts(businessId, { customerId = null, limit = RECEIPTS_SHOWN } = {}) {
  const rows = db
    .prepare("SELECT * FROM receipts WHERE business_id = ? AND (? IS NULL OR customer_id = ?) ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(tenant(businessId), customerId, customerId, limit);
  const names = new Map(customers.list(businessId).map((c) => [c.id, c.name]));
  return rows.map((row) => toReceipt(row, names));
}

/* ---------------------------------------------------------------- owed --- */

/** Billed minus received, in paise (negative: the customer has paid in advance). */
function balancePaise(businessId, customerId) {
  const billed = db
    .prepare("SELECT COALESCE(SUM(total_paise), 0) AS n FROM invoices WHERE business_id = ? AND customer_id = ? AND status IN ('issued', 'part_paid', 'paid')")
    .get(businessId, customerId).n;
  const received = db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM receipts WHERE business_id = ? AND customer_id = ?").get(businessId, customerId).n;
  return billed - received;
}

/**
 * Each customer's open invoices after their receipts are applied: money for an invoice to that
 * invoice first, then on-account money and any excess to the oldest open invoices.
 */
function openInvoices(invoices, receipts) {
  const open = new Map(invoices.map((inv) => [inv.id, { ...inv, open_paise: inv.total_paise }]));
  let pool = 0;
  for (const r of receipts) {
    const target = r.invoice_id ? open.get(r.invoice_id) : null;
    if (!target) {
      pool += r.amount_paise;
      continue;
    }
    const applied = Math.min(target.open_paise, r.amount_paise);
    target.open_paise -= applied;
    pool += r.amount_paise - applied;
  }
  for (const inv of open.values()) {
    const applied = Math.min(inv.open_paise, pool);
    inv.open_paise -= applied;
    pool -= applied;
  }
  return [...open.values()].filter((inv) => inv.open_paise > 0);
}

/**
 * Who owes the shop, largest first: [{customer, amount, amount_paise, oldest_due, days, invoices}].
 * oldest_due is when the oldest invoice still open was issued; days is how long ago that was.
 */
function owed(businessId, { at = Date.now() } = {}) {
  tenant(businessId);
  const invoices = billedInvoices(businessId);
  const receipts = db.prepare("SELECT customer_id, invoice_id, amount_paise FROM receipts WHERE business_id = ? ORDER BY created_at, rowid").all(businessId);
  const out = [];
  for (const customer of customers.list(businessId)) {
    const theirs = invoices.filter((inv) => inv.customer_id === customer.id);
    if (!theirs.length) continue;
    const paid = receipts.filter((r) => r.customer_id === customer.id);
    const amountPaise = theirs.reduce((s, inv) => s + inv.total_paise, 0) - paid.reduce((s, r) => s + r.amount_paise, 0);
    if (amountPaise <= 0) continue;
    const open = openInvoices(theirs, paid);
    const oldestDue = open[0] ? open[0].issued_at ?? open[0].created_at : null;
    out.push({
      customer: { id: customer.id, name: customer.name, phone: customer.phone ?? null },
      amount: toRupees(amountPaise),
      amount_paise: amountPaise,
      oldest_due: oldestDue,
      days: oldestDue ? Math.max(0, Math.floor((at - Date.parse(oldestDue)) / DAY_MS)) : 0,
      invoices: open.map((inv) => ({ id: inv.id, number: inv.number, total: toRupees(inv.total_paise), open: toRupees(inv.open_paise), issued_at: inv.issued_at, pay_url: inv.pay_url ?? null, pay_expires_at: inv.pay_expires_at ?? null })),
    });
  }
  return out.sort((a, b) => b.amount_paise - a.amount_paise || String(a.oldest_due).localeCompare(String(b.oldest_due)));
}

/** For SELL's GET /api/sell: `{owed, receipts}` (owed largest first; the latest receipts). */
function summary(businessId) {
  return { owed: owed(businessId), receipts: listReceipts(businessId) };
}

/* -------------------------------------------------- spoken receipts --- */

const MODE_WORDS = {
  cash: { "hi-IN": "नकद", "kn-IN": "ನಗದು", "en-IN": "in cash" },
  upi: { "hi-IN": "यूपीआई से", "kn-IN": "ಯುಪಿಐ ಮೂಲಕ", "en-IN": "by UPI" },
};

/**
 * The sentence the server reads back before a heard payment is written down. Figures come from
 * the stored draft, never from a model: "रमेश से 2 हज़ार रुपये नकद मिले, उनके बिल के लिए।"
 */
const READBACK = {
  "hi-IN": (v) => `${v.name} से ${v.amount} ${v.mode} मिले, ${v.invoice ? "उनके बिल के लिए" : "उनके खाते में"}।`,
  "kn-IN": (v) => `${v.name} ಅವರಿಂದ ${v.amount} ${v.mode} ಬಂದಿದೆ, ${v.invoice ? "ಅವರ ಬಿಲ್‌ಗೆ" : "ಅವರ ಖಾತೆಗೆ"}.`,
  "en-IN": (v) => `${v.name} paid ${v.amount} ${v.mode}, ${v.invoice ? "against their bill" : "on their account"}.`,
};

/** Bytes kept free after a receipt read-back for its spoken question ("ಇದನ್ನು ಖಾತೆಯಲ್ಲಿ ಬರೆಯಲೇ?" is 66). */
const QUESTION_ROOM_BYTES = 100;

function receiptReadback(language, { name, amountPaise, mode, invoice }) {
  const lang = langKey(language);
  // In a call the yes/no question follows in the same /speak piece (src/tools/khata.js): leave room for it.
  const { fitOnePiece, SPEAK_MAX_BYTES } = require("../agora/speech-fit");
  const values = { name, amount: spokenRupees(amountPaise, lang), mode: MODE_WORDS[mode][lang], invoice: Boolean(invoice) };
  return fitOnePiece(READBACK[lang], values, ["name"], { maxBytes: SPEAK_MAX_BYTES - QUESTION_ROOM_BYTES });
}

function toDraft(row) {
  if (!row) return null;
  return { ...row, amount: toRupees(row.amount_paise) };
}

function getDraft(businessId, draftId) {
  return toDraft(db.prepare("SELECT * FROM receipt_readbacks WHERE business_id = ? AND id = ?").get(tenant(businessId), draftId));
}

function pendingDraft(businessId) {
  return toDraft(db.prepare("SELECT * FROM receipt_readbacks WHERE business_id = ? AND status = 'pending'").get(tenant(businessId)));
}

/** A heard payment checked and read back, without writing anything (off a call: the owner uses the button). */
function previewReceipt(businessId, input = {}, { language } = {}) {
  tenant(businessId);
  const fields = checkReceipt(businessId, input);
  return { fields, readback: receiptReadback(language, { name: fields.customer.name, amountPaise: fields.amountPaise, mode: fields.mode, invoice: fields.invoice }) };
}

/**
 * A payment the agent heard, held until the owner's spoken yes to its read-back. Withdraws any
 * other draft still waiting (one at a time, so a yes can only mean this one).
 * `input` as recordReceipt (customerId, amount, mode, invoiceId?, note?), plus ownerWords.
 */
function draftReceipt(businessId, input = {}, { language } = {}) {
  const { fields, readback } = previewReceipt(businessId, input, { language });
  return db.transaction(() => {
    db.prepare("UPDATE receipt_readbacks SET status = 'withdrawn', decided_at = ? WHERE business_id = ? AND status = 'pending'").run(now(), businessId);
    const id = repo.newId("rcd");
    db.prepare(
      `INSERT INTO receipt_readbacks (id, business_id, customer_id, invoice_id, amount_paise, mode, note, owner_words, readback, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, businessId, fields.customer.id, fields.invoice?.id ?? null, fields.amountPaise, fields.mode, fields.note, input.ownerWords ?? null, readback, now());
    return { draft: getDraft(businessId, id), customer: fields.customer, invoice: fields.invoice };
  });
}

/** The server spoke the draft's read-back through `agentId`; only that agent's call can answer it. */
function markDraftSpoken(businessId, draftId, { agentId, text }) {
  const changed = db
    .prepare("UPDATE receipt_readbacks SET agent_id = ?, spoken_text = ?, spoken_at = ? WHERE business_id = ? AND id = ? AND status = 'pending'")
    .run(agentId, text, now(), tenant(businessId), draftId).changes;
  if (!changed) throw new KhataError("NO_PENDING_PAYMENT", "That payment is no longer waiting for the owner.", { status: 409 });
  return getDraft(businessId, draftId);
}

/**
 * The owner's spoken answer to a draft's read-back. `history` is the call's Agora /history
 * contents, fetched by the caller from its own agent id (never words from a model).
 * - decision "confirm": a clear yes that answers the read-back the server spoke through this
 *   agent (approvals.answerAfterSpoken) -> the receipt, recorded_via voice, with the owner's words;
 * - decision "cancel": the owner's last words must not be a yes -> the draft is withdrawn.
 * Throws the approvals' typed errors (READBACK_NOT_SPOKEN, NO_ANSWER_YET, ...) or NOT_AFFIRMATIVE.
 */
function confirmDraft(businessId, draftId, { decision, agentId, history, sessionId = null }) {
  const approvals = require("../approvals");
  if (decision !== "confirm" && decision !== "cancel") throw new KhataError("INVALID_DECISION", 'decision is "confirm" or "cancel".');
  const draft = getDraft(businessId, draftId);
  if (!draft || draft.status !== "pending") throw new KhataError("NO_PENDING_PAYMENT", "No payment is waiting for the owner's yes.", { status: 409 });

  if (decision === "cancel") {
    const words = approvals.lastOwnerWords(history);
    if (words && approvals.classifyUtterance(words) === "affirmative") throw new KhataError("NOT_NEGATIVE", "The owner's reply was a yes; the payment is not cancelled.", { status: 409 });
    db.prepare("UPDATE receipt_readbacks SET status = 'withdrawn', decided_at = ? WHERE business_id = ? AND id = ? AND status = 'pending'").run(now(), businessId, draft.id);
    return { draft: getDraft(businessId, draft.id), receipt: null };
  }

  if (!agentId || draft.agent_id !== agentId || !draft.spoken_text) {
    throw new KhataError("READBACK_NOT_SPOKEN", "This payment was not read out to the owner in this call.", { status: 409 });
  }
  // Also refuses the yes when any other question the server asked (every *_readbacks table) came after this read-back.
  const { text } = approvals.answerAfterSpoken(businessId, history, { agentId, spoken: [draft.spoken_text], subject: { kind: "receipt" } });
  if (approvals.classifyUtterance(text) !== "affirmative") {
    throw new KhataError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes; the payment is not written down.", { status: 409 });
  }
  return db.transaction(() => {
    // The figures are the draft's own, checked again: the invoice may have been paid meanwhile.
    const fields = checkReceipt(businessId, { customerId: draft.customer_id, amount: draft.amount, mode: draft.mode, invoiceId: draft.invoice_id, note: draft.note });
    const receipt = insertReceipt(businessId, fields, { via: "voice", evidenceUtterance: text, sessionId, actor: "owner" });
    db.prepare("UPDATE receipt_readbacks SET status = 'recorded', receipt_id = ?, decided_at = ? WHERE business_id = ? AND id = ?").run(receipt.id, now(), businessId, draft.id);
    return { draft: getDraft(businessId, draft.id), receipt };
  });
}

/* ------------------------------------------------------------ reminders --- */

/**
 * One open bill: what is owed is that bill's open amount, so the pay link pays exactly it. Several
 * open bills: the total owed and the number of bills, and the link is named as the OLDEST bill's,
 * with that bill's own open amount (the pay page charges that), never as the total.
 */
const REMINDER = {
  "hi-IN": (v) => `नमस्ते ${v.name} जी, ${v.shop} की ओर से याद दिला रहे हैं: आपके ${v.amount} बाकी हैं${v.bill ? ` (बिल ${v.bill}${v.date ? `, ${v.date}` : ""})` : ""}।${v.payUrl ? ` ऑनलाइन भुगतान: ${v.payUrl}` : ""} धन्यवाद।`,
  "kn-IN": (v) => `ನಮಸ್ಕಾರ ${v.name} ಅವರೇ, ${v.shop} ಕಡೆಯಿಂದ ನೆನಪು: ನಿಮ್ಮ ${v.amount} ಬಾಕಿ ಇದೆ${v.bill ? ` (ಬಿಲ್ ${v.bill}${v.date ? `, ${v.date}` : ""})` : ""}.${v.payUrl ? ` ಆನ್‌ಲೈನ್ ಪಾವತಿ: ${v.payUrl}` : ""} ಧನ್ಯವಾದಗಳು.`,
  "en-IN": (v) => `Hello ${v.name}, a gentle reminder from ${v.shop}: ${v.amount} is due${v.bill ? ` (bill ${v.bill}${v.date ? `, ${v.date}` : ""})` : ""}.${v.payUrl ? ` Pay online: ${v.payUrl}` : ""} Thank you.`,
};
const REMINDER_BILLS = {
  "hi-IN": (v) => `नमस्ते ${v.name} जी, ${v.shop} की ओर से याद दिला रहे हैं: आपके कुल ${v.amount} बाकी हैं (${v.count} बिल)।${v.payUrl ? ` सबसे पुराने बिल ${v.bill}${v.date ? ` (${v.date})` : ""} के ${v.billAmount} का ऑनलाइन भुगतान: ${v.payUrl}` : ""} धन्यवाद।`,
  "kn-IN": (v) => `ನಮಸ್ಕಾರ ${v.name} ಅವರೇ, ${v.shop} ಕಡೆಯಿಂದ ನೆನಪು: ನಿಮ್ಮ ಒಟ್ಟು ${v.amount} ಬಾಕಿ ಇದೆ (${v.count} ಬಿಲ್).${v.payUrl ? ` ಹಳೆಯ ಬಿಲ್ ${v.bill}${v.date ? ` (${v.date})` : ""} ರ ${v.billAmount} ಆನ್‌ಲೈನ್ ಪಾವತಿ: ${v.payUrl}` : ""} ಧನ್ಯವಾದಗಳು.`,
  "en-IN": (v) => `Hello ${v.name}, a gentle reminder from ${v.shop}: ${v.amount} is due in all (${v.count} bills).${v.payUrl ? ` Pay the oldest bill, ${v.bill}${v.date ? ` (${v.date})` : ""}, ${v.billAmount} open, online: ${v.payUrl}` : ""} Thank you.`,
};

/** The copy the owner gets on Telegram, so they know what was prepared. */
const OWNER_COPY = {
  "hi-IN": (v) => `${v.name} के लिए भुगतान याद संदेश (${v.amount} बाकी)। व्हाट्सऐप पर भेजें: ${v.shareUrl}\n\n${v.text}`,
  "kn-IN": (v) => `${v.name} ಅವರಿಗೆ ಪಾವತಿ ನೆನಪಿನ ಸಂದೇಶ (${v.amount} ಬಾಕಿ). ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿ: ${v.shareUrl}\n\n${v.text}`,
  "en-IN": (v) => `Payment reminder for ${v.name} (${v.amount} due). Send it on WhatsApp: ${v.shareUrl}\n\n${v.text}`,
};

const dateText = (iso) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** https://wa.me/91<10 digits>?text=... (WhatsApp's free click-to-chat link); with no phone the owner picks the chat. */
function whatsappUrl(phone, text) {
  const to = /^[6-9]\d{9}$/.test(String(phone ?? "")) ? `91${phone}` : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/**
 * The reminder for one customer: the text (in `language`), the WhatsApp share link and what is
 * owed. A live pay link of the oldest open invoice is included, named as that bill's with its own
 * open amount when more than one bill is open (REMINDER_BILLS). Nothing is sent to the customer:
 * the owner sends it from their own WhatsApp. NOTHING_OWED when the customer owes nothing.
 */
function reminderFor(businessId, customerId, { language, at = Date.now() } = {}) {
  const customer = requireCustomer(businessId, customerId);
  const due = owed(businessId, { at }).find((row) => row.customer.id === customer.id);
  if (!due) throw new KhataError("NOTHING_OWED", `${customer.name} owes nothing.`, { status: 409 });
  const lang = langKey(language);
  const oldest = due.invoices[0] ?? null;
  const payUrl = oldest?.pay_url && (!oldest.pay_expires_at || Date.parse(oldest.pay_expires_at) > at) ? oldest.pay_url : null;
  const shop = repo.getBusiness(businessId)?.name ?? "";
  const text = (due.invoices.length > 1 ? REMINDER_BILLS : REMINDER)[lang]({
    name: customer.name,
    shop,
    amount: formatRupees(due.amount_paise),
    count: due.invoices.length,
    bill: oldest?.number ?? null,
    billAmount: oldest ? formatRupees(Math.round(oldest.open * 100)) : null, // owed() gives rupees
    date: oldest?.issued_at ? dateText(oldest.issued_at) : null,
    payUrl,
  });
  return { customer, amount: due.amount, amount_paise: due.amount_paise, days: due.days, text, shareUrl: whatsappUrl(customer.phone, text), language: lang };
}

/**
 * Prepare a reminder, send a copy to the owner's linked Telegram chat (if any) and emit
 * reminder.sent. A Telegram failure is reported in `telegram` and as an error event; the
 * reminder itself still stands (the WhatsApp link does not depend on Telegram).
 */
async function remind(businessId, customerId, { language, sessionId = null, actor = "owner", telegram = require("../notify/telegram") } = {}) {
  const reminder = reminderFor(businessId, customerId, { language });
  const copy = OWNER_COPY[reminder.language]({ name: reminder.customer.name, amount: formatRupees(reminder.amount_paise), shareUrl: reminder.shareUrl, text: reminder.text });
  let sent;
  try {
    sent = await telegram.sendToOwner(businessId, copy);
  } catch (err) {
    events.emit(businessId, "error", { code: err.code ?? "TELEGRAM_FAILED", message: err.message, scope: "telegram" }, { actor: "system" });
    sent = { sent: false, reason: "error" };
  }
  const telegramResult = { sent: Boolean(sent?.sent), ...(sent?.sent ? {} : { reason: sent?.reason ?? "error" }) };
  events.emit(
    businessId,
    "reminder.sent",
    { customerId: reminder.customer.id, customer: { id: reminder.customer.id, name: reminder.customer.name }, amount: reminder.amount, text: reminder.text, shareUrl: reminder.shareUrl, telegram: telegramResult },
    { sessionId, actor },
  );
  return { ...reminder, telegram: telegramResult };
}

const INVOICE_SHARE = {
  "hi-IN": (v) => `नमस्ते ${v.name} जी, ${v.shop} का बिल ${v.bill}: ${v.amount}।${v.payUrl ? ` ऑनलाइन भुगतान: ${v.payUrl}` : ""} धन्यवाद।`,
  "kn-IN": (v) => `ನಮಸ್ಕಾರ ${v.name} ಅವರೇ, ${v.shop} ಬಿಲ್ ${v.bill}: ${v.amount}.${v.payUrl ? ` ಆನ್‌ಲೈನ್ ಪಾವತಿ: ${v.payUrl}` : ""} ಧನ್ಯವಾದಗಳು.`,
  "en-IN": (v) => `Hello ${v.name}, your bill ${v.bill} from ${v.shop}: ${v.amount}.${v.payUrl ? ` Pay online: ${v.payUrl}` : ""} Thank you.`,
};

/**
 * The WhatsApp share link of an issued invoice (SELL's GET /api/sell): the invoice summary and its
 * pay link, to the customer's phone. `invoice` is SELL's invoices.get shape
 * ({number, customerId, totals: {totalPaise}, payUrl}). Null for an invoice without a number.
 */
function shareUrl(businessId, invoice, { language } = {}) {
  if (!invoice?.number || !Number.isInteger(invoice.totals?.totalPaise)) return null;
  const customer = customers.get(tenant(businessId), invoice.customerId);
  if (!customer) return null;
  const business = repo.getBusiness(businessId);
  const lang = langKey(language ?? business?.language);
  const text = INVOICE_SHARE[lang]({ name: customer.name, shop: business?.name ?? "", bill: invoice.number, amount: formatRupees(invoice.totals.totalPaise), payUrl: invoice.payUrl ?? null });
  return whatsappUrl(customer.phone, text);
}

/* ------------------------------------------------ Razorpay test payment --- */

/**
 * SELL's invoice.paid {invoiceId, customerId, amountPaise, razorpayPaymentId, razorpayOrderId, testMode}
 * (a verified Razorpay test-mode checkout of an invoice) -> a receipt with
 * mode razorpay_test for the money it brought in. Once per Razorpay payment id (unique index), so
 * a second online payment of the same invoice is a second receipt; an event without a payment id
 * is refused (PAYMENT_ID_MISSING, reported as an error event by start()). The amount is the
 * event's amountPaise, else what the invoice still had open.
 */
function onInvoicePaid(event) {
  if (event?.type !== "invoice.paid") return null;
  const d = event.data ?? {};
  const businessId = event.businessId;
  const invoiceId = d.invoiceId;
  const invoice = businessId && invoiceId ? getInvoice(businessId, invoiceId) : null;
  if (!invoice || !BILLED.includes(invoice.status)) return null;
  const paymentId = typeof d.razorpayPaymentId === "string" && d.razorpayPaymentId ? d.razorpayPaymentId : null;
  if (!paymentId) throw new KhataError("PAYMENT_ID_MISSING", "invoice.paid carries no razorpayPaymentId; no receipt was recorded.");
  if (db.prepare("SELECT 1 FROM receipts WHERE business_id = ? AND razorpay_payment_id = ?").get(businessId, paymentId)) return null;
  const given = Number.isInteger(d.amountPaise) && d.amountPaise > 0 ? d.amountPaise : null;
  const amountPaise = given ?? invoiceOpenPaise(businessId, invoice);
  if (amountPaise <= 0) return null;
  const customer = customers.get(businessId, invoice.customer_id);
  return insertReceipt(
    businessId,
    { customer, invoice, amountPaise, mode: "razorpay_test", note: null },
    { via: "razorpay", razorpayPaymentId: paymentId, sessionId: event.sessionId ?? null, actor: "system" },
  );
}

let unsubscribe = null;

/** Listen for invoice.paid. Idempotent; returns stop(). */
function start() {
  if (!unsubscribe) {
    const off = events.subscribeAll((event) => {
      if (event.type !== "invoice.paid") return;
      try {
        onInvoicePaid(event);
      } catch (err) {
        events.emit(event.businessId, "error", { code: err.code ?? "RECEIPT_FAILED", message: err.message, scope: "khata" }, { actor: "system" });
      }
    });
    unsubscribe = () => {
      off();
      unsubscribe = null;
    };
  }
  return unsubscribe;
}

module.exports = {
  KhataError,
  MODES,
  toPaise,
  toRupees,
  formatRupees,
  spokenRupees,
  customerNamed,
  requireCustomer,
  recordReceipt,
  listReceipts,
  balancePaise,
  invoiceOpenPaise,
  owed,
  summary,
  receiptReadback,
  previewReceipt,
  draftReceipt,
  markDraftSpoken,
  pendingDraft,
  getDraft,
  confirmDraft,
  reminderFor,
  whatsappUrl,
  shareUrl,
  remind,
  onInvoicePaid,
  start,
};
