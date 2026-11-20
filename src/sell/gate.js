"use strict";

/**
 * The invoice gate (contract SELL). An invoice is issued only on the owner's explicit yes to the
 * exact invoice the server read out: request -> (the server speaks the read-back) -> confirm.
 * It mirrors the purchase gate (src/approvals.js) on its own tables and reuses its spoken-consent
 * check (approvals.answerAfterSpoken) unchanged:
 * - by voice: a clear yes in the owner's own ASR turn after the server-spoken read-back, with no
 *   other question spoken in between (approvals.answerAfterSpoken checks every *_readbacks table:
 *   purchase, rule, reorder, invoice, item tax); a typed message never counts;
 * - by button: the ✓ on the invoice's Yes card, where the read-back is on screen.
 * Approving issues at once, in one transaction: the approval is consumed, the next number of the
 * financial year is taken, the invoice becomes issued (the database refuses that without the
 * consumed approval) and each line goes out of stock (stock.move reason "sale"). The PDF and the
 * pay page follow after the commit.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const gst = require("./gst");
const settings = require("./settings");
const customers = require("./customers");
const invoices = require("./invoices");
const { SellError } = require("./errors");
const { unitWord } = require("../procurement/units");
const { itemIn } = require("../discovery/slug");

const stock = () => require("../stock");
const items = () => require("../stock/items");

const { fitOnePiece, bytes, SPEAK_MAX_BYTES } = require("../agora/speech-fit");
const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const SCRIPT = { "hi-IN": /\p{Script=Devanagari}/u, "kn-IN": /\p{Script=Kannada}/u };

/* ------------------------------------------------------------ read-back --- */

/** The item's name as the owner hears it in `language`: its own script when Sahay knows one. */
function spokenName(businessId, line, language) {
  if (language === "en-IN") return line.name;
  if (SCRIPT[language].test(line.name)) return line.name;
  const item = items().get(businessId, line.itemId);
  if (item?.name_native && SCRIPT[language].test(item.name_native)) return item.name_native;
  return itemIn(line.name, language) ?? line.name;
}

const amount = (paise) => gst.rupeesText(paise);
const rateOf = (invoice) => {
  const rates = [...new Set(invoice.lines.map((l) => l.gstRate))];
  return rates.length === 1 ? rates[0] : null;
};

const WORDS = {
  "en-IN": {
    head: { tax_invoice: (c) => `Tax invoice for ${c}`, bill_of_supply: (c) => `Bill of supply for ${c}, no GST`, bill: (c) => `Bill for ${c}` },
    line: (l) => `${l.qty} ${l.unit} ${l.item} at ${l.rate} rupees per ${l.unit1}, ${l.total} rupees`,
    tax: (t) => (t.rate != null ? `GST ${t.rate} percent, ${t.tax} rupees${t.igst ? " as IGST" : ""}.` : `GST ${t.tax} rupees${t.igst ? " as IGST" : ""}.`),
    total: (t) => `Total ${t} rupees.`,
    count: (n) => `${n} items`,
    ask: "Shall I make this bill?",
    sep: "; ",
    colon: ": ",
    end: ".",
  },
  "hi-IN": {
    head: { tax_invoice: (c) => `${c} का टैक्स बिल`, bill_of_supply: (c) => `${c} का बिल ऑफ़ सप्लाई, जीएसटी नहीं`, bill: (c) => `${c} का बिल` },
    line: (l) => `${l.qty} ${l.unit} ${l.item}, ${l.rate} रुपये प्रति ${l.unit1}, ${l.total} रुपये`,
    tax: (t) => (t.rate != null ? `जीएसटी ${t.rate} प्रतिशत, ${t.tax} रुपये${t.igst ? " आईजीएसटी" : ""}।` : `जीएसटी ${t.tax} रुपये${t.igst ? " आईजीएसटी" : ""}।`),
    total: (t) => `कुल ${t} रुपये।`,
    count: (n) => `${n} चीज़ें`,
    ask: "क्या मैं यह बिल बना दूँ?",
    sep: "; ",
    colon: ": ",
    end: "।",
  },
  "kn-IN": {
    head: { tax_invoice: (c) => `${c} ಅವರಿಗೆ ತೆರಿಗೆ ಬಿಲ್`, bill_of_supply: (c) => `${c} ಅವರಿಗೆ ಬಿಲ್ ಆಫ್ ಸಪ್ಲೈ, ಜಿಎಸ್‌ಟಿ ಇಲ್ಲ`, bill: (c) => `${c} ಅವರಿಗೆ ಬಿಲ್` },
    line: (l) => `${l.qty} ${l.unit} ${l.item}, ಒಂದು ${l.unit1}ಗೆ ${l.rate} ರೂಪಾಯಿ, ${l.total} ರೂಪಾಯಿ`,
    tax: (t) => (t.rate != null ? `ಜಿಎಸ್‌ಟಿ ಶೇಕಡಾ ${t.rate}, ${t.tax} ರೂಪಾಯಿ${t.igst ? " ಐಜಿಎಸ್‌ಟಿ" : ""}.` : `ಜಿಎಸ್‌ಟಿ ${t.tax} ರೂಪಾಯಿ${t.igst ? " ಐಜಿಎಸ್‌ಟಿ" : ""}.`),
    total: (t) => `ಒಟ್ಟು ${t} ರೂಪಾಯಿ.`,
    count: (n) => `${n} ವಸ್ತುಗಳು`,
    ask: "ಈ ಬಿಲ್ ಮಾಡಲೇ?",
    sep: "; ",
    colon: ": ",
    end: ".",
  },
};

