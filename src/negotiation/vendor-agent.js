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

/**
 * Murf voice for the simulated vendor: a male voice distinct from the agent's.
 * Verified live 2026-11-19 with GET https://api.murf.ai/v1/speech/voices?model=FALCON:
 * hi-IN-chirag, Male, locale hi-IN, supported locales include kn-IN and en-IN.
 */
const VENDOR_VOICE_ID = "hi-IN-chirag";

const DEFAULT_MAX_ROUNDS = 5;

/** The vendor's private pricing for one negotiation. */
function vendorPolicy(basisPrice) {
  return strategy.createVendorSim({ basisPrice });
}

/** The vendor's ask in each round, 1..maxRounds. */
function askSchedule(policy, maxRounds = DEFAULT_MAX_ROUNDS) {
  return Array.from({ length: maxRounds }, (_, i) => strategy.vendorSimAsk(policy, i + 1));
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
  return [
    "You are a SIMULATED vendor in a demo of a procurement assistant. You are not a real business. If anyone asks, say you are a simulated vendor.",
    `You sell ${item}. The buyer, an automated assistant called Sahay, wants ${quantity} ${unit}.`,
    `Speak only ${script}, one or two short sentences per turn, no lists. Say the unit as "${unitSpoken}".`,
    `Your asking price, per ${unit}, by round of the negotiation: ${asks}. Start with the round 1 price. Each time the buyer counters below your current ask, move to the next price in the list and say it.`,
    `Your absolute minimum is ${money(floor)} rupees per ${unit}. Never go below it. If the buyer offers your current ask or more, accept that offer and repeat the agreed price per ${unit} in one sentence.`,
    "When you reach the last price in the list, say it is your final price.",
    "Never mention any other number. If asked about freight, delivery time, minimum order or payment terms, say you will confirm those later.",
  ].join("\n");
}

/* ---------- lines for the server-driven fallback loop (no model involved) ---------- */

const VENDOR_LINES = {
  ask: {
    "hi-IN": (v) => `${v.price} रुपये प्रति ${v.unit} लगेगा।`,
    "kn-IN": (v) => `ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ಆಗುತ್ತದೆ.`,
    "en-IN": (v) => `It will be ${v.price} rupees per ${v.unit}.`,
  },
  final: {
    "hi-IN": (v) => `${v.price} रुपये प्रति ${v.unit}, इससे कम नहीं होगा, यह आख़िरी भाव है।`,
    "kn-IN": (v) => `ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಆಗುವುದಿಲ್ಲ, ಇದೇ ಕೊನೆಯ ಬೆಲೆ.`,
    "en-IN": (v) => `${v.price} rupees per ${v.unit} is my final price; I cannot go lower.`,
  },
  accept: {
    "hi-IN": (v) => `ठीक है, ${v.price} रुपये प्रति ${v.unit} में दे देंगे।`,
    "kn-IN": (v) => `ಸರಿ, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಕೊಡುತ್ತೇವೆ.`,
    "en-IN": (v) => `All right, I will supply at ${v.price} rupees per ${v.unit}.`,
  },
};

/**
 * One simulated vendor turn in the fallback loop.
 * @returns {{action: 'accept'|'counter', price: number, final: boolean, text: string}}
 */
function vendorTurn({ policy, round, buyerOffer, language, unitSpoken }) {
  const move = strategy.vendorSimMove({ policy, round, buyerOffer });
  const final = move.action === "counter" && move.price <= policy.floor;
  const key = move.action === "accept" ? "accept" : final ? "final" : "ask";
  const lines = VENDOR_LINES[key];
  return { action: move.action, price: move.price, final, text: (lines[language] ?? lines["hi-IN"])({ price: money(move.price), unit: unitSpoken }) };
}

module.exports = { VENDOR_VOICE_ID, DEFAULT_MAX_ROUNDS, vendorPolicy, askSchedule, vendorPrompt, introText, vendorTurn };
