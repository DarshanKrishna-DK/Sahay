"use strict";

/**
 * The SIMULATED vendor: a second Agora agent with its own voice that plays a
 * vendor whose prices follow strategy.createVendorSim, based on the real listed
 * price of the shortlisted vendor. It introduces itself as a simulated vendor
 * in its first sentence, and every turn and quote it produces is stored with
 * simulated: true (repo derives it from the negotiation's counterpart).
 *
 * Numbers: the ask for every round and the private floor are computed here in
 * code and written into the prompt; the model only words them. It never gives
 * freight or delivery figures, because the simulation has none.
 */

const strategy = require("./strategy");
const variety = require("../agora/variety");

/**
 * Murf voice for the simulated vendor: a male voice distinct from the agent's.
 * Verified live 2026-11-19 with GET https://api.murf.ai/v1/speech/voices?model=FALCON:
 * hi-IN-chirag, Male, locale hi-IN, supported locales include kn-IN and en-IN.
 */
const VENDOR_VOICE_ID = "hi-IN-chirag";

const DEFAULT_MAX_ROUNDS = strategy.DEFAULT_MAX_ROUNDS;

/** The vendor's private pricing for one negotiation of `maxRounds` rounds. */
function vendorPolicy(basisPrice, maxRounds = DEFAULT_MAX_ROUNDS) {
  return strategy.createVendorSim({ basisPrice, maxRounds });
}

/** The vendor's ask in each scheduled round, 1..policy.maxRounds; the last one is the floor. */
function askSchedule(policy) {
  return strategy.vendorSimSchedule(policy);
}

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));

const INTRO = {
  "hi-IN": "नमस्ते, मैं एक सिम्युलेटेड विक्रेता हूँ, यह डेमो है, असली दुकान नहीं।",
  "kn-IN": "ನಮಸ್ಕಾರ, ನಾನು ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್, ಇದು ಡೆಮೊ, ನಿಜವಾದ ಅಂಗಡಿ ಅಲ್ಲ.",
  "en-IN": "Hello, I am a simulated vendor for this demo, not a real shop.",
};

function introText(language) {
  return INTRO[language] ?? INTRO["hi-IN"];
}

/** System prompt for the simulated vendor agent. */
function vendorPrompt({ language, item, quantity, unit, unitSpoken, schedule, floor }) {
  const script = language === "kn-IN" ? "Kannada script" : language === "en-IN" ? "English" : "Hindi in Devanagari script";
  const asks = schedule.map((price, i) => `round ${i + 1}: ${money(price)} rupees per ${unit}`).join("; ");
  const last = schedule.length;
  return [
    "You are a SIMULATED vendor in a demo of a procurement assistant. You are not a real business. If anyone asks, say you are a simulated vendor.",
    `You sell ${item}. The buyer, an automated assistant called Sahay, wants ${quantity} ${unit}.`,
    `Speak only ${script}, one or two short sentences per turn, no lists. Say the unit as "${unitSpoken}".`,
    "Talk like a friendly, experienced wholesale trader in an Indian market bargaining with a regular buyer: warm, a little dramatic about prices, never rude. Use everyday trader talk in your language (Hindi: भाई साहब, माल एकदम बढ़िया है, मंडी में भाव चढ़े हुए हैं, इससे नीचे घाटा है; Kannada: ಸಾರ್, ಮಾಲು ಚೆನ್ನಾಗಿದೆ, ಮಾರ್ಕೆಟ್‌ನಲ್ಲಿ ರೇಟ್ ಜಾಸ್ತಿ ಇದೆ; English: the quality is really good, market rates are up). Vary how you say it every turn.",
    `Your asking price, per ${unit}, by round of the negotiation: ${asks}. Start with the round 1 price. Each time the buyer counters below your current ask, move to the next price in the list (exactly one step) and say it. Say each price as the whole number of rupees in the list.`,
    `Your absolute minimum is ${money(floor)} rupees per ${unit}. Never go below it. If the buyer offers at least the next price in the list (or your current ask), accept the buyer's offer and repeat that agreed price per ${unit} in one sentence.`,
    `Only the round ${last} price (${money(schedule[last - 1])} rupees) is your final price; say "final" or "last price" only then. Never call any earlier price final, last, or your best.`,
    "Never mention any other number. If asked about freight, delivery time, minimum order or payment terms, say you will confirm those later.",
  ].join("\n");
}

/* ---------- lines for the server-driven loop, the default mode (no model involved) ---------- */

/**
 * A kirana wholesaler's bargaining lines (Track POLISH): several phrasings of each move, walked
 * in turn per negotiation (src/agora/variety.js). Every variant carries only the price and unit it
 * is given; only "final" variants call a price final or last (the loop and the quote rely on it).
 * The vendor's voice is male (hi-IN-chirag), so Hindi first-person forms are masculine.
 */