/**
 * The money sentence of an invoice, built from stored rows only: customer, each line (quantity,
 * unit, item, rate, line value), the tax and the total, then the question. Plain digits.
 * Always ONE /speak piece (src/agora/speech-fit.js; Murf allows 2 streams): a bill too long to
 * read line by line names how many items it has instead (the lines are on the screen), and a
 * very long customer name is shortened for speech. Deterministic, so the stored read-back can be
 * rebuilt and compared.
 */
function buildReadback(businessId, invoice, language) {
  const w = WORDS[language];
  if (!w) throw new SellError("UNSUPPORTED_LANGUAGE", `No read-back wording for "${language}".`);
  const customer = customers.get(businessId, invoice.customerId);
  const lines = invoice.lines.map((l) =>
    w.line({
      qty: String(l.quantity),
      unit: unitWord(l.unit, language, l.quantity !== 1, { short: true }),
      unit1: unitWord(l.unit, language, false, { short: true }),
      item: spokenName(businessId, l, language),
      rate: amount(l.ratePaise),
      total: amount(l.taxablePaise),
    }),
  );
  const tail = [];
  if (invoice.kind === "tax_invoice") tail.push(w.tax({ rate: rateOf(invoice), tax: amount(invoice.totals.taxPaise), igst: !invoice.intraState }));
  tail.push(w.total(amount(invoice.totals.totalPaise)), w.ask);
  const sentence = (name, body) => [`${w.head[invoice.kind](name)}${w.colon}${body}${w.end}`, ...tail].join(" ");
  const name = customer?.name ?? "";
  const full = sentence(name, lines.join(w.sep));
  if (bytes(full) <= SPEAK_MAX_BYTES) return full;
  if (lines.length === 1) return fitOnePiece((v) => sentence(v.name, lines[0]), { name }, ["name"]);
  return fitOnePiece((v) => sentence(v.name, w.count(invoice.lines.length)), { name }, ["name"]);
}

const businessLanguage = (businessId) => {
  const language = repo.getBusiness(businessId)?.language;
  return LANGUAGES.includes(language) ? language : "en-IN";
};

/* ----------------------------------------------------------------- rows --- */

const approvalRow = (businessId, approvalId) =>
  typeof approvalId === "string" && approvalId ? db.prepare("SELECT * FROM invoice_approvals WHERE business_id = ? AND id = ?").get(businessId, approvalId) ?? null : null;

