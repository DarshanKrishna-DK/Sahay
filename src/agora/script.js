"use strict";

/**
 * Native-script guard for text the server itself speaks (CLAUDE.md rule 5): a Hindi line is
 * Devanagari, a Kannada line is Kannada script. Murf reads a Latin word inside Hindi or Kannada
 * with an English voice model, and a Devanagari word inside Kannada with the wrong one.
 *
 * Allowed inside a hi/kn line: digits and punctuation, purchase-order numbers (SAHAY/2026/AB12-0001),
 * the word "Razorpay", and the exact names the caller passes (a vendor's or business's own
 * brand name, which is never transliterated by guess).
 */

const LATIN_WORD = /[A-Za-z][A-Za-z'.&-]*/g;
/** SAHAY/2026/AB12-0001 (per-business code, repo.poCode) and the older SAHAY/2026/0001. */
const PO_NUMBER = /\b[A-Z]{2,10}\/\d{4}\/(?:[0-9A-F]{4,64}-)?\d{1,6}\b/g;
const ALWAYS_ALLOWED = ["Razorpay"];
/** A script that does not belong inside a sentence of this language. */
const FOREIGN = {
  "hi-IN": /\p{Script=Kannada}/u,
  "kn-IN": /\p{Script=Devanagari}/u,
};

/**
 * Problems in `text` for `language`: `{ latin: string[], foreign: boolean }`.
 * English (or an unknown language) has no rule here and always comes back clean.
 * @param {string} text
 * @param {string} language  hi-IN | kn-IN | en-IN
 * @param {{allow?: (string|null|undefined)[]}} [options]  names that may stay as written
 */
function scriptProblems(text, language, { allow = [] } = {}) {
  const clean = { latin: [], foreign: false };
  if (!FOREIGN[language]) return clean;
  let rest = String(text ?? "").replace(PO_NUMBER, " ");
  const names = [...ALWAYS_ALLOWED, ...allow.filter((a) => typeof a === "string" && a.trim())].sort((a, b) => b.length - a.length);
  for (const name of names) rest = rest.split(name).join(" ");
  return { latin: rest.match(LATIN_WORD) ?? [], foreign: FOREIGN[language].test(rest) };
}

/** True when `text` is all in `language`'s script apart from the allowed tokens. */
function isNativeScript(text, language, options) {
  const p = scriptProblems(text, language, options);
  return p.latin.length === 0 && !p.foreign;
}

module.exports = { scriptProblems, isNativeScript };
