"use strict";

/**
 * Spoken lines for stock, in the owner's language and its own script (CLAUDE.md rule 5). Every
 * figure comes from the ledger; items are said in the sentence's script when the trade-word
 * table knows them (src/discovery/slug.js itemIn), else as the owner or the shop named them.
 */

const { itemIn } = require("../discovery/slug");
const { unitWord } = require("../procurement/units");
const { langKey } = require("../tools/errors");
const { scriptProblems } = require("../agora/script");

const round3 = (n) => Math.round(n * 1000) / 1000;
const num = (n) => String(round3(n));
const SCRIPT = { "hi-IN": /\p{Script=Devanagari}/u, "kn-IN": /\p{Script=Kannada}/u, "en-IN": /\p{Script=Latin}/u };
const SIM = { "hi-IN": " (सिम्युलेटेड विक्रेता)", "kn-IN": " (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)", "en-IN": " (simulated vendor)" };

/** The item as said in a sentence of `language`. */
function itemWord(item, language) {
  const lang = langKey(language);
  if (lang !== "en-IN") {
    const native = itemIn(item.name, lang) ?? (item.name_native ? itemIn(item.name_native, lang) : null);
    if (native) return native;
  }
  for (const name of [item.name, item.name_native]) if (name && SCRIPT[lang].test(name)) return name;
  return item.name;
}

const qty = (n, unit, language) => `${num(n)} ${unitWord(unit, language, n !== 1)}`;