function listApprovals(businessId, { status, invoice_id: invoiceId } = {}) {
  const where = ["business_id = ?"];
  const params = [businessId];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (invoiceId) {
    where.push("invoice_id = ?");
    params.push(invoiceId);
  }
  return db.prepare(`SELECT * FROM invoice_approvals WHERE ${where.join(" AND ")} ORDER BY requested_at, rowid`).all(...params);
}

const readbacksOf = (businessId, approvalId, agentId) =>
  db.prepare("SELECT spoken_text FROM invoice_readbacks WHERE business_id = ? AND approval_id = ? AND agent_id = ? ORDER BY spoken_at, rowid").all(businessId, approvalId, agentId).map((r) => r.spoken_text);

const view = (a) =>
  a && {
    approvalId: a.id,
    invoiceId: a.invoice_id,
    status: a.status,
    readback: a.readback,
    totalPaise: a.total_paise,
    decidedVia: a.decided_via,
    evidenceUtterance: a.evidence_utterance,
  };

/* --------------------------------------------------------- consistency --- */

/**
 * The invoice as it would be drafted now from the same lines: an invoice whose settings, item tax,
 * customer state or rates changed since it was drafted no longer matches what was read out.
 */
function stillMatches(businessId, invoice, approval) {
  if (approval.total_paise !== invoice.totals.totalPaise) return false;
  if (!LANGUAGES.some((language) => buildReadback(businessId, invoice, language) === approval.readback)) return false;
  let now;
  try {
    const customer = customers.get(businessId, invoice.customerId);
    now = invoices.compute(businessId, customer, invoice.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, rate: l.ratePaise / 100 })));
  } catch {
    return false;
  }
  return now.supplier.kind === invoice.kind && now.supplier.stateCode === invoice.supplierState && now.placeOfSupply === invoice.placeOfSupply.code &&
    now.computed.totals.totalPaise === invoice.totals.totalPaise && now.computed.totals.taxPaise === invoice.totals.taxPaise;
}

/* ------------------------------------------------------------- request --- */

function withdraw(businessId, approval, reason, sessionId) {
  db.prepare("UPDATE invoice_approvals SET status = 'rejected', decided_at = ? WHERE business_id = ? AND id = ?").run(new Date().toISOString(), businessId, approval.id);
  db.prepare("UPDATE invoices SET status = 'draft' WHERE business_id = ? AND id = ? AND status = 'pending'").run(businessId, approval.invoice_id);
  events.emit(businessId, "invoice.decided", { ...view({ ...approval, status: "rejected" }), reason }, { sessionId, actor: "system" });
}

/**
 * Put one invoice to the owner. Returns { approval, invoice, created }. Asking again for an
 * unchanged invoice returns the open approval; any other invoice waiting for the owner is
 * withdrawn (one invoice waits at a time, DB trigger). Refused while a purchase deal waits for
 * the owner, so a yes can never be heard as the answer to the wrong question.
 */
