"use strict";

/**
 * Was a requirement actually said by the owner? (E2E r4 bug 4.)
 *
 * ASR sometimes delivers a fragment ("मुझे पांच") and the model fills in the rest from earlier
 * context ("5 kg basmati rice"). save_requirement checks the figures the model passes against
 * the owner's own last turns: Agora /history owner turns in a call (spoken: source "asr", or typed
 * in the console: source "message"), else the `owner_words` the model copied. A typed turn is good
 * evidence of WHAT the owner wants; it is never consent (approvals, rules and the usual quantity
 * read only ASR turns, approvals.isOwnerAsr). The check is deliberately simple and lenient on wording:
 * - a quantity needs a number in those turns: its exact digits (any script), or number words;
 * - a unit the model sets needs one of its spellings in the same turn as that number;
 * - an item needs one of its words in the turns, in its own script or via the trade-word table.
 * An item that cannot be compared across scripts is not refused (no guessing either way).
 */

const { canonicalUnit } = require("../procurement/units");
const { itemIn } = require("../discovery/slug");

/** How many of the owner's latest turns may carry one requirement ("basmati chawal chahiye" ... "do sau kilo"). */
const TURNS = 2;

const DIGITS = { "०": 0x966, "೦": 0xce6 };

const fold = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‌‍]/g, "")
    .replace(/[०-९]/g, (d) => String(d.codePointAt(0) - DIGITS["०"]))
    .replace(/[೦-೯]/g, (d) => String(d.codePointAt(0) - DIGITS["೦"]))
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/(\d)(?=[^\d\s.])/gu, "$1 ")
    .replace(/[^\p{L}\p{M}\p{N}.]+/gu, " ")
    .trim();

const tokens = (text) => fold(text).split(" ").map((t) => t.replace(/\.$/, "")).filter(Boolean);

/** Whole-word number words (Hindi, romanised Hindi and Kannada, English). "do" is left out: it is also English. */
const NUMBER_WORDS = new Set([
  "एक", "दो", "तीन", "चार", "पांच", "पाँच", "छह", "छः", "छे", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह",
  "पंद्रह", "पन्द्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर", "अस्सी", "नब्बे",
  "सौ", "हज़ार", "हजार", "लाख", "करोड़", "डेढ़", "ढाई", "सवा", "आधा", "पच्चीस", "दर्जन",
  "ek", "teen", "char", "chaar", "panch", "paanch", "saat", "aath", "das", "bees", "pachas", "pachaas", "sau", "hazar", "hazaar",
  // Romanised Hindi (typed Hinglish). Left out: "do" (English), "saath" ("with"), "nau" (rare, and "now" misheard).
  "chhe", "chhah", "gyarah", "barah", "pandrah", "solah", "tees", "chalis", "chaalis", "sattar", "assi", "nabbe",
  "dedh", "dhai", "dhaai", "sawa", "aadha", "aadhaa", "darjan",
  // Romanised Kannada (typed Kanglish), whole words only.
  "ondu", "eradu", "mooru", "muru", "naalku", "nalku", "aidu", "aaru", "elu", "entu", "ombattu", "hattu", "ippattu", "muvattu",
  "nalavattu", "aivattu", "nooru", "nuru", "innooru", "innuru", "munnooru", "saavira", "savira", "ardha",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety", "hundred", "thousand", "lakh", "lakhs", "crore", "crores", "dozen", "half",
]);
/** Endings of the irregular Hindi numbers 21-99 (इक्कीस, बत्तीस, इक्यावन, इकसठ, इकहत्तर, इक्यासी, इक्यानवे ...). */
const HINDI_NUMBER_ENDING = /(?:ीस|ावन|सठ|त्तर|ासी|नवे|नबे)$/u;
/** Kannada number stems, found inside compounds and case endings (ಇನ್ನೂರು, ಇಪ್ಪತ್ತೈದು, ಸಾವಿರದ). */
const KANNADA_NUMBER_STEMS = [
  "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು", "ಹತ್ತು", "ಹನ್ನ", "ಹದಿ", "ಇಪ್ಪತ್ತ",
  "ಮೂವತ್ತ", "ನಲವತ್ತ", "ಐವತ್ತ", "ಅರವತ್ತ", "ಎಪ್ಪತ್ತ", "ಎಂಬತ್ತ", "ತೊಂಬತ್ತ", "ನೂರ", "ಸಾವಿರ", "ಲಕ್ಷ", "ಕೋಟಿ", "ಅರ್ಧ", "ಡಜನ್",
];

