"use strict";

/**
 * One server line, one /speak request, one Murf stream.
 *
 * Murf Falcon allows 2 concurrent streams outside US-East; a context over the limit closes the
 * WebSocket with 4029 and stops every context on it (murf.ai/api/docs/resources/rate-limits.md;
 * agora-findings.md "Live check 129a071 stall"). A read-back the server speaks therefore has to
 * go out as ONE /speak piece: Agora's /speak takes at most 512 bytes and Sahay keeps under 500.
 *
 * fitOnePiece builds a line from its values and, only when it is still over the limit, shortens
 * the free-text values it is allowed to shorten (a vendor's or customer's long name, an item
 * name) a word at a time, longest first. Figures are never touched. Deterministic: the same
 * values always give the same line, so a stored read-back can still be rebuilt and compared.
 */

const SPEAK_MAX_BYTES = 500; // Agora /speak docs limit 512 bytes; kept under it on purpose
const MIN_CHARS = 12;

const bytes = (text) => Buffer.byteLength(String(text ?? ""), "utf8");
const graphemes = (text) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);

/** One step shorter: drop the last word, or a quarter of a single long word (whole graphemes). */
function shorten(text) {
  const words = String(text).trim().split(/\s+/);
  if (words.length > 1) return words.slice(0, -1).join(" ").replace(/[\s,;:(-]+$/u, "");
  const g = graphemes(words[0]);
  return g.slice(0, Math.max(MIN_CHARS, Math.ceil(g.length * 0.75))).join("");
}

/**
 * `build(values)` -> text. Returns the text for `values`, shortening the `shortenable` keys only
 * while the text is over `maxBytes`. When nothing more can be shortened the text is returned as
 * built (the caller's length tests keep that from happening).
 */
function fitOnePiece(build, values, shortenable = [], { maxBytes = SPEAK_MAX_BYTES } = {}) {
  const v = { ...values };
  let text = build(v);
  while (bytes(text) > maxBytes) {
    const key = shortenable
      .filter((k) => typeof v[k] === "string" && graphemes(v[k]).length > MIN_CHARS)
      .sort((a, b) => bytes(v[b]) - bytes(v[a]))[0];
    if (!key) break;
    const shorter = shorten(v[key]);
    if (shorter === v[key]) break;
    v[key] = shorter;
    text = build(v);
  }
  return text;
}

module.exports = { SPEAK_MAX_BYTES, fitOnePiece, bytes };