function requestInvoiceApproval(businessId, invoiceId, { sessionId = null } = {}) {
  return db.transaction(() => {
    const invoice = invoices.get(businessId, invoiceId);
    if (!invoice) throw new SellError("INVOICE_NOT_FOUND", "There is no such invoice.", { status: 404 });
    if (invoice.status !== "draft" && invoice.status !== "pending") throw new SellError("INVOICE_ALREADY_ISSUED", `This invoice is already ${invoice.status}.`, { status: 409 });
    if (repo.listApprovals(businessId, { status: "pending" }).length) {
      throw new SellError("PURCHASE_APPROVAL_PENDING", "A purchase deal is waiting for the owner's answer; answer it first.", { status: 409 });
    }

    let kept = null;
    for (const open of listApprovals(businessId, { invoice_id: invoiceId })) {
      if (open.status !== "pending" && open.status !== "approved") continue;
      if (!kept && open.status === "pending" && stillMatches(businessId, invoice, open)) kept = open;
      else withdraw(businessId, open, "The invoice changed after this approval was requested.", sessionId);
    }
    for (const other of listApprovals(businessId, { status: "pending" })) {
      if (other.invoice_id !== invoiceId) withdraw(businessId, other, "Another invoice was put to the owner.", sessionId);
    }
    if (kept) return { approval: kept, invoice: invoices.get(businessId, invoiceId), created: false };

    const current = invoices.get(businessId, invoiceId);
    // Refuse what can no longer be issued (settings or an item's tax changed since the draft).
    const probe = { readback: buildReadback(businessId, current, businessLanguage(businessId)), total_paise: current.totals.totalPaise };
    if (!stillMatches(businessId, current, probe)) throw new SellError("INVOICE_STALE", "This invoice no longer matches the shop's settings or the items' tax; draft it again.", { status: 409 });
    if (current.status === "draft") db.prepare("UPDATE invoices SET status = 'pending' WHERE business_id = ? AND id = ? AND status = 'draft'").run(businessId, invoiceId);
    const id = repo.newId("iap");
    db.prepare("INSERT INTO invoice_approvals (id, business_id, invoice_id, status, readback, total_paise, requested_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)").run(
      id, businessId, invoiceId, probe.readback, probe.total_paise, new Date().toISOString(),
    );
    const approval = approvalRow(businessId, id);
    const invoiceNow = invoices.get(businessId, invoiceId);
    events.emit(businessId, "invoice.requested", { ...view(approval), invoice: invoices.summary(invoiceNow, customers.get(businessId, invoiceNow.customerId)) }, { sessionId, actor: "agent" });
    return { approval, invoice: invoiceNow, created: true };
  });
}

/** The server spoke `text` (this approval's read-back) into the owner's call through agentId. */
function recordInvoiceReadbackSpoken(businessId, approvalId, { agentId, text, sessionId = null }) {
  if (!agentId || typeof text !== "string" || !text) throw new SellError("READBACK_NOT_SPOKEN", "Nothing was read out.", { status: 409 });
  return db.transaction(() => {
    const approval = approvalRow(businessId, approvalId);
    if (!approval) throw new SellError("APPROVAL_NOT_FOUND", "There is no such invoice approval.", { status: 404 });
    if (approval.status !== "pending") throw new SellError("ALREADY_DECIDED", `This approval is already ${approval.status}.`, { status: 409 });
    const at = new Date().toISOString();
    db.prepare("INSERT INTO invoice_readbacks (id, business_id, approval_id, agent_id, spoken_text, spoken_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      repo.newId("irb"), businessId, approvalId, agentId, text, at,
    );
    events.emit(businessId, "invoice.spoken", { approvalId, invoiceId: approval.invoice_id, readback: text, spokenAt: at }, { sessionId, actor: "agent" });
    return { approvalId, spokenAt: at };
  });
}

/* ------------------------------------------------------------- decide --- */

/**
 * The owner's reply classified as approvals.classifyUtterance does (strict: a condition, a question
 * or an unknown word is "unclear"), after the words for making a bill are put in its terms:
 * "हाँ, बना दो" / "haan bill bana do" / "ಬಿಲ್ ಮಾಡಿ" say the same as "हाँ, कर दो" / "ಮಾಡಿ".
 */
const BILL_WORDS = [
  [/बना\s*(दो|दीजिए|दीजिये|दें|देना)/gu, "कर $1"],
  [/\bbana\s*(do|dijiye|den|dena)\b/giu, "kar $1"],
  [/(^|\s)(बिल|bill|ಬಿಲ್)(?=\s|$|[,.!।])/giu, "$1"],
];
function classifyReply(text) {
  let said = String(text ?? "");
  for (const [pattern, replacement] of BILL_WORDS) said = said.replace(pattern, replacement);
  return approvals.classifyUtterance(said);
}

/**
 * The owner's spoken answer to this approval's read-back (fails closed; see the module comment).
 * Returns the owner's words.
 */
function spokenAnswer(businessId, approval, history, agentId) {
  const own = agentId ? readbacksOf(businessId, approval.id, agentId) : [];
  const { text } = approvals.answerAfterSpoken(businessId, history, { agentId, spoken: own, subject: { kind: "invoice" } });
  return text;
}