const VENDOR_LINES = {
  // round 1: the opening ask
  open: {
    "hi-IN": [
      (v) => `नमस्ते जी! ${v.price} रुपये प्रति ${v.unit} लगेगा, माल एकदम बढ़िया है।`,
      (v) => `जी, आजकल ${v.price} रुपये प्रति ${v.unit} चल रहा है, क्वालिटी पक्की है।`,
      (v) => `देखिए, ${v.price} रुपये प्रति ${v.unit} का भाव है, माल बिल्कुल साफ़-सुथरा है।`,
    ],
    "kn-IN": [
      (v) => `ನಮಸ್ಕಾರ ಸಾರ್! ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ಆಗುತ್ತೆ, ಮಾಲು ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ.`,
      (v) => `ಹೌದು ಸಾರ್, ಈಗ ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ನಡೀತಿದೆ.`,
    ],
    "en-IN": [
      (v) => `Namaste! It's ${v.price} rupees per ${v.unit}, and the quality is really good.`,
      (v) => `Sure, the rate these days is ${v.price} rupees per ${v.unit}.`,
    ],
  },
  // a later round: the next step down after the buyer's counter (never called final)
  ask: {
    "hi-IN": [
      (v) => `अरे भाई साहब, इतने में नहीं हो पाएगा; चलिए ${v.price} रुपये प्रति ${v.unit} कर देता हूँ।`,
      (v) => `हम्म, मंडी में भाव चढ़े हुए हैं जी; ${v.price} रुपये प्रति ${v.unit} लगा दूँगा।`,
      (v) => `इतना कम? घाटा हो जाएगा जी; ${v.price} रुपये प्रति ${v.unit} ठीक रहेगा।`,
      (v) => `आपके लिए थोड़ा कम कर देता हूँ, ${v.price} रुपये प्रति ${v.unit}।`,
    ],
    "kn-IN": [
      (v) => `ಅಯ್ಯೋ ಸಾರ್, ಅಷ್ಟಕ್ಕೆ ಆಗಲ್ಲ; ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ಮಾಡ್ತೀನಿ.`,
      (v) => `ಹೂಂ, ಮಾರ್ಕೆಟ್‌ನಲ್ಲಿ ರೇಟ್ ಜಾಸ್ತಿ ಇದೆ ಸಾರ್; ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ಕೊಡಿ.`,
      (v) => `ನಿಮಗೋಸ್ಕರ ಸ್ವಲ್ಪ ಕಡಿಮೆ ಮಾಡ್ತೀನಿ, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ.`,
    ],
    "en-IN": [
      (v) => `Oh sir, that's too low for me; okay, I can do ${v.price} rupees per ${v.unit}.`,
      (v) => `Hmm, market rates are up this week; ${v.price} rupees per ${v.unit}.`,
      (v) => `For you I'll come down a little: ${v.price} rupees per ${v.unit}.`,
    ],
  },
  final: {
    "hi-IN": [
      (v) => `बस भाई साहब, ${v.price} रुपये प्रति ${v.unit}, यह आख़िरी भाव है, इससे नीचे नहीं जा पाऊँगा।`,
      (v) => `देखिए, ${v.price} रुपये प्रति ${v.unit} मेरा आख़िरी भाव है, इससे कम में घाटा है।`,
      (v) => `${v.price} रुपये प्रति ${v.unit}, यही आख़िरी भाव है जी, अब और नहीं होगा।`,
    ],
    "kn-IN": [
      (v) => `ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ, ಇದೇ ಕೊನೆಯ ಬೆಲೆ ಸಾರ್, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಆಗಲ್ಲ.`,
      (v) => `ನೋಡಿ ಸಾರ್, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ನನ್ನ ಕೊನೆಯ ಬೆಲೆ, ಇನ್ನೂ ಕಡಿಮೆ ಮಾಡಿದ್ರೆ ನಷ್ಟ.`,
    ],
    "en-IN": [
      (v) => `${v.price} rupees per ${v.unit} is my final price, sir; any lower and I lose money.`,
      (v) => `Look, ${v.price} rupees per ${v.unit}, final price. I really cannot go lower.`,
    ],
  },
  accept: {
    "hi-IN": [
      (v) => `ठीक है, ${v.price} रुपये प्रति ${v.unit} में दे देंगे।`,
      (v) => `चलिए, आपकी बात रख लेते हैं, ${v.price} रुपये प्रति ${v.unit} में दे देंगे।`,
      (v) => `अच्छा ठीक है जी, ${v.price} रुपये प्रति ${v.unit} में दे दूँगा।`,
    ],
    "kn-IN": [
      (v) => `ಸರಿ, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಕೊಡುತ್ತೇವೆ.`,
      (v) => `ಆಯ್ತು ಸಾರ್, ನಿಮ್ಮ ಮಾತು; ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಕೊಡ್ತೀನಿ.`,
    ],
    "en-IN": [
      (v) => `All right, I will supply at ${v.price} rupees per ${v.unit}.`,
      (v) => `Okay, done: ${v.price} rupees per ${v.unit} it is.`,
    ],
  },
};

/**
 * One simulated vendor turn in the server-driven loop. Only the last scheduled ask is final.
 * `scope` (the negotiation id) keeps the wording varied across the rounds of one negotiation.
 * @returns {{action: 'accept'|'counter', price: number, final: boolean, text: string}}
 */
function vendorTurn({ policy, round, buyerOffer, language, unitSpoken, scope = "" }) {
  const move = strategy.vendorSimMove({ policy, round, buyerOffer });
  const final = move.action === "counter" && round >= policy.maxRounds;
  const key = move.action === "accept" ? "accept" : final ? "final" : round <= 1 ? "open" : "ask";
  const lines = VENDOR_LINES[key];
  const text = variety.pick(lines[language] ?? lines["hi-IN"], { scope, key: `vendor.${key}`, vars: { price: money(move.price), unit: unitSpoken } });
  return { action: move.action, price: move.price, final, text };
}

module.exports = { VENDOR_VOICE_ID, DEFAULT_MAX_ROUNDS, VENDOR_LINES, vendorPolicy, askSchedule, vendorPrompt, introText, vendorTurn };
