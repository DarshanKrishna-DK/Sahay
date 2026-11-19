// A status line names the item only when the item is written in the line's own script, so one
// sentence never mixes Hindi and Kannada (CLAUDE.md rule 5; E2E 2026-11-19: a Hindi
// "{item} के 10 विक्रेता मिले" carried a Kannada item after the business language changed).
// Otherwise the line's item-free twin ("<key>Any") is used. No DOM and no imports, so node:test
// loads it as is (test/item-line.test.js).

const LETTERS = { hi: /[ऀ-ॿ]/u, kn: /[ಀ-೿]/u, en: /[A-Za-z]/ };

/** True when `item` has letters of `lang`'s script only (digits and signs fit every script). */
function fits(item, lang) {
  if (!LETTERS[lang]) return false;
  return Object.entries(LETTERS).every(([other, re]) => other === lang || !re.test(item));
}

/** { key, vars } for t(): `key` with the item when it fits `lang`, else `${key}Any` without it. */
export function itemLine(key, vars, lang) {
  const { item, ...rest } = vars || {};
  const text = item == null ? "" : String(item).trim();
  return text && fits(text, lang) ? { key, vars: { ...rest, item: text } } : { key: `${key}Any`, vars: rest };
}