const LINES = {
  reorder_question: {
    "hi-IN": (v) => `${v.out ? `${v.item} खत्म हो गया है।` : `${v.item} कम है, ${v.left} बचा है।`} ${v.more ? `${v.more} और मँगाऊँ?` : "और मँगाऊँ?"}`,
    "kn-IN": (v) => `${v.out ? `${v.item} ಮುಗಿದಿದೆ.` : `${v.item} ಕಡಿಮೆ ಇದೆ, ${v.left} ಉಳಿದಿದೆ.`} ${v.more ? `ಇನ್ನೂ ${v.more} ತರಿಸಲೇ?` : "ಇನ್ನಷ್ಟು ತರಿಸಲೇ?"}`,
    "en-IN": (v) => `${v.out ? `${v.item} has run out.` : `${v.item} is running low, ${v.left} left.`} ${v.more ? `Shall I buy ${v.more} more?` : "Shall I buy more?"}`,
  },
  reorder_answer: {
    "hi-IN": () => "हाँ या ना में बताइए।",
    "kn-IN": () => "ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.",
    "en-IN": () => "Please tell me yes or no.",
  },
  reorder_searching: {
    "hi-IN": (v) => `ठीक है, ${v.more} ${v.item} के लिए विक्रेताओं की खोज शुरू कर दी है। ऑर्डर आपकी हाँ के बिना नहीं होगा।`,
    "kn-IN": (v) => `ಸರಿ, ${v.more} ${v.item} ಗಾಗಿ ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಶುರು ಮಾಡಿದ್ದೇನೆ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಆರ್ಡರ್ ಆಗುವುದಿಲ್ಲ.`,
    "en-IN": (v) => `All right, I have started looking for sellers of ${v.more} of ${v.item}. Nothing is ordered without your yes.`,
  },
  reorder_saved: {
    "hi-IN": (v) => `ठीक है, ${v.item} की ज़रूरत लिख ली है।`,
    "kn-IN": (v) => `ಸರಿ, ${v.item} ಅಗತ್ಯವನ್ನು ಬರೆದುಕೊಂಡಿದ್ದೇನೆ.`,
    "en-IN": (v) => `All right, I have noted that you need ${v.item}.`,
  },
  reorder_how_much: {
    "hi-IN": (v) => `ठीक है, ${v.item} कितना मँगाऊँ?`,
    "kn-IN": (v) => `ಸರಿ, ${v.item} ಎಷ್ಟು ತರಿಸಲಿ?`,
    "en-IN": (v) => `All right, how much ${v.item} shall I buy?`,
  },
  reorder_declined: {
    "hi-IN": () => "ठीक है, अभी नहीं मँगाती।",
    "kn-IN": () => "ಸರಿ, ಈಗ ತರಿಸುವುದಿಲ್ಲ.",
    "en-IN": () => "All right, I will not buy more now.",
  },
  reorder_none: {
    "hi-IN": () => "अभी कोई सामान दोबारा मँगाने के लिए नहीं पूछा गया है।",
    "kn-IN": () => "ಈಗ ಯಾವ ಸಾಮಾನನ್ನೂ ಮತ್ತೆ ತರಿಸಲು ಕೇಳಿಲ್ಲ.",
    "en-IN": () => "There is no item waiting to be bought again.",
  },
  reorder_unclear: {
    "hi-IN": () => "मुझे साफ़ हाँ या ना सुनाई नहीं दी। और मँगाऊँ, हाँ या ना?",
    "kn-IN": () => "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಅಥವಾ ಇಲ್ಲ ಕೇಳಿಸಲಿಲ್ಲ. ಇನ್ನಷ್ಟು ತರಿಸಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": () => "I did not hear a clear yes or no. Shall I buy more, yes or no?",
  },
  reorder_tap: {
    "hi-IN": () => "स्क्रीन पर स्टॉक वाले कार्ड में और मँगाने का बटन दबाइए।",
    "kn-IN": () => "ಪರದೆಯ ಮೇಲಿನ ಸ್ಟಾಕ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಇನ್ನಷ್ಟು ತರಿಸುವ ಬಟನ್ ಒತ್ತಿ.",
    "en-IN": () => "Please press the buy more button on the stock card on the screen.",
  },
  stock_one: {
    "hi-IN": (v) => (v.counted ? `${v.item} ${v.left} बचा है${v.low ? `, जो ${v.level} की सीमा से कम है` : ""}।` : `${v.item} का स्टॉक अभी तक गिना नहीं गया है।`),
    "kn-IN": (v) => (v.counted ? `${v.item} ${v.left} ಉಳಿದಿದೆ${v.low ? `, ಇದು ${v.level} ಮಿತಿಗಿಂತ ಕಡಿಮೆ` : ""}.` : `${v.item} ಸ್ಟಾಕ್ ಇನ್ನೂ ಎಣಿಸಿಲ್ಲ.`),
    "en-IN": (v) => (v.counted ? `${v.left} of ${v.item} left${v.low ? `, at or below your limit of ${v.level}` : ""}.` : `The stock of ${v.item} has not been counted yet.`),
  },
  stock_all: {
    "hi-IN": (v) => `स्टॉक में ${v.count} सामान हैं${v.low ? `; कम हैं: ${v.low}` : ", कोई भी कम नहीं है"}।`,
    "kn-IN": (v) => `ಸ್ಟಾಕ್‌ನಲ್ಲಿ ${v.count} ಸಾಮಾನುಗಳಿವೆ${v.low ? `; ಕಡಿಮೆ ಇರುವುದು: ${v.low}` : ", ಯಾವುದೂ ಕಡಿಮೆ ಇಲ್ಲ"}.`,
    "en-IN": (v) => `There are ${v.count} items in stock${v.low ? `; low: ${v.low}` : ", none of them low"}.`,
  },
  stock_empty: {
    "hi-IN": () => "अभी स्टॉक में कोई सामान दर्ज नहीं है। बताइए, किस सामान का कितना स्टॉक है?",
    "kn-IN": () => "ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇನ್ನೂ ಯಾವ ಸಾಮಾನೂ ದಾಖಲಾಗಿಲ್ಲ. ಯಾವ ಸಾಮಾನು ಎಷ್ಟು ಇದೆ ಎಂದು ಹೇಳಿ.",
    "en-IN": () => "No items are in stock yet. Tell me which item you have and how much.",
  },
  stock_unknown_item: {
    "hi-IN": (v) => `${v.item} स्टॉक में दर्ज नहीं है।`,
    "kn-IN": (v) => `${v.item} ಸ್ಟಾಕ್‌ನಲ್ಲಿ ದಾಖಲಾಗಿಲ್ಲ.`,
    "en-IN": (v) => `${v.item} is not in the stock list.`,
  },
  stock_counted: {
    "hi-IN": (v) => `ठीक है, ${v.item} का स्टॉक ${v.left} लिख लिया।`,
    "kn-IN": (v) => `ಸರಿ, ${v.item} ಸ್ಟಾಕ್ ${v.left} ಎಂದು ಬರೆದುಕೊಂಡೆ.`,
    "en-IN": (v) => `Noted: ${v.left} of ${v.item} in stock.`,
  },
  stock_not_heard: {
    "hi-IN": () => "मैं सामान या मात्रा ठीक से नहीं सुन पाई। कृपया सामान और मात्रा फिर से बताइए।",
    "kn-IN": () => "ಸಾಮಾನು ಅಥವಾ ಪ್ರಮಾಣ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": () => "I did not catch the item or the amount. Please say them again.",
  },
  delivered: {
    "hi-IN": (v) => `ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""} का माल आ गया, ${v.added} ${v.item} स्टॉक में जुड़ गया। अब ${v.left} है।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""} ಸರಕು ಬಂದಿದೆ, ${v.added} ${v.item} ಸ್ಟಾಕ್‌ಗೆ ಸೇರಿದೆ. ಈಗ ${v.left} ಇದೆ.`,
    "en-IN": (v) => `Order ${v.po}${v.sim ? SIM["en-IN"] : ""} has arrived: ${v.added} of ${v.item} added to stock, ${v.left} now.`,
  },
  delivered_already: {
    "hi-IN": (v) => `ऑर्डर ${v.po} का माल पहले ही स्टॉक में जुड़ चुका है।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po} ಸರಕು ಈಗಾಗಲೇ ಸ್ಟಾಕ್‌ಗೆ ಸೇರಿದೆ.`,
    "en-IN": (v) => `Order ${v.po} is already in stock.`,
  },
  no_open_order: {
    "hi-IN": () => "कोई ऐसा ऑर्डर नहीं है जिसका माल आना बाकी हो।",
    "kn-IN": () => "ಸರಕು ಬರಬೇಕಾದ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ಇಲ್ಲ.",
    "en-IN": () => "There is no order still waiting for delivery.",
  },
  order_not_deliverable: {
    "hi-IN": () => "यह ऑर्डर रद्द या बंद है, इसका माल स्टॉक में नहीं जोड़ सकती।",
    "kn-IN": () => "ಈ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ ಅಥವಾ ಮುಚ್ಚಿದೆ, ಇದರ ಸರಕನ್ನು ಸ್ಟಾಕ್‌ಗೆ ಸೇರಿಸಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": () => "This order is cancelled or closed, so it cannot be added to stock.",
  },
  ambiguous_item: {
    "hi-IN": (v) => `कौन सा सामान: ${v.choices}?`,
    "kn-IN": (v) => `ಯಾವ ಸಾಮಾನು: ${v.choices}?`,
    "en-IN": (v) => `Which item: ${v.choices}?`,
  },
  ambiguous_order: {
    "hi-IN": (v) => `कौन सा ऑर्डर: ${v.choices}?`,
    "kn-IN": (v) => `ಯಾವ ಆರ್ಡರ್: ${v.choices}?`,
    "en-IN": (v) => `Which order: ${v.choices}?`,
  },
  unit_mismatch: {
    "hi-IN": (v) => `${v.item} का स्टॉक ${v.unit} में गिना जाता है, कृपया उसी में बताइए।`,
    "kn-IN": (v) => `${v.item} ಸ್ಟಾಕ್ ${v.unit} ನಲ್ಲಿ ಎಣಿಸಲಾಗುತ್ತದೆ, ದಯವಿಟ್ಟು ಅದರಲ್ಲೇ ಹೇಳಿ.`,
    "en-IN": (v) => `${v.item} is counted in ${v.unit}; please say it in that unit.`,
  },
  unit_needed: {
    "hi-IN": (v) => `${v.item} किस इकाई में, किलो, पीस या बोरी?`,
    "kn-IN": (v) => `${v.item} ಯಾವ ಘಟಕದಲ್ಲಿ, ಕೆಜಿ, ಪೀಸ್ ಅಥವಾ ಚೀಲ?`,
    "en-IN": (v) => `${v.item} in which unit: kilograms, pieces or bags?`,
  },
  unit_unknown: {
    "hi-IN": (v) => `मैं इकाई "${v.unit}" नहीं समझ पाई। किलो, लीटर, पीस या बोरी में बताइए।`,
    "kn-IN": (v) => `"${v.unit}" ಘಟಕ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಕೆಜಿ, ಲೀಟರ್, ಪೀಸ್ ಅಥವಾ ಚೀಲದಲ್ಲಿ ಹೇಳಿ.`,
    "en-IN": (v) => `I did not understand the unit "${v.unit}". Please say kilograms, litres, pieces or bags.`,
  },
  level_tap: {
    "hi-IN": () => "स्क्रीन पर नियम वाले कार्ड में सही का निशान दबाइए।",
    "kn-IN": () => "ಪರದೆಯ ಮೇಲಿನ ನಿಯಮದ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಸರಿ ಗುರುತನ್ನು ಒತ್ತಿ.",
    "en-IN": () => "Please tap the tick on the rule card on the screen.",
  },
  level_question: {
    "hi-IN": () => "क्या यह नियम रखूँ?",
    "kn-IN": () => "ಈ ನಿಯಮ ಇಟ್ಟುಕೊಳ್ಳಲೇ?",
    "en-IN": () => "Shall I keep this rule?",
  },
};

