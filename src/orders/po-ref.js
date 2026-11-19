"use strict";

/**
 * A purchase order named the way an owner says or types it (E2E regress bug 5: create_payment_link
 * given "SAHAY/2026/6799-0001" answered "order not found", because only an order id was looked up).
 *
 * Only the digits of a reference count: ASCII, Devanagari and Kannada digits, and digit words said
 * one by one (छह सात नौ नौ, ಆರು ಏಳು, six seven). A reference matches an order when its digits are the
 * whole PO number's digits, the tail of them (4 digits or more), or the PO's sequence number (its
 * last group, "0001" = 1). Several matches are ambiguous; no match is null, never a guess.
 */

const DIGITS = { "०": 0, "१": 1, "२": 2, "३": 3, "४": 4, "५": 5, "६": 6, "७": 7, "८": 8, "९": 9, "೦": 0, "೧": 1, "೨": 2, "೩": 3, "೪": 4, "೫": 5, "೬": 6, "೭": 7, "೮": 8, "೯": 9 };

const WORDS = new Map(
  Object.entries({
    0: ["zero", "oh", "शून्य", "ज़ीरो", "जीरो", "ಸೊನ್ನೆ", "ಶೂನ್ಯ"],
    1: ["one", "एक", "ಒಂದು"],
    2: ["two", "दो", "ಎರಡು"],
    3: ["three", "तीन", "ಮೂರು"],
    4: ["four", "चार", "ನಾಲ್ಕು"],
    5: ["five", "पाँच", "पांच", "ಐದು"],
    6: ["six", "छह", "छः", "छे", "ಆರು"],
    7: ["seven", "सात", "ಏಳು"],
    8: ["eight", "आठ", "ಎಂಟು"],
    9: ["nine", "नौ", "ಒಂಬತ್ತು"],
  }).flatMap(([digit, words]) => words.map((w) => [w.normalize("NFC"), digit])),
);

/** The digits of `text`, in order, as ASCII ("" when there are none). */
function digitsOf(text) {
  const normal = String(text ?? "").normalize("NFC").toLowerCase().replace(/[०-९೦-೯]/g, (d) => String(DIGITS[d]));
  return normal
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .map((token) => (WORDS.has(token) ? WORDS.get(token) : token.replace(/\D/g, "")))
    .join("");
}

/** The PO's sequence number: its last group of digits as a number ("SAHAY/2026/6799-0001" -> 1). */
function sequenceOf(poNumber) {
  const groups = String(poNumber ?? "").match(/\d+/g);
  return groups ? Number(groups.at(-1)) : null;
}

/**
 * The order `ref` names among `orders` (rows with po_number): `{order}`, `{ambiguous: [orders]}`
 * when several match, or null.
 */
function findByPo(orders, ref) {
  const wanted = digitsOf(ref);
  if (!wanted) return null;
  const withPo = (orders ?? []).filter((o) => o?.po_number);
  const pick = (matches) => (matches.length === 1 ? { order: matches[0] } : matches.length > 1 ? { ambiguous: matches } : null);
  return (
    pick(withPo.filter((o) => digitsOf(o.po_number) === wanted)) ??
    (wanted.length >= 4 ? pick(withPo.filter((o) => digitsOf(o.po_number).endsWith(wanted))) : null) ??
    pick(withPo.filter((o) => sequenceOf(o.po_number) === Number(wanted)))
  );
}

module.exports = { digitsOf, findByPo };