/** Inside the decide transaction: consume the approval, number the invoice, issue it, take the stock out. */
function issue(businessId, approval, invoice, { sessionId }) {
  const supplier = settings.supplier(businessId);
  const customer = customers.get(businessId, invoice.customerId);
  const at = new Date();
  const fy = gst.financialYear(at);
  const last = db.prepare("SELECT MAX(seq) AS seq FROM invoices WHERE business_id = ? AND fy = ?").get(businessId, fy).seq ?? 0;
  const seq = last + 1;
  const number = gst.invoiceNumber(supplier.invoicePrefix, fy, seq);
  const recipient = {
    name: customer.name,
    address: customer.address,
    gstin: customer.gstin,
    stateCode: customer.state_code,
    stateName: customer.state_name,
    phone: customer.phone,
  };
  const supplierSnapshot = { name: supplier.name, address: supplier.address, gstin: supplier.gstin, stateCode: supplier.stateCode, stateName: supplier.stateName, scheme: supplier.scheme };

  const consumed = db.prepare("UPDATE invoice_approvals SET status = 'consumed' WHERE business_id = ? AND id = ? AND status = 'approved'").run(businessId, approval.id).changes;
  if (consumed !== 1) throw new SellError("APPROVAL_CONSUMED", "This approval was already used.", { status: 409 });
  db.prepare(
    `UPDATE invoices SET status = 'issued', fy = ?, seq = ?, number = ?, supplier = ?, recipient = ?, approval_id = ?, issued_at = ?
     WHERE business_id = ? AND id = ? AND status = 'pending'`,
  ).run(fy, seq, number, JSON.stringify(supplierSnapshot), JSON.stringify(recipient), approval.id, at.toISOString(), businessId, invoice.id);
  for (const line of invoice.lines) {
    stock().move(businessId, { itemId: line.itemId, qty: -line.quantity, reason: "sale", refId: invoice.id }, { sessionId, actor: "system" });
  }
  return invoices.get(businessId, invoice.id);
}

/**
 * Record the owner's decision on a pending invoice approval; on approve, issue the invoice.
 * - via "voice": `history` is the call's Agora /history (fetched by the caller from agentId,
 *   never words from the model); approve needs spokenAnswer to be a clear yes, reject needs the
 *   owner's last words not to be a yes.
 * - via "button": the ✓ / ✕ on the invoice's Yes card.
 * Returns { approval, invoice }. The PDF and pay page are made by finishIssue after this returns.
 */
