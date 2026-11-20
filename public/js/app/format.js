// Words for amounts, quantities, items and days (no DOM). Shared by toasts, Sell, Money, Stock and the
// Yes card. Indian grouping; units and "today" in the owner's script.

import { amount, rupees, toDate, num } from "./dom.js";
import { lang, unitWord, addStrings, t } from "./i18n.js";
import { scriptOf } from "../voice.js";

addStrings({
  "fmt.today": ["today", "आज", "ಇಂದು"],
  "fmt.days": ["{n} days", "{n} दिन", "{n} ದಿನ"],
  "fmt.dayOne": ["1 day", "1 दिन", "1 ದಿನ"],
});

const inrPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹6,457.50" or "₹11,000": paise always as two digits, whole rupees without them. */
export function money(v) {
  const n = num(v);
  if (n === null) return "";
  return Number.isInteger(n) ? rupees(n) : `₹${inrPaise.format(n)}`;
}

/** "200 kg" in the owner's script for the unit. */
export function qtyText(q, unit) {
  const n = amount(q);
  if (n === null) return "";
  const u = unitWord(unit);
  return u ? `${n} ${u}` : n;
}

/** The item's name in the owner's script when Sahay has it, else as stored. */
export function itemName(it) {
  if (!it) return "";
  const L = lang();
  if (it.nameNative && L !== "en" && scriptOf(it.nameNative) === L) return it.nameNative;
  return it.name || it.nameNative || "";
}

/** Whole days since a date (0 = today); null when the date is unknown. */
export function daysSince(ts) {
  const d = toDate(ts);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

export function daysWord(n) {
  if (n === null || n === undefined) return "";
  if (n === 0) return t("fmt.today");
  return n === 1 ? t("fmt.dayOne") : t("fmt.days", { n });
}

/** The first letter of a name (a whole grapheme, so a Devanagari conjunct stays whole). */
export function initial(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  try { return [...new Intl.Segmenter().segment(text)][0].segment; } catch { return text.slice(0, 1); }
}

/** "Lakshmi Provision Mart" -> "LP". */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return (initial(words[0]) + (words[1] ? initial(words[1]) : "")).toUpperCase();
}
