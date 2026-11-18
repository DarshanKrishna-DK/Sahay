'use strict';

/**
 * The one unit table. Every module that compares, converts or says a unit uses it: the
 * save_requirement boundary (so a requirement is stored as "kg", never "किलो" or "kilos"),
 * vendor scoring, landed cost, the approval gate and the negotiation lines.
 *
 * A unit is known only when one of its spellings below matches exactly (after case, spacing,
 * joiners and a trailing full stop or danda are folded). Nothing is guessed from a near match.
 */

/**
 * code -> spellings (English, Hindi in Devanagari, Kannada in Kannada script) and spoken words.
 * `en` is [one, many]; `enShort` is the form the approval read-back has always used.
 */
const UNITS = {
  kg: {
    names: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilo gram', 'kilo grams', 'किलो', 'किलोग्राम', 'केजी', 'ಕೆಜಿ', 'ಕಿಲೋ', 'ಕಿಲೊ', 'ಕಿಲೋಗ್ರಾಂ', 'ಕಿಲೋಗ್ರಾಮ್'],
    hi: 'किलो', kn: 'ಕೆಜಿ', en: ['kilogram', 'kilograms'], enShort: 'kg',
  },
  g: {
    names: ['g', 'gm', 'gms', 'gram', 'grams', 'ग्राम', 'ಗ್ರಾಂ', 'ಗ್ರಾಮ್'],
    hi: 'ग्राम', kn: 'ಗ್ರಾಂ', en: ['gram', 'grams'],
  },
  quintal: {
    names: ['quintal', 'quintals', 'qtl', 'क्विंटल', 'कुंतल', 'ಕ್ವಿಂಟಾಲ್', 'ಕ್ವಿಂಟಲ್'],
    hi: 'क्विंटल', kn: 'ಕ್ವಿಂಟಾಲ್', en: ['quintal', 'quintals'],
  },
  tonne: {
    names: ['tonne', 'tonnes', 'ton', 'tons', 'mt', 'metric ton', 'metric tonne', 'टन', 'ಟನ್'],
    hi: 'टन', kn: 'ಟನ್', en: ['tonne', 'tonnes'],
  },
  litre: {
    names: ['litre', 'litres', 'liter', 'liters', 'l', 'ltr', 'लीटर', 'लिटर', 'ಲೀಟರ್', 'ಲೀಟರ'],
    hi: 'लीटर', kn: 'ಲೀಟರ್', en: ['litre', 'litres'],
  },
  ml: {
    names: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'मिलीलीटर', 'मिली', 'ಮಿಲಿಲೀಟರ್', 'ಮಿಲಿ'],
    hi: 'मिलीलीटर', kn: 'ಮಿಲಿಲೀಟರ್', en: ['millilitre', 'millilitres'],
  },
  metre: {
    names: ['metre', 'metres', 'meter', 'meters', 'm', 'mtr', 'मीटर', 'ಮೀಟರ್'],
    hi: 'मीटर', kn: 'ಮೀಟರ್', en: ['metre', 'metres'],
  },
  piece: {
    names: ['piece', 'pieces', 'pc', 'pcs', 'nos', 'पीस', 'पीसेस', 'नग', 'ಪೀಸ್', 'ಪೀಸ್‌ಗಳು', 'ತುಂಡು'],
    hi: 'पीस', kn: 'ಪೀಸ್', en: ['piece', 'pieces'],
  },
  bag: {
    names: ['bag', 'bags', 'sack', 'sacks', 'बोरी', 'बोरा', 'बैग', 'थैला', 'ಚೀಲ', 'ಬ್ಯಾಗ್', 'ಮೂಟೆ'],
    hi: 'बोरी', kn: 'ಚೀಲ', en: ['bag', 'bags'],
  },
  box: {
    names: ['box', 'boxes', 'carton', 'cartons', 'डिब्बा', 'बॉक्स', 'ಬಾಕ್ಸ್', 'ಡಬ್ಬ', 'ಡಬ್ಬಿ'],
    hi: 'डिब्बा', kn: 'ಬಾಕ್ಸ್', en: ['box', 'boxes'],
  },
  pack: {
    names: ['pack', 'packs', 'पैक', 'ಪ್ಯಾಕ್'],
    hi: 'पैक', kn: 'ಪ್ಯಾಕ್', en: ['pack', 'packs'],
  },
  packet: {
    names: ['packet', 'packets', 'pkt', 'pkts', 'पैकेट', 'ಪ್ಯಾಕೆಟ್'],
    hi: 'पैकेट', kn: 'ಪ್ಯಾಕೆಟ್', en: ['packet', 'packets'],
  },
  dozen: {
    names: ['dozen', 'dozens', 'doz', 'दर्जन', 'ಡಜನ್'],
    hi: 'दर्जन', kn: 'ಡಜನ್', en: ['dozen', 'dozen'],
  },
};