function confirmInvoice(businessId, approvalId, { decision, via, agentId = null, history, sessionId = null } = {}) {
  if (decision !== "approve" && decision !== "reject") throw new SellError("INVALID_DECISION", 'decision is "approve" or "reject".');
  if (via !== "voice" && via !== "button") throw new SellError("INVALID_VIA", 'via is "voice" or "button".');

  const approval = approvalRow(businessId, approvalId);
  if (!approval) throw new SellError("APPROVAL_NOT_FOUND", "There is no such invoice approval.", { status: 404 });
  if (approval.status !== "pending") throw new SellError("ALREADY_DECIDED", `This approval is already ${approval.status}.`, { status: 409 });

  let utterance = null;
  if (via === "voice") {
    if (!Array.isArray(history)) throw new SellError("EVIDENCE_REQUIRED", "A spoken decision needs the call history as evidence.", { status: 409 });
    utterance = decision === "approve" ? spokenAnswer(businessId, approval, history, agentId) : approvals.lastOwnerWords(history);
    if (!utterance) throw new SellError("EVIDENCE_REQUIRED", "A spoken decision needs the owner's words as evidence.", { status: 409 });
    const said = classifyReply(utterance);
    if (decision === "approve" && said !== "affirmative") throw new SellError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes; the invoice is not made.", { status: 409 });
    if (decision === "reject" && said === "affirmative") throw new SellError("NOT_NEGATIVE", "The owner's reply was a yes; it cannot be recorded as a no.", { status: 409 });
  }

  return db.transaction(() => {
    const fresh = approvalRow(businessId, approvalId);
    if (fresh.status !== "pending") throw new SellError("ALREADY_DECIDED", `This approval is already ${fresh.status}.`, { status: 409 });
    const invoice = invoices.get(businessId, fresh.invoice_id);
    const at = new Date().toISOString();
    if (decision === "reject") {
      db.prepare("UPDATE invoice_approvals SET status = 'rejected', decided_at = ?, decided_via = ?, evidence_utterance = ? WHERE business_id = ? AND id = ?").run(
        at, via, utterance, businessId, fresh.id,
      );
      db.prepare("UPDATE invoices SET status = 'draft' WHERE business_id = ? AND id = ? AND status = 'pending'").run(businessId, invoice.id);
      const decided = approvalRow(businessId, fresh.id);
      events.emit(businessId, "invoice.decided", { ...view(decided), via }, { sessionId, actor: "owner" });
      return { approval: decided, invoice: invoices.get(businessId, invoice.id) };
    }
    if (!stillMatches(businessId, invoice, fresh)) throw new SellError("APPROVAL_STALE", "The invoice changed after it was read out; ask again.", { status: 409 });
    db.prepare("UPDATE invoice_approvals SET status = 'approved', decided_at = ?, decided_via = ?, evidence_utterance = ? WHERE business_id = ? AND id = ?").run(
      at, via, utterance, businessId, fresh.id,
    );
    events.emit(businessId, "invoice.decided", { ...view(approvalRow(businessId, fresh.id)), via }, { sessionId, actor: "owner" });
    const issued = issue(businessId, approvalRow(businessId, fresh.id), invoice, { sessionId });
    return { approval: approvalRow(businessId, fresh.id), invoice: issued };
  });
}

/**
 * The guard for actions on an issued invoice (PDF, pay page): it rests on a consumed approval of
 * the same business for the same invoice and total. Returns the invoice.
 */
function assertIssued(businessId, invoiceId) {
  const invoice = invoices.get(businessId, invoiceId);
  if (!invoice) throw new SellError("INVOICE_NOT_FOUND", "There is no such invoice.", { status: 404 });
  const approval = approvalRow(businessId, invoice.approvalId);
  const sound = approval && approval.status === "consumed" && approval.invoice_id === invoice.id && approval.total_paise === invoice.totals.totalPaise && invoice.number;
  if (!sound || !["issued", "part_paid", "paid"].includes(invoice.status)) throw new SellError("INVOICE_NOT_ISSUED", "This invoice has not been issued with the owner's approval.", { status: 409 });
  return invoice;
}

/**
 * After an issue: write the PDF and open the pay page, then announce invoice.issued with what
 * exists. A failure of either is reported (event error) and returned, never hidden; the invoice
 * stays issued.
 */
async function finishIssue(businessId, invoiceId, { sessionId = null, checkoutOptions } = {}) {
  const invoice = assertIssued(businessId, invoiceId);
  const problems = [];
  try {
    await require("./invoice-pdf").writeInvoicePdf(businessId, invoice.id);
  } catch (err) {
    problems.push({ step: "pdf", code: err.code ?? "PDF_FAILED", message: err.message });
  }
  try {
    await require("./checkout").ensureCheckout(businessId, invoice.id, checkoutOptions);
  } catch (err) {
    problems.push({ step: "pay", code: err.code ?? "PAY_FAILED", message: err.message });
  }
  for (const p of problems) events.emit(businessId, "error", { code: p.code, message: p.message, scope: `invoice.${p.step}`, invoiceId }, { sessionId, actor: "system" });
  const done = require("./view").invoiceView(businessId, invoices.get(businessId, invoiceId));
  events.emit(businessId, "invoice.issued", { invoice: done, problems }, { sessionId, actor: "system" });
  return { invoice: done, problems };
}

module.exports = {
  buildReadback, classifyReply, requestInvoiceApproval, recordInvoiceReadbackSpoken, confirmInvoice, assertIssued, finishIssue,
  listApprovals, approvalRow, readbacksOf, view, spokenName, LANGUAGES,
};