/** One line in `language`. A hi/kn line with stray Latin or the other Indic script is logged (rule 5). */
function line(key, language, vars = {}, { allow = [] } = {}) {
  const lang = langKey(language);
  const text = LINES[key][lang](vars);
  const problems = scriptProblems(text, lang, { allow });
  if (problems.latin.length || problems.foreign) {
    console.warn(`[stock] ${key} (${lang}) is not all in its own script: ${[...problems.latin, problems.foreign ? "<other Indic script>" : null].filter(Boolean).join(", ")}`);
  }
  return text;
}

/**
 * How much of one item is left, as get_stock and the Stock card's read-aloud say it:
 * `{ stock: {...on_hand, level, low, counted}, say }`. Figures from the ledger only.
 */
function stockOne(businessId, item, language) {
  const stock = require("./index");
  const s = stock.withStock(businessId, item);
  const counted = stock.listMoves(businessId, { itemId: item.id, limit: 1 }).length > 0;
  return {
    stock: { ...s, counted },
    say: line(
      "stock_one",
      language,
      {
        item: itemWord(item, language),
        counted,
        left: qty(s.on_hand, item.unit, language),
        low: counted && s.low,
        level: s.level != null ? qty(s.level, item.unit, language) : null,
      },
      { allow: [item.name, item.name_native] },
    ),
  };
}

module.exports = { line, itemWord, qty, num, stockOne, LINES, SIM };