/** Exact metric relationships only. A bag, box or piece has no fixed size, so it is never here. */
const UNIT_SIZE = {
  g: { dimension: 'mass', size: 0.001 },
  kg: { dimension: 'mass', size: 1 },
  quintal: { dimension: 'mass', size: 100 },
  tonne: { dimension: 'mass', size: 1000 },
  ml: { dimension: 'volume', size: 0.001 },
  litre: { dimension: 'volume', size: 1 },
};

/** One spelling per unit name: composed, lower case, no joiners, single spaces, no "per", no final full stop or danda. */
function fold(unit) {
  return String(unit)
    .normalize('NFC')
    .replace(/[‌‍]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^(?:per|प्रति)\s+|^\//u, '')
    .replace(/[.।]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CODE_BY_NAME = new Map(
  Object.entries(UNITS).flatMap(([code, unit]) => [code, ...unit.names].map((name) => [fold(name), code])),
);

/**
 * The canonical code ("kg", "piece", ...) for any known spelling in English, Hindi or Kannada;
 * null for a unit this table does not know. Use at a boundary that must refuse to guess.
 */
function canonicalUnit(unit) {
  if (unit == null) return null;
  const text = fold(unit);
  if (!text) return null;
  return CODE_BY_NAME.get(text) ?? null;
}

/**
 * "Kg", "किलो", " kgs " -> "kg". An unknown unit is kept as written (folded) so two listings in
 * the same unknown unit still compare equal; empty -> null.
 */
function normaliseUnit(unit) {
  if (unit == null) return null;
  const text = fold(unit);
  if (!text) return null;
  return CODE_BY_NAME.get(text) ?? text;
}

/** True when two units are the same unit (both known and equal, or the same unknown spelling). */
function sameUnit(a, b) {
  const x = normaliseUnit(a);
  return x !== null && x === normaliseUnit(b);
}

/**
 * How many `toUnit` make one `fromUnit` (tonne -> kg = 1000). Null when either unit is missing
 * or the two have no exact relationship.
 */
function unitRatio(fromUnit, toUnit) {
  const from = normaliseUnit(fromUnit);
  const to = normaliseUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return 1;
  const a = UNIT_SIZE[from];
  const b = UNIT_SIZE[to];
  if (!a || !b || a.dimension !== b.dimension) return null;
  return a.size / b.size;
}

const LANGUAGE_KEY = { 'hi-IN': 'hi', 'kn-IN': 'kn', 'en-IN': 'en', hi: 'hi', kn: 'kn', en: 'en' };

/**
 * A unit as spoken in `language` (hi-IN | kn-IN | en-IN, or hi | kn | en). English is plural
 * when `many`; `short` gives "kg" instead of "kilogram(s)". An unknown unit is said as written.
 */
function unitWord(unit, language, many = false, { short = false } = {}) {
  if (unit == null || unit === '') return '';
  const known = UNITS[normaliseUnit(unit)];
  if (!known) return String(unit).trim();
  const lang = LANGUAGE_KEY[language] ?? 'en';
  if (lang !== 'en') return known[lang];
  if (short && known.enShort) return known.enShort;
  return known.en[many ? 1 : 0];
}

/** Canonical codes, for tool descriptions. */
const UNIT_CODES = Object.freeze(Object.keys(UNITS));

module.exports = { canonicalUnit, normaliseUnit, sameUnit, unitRatio, unitWord, UNIT_CODES };