const isNumberWord = (token) =>
  NUMBER_WORDS.has(token) || HINDI_NUMBER_ENDING.test(token) || KANNADA_NUMBER_STEMS.some((stem) => token.includes(stem));

const isDigits = (token) => /^\d+(?:\.\d+)?$/.test(token);

/** `text` names some number, in digits or in words. */
const hasNumber = (text) => tokens(text).some((t) => isDigits(t) || isNumberWord(t));

/** The quantity is in `text`: as its exact digits, or as number words (not parsed: any number word counts). */
function numberHeard(text, quantity) {
  const words = tokens(text);
  if (words.filter(isDigits).map(Number).includes(Number(quantity))) return true;
  return words.some(isNumberWord);
}

const LATIN = /^[a-z0-9.]+$/;

/** One of the unit's spellings is in `text` (units.js); inside an Indic word only as its start ("ಕಿಲೋಗೆ"). */
function unitHeard(text, unit) {
  const words = tokens(text);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (canonicalUnit(word) === unit) return true;
    if (words[i + 1] && canonicalUnit(`${word} ${words[i + 1]}`) === unit) return true;
    if (LATIN.test(word)) continue;
    for (let end = word.length - 1; end >= 2; end--) if (canonicalUnit(word.slice(0, end)) === unit) return true;
  }
  return false;
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Devanagari}/u, /\p{Script=Kannada}/u];
const scriptOf = (word) => SCRIPTS.find((script) => script.test(word)) ?? null;

/**
 * A word of the item is in the turns: the item as given, or the item said in Hindi or Kannada
 * through the trade-word table. Only words in a script the turns use can be compared; when none
 * can, the item is not refused.
 */
function itemHeard(turns, item) {
  const heard = fold(turns.join(" "));
  const variants = [item, itemIn(item, "hi-IN"), itemIn(item, "kn-IN")].filter(Boolean);
  const words = [...new Set(variants.flatMap(tokens))].filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  const comparable = words.filter((w) => {
    const script = scriptOf(w);
    return script && script.test(heard);
  });
  if (!comparable.length) return true;
  return comparable.some((w) => heard.includes(w));
}

/**
 * The fields of a save_requirement call that the owner's turns do not bear out, [] when all do.
 * @param {string[]} turns  the owner's latest turns, oldest first
 * @param {{item?: string, quantity?: number, unit?: string}} claim
 *   unit is the canonical code the model is setting now (undefined when it keeps the stored one)
 */
function notHeard(turns, { item, quantity, unit } = {}) {
  const recent = (turns ?? []).slice(-TURNS);
  const missing = [];
  if (item && !itemHeard(recent, item)) missing.push("item");
  if (quantity != null) {
    // The amount is the one in the owner's latest turn that names a number: an earlier
    // "दो सौ किलो" does not vouch for a later fragment "मुझे पांच" (E2E r4).
    const turn = recent.findLast(hasNumber);
    const said = turn !== undefined && numberHeard(turn, quantity) && (!unit || unitHeard(turn, unit));
    if (!said) missing.push("quantity", ...(unit ? ["unit"] : []));
  } else if (unit && !recent.some((turn) => unitHeard(turn, unit))) missing.push("unit");
  return missing;
}

/** Owner turns that can say what to buy: spoken (asr) or typed (message), per agora-findings "Typed owner message". */
const OWNER_SOURCES = new Set(["asr", "message"]);
const isOwnerTurn = (item) => item?.role === "user" && OWNER_SOURCES.has(item?.metadata?.source) && typeof item.content === "string" && item.content.trim() !== "";

/**
 * The owner's last `n` turns (spoken or typed) from an Agora /history `contents` array, oldest
 * first. Type mode could not save a need while this read ASR turns only (final-2 E).
 */
function ownerTurns(contents, n = TURNS) {
  return Array.isArray(contents) ? contents.filter(isOwnerTurn).slice(-n).map((item) => item.content.trim()) : [];
}

module.exports = { notHeard, ownerTurns, isOwnerTurn, numberHeard, unitHeard, itemHeard, TURNS };
