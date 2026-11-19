"use strict";

/**
 * Seller-controlled text (IndiaMART listing names and titles, a vendor's own words) is cleaned
 * once, where it enters the database (src/db/repo.js), so no prompt, spoken line, PDF or
 * Telegram message ever carries it raw (security review r1 #5).
 */

/** Longest vendor-supplied name or title kept. */
const VENDOR_TEXT_MAX = 80;
/** A vendor's quoted sentence is a whole spoken line, so it may be longer than a name. */
const QUOTED_SENTENCE_MAX = 240;

/**
 * Text that came from a vendor (an IndiaMART listing, a vendor's own words) and may later be
 * spoken, printed, sent on Telegram or shown to a model: control and format characters and
 * line breaks become spaces (the zero-width joiners Indic scripts need are kept), whitespace
 * is collapsed, and at most `max` characters remain. Null when nothing is left.
 */
function vendorText(value, max = VENDOR_TEXT_MAX) {
  if (value == null) return null;
  const clean = String(value)
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (ch) => (ch === "\u200c" || ch === "\u200d" ? ch : " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const chars = [...clean];
  return chars.length <= max ? clean : chars.slice(0, max).join("").trimEnd();
}

module.exports = { vendorText, VENDOR_TEXT_MAX, QUOTED_SENTENCE_MAX };
