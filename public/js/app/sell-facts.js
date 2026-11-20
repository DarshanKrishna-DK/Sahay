// Sell and Money facts for the browser, with no DOM and no imports, so node:test can load it as is
// (test/sell-facts.test.js). Everything here is arithmetic or grouping over rows the server sent;
// nothing is invented: an unknown number stays null and the screen shows nothing for it.

/** Bill statuses the screens know; anything else is shown as a draft. */
export const BILL_STATUSES = ["draft", "pending", "issued", "part_paid", "paid", "cancelled"];
export const billStatus = (inv) => (inv && BILL_STATUSES.includes(inv.status) ? inv.status : "draft");

/** Which shelf of the bills list a status sits on (pending bills wait in their own place). */
const GROUP_OF = { issued: "unpaid", part_paid: "unpaid", draft: "draft", paid: "paid", cancelled: "cancelled" };
export const BILL_GROUPS = ["unpaid", "draft", "paid", "cancelled"];

const newestFirst = (a, b) => String(b.issuedAt || b.createdAt || "").localeCompare(String(a.issuedAt || a.createdAt || ""));

/**
 * The bills list, waiting ones left out: [{ group, bills }] in the order unpaid, draft, paid,
 * cancelled; each group newest first; empty groups dropped.
 */
export function billGroups(invoices) {
  const by = new Map(BILL_GROUPS.map((g) => [g, []]));
  for (const inv of invoices || []) {
    const s = billStatus(inv);
    if (s === "pending") continue;
    by.get(GROUP_OF[s]).push(inv);
  }
  return BILL_GROUPS.map((group) => ({ group, bills: by.get(group).sort(newestFirst) })).filter((g) => g.bills.length);
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const paise = (v) => Math.round(v * 100) / 100;

/** A line's amount before tax: the server's taxable value, else quantity x rate; null if unknown. */
export function lineAmount(line) {
  if (!line) return null;
  if (isNum(line.taxable)) return line.taxable;
  if (isNum(line.qty) && isNum(line.unitPrice)) return paise(line.qty * line.unitPrice);
  return null;
}

/**
 * How a bill's tax reads: { kind, rows, tax }.
 *  kind "unknown": the server sent no tax figure (show nothing);
 *  kind "none":    tax is zero (a plain bill or bill of supply);
 *  kind "split":   CGST + SGST (inside the shop's state);
 *  kind "igst":    IGST (another state);
 *  kind "total":   a tax total without its split.
 * rows: [{ key: "taxable" | "cgst" | "sgst" | "igst", amount }] for the figures the server sent.
 */
export function gstRows(totals) {
  const t = totals || {};
  const rows = [];
  if (isNum(t.taxable)) rows.push({ key: "taxable", amount: t.taxable });
  if (!isNum(t.tax)) return { kind: "unknown", rows, tax: null };
  if (t.tax === 0) return { kind: "none", rows, tax: 0 };
  if (isNum(t.igst) && t.igst > 0) return { kind: "igst", rows: [...rows, { key: "igst", amount: t.igst }], tax: t.tax };
  if ((isNum(t.cgst) && t.cgst > 0) || (isNum(t.sgst) && t.sgst > 0)) {
    return { kind: "split", rows: [...rows, { key: "cgst", amount: isNum(t.cgst) ? t.cgst : 0 }, { key: "sgst", amount: isNum(t.sgst) ? t.sgst : 0 }], tax: t.tax };
  }
  return { kind: "total", rows, tax: t.tax };
}

/** What is still owed on a bill: total less paid for an unpaid / part-paid bill; null if unknown. */
export function dueOf(inv) {
  const s = billStatus(inv);
  const total = inv && inv.totals && isNum(inv.totals.total) ? inv.totals.total : null;
  if (total === null) return null;
  if (s === "paid" || s === "cancelled" || s === "draft" || s === "pending") return s === "paid" ? 0 : null;
  const paid = isNum(inv.paid) ? inv.paid : 0;
  return Math.max(0, paise(total - paid));
}

/** A GSTIN with its middle hidden: "29•••••••••••1Z5" (first 2 and last 3 shown). */
export function maskGstin(g) {
  const s = String(g ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (s.length <= 5) return s;
  return `${s.slice(0, 2)}${"•".repeat(s.length - 5)}${s.slice(-3)}`;
}

/* ------------------------------------------------------------ phone -- */

/** The ten digits of an Indian mobile number from what was typed (drops +91 / 0 in front). */
export function cleanPhone(text) {
  let d = String(text ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

/** "empty" | "short" | "shape" (10 digits but not 6-9 first) | "ok". */
export function phoneProblem(digits) {
  const d = String(digits ?? "");
  if (!d) return "empty";
  if (d.length < 10) return "short";
  return /^[6-9]\d{9}$/.test(d) ? "ok" : "shape";
}

/** "98765 43210" as it is read aloud in two halves; partial input keeps its own grouping. */
export const formatPhone = (digits) => {
  const d = String(digits ?? "");
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
};

/* ------------------------------------------------------------ keypad -- */

/**
 * One key on a number pad. "back" removes a digit, "clear" empties; a leading zero is ignored for
 * amounts (`noLeadingZero`), and input stops at `max` digits.
 */
export function padPress(digits, key, { max = 8, noLeadingZero = true } = {}) {
  const d = String(digits ?? "");
  if (key === "back") return d.slice(0, -1);
  if (key === "clear") return "";
  if (!/^\d{1,2}$/.test(String(key))) return d;
  if (noLeadingZero && d === "" && /^0+$/.test(String(key))) return d;
  return (d + key).slice(0, max);
}

/* ------------------------------------------------------------- khata -- */

/** A meter's fill against the largest amount, in whole percent; small debts still show a sliver. */
export function meterShare(amount, max) {
  if (!isNum(amount) || !isNum(max) || max <= 0 || amount <= 0) return 0;
  return Math.min(100, Math.max(6, Math.round((amount / max) * 100)));
}

/** "today" | "days" | "old" (30 days or more) | null when the date is unknown. */
export function ageBucket(days) {
  if (!isNum(days)) return null;
  if (days <= 0) return "today";
  return days >= 30 ? "old" : "days";
}

/** Sum of the amounts the server sent (unknown amounts count as nothing). */
export const sumOf = (rows, key = "amount") => paise((rows || []).reduce((s, r) => s + (r && isNum(r[key]) ? r[key] : 0), 0));

/**
 * Purchase orders still to pay (Money > to pay): not yet paid, not cancelled or rejected.
 * Same reading as the Buy screen's receipts (paid, in transit, delivered and closed are paid).
 */
const SETTLED = new Set(["paid", "in_transit", "delivered", "closed", "cancelled", "rejected"]);
export function ordersToPay(orders) {
  return [...(orders || [])].filter((o) => o && o.status && !SETTLED.has(o.status))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

/* ------------------------------------------------------- bill filters -- */

/** The Sell list's filters (spec v4: Today / Not paid / All); waiting bills are never in the list. */
export const BILL_FILTERS = ["today", "unpaid", "all"];

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Bills for a filter, newest first: "today" (made or billed today, local time), "unpaid" (billed
 * or part paid), "all". Counts for every filter come back too, for the filter labels.
 */
export function filterBills(invoices, filter = "all", now = new Date()) {
  const list = [...(invoices || [])].filter((i) => billStatus(i) !== "pending").sort(newestFirst);
  const today = (i) => {
    const raw = i.issuedAt || i.createdAt;
    const d = raw ? new Date(raw) : null;
    return Boolean(d && !Number.isNaN(d.getTime()) && sameDay(d, now));
  };
  const unpaid = (i) => ["issued", "part_paid"].includes(billStatus(i));
  const pick = { today, unpaid, all: () => true };
  const counts = { today: list.filter(today).length, unpaid: list.filter(unpaid).length, all: list.length };
  const key = BILL_FILTERS.includes(filter) ? filter : "all";
  return { bills: list.filter(pick[key]), counts, filter: key };
}

/** Money received today (local time): { amount, count } over the receipts the server sent. */
export function receivedToday(receipts, now = new Date()) {
  const today = (r) => {
    const d = r && r.createdAt ? new Date(r.createdAt) : null;
    return Boolean(d && !Number.isNaN(d.getTime()) && sameDay(d, now));
  };
  const rows = (receipts || []).filter(today);
  return { amount: sumOf(rows), count: rows.length };
}
