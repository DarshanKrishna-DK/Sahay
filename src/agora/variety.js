"use strict";

/**
 * Natural variation for lines the server speaks itself (narrator, negotiation loop): a person
 * never says "the search is done" the same way three times in a row (Track POLISH; LiveKit's
 * prompting guide: never open two turns the same way).
 *
 * Variants of one line differ only in wording: every figure, name and label is filled in by the
 * caller from the same variables, so a variant can never change a number.
 *
 * Deterministic: each scope (a business, a negotiation) walks the variants in turn from an
 * offset taken from a hash of the scope, so two negotiations do not sound identical, consecutive
 * uses in one scope never repeat, and a test can predict the choice with `variantIndex`.
 */

const crypto = require("node:crypto");

/** scope|key -> how many times that line was said in that scope */
const said = new Map();
const MAX_SCOPES = 5000;

const offsetOf = (text, n) => crypto.createHash("sha256").update(String(text)).digest().readUInt32BE(0) % n;

/** Index of the variant the next `pick` of `key` in `scope` returns, without using it up. */
function variantIndex(n, scope, key) {
  const id = `${scope}|${key}`;
  return (offsetOf(id, n) + (said.get(id) ?? 0)) % n;
}

/**
 * The next of `variants` for this line in this scope. `variants` is an array of strings or of
 * functions of `vars`; a single variant is always itself.
 */
function pick(variants, { scope = "", key = "", vars } = {}) {
  const list = Array.isArray(variants) ? variants : [variants];
  if (!list.length) throw new Error("pick needs at least one variant.");
  const index = list.length === 1 ? 0 : variantIndex(list.length, scope, key);
  if (list.length > 1) {
    const id = `${scope}|${key}`;
    if (!said.has(id) && said.size >= MAX_SCOPES) said.delete(said.keys().next().value);
    said.set(id, (said.get(id) ?? 0) + 1);
  }
  const chosen = list[index];
  return typeof chosen === "function" ? chosen(vars ?? {}) : chosen;
}

/** Tests: start every scope afresh. */
function reset() {
  said.clear();
}

module.exports = { pick, variantIndex, reset };
