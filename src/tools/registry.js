"use strict";

/**
 * The agent tools: one registry, used by the MCP server (owner and negotiation
 * agents) and by any server-side caller.
 *
 * `ctx = { businessId, sessionId, agentId, actor, toolScope }` is built ONLY from a
 * verified bearer (src/mcp-server.js) - never from tool arguments. Every result
 * the agent speaks carries `say`: one short sentence in its own script, built here
 * from stored data, in the language the owner just used (`reply_language`, else
 * the business language). Errors are ToolErrors with `say`.
 *
 * Voice models relay opaque ids badly, so ids are optional: a missing id means
 * "the current one" (latest requirement, best comparable vendor, best deal, the one
 * approval waiting, the most recent confirmed order). A default is never a guess between several
 * candidates: then the tool refuses with AMBIGUOUS and names the choices.
 *
 * Irreversible steps go through the business modules' own gates:
 * create_order -> orders.createOrder (approvals.assertApproved inside),
 * create_payment_link -> payments.createPaymentLink (assertOrderApproved inside).
 */

const repo = require("../db/repo");
const { vendorText } = require("../db/vendor-text");
const events = require("../events");
const jobs = require("../jobs");
const approvals = require("../approvals");
const orders = require("../orders");
const { findByPo } = require("../orders/po-ref");
const payments = require("../orders/payments");
const { findVendors } = require("../discovery/indiamart");
const { candidateSlugs, cityName, cityIn, itemIn } = require("../discovery/slug");
const { isNativeScript } = require("../agora/script");
const evidence = require("./evidence");
const toolCalls = require("./calls");
const outcome = require("../agora/outcome");
/** One /history read inside a tool is bounded, so the tool answers within the MCP timeout_ms. */
const { TOOL_HISTORY_TIMEOUT_MS } = require("../agora/agent");
const { scoreVendor, rankDeals, comparableListedPrice } = require("../procurement/scoring");
const { canonicalUnit, sameUnit, unitWord, UNIT_CODES } = require("../procurement/units");
const { ToolError, toToolError, sayFor, langKey, LANGS } = require("./errors");
const agentRules = require("../agent/rules");
const agentProfile = require("../agent/profile");
const agentMemories = require("../agent/memories");
const policy = require("../agent/policy");

/** Which agent may call a tool. The bearer's sessions row kind decides the scope. */
const SCOPES = Object.freeze({ owner: "owner", negotiation: "negotiation" });

const SHORTLIST_SIZE = 5;
const DISCOVERY_LIMIT = 10;
const HISTORY_ATTEMPTS = 3;
const HISTORY_RETRY_MS = 600;
/** Voice evidence that may simply not be in /history yet: looked for again. */
const VOICE_RETRY = new Set(["NO_ANSWER_YET", "READBACK_NOT_HEARD"]);
/** get_order_status without an id speaks the latest and lists at most this many recent orders. */
const RECENT_ORDERS = 10;
/** A confirm tool's refusals that mean "nothing is waiting for an answer" (see callTool). */
const NOTHING_WAITING = new Set(["NO_PENDING_INVOICE", "NO_PENDING_PAYMENT", "NO_PENDING_APPROVAL", "ALREADY_DECIDED", "NO_SPOKEN_RULE", "NO_PROPOSAL", "PROPOSAL_DECIDED"]);
/** A purchase need saved this soon after draft_invoice started belongs to that sale turn and is refused. */
const SALE_TURN_MS = 6000;

/* -------------------------------------------------------------- speech --- */

const round2 = (n) => Math.round(n * 100) / 100;
/** Plain digits, as approvals.js does, so the speech engine reads them as numbers. */
const money = (n) => String(round2(n));

const SIM_LABEL = { "hi-IN": "सिम्युलेटेड विक्रेता", "kn-IN": "ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್", "en-IN": "simulated vendor" };

const ORDER_STATUS_WORDS = {
  confirmed: { "hi-IN": "पक्का", "kn-IN": "ಖಚಿತ", "en-IN": "confirmed" },
  paid: { "hi-IN": "भुगतान हो गया", "kn-IN": "ಪಾವತಿ ಆಗಿದೆ", "en-IN": "paid" },
  in_transit: { "hi-IN": "रास्ते में", "kn-IN": "ದಾರಿಯಲ್ಲಿದೆ", "en-IN": "in transit" },
  delivered: { "hi-IN": "पहुँच गया", "kn-IN": "ತಲುಪಿದೆ", "en-IN": "delivered" },
  closed: { "hi-IN": "बंद", "kn-IN": "ಮುಗಿದಿದೆ", "en-IN": "closed" },
  cancelled: { "hi-IN": "रद्द", "kn-IN": "ರದ್ದು", "en-IN": "cancelled" },
};

/** The payment clause of an order status sentence. */
const PAYMENT_WORDS = {
  paid: { "hi-IN": "भुगतान हो गया है", "kn-IN": "ಪಾವತಿ ಆಗಿದೆ", "en-IN": "it is paid" },
  pending_link: { "hi-IN": "भुगतान बाकी है, भुगतान लिंक बन चुका है", "kn-IN": "ಪಾವತಿ ಬಾಕಿ ಇದೆ, ಪಾವತಿ ಲಿಂಕ್ ಸಿದ್ಧವಿದೆ", "en-IN": "payment is pending and the payment link is ready" },
  pending_no_link: { "hi-IN": "भुगतान बाकी है, लिंक अभी नहीं बना", "kn-IN": "ಪಾವತಿ ಬಾಕಿ ಇದೆ, ಲಿಂಕ್ ಇನ್ನೂ ಮಾಡಿಲ್ಲ", "en-IN": "payment is pending and no payment link has been made yet" },
};

const MISSING_WORDS = {
  item: { "hi-IN": "क्या सामान चाहिए", "kn-IN": "ಯಾವ ವಸ್ತು ಬೇಕು", "en-IN": "which item" },
  quantity: { "hi-IN": "कितनी मात्रा", "kn-IN": "ಎಷ್ಟು ಪ್ರಮಾಣ", "en-IN": "how much" },
  unit: { "hi-IN": "किस इकाई में", "kn-IN": "ಯಾವ ಘಟಕದಲ್ಲಿ", "en-IN": "in which unit" },
  city: { "hi-IN": "किस शहर में डिलीवरी", "kn-IN": "ಯಾವ ನಗರಕ್ಕೆ ಡೆಲಿವರಿ", "en-IN": "delivery to which city" },
};

/**
 * A Kannada place name with the dative ending: ಬೆಂಗಳೂರು -> ಬೆಂಗಳೂರಿಗೆ, ಹೈದರಾಬಾದ್ -> ಹೈದರಾಬಾದಿಗೆ,
 * ದೆಹಲಿ -> ದೆಹಲಿಗೆ (E2E r4 heard "ಬೆಂಗಳೂರುಗೆ" and "ಬೆಂಗಳೂರಿನಿಗೆ").
 */
function knDative(place) {
  const word = String(place);
  return /[ುೂ್]$/u.test(word) ? `${word.slice(0, -1)}ಿಗೆ` : `${word}ಗೆ`;
}

/** Phrase book. Each entry: (vars) => sentence, per language. */
const PHRASES = {
  profile: {
    "hi-IN": (v) => `यह ${v.name} का खाता है${v.city ? `, शहर ${v.city}` : ""}।`,
    "kn-IN": (v) => `ಇದು ${v.name} ಅವರ ಖಾತೆ${v.city ? `, ನಗರ ${v.city}` : ""}.`,
    "en-IN": (v) => `This is the account of ${v.name}${v.city ? ` in ${v.city}` : ""}.`,
  },
  requirement_saved: {
    "hi-IN": (v) => `ठीक है, ${v.quantity} ${v.unit} ${v.item} लिख लिया${v.city ? `, ${v.city} के लिए` : ""}।`,
    "kn-IN": (v) => `ಸರಿ, ${v.quantity} ${v.unit} ${v.item} ಬರೆದುಕೊಂಡೆ${v.city ? `, ${knDative(v.city)}` : ""}.`,
    "en-IN": (v) => `Noted: ${v.quantity} ${v.unit} of ${v.item}${v.city ? ` for ${v.city}` : ""}.`,
  },
  requirement_saved_searching: {
    "hi-IN": (v) => `ठीक है, ${v.quantity} ${v.unit} ${v.item}${v.city ? `, ${v.city} के लिए` : ""}; इंडियामार्ट पर विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगी।`,
    "kn-IN": (v) => `ಸರಿ, ${v.quantity} ${v.unit} ${v.item}${v.city ? `, ${knDative(v.city)}` : ""}; ಇಂಡಿಯಾಮಾರ್ಟ್‌ನಲ್ಲಿ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಶುರು ಮಾಡಿದ್ದೇನೆ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.`,
    "en-IN": (v) => `Noted: ${v.quantity} ${v.unit} of ${v.item}${v.city ? ` for ${v.city}` : ""}. I have started looking for vendors on IndiaMART and will tell you as soon as I find them.`,
  },
  requirement_not_heard: {
    "hi-IN": (v) => `माफ़ कीजिए, पूरी बात सुनाई नहीं दी; बताइए, ${v.missing}?`,
    "kn-IN": (v) => `ಕ್ಷಮಿಸಿ, ಪೂರ್ತಿ ಕೇಳಿಸಲಿಲ್ಲ; ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ, ${v.missing}?`,
    "en-IN": (v) => `Sorry, I did not catch all of that; please tell me again ${v.missing}.`,
  },
  requirement_missing: {
    "hi-IN": (v) => `${v.item ? `${v.item} लिख लिया; ` : ""}बताइए, ${v.missing}?`,
    "kn-IN": (v) => `${v.item ? `${v.item} ಬರೆದುಕೊಂಡೆ; ` : ""}ದಯವಿಟ್ಟು ಹೇಳಿ, ${v.missing}?`,
    "en-IN": (v) => `${v.item ? `Noted ${v.item}; ` : ""}please tell me ${v.missing}.`,
  },
  sourcing_started: {
    "hi-IN": (v) => `इंडियामार्ट पर ${v.item} के विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगी।`,
    "kn-IN": (v) => `ಇಂಡಿಯಾಮಾರ್ಟ್‌ನಲ್ಲಿ ${v.item} ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಶುರು ಮಾಡಿದ್ದೇನೆ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.`,
    "en-IN": (v) => `I have started looking for ${v.item} vendors on IndiaMART and will tell you as soon as I find them.`,
  },
  sourcing_already: {
    "hi-IN": () => "इस ज़रूरत की खोज पहले से चल रही है।",
    "kn-IN": () => "ಈ ಅಗತ್ಯದ ಹುಡುಕಾಟ ಈಗಾಗಲೇ ನಡೆಯುತ್ತಿದೆ.",
    "en-IN": () => "The search for this requirement is already running.",
  },
  job_queued: {
    "hi-IN": () => "काम शुरू होने वाला है।",
    "kn-IN": () => "ಕೆಲಸ ಶುರುವಾಗಲಿದೆ.",
    "en-IN": () => "The work is about to start.",
  },
  job_running_sourcing: {
    "hi-IN": (v) => `खोज चल रही है, अभी तक ${v.count} विक्रेता मिले हैं।`,
    "kn-IN": (v) => `ಹುಡುಕಾಟ ನಡೆಯುತ್ತಿದೆ, ಇಲ್ಲಿಯವರೆಗೆ ${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ.`,
    "en-IN": (v) => `The search is running; ${v.count} vendors found so far.`,
  },
  sourcing_running_none: {
    "hi-IN": () => "विक्रेताओं की खोज अभी चल रही है, मिलते ही बताऊँगी।",
    "kn-IN": () => "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಇನ್ನೂ ನಡೆಯುತ್ತಿದೆ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.",
    "en-IN": () => "The vendor search is still running; I will tell you as soon as I find vendors.",
  },
  job_running_negotiation: {
    "hi-IN": () => "मोल-भाव अभी चल रहा है।",
    "kn-IN": () => "ಚೌಕಾಸಿ ಇನ್ನೂ ನಡೆಯುತ್ತಿದೆ.",
    "en-IN": () => "The negotiation is still going on.",
  },
  job_done_sourcing: {
    "hi-IN": (v) => `खोज पूरी हुई, ${v.count} विक्रेता मिले${v.national ? ", पूरे भारत से" : ""}।`,
    "kn-IN": (v) => `ಹುಡುಕಾಟ ಮುಗಿಯಿತು, ${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ${v.national ? ", ಭಾರತದಾದ್ಯಂತದಿಂದ" : ""}.`,
    "en-IN": (v) => `The search is done: ${v.count} vendors found${v.national ? ", from all over India" : ""}.`,
  },
  job_done_negotiation: {
    "hi-IN": () => "मोल-भाव पूरा हो गया।",
    "kn-IN": () => "ಚೌಕಾಸಿ ಮುಗಿಯಿತು.",
    "en-IN": () => "The negotiation is finished.",
  },
  job_done_negotiation_agreed: {
    "hi-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["hi-IN"]})` : ""} से मोल-भाव पूरा, ${v.price} रुपये प्रति ${v.unit} पर बात बनी।`,
    "kn-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["kn-IN"]})` : ""} ಜೊತೆ ಚೌಕಾಸಿ ಮುಗಿಯಿತು, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಒಪ್ಪಿಗೆಯಾಯಿತು.`,
    "en-IN": (v) => `The negotiation with ${v.vendor}${v.sim ? ` (${SIM_LABEL["en-IN"]})` : ""} is done at ${v.price} rupees per ${v.unit}.`,
  },
  job_done_negotiation_no_deal: {
    "hi-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["hi-IN"]})` : ""} से मोल-भाव ख़त्म हुआ, सौदा नहीं बना।`,
    "kn-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["kn-IN"]})` : ""} ಜೊತೆ ಚೌಕಾಸಿ ಮುಗಿಯಿತು, ವ್ಯವಹಾರ ಆಗಲಿಲ್ಲ.`,
    "en-IN": (v) => `The negotiation with ${v.vendor}${v.sim ? ` (${SIM_LABEL["en-IN"]})` : ""} has ended without a deal.`,
  },
  job_failed: {
    "hi-IN": () => "यह काम पूरा नहीं हो पाया।",
    "kn-IN": () => "ಈ ಕೆಲಸ ಮುಗಿಸಲು ಆಗಲಿಲ್ಲ.",
    "en-IN": () => "That job could not be completed.",
  },
  job_cancelled: {
    "hi-IN": () => "यह काम रद्द कर दिया गया।",
    "kn-IN": () => "ಈ ಕೆಲಸ ರದ್ದಾಗಿದೆ.",
    "en-IN": () => "That job was cancelled.",
  },
  sourcing_not_started: {
    "hi-IN": () => "विक्रेताओं की खोज अभी शुरू नहीं हुई है; शुरू करूँ?",
    "kn-IN": () => "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಇನ್ನೂ ಶುರುವಾಗಿಲ್ಲ; ಶುರು ಮಾಡಲೇ?",
    "en-IN": () => "The vendor search has not started yet; shall I start it?",
  },
  sourcing_found_none: {
    "hi-IN": () => "खोज में कोई विक्रेता नहीं मिला।",
    "kn-IN": () => "ಹುಡುಕಾಟದಲ್ಲಿ ಯಾವ ಮಾರಾಟಗಾರರೂ ಸಿಕ್ಕಿಲ್ಲ.",
    "en-IN": () => "The search found no vendors.",
  },
  shortlist: {
    "hi-IN": (v) => `${v.count} विक्रेता मिले, ${v.comparable} के भाव प्रति ${v.unit} में हैं; सबसे अच्छे ${v.name}${v.city ? `, ${v.city}` : ""}, ${v.price} रुपये प्रति ${v.unit}।`,
    "kn-IN": (v) => `${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ, ${v.comparable} ಜನರ ಬೆಲೆ ಒಂದು ${v.unit}ಗೆ ಇದೆ; ಉತ್ತಮರು ${v.name}${v.city ? `, ${v.city}` : ""}, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ.`,
    "en-IN": (v) => `${v.count} vendors found, ${v.comparable} with a price per ${v.unit}; the best is ${v.name}${v.city ? ` in ${v.city}` : ""}, at ${v.price} rupees per ${v.unit}.`,
  },
  shortlist_no_comparable: {
    "hi-IN": (v) => `${v.count} विक्रेता मिले, पर किसी की लिस्टिंग में प्रति ${v.unit} भाव नहीं है; सबसे ऊपर ${v.name}।`,
    "kn-IN": (v) => `${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ, ಆದರೆ ಯಾರ ಪಟ್ಟಿಯಲ್ಲೂ ಒಂದು ${v.unit}ಗೆ ಬೆಲೆ ಇಲ್ಲ; ಮೊದಲನೆಯವರು ${v.name}.`,
    "en-IN": (v) => `${v.count} vendors found, but none lists a price per ${v.unit}; the top one is ${v.name}.`,
  },
  rank_out_of_range: {
    "hi-IN": (v) => `सूची में केवल ${v.count} विक्रेता हैं।`,
    "kn-IN": (v) => `ಪಟ್ಟಿಯಲ್ಲಿ ${v.count} ಮಾರಾಟಗಾರರು ಮಾತ್ರ ಇದ್ದಾರೆ.`,
    "en-IN": (v) => `There are only ${v.count} vendors on the list.`,
  },
  no_comparable_vendor: {
    "hi-IN": (v) => `किसी विक्रेता की लिस्टिंग में प्रति ${v.unit} भाव नहीं है, इसलिए सिम्युलेटेड विक्रेता नहीं बना सकती; किसी असली विक्रेता को लिंक से जोड़ूँ?`,
    "kn-IN": (v) => `ಯಾವ ಮಾರಾಟಗಾರರ ಪಟ್ಟಿಯಲ್ಲೂ ಒಂದು ${v.unit}ಗೆ ಬೆಲೆ ಇಲ್ಲ, ಹಾಗಾಗಿ ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್ ಮಾಡಲು ಆಗುವುದಿಲ್ಲ; ನಿಜವಾದ ಮಾರಾಟಗಾರರನ್ನು ಲಿಂಕ್ ಮೂಲಕ ಸೇರಿಸಲೇ?`,
    "en-IN": (v) => `No vendor lists a price per ${v.unit}, so I cannot base a simulated vendor on one; shall I invite a real vendor by link?`,
  },
  no_listed_price_try: {
    "hi-IN": (v) => `${v.vendor} की लिस्टिंग में प्रति ${v.unit} भाव नहीं है; नंबर ${v.rank}, ${v.alt}, का भाव है, उनसे मोल-भाव करूँ?`,
    "kn-IN": (v) => `${v.vendor} ಅವರ ಪಟ್ಟಿಯಲ್ಲಿ ಒಂದು ${v.unit}ಗೆ ಬೆಲೆ ಇಲ್ಲ; ಸಂಖ್ಯೆ ${v.rank}, ${v.alt}, ಅವರ ಬೆಲೆ ಇದೆ, ಅವರ ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡಲೇ?`,
    "en-IN": (v) => `${v.vendor}'s listing has no price per ${v.unit}; number ${v.rank}, ${v.alt}, does. Shall I negotiate with them?`,
  },
  unit_unknown: {
    "hi-IN": (v) => `"${v.unit}" इकाई मुझे समझ नहीं आई; किलो, क्विंटल, टन, लीटर, पीस, बोरी या डिब्बा, कौन सी?`,
    "kn-IN": (v) => `"${v.unit}" ಘಟಕ ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ; ಕೆಜಿ, ಕ್ವಿಂಟಾಲ್, ಟನ್, ಲೀಟರ್, ಪೀಸ್, ಚೀಲ ಅಥವಾ ಬಾಕ್ಸ್, ಯಾವುದು?`,
    "en-IN": (v) => `I did not understand the unit "${v.unit}"; is it kilograms, quintals, tonnes, litres, pieces, bags or boxes?`,
  },
  no_requirement: {
    "hi-IN": () => "पहले बताइए, क्या खरीदना है?",
    "kn-IN": () => "ಮೊದಲು ಹೇಳಿ, ಏನು ಖರೀದಿಸಬೇಕು?",
    "en-IN": () => "First tell me what you want to buy.",
  },
  no_jobs: {
    "hi-IN": () => "अभी तक कोई खोज या मोल-भाव शुरू नहीं हुआ है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಹುಡುಕಾಟ ಅಥವಾ ಚೌಕಾಸಿ ಶುರುವಾಗಿಲ್ಲ.",
    "en-IN": () => "No search or negotiation has been started yet.",
  },
  no_pending_approval: {
    "hi-IN": () => "अभी कोई मंज़ूरी बाकी नहीं है।",
    "kn-IN": () => "ಈಗ ಬಾಕಿ ಇರುವ ಒಪ್ಪಿಗೆ ಇಲ್ಲ.",
    "en-IN": () => "There is no approval waiting.",
  },
  choose: {
    "hi-IN": (v) => `${v.n} विकल्प हैं: ${v.list}; कौन सा?`,
    "kn-IN": (v) => `${v.n} ಆಯ್ಕೆಗಳಿವೆ: ${v.list}; ಯಾವುದು?`,
    "en-IN": (v) => `There are ${v.n} choices: ${v.list}. Which one?`,
  },
  choice_deal: {
    "hi-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["hi-IN"]})` : ""} ${v.total} रुपये`,
    "kn-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["kn-IN"]})` : ""} ${v.total} ರೂಪಾಯಿ`,
    "en-IN": (v) => `${v.vendor}${v.sim ? ` (${SIM_LABEL["en-IN"]})` : ""} at ${v.total} rupees`,
  },
  negotiation_started_simulated: {
    "hi-IN": (v) => `${v.vendor} की लिस्टिंग के भाव पर बने सिम्युलेटेड विक्रेता से मोल-भाव शुरू कर दिया है, नतीजा आते ही बताऊँगी।`,
    "kn-IN": (v) => `${v.vendor} ಅವರ ಪಟ್ಟಿಯ ಬೆಲೆಯ ಆಧಾರದ ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್ ಜೊತೆ ಚೌಕಾಸಿ ಶುರು ಮಾಡಿದ್ದೇನೆ, ಫಲಿತಾಂಶ ಬಂದ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.`,
    "en-IN": (v) => `I have started negotiating with a simulated vendor priced from ${v.vendor}'s listing and will report the result.`,
  },
  negotiation_started_human: {
    "hi-IN": () => "विक्रेता के जुड़ने का लिंक स्क्रीन पर है; उनके जुड़ते ही मोल-भाव शुरू होगा।",
    "kn-IN": () => "ಮಾರಾಟಗಾರರು ಸೇರುವ ಲಿಂಕ್ ಪರದೆಯ ಮೇಲಿದೆ; ಅವರು ಸೇರಿದ ತಕ್ಷಣ ಚೌಕಾಸಿ ಶುರುವಾಗುತ್ತದೆ.",
    "en-IN": () => "The vendor's join link is on the screen; the negotiation starts as soon as they join.",
  },
  negotiation_running_no_quote: {
    "hi-IN": () => "मोल-भाव अभी चल रहा है, नतीजा आते ही बताऊँगी।",
    "kn-IN": () => "ಚೌಕಾಸಿ ಇನ್ನೂ ನಡೆಯುತ್ತಿದೆ, ಫಲಿತಾಂಶ ಬಂದ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.",
    "en-IN": () => "The negotiation is still going on; I will tell you the result as soon as it is in.",
  },
  deals_empty: {
    "hi-IN": () => "अभी कोई कोटेशन नहीं आया है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಕೊಟೇಶನ್ ಬಂದಿಲ್ಲ.",
    "en-IN": () => "There are no quotes yet.",
  },
  deal_best: {
    "hi-IN": (v) => `सबसे अच्छा सौदा ${v.vendor}${v.sim ? ` (${SIM_LABEL["hi-IN"]})` : ""}: ${v.price} रुपये प्रति ${v.unit}, ${v.landed != null ? `कुल ${v.landed} रुपये` : `माल ${v.goods} रुपये, भाड़ा तय नहीं`}।`,
    "kn-IN": (v) => `ಉತ್ತಮ ವ್ಯವಹಾರ ${v.vendor}${v.sim ? ` (${SIM_LABEL["kn-IN"]})` : ""}: ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ, ${v.landed != null ? `ಒಟ್ಟು ${v.landed} ರೂಪಾಯಿ` : `ಸರಕು ${v.goods} ರೂಪಾಯಿ, ಸಾಗಣೆ ವೆಚ್ಚ ತಿಳಿದಿಲ್ಲ`}.`,
    "en-IN": (v) => `Best deal: ${v.vendor}${v.sim ? ` (${SIM_LABEL["en-IN"]})` : ""} at ${v.price} rupees per ${v.unit}, ${v.landed != null ? `${v.landed} rupees in total` : `${v.goods} rupees for the goods, freight not quoted`}.`,
  },
  deal_none_rankable: {
    "hi-IN": () => "कोटेशन आए हैं पर उनकी तुलना नहीं हो सकती, स्क्रीन पर कारण लिखे हैं।",
    "kn-IN": () => "ಕೊಟೇಶನ್‌ಗಳು ಬಂದಿವೆ, ಆದರೆ ಹೋಲಿಸಲು ಆಗುವುದಿಲ್ಲ; ಕಾರಣಗಳು ಪರದೆಯ ಮೇಲಿವೆ.",
    "en-IN": () => "There are quotes, but they cannot be compared; the reasons are on the screen.",
  },
  busy: {
    "hi-IN": () => sayFor("busy", "hi-IN"),
    "kn-IN": () => sayFor("busy", "kn-IN"),
    "en-IN": () => sayFor("busy", "en-IN"),
  },
  deal_offer_approval: {
    "hi-IN": () => "क्या इस डील को मंज़ूरी के लिए पढ़ूँ?",
    "kn-IN": () => "ಈ ವ್ಯವಹಾರವನ್ನು ಒಪ್ಪಿಗೆಗಾಗಿ ಓದಲೇ?",
    "en-IN": () => "Shall I read this deal out for your approval?",
  },
  approval_question: {
    "hi-IN": () => "क्या मैं ऑर्डर कर दूँ?",
    "kn-IN": () => "ಆರ್ಡರ್ ಮಾಡಲೇ?",
    "en-IN": () => "Shall I place the order?",
  },
  approval_recording: {
    "hi-IN": () => "ठीक है, दर्ज कर रही हूँ।",
    "kn-IN": () => "ಸರಿ, ದಾಖಲಿಸುತ್ತಿದ್ದೇನೆ.",
    "en-IN": () => "All right, recording that.",
  },
  readback_not_spoken: {
    "hi-IN": () => "मैं सौदे का ब्योरा पढ़कर नहीं सुना पाई; ब्योरा स्क्रीन पर है, वहीं मंज़ूरी का बटन दबाइए।",
    "kn-IN": () => "ವ್ಯವಹಾರದ ವಿವರ ಓದಿ ಹೇಳಲು ಆಗಲಿಲ್ಲ; ವಿವರ ಪರದೆಯ ಮೇಲಿದೆ, ಅಲ್ಲಿ ಒಪ್ಪಿಗೆ ಬಟನ್ ಒತ್ತಿ.",
    "en-IN": () => "I could not read the deal out to you; it is on the screen, please use the approve button there.",
  },
  approval_approved: {
    "hi-IN": () => "आपकी मंज़ूरी दर्ज हो गई।",
    "kn-IN": () => "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ದಾಖಲಾಯಿತು.",
    "en-IN": () => "Your approval is recorded.",
  },
  approval_rejected: {
    "hi-IN": () => "ठीक है, यह सौदा मंज़ूर नहीं किया।",
    "kn-IN": () => "ಸರಿ, ಈ ವ್ಯವಹಾರಕ್ಕೆ ಒಪ್ಪಿಗೆ ಕೊಟ್ಟಿಲ್ಲ.",
    "en-IN": () => "All right, this deal is not approved.",
  },
  order_created: {
    "hi-IN": (v) => `ऑर्डर बन गया${v.sim ? ` (${SIM_LABEL["hi-IN"]})` : ""}, खरीद आदेश नंबर ${v.po}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ಆಗಿದೆ${v.sim ? ` (${SIM_LABEL["kn-IN"]})` : ""}, ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ ${v.po}.`,
    "en-IN": (v) => `The order is placed${v.sim ? ` with a ${SIM_LABEL["en-IN"]}` : ""}, purchase order number ${v.po}.`,
  },
  payment_link: {
    "hi-IN": (v) => `ऑर्डर ${v.po} के भुगतान का टेस्ट लिंक बन गया है, स्क्रीन पर दिख रहा है।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po} ಪಾವತಿಯ ಟೆಸ್ಟ್ ಲಿಂಕ್ ಸಿದ್ಧವಾಗಿದೆ, ಪರದೆಯ ಮೇಲೆ ಕಾಣುತ್ತಿದೆ.`,
    "en-IN": (v) => `The test-mode payment link for order ${v.po} is ready and on the screen.`,
  },
  order_already_paid: {
    "hi-IN": (v) => `ऑर्डर ${v.po} का भुगतान पहले ही हो चुका है।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po} ಪಾವತಿ ಈಗಾಗಲೇ ಆಗಿದೆ.`,
    "en-IN": (v) => `Order ${v.po} is already paid.`,
  },
  po_not_found: {
    "hi-IN": (v) => `यह खरीद आदेश नंबर इस व्यापार में नहीं मिला।${v.po ? ` भुगतान के लिए बाकी ऑर्डर ${v.po} है।` : ""}`,
    "kn-IN": (v) => `ಈ ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ ಈ ವ್ಯಾಪಾರದಲ್ಲಿ ಸಿಗಲಿಲ್ಲ.${v.po ? ` ಪಾವತಿಗೆ ಬಾಕಿ ಇರುವ ಆರ್ಡರ್ ${v.po}.` : ""}`,
    "en-IN": (v) => `That purchase order number is not one of this business's.${v.po ? ` The order awaiting payment is ${v.po}.` : ""}`,
  },
  po_ambiguous: {
    "hi-IN": (v) => `कौन सा ऑर्डर: ${v.po}?`,
    "kn-IN": (v) => `ಯಾವ ಆರ್ಡರ್: ${v.po}?`,
    "en-IN": (v) => `Which order: ${v.po}?`,
  },
  no_payable_order: {
    "hi-IN": (v) => `भुगतान के लिए कोई पक्का ऑर्डर बाकी नहीं है; आख़िरी ऑर्डर ${v.po} ${v.status} है।`,
    "kn-IN": (v) => `ಪಾವತಿಗೆ ಬಾಕಿ ಇರುವ ಖಚಿತ ಆರ್ಡರ್ ಇಲ್ಲ; ಕೊನೆಯ ಆರ್ಡರ್ ${v.po} ${v.status}.`,
    "en-IN": (v) => `No confirmed order is waiting for payment; the last order, ${v.po}, is ${v.status}.`,
  },
  orders_empty: {
    "hi-IN": () => "अभी कोई ऑर्डर नहीं है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಆರ್ಡರ್ ಇಲ್ಲ.",
    "en-IN": () => "There are no orders yet.",
  },
  negotiation_rule_cap: {
    "hi-IN": (v) => `आपके नियम के अनुसार मैं प्रति ${v.unit} ${v.price} रुपये से ज़्यादा नहीं दूँगी${v.owner ? `, ${v.owner} नहीं` : ""}।`,
    "kn-IN": (v) => `ನಿಮ್ಮ ನಿಯಮದಂತೆ ಪ್ರತಿ ${v.unit} ${v.price} ರೂಪಾಯಿಗಿಂತ ಹೆಚ್ಚು ಕೊಡುವುದಿಲ್ಲ${v.owner ? `, ${v.owner} ಅಲ್ಲ` : ""}.`,
    "en-IN": (v) => `By your rule, I will not pay more than ${v.price} rupees per ${v.unit}${v.owner ? `, not ${v.owner}` : ""}.`,
  },
  rule_question: {
    "hi-IN": () => "यह नियम रख लूँ?",
    "kn-IN": () => "ಈ ನಿಯಮ ಇಟ್ಟುಕೊಳ್ಳಲೇ?",
    "en-IN": () => "Shall I keep this rule?",
  },
  rule_tap: {
    "hi-IN": () => "यह नियम रखना हो तो स्क्रीन पर सही का निशान दबाइए।",
    "kn-IN": () => "ಈ ನಿಯಮ ಬೇಕಿದ್ದರೆ ಪರದೆಯ ಮೇಲೆ ಸರಿ ಗುರುತು ಒತ್ತಿ.",
    "en-IN": () => "To keep this rule, tap the tick on the screen.",
  },
  rule_kept: {
    "hi-IN": () => "ठीक है, यह नियम याद रखूँगी।",
    "kn-IN": () => "ಸರಿ, ಈ ನಿಯಮವನ್ನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ.",
    "en-IN": () => "Done, I will remember this rule.",
  },
  rule_forgotten: {
    "hi-IN": () => "ठीक है, यह नियम हटा दिया।",
    "kn-IN": () => "ಸರಿ, ಈ ನಿಯಮವನ್ನು ತೆಗೆದುಹಾಕಿದೆ.",
    "en-IN": () => "Done, I have dropped this rule.",
  },
  rule_unclear: {
    "hi-IN": () => "मुझे साफ़ हाँ सुनाई नहीं दी; यह नियम रख लूँ, हाँ या नहीं?",
    "kn-IN": () => "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಎಂದು ಕೇಳಿಸಲಿಲ್ಲ; ಈ ನಿಯಮ ಇಟ್ಟುಕೊಳ್ಳಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": () => "I did not hear a clear yes; shall I keep this rule, yes or no?",
  },
  rule_forget_unclear: {
    "hi-IN": () => "आपने हाँ कहा, इसलिए नियम नहीं हटाया।",
    "kn-IN": () => "ನೀವು ಹೌದು ಎಂದಿರಿ, ಹಾಗಾಗಿ ನಿಯಮ ತೆಗೆದಿಲ್ಲ.",
    "en-IN": () => "You said yes, so I have not dropped the rule.",
  },
  no_spoken_rule: {
    "hi-IN": () => "अभी कोई नया नियम आपकी हाँ का इंतज़ार नहीं कर रहा।",
    "kn-IN": () => "ಈಗ ಯಾವ ಹೊಸ ನಿಯಮವೂ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿಲ್ಲ.",
    "en-IN": () => "No new rule is waiting for your yes right now.",
  },
  rule_not_found: {
    "hi-IN": () => "ऐसा कोई नियम नहीं मिला।",
    "kn-IN": () => "ಅಂಥ ನಿಯಮ ಸಿಗಲಿಲ್ಲ.",
    "en-IN": () => "I could not find such a rule.",
  },
  my_agent_rules: {
    "hi-IN": (v) => `आपके ${v.count} नियम हैं: ${v.list}`,
    "kn-IN": (v) => `ನಿಮ್ಮ ${v.count} ನಿಯಮಗಳು: ${v.list}`,
    "en-IN": (v) => `You have ${v.count} ${v.count === 1 ? "rule" : "rules"}: ${v.list}`,
  },
  my_agent_empty: {
    "hi-IN": () => "अभी कोई नियम नहीं है; बताइए, आप कैसे खरीदना पसंद करते हैं।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ನಿಯಮವೂ ಇಲ್ಲ; ನೀವು ಹೇಗೆ ಖರೀದಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ ಎಂದು ಹೇಳಿ.",
    "en-IN": () => "No rules yet; tell me how you like to buy.",
  },
  usual_quantity_offer: {
    "hi-IN": (v) => `आम तौर पर आप ${v.item} ${v.quantity} ${v.unit} लेते हैं।`,
    "kn-IN": (v) => `ಸಾಮಾನ್ಯವಾಗಿ ನೀವು ${v.item} ${v.quantity} ${v.unit} ತೆಗೆದುಕೊಳ್ಳುತ್ತೀರಿ.`,
    "en-IN": (v) => `You usually take ${v.quantity} ${v.unit} of ${v.item}.`,
  },
  usual_quantity_question: {
    "hi-IN": () => "क्या इस बार भी इतना ही लूँ?",
    "kn-IN": () => "ಈ ಬಾರಿಯೂ ಅಷ್ಟೇ ತೆಗೆದುಕೊಳ್ಳಲೇ?",
    "en-IN": () => "Shall I take the same this time?",
  },
  quantity_ask: {
    "hi-IN": () => "बताइए, कितनी मात्रा चाहिए?",
    "kn-IN": () => "ಎಷ್ಟು ಪ್ರಮಾಣ ಬೇಕು, ಹೇಳಿ?",
    "en-IN": () => "Please tell me how much you need.",
  },
  order_status: {
    "hi-IN": (v) => `ऑर्डर ${v.po} ${v.status} है${v.payment ? `, ${v.payment}` : ""}${v.more ? `; कुल ${v.count} ऑर्डर हैं` : ""}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po} ${v.status}${v.payment ? `, ${v.payment}` : ""}${v.more ? `; ಒಟ್ಟು ${v.count} ಆರ್ಡರ್‌ಗಳಿವೆ` : ""}.`,
    "en-IN": (v) => `Order ${v.po} is ${v.status}${v.payment ? `; ${v.payment}` : ""}${v.more ? `; there are ${v.count} orders in all` : ""}.`,
  },
};

/** One sentence from the phrase book in `language` (hi-IN | kn-IN | en-IN). */
function phrase(key, language, vars = {}) {
  const entry = PHRASES[key];
  if (!entry) throw new Error(`No phrase "${key}".`);
  return entry[langKey(language)](vars);
}

function languageOf(businessId) {
  return langKey(repo.getBusiness(businessId)?.language);
}

/* --------------------------------------------------------- validation --- */

/** A small JSON-Schema subset: object with typed, enumerated, required properties; no extras. */
function validateArgs(schema, args) {
  const value = args ?? {};
  if (typeof value !== "object" || Array.isArray(value)) return "Arguments must be an object.";
  const props = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    if (value[name] === undefined || value[name] === null || value[name] === "") return `${name} is required.`;
  }
  for (const [name, v] of Object.entries(value)) {
    const spec = props[name];
    if (!spec) {
      if (schema.additionalProperties === false) return `Unknown argument ${name}.`;
      continue;
    }
    if (v === null || v === undefined) continue;
    const t = spec.type;
    const ok =
      t === "string" ? typeof v === "string" :
      t === "number" ? typeof v === "number" && Number.isFinite(v) :
      t === "integer" ? Number.isInteger(v) :
      t === "boolean" ? typeof v === "boolean" : true;
    if (!ok) return `${name} must be a ${t}.`;
    if (spec.enum && !spec.enum.includes(v)) return `${name} must be one of: ${spec.enum.join(", ")}.`;
    if (spec.exclusiveMinimum !== undefined && !(v > spec.exclusiveMinimum)) return `${name} must be above ${spec.exclusiveMinimum}.`;
    if (spec.minimum !== undefined && v < spec.minimum) return `${name} must be at least ${spec.minimum}.`;
    if (spec.maximum !== undefined && v > spec.maximum) return `${name} must be at most ${spec.maximum}.`;
    if (spec.maxLength !== undefined && typeof v === "string" && v.length > spec.maxLength) return `${name} is too long.`;
    if (spec.pattern && typeof v === "string" && !new RegExp(spec.pattern).test(v)) return `${name} is not in the expected format.`;
  }
  return null;
}

const NUMERIC_TEXT = /^\s*-?\d+(?:\.\d+)?\s*$/;

/**
 * The arguments a model sends, made fit for `schema` without guessing (E2E regress bug 1: every
 * set_reorder_level call failed with INVALID_ARGUMENTS): a number sent as plain digits ("50") is
 * that number, and owner_words, which the model copies onto every call after the tools that take
 * it, is dropped where the tool has no use for it. Anything else is left for validateArgs.
 */
function normalizeArgs(schema, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const props = schema.properties ?? {};
  const out = {};
  for (const [name, v] of Object.entries(args)) {
    if (name === "owner_words" && !props.owner_words) continue;
    const t = props[name]?.type;
    out[name] = (t === "number" || t === "integer") && typeof v === "string" && NUMERIC_TEXT.test(v) ? Number(v) : v;
  }
  return out;
}

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

const REPLY_LANGUAGE = {
  type: "string",
  enum: LANGS,
  description: "The language the owner just spoke in: hi-IN (Hindi), kn-IN (Kannada) or en-IN (English). The `say` text comes back in it.",
};
/** Owner tools: every one takes reply_language, so `say` follows the owner's language. */
const ownerObj = (properties, required = []) => obj({ ...properties, reply_language: REPLY_LANGUAGE }, required);

/** An optional id. Voice models garble ids, so tools default to the current record and descriptions say so. */
const idArg = (what, fallback) => ({
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: `Optional. Leave it out to use ${fallback}. Only give the ${what} id exactly as a tool returned it.`,
});

/* ------------------------------------------------------------ helpers --- */

function requireRow(row, language) {
  if (!row) throw new ToolError("NOT_FOUND", sayFor("not_found", language));
  return row;
}

const missingFields = (r) => ["item", "quantity", "unit", "city"].filter((field) => r[field] == null || r[field] === "");

/** A need said again within this long is the same need (final-2 D: a repeated request made a duplicate). */
const TWIN_WINDOW_MS = 10 * 60 * 1000;
const foldText = (text) => String(text ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The business's latest need when it is exactly this one (item, quantity, unit, city), was saved in
 * the last few minutes and has no order yet; null otherwise. Only the latest is considered, so the
 * tools' "current requirement" stays the one the owner is talking about.
 */
function recentTwin(businessId, fields, now = Date.now()) {
  if (!fields.item || fields.quantity == null || !fields.unit) return null;
  const latest = repo.listRequirements(businessId).at(-1);
  if (!latest || now - Date.parse(latest.created_at) > TWIN_WINDOW_MS) return null;
  const same = foldText(latest.item) === foldText(fields.item) && latest.quantity === fields.quantity && latest.unit === fields.unit && (fields.city === undefined || latest.city === fields.city);
  if (!same) return null;
  const ordered = repo.listQuotes(businessId, { requirement_id: latest.id }).some((q) => repo.listOrders(businessId, { quote_id: q.id }).length > 0);
  return ordered ? null : latest;
}

/**
 * The requirement a tool works on: the one named, else the latest one saved in this call,
 * else the business's latest. Tenant comes from ctx only.
 */
function currentRequirement(ctx, requirementId, language) {
  if (requirementId) return requireRow(repo.getRequirement(ctx.businessId, requirementId), language);
  const all = repo.listRequirements(ctx.businessId);
  const thisCall = ctx.sessionId ? all.filter((r) => r.session_id === ctx.sessionId) : [];
  const latest = (thisCall.length ? thisCall : all).at(-1);
  if (!latest) throw new ToolError("NO_REQUIREMENT", phrase("no_requirement", language), { status: 409 });
  return latest;
}

/** The IndiaMART category the sourcing job resolved ("Basmati Rice"); stored on the job's result. */
function sourcedCategory(businessId, requirementId) {
  const done = repo.listJobs(businessId, { requirement_id: requirementId, kind: "sourcing", status: "done" });
  return done.at(-1)?.result?.category ?? null;
}

/** Indic script, read wrongly inside an English sentence. */
const INDIC_SCRIPT = /[\p{Script=Devanagari}\p{Script=Kannada}]/u;

/** Said when no rule can name the item in the sentence's own script. */
const UNNAMED_ITEM = { "hi-IN": "आपका बताया सामान", "kn-IN": "ನೀವು ಹೇಳಿದ ವಸ್ತು", "en-IN": "the requested item" };

/**
 * The item as said in a `language` sentence; a word in another script is never read out by this
 * language's voice (CLAUDE.md rule 5).
 * - hi / kn: the owner's own words when they are all in that script, else the same item from the
 *   trade-word table ("basmati rice" -> "बासमती चावल", slug.itemIn), else a plain "the item you
 *   named" (E2E r4: "basmati rice" was read inside a Hindi reply).
 * - en: the owner's words when they have no Indic script, else the IndiaMART category found by
 *   sourcing ("Basmati Rice"), else the English trade name ("basmati rice"), else "the requested item".
 */
function spokenItem(businessId, requirement, language) {
  const lang = langKey(language);
  const item = String(requirement.item ?? "");
  if (lang !== "en-IN") return isNativeScript(item, lang) ? item : itemIn(item, lang) ?? UNNAMED_ITEM[lang];
  if (!INDIC_SCRIPT.test(item)) return item;
  const category = sourcedCategory(businessId, requirement.id);
  if (category && !INDIC_SCRIPT.test(category)) return category;
  const slug = candidateSlugs(item)[0];
  return slug ? slug.replace(/-/g, " ") : UNNAMED_ITEM[lang];
}

const isActive = (job) => Boolean(job) && (job.status === "queued" || job.status === "running");

/** The latest job of one kind for a requirement, or null. */
function latestJob(businessId, requirementId, kind) {
  return repo.listJobs(businessId, { requirement_id: requirementId, kind }).at(-1) ?? null;
}

/**
 * Why a requirement has no vendors, without claiming a result before the search has ended:
 * running -> "still running", never started -> offer to start, ended -> "found none".
 */
function noVendors(businessId, requirement, language) {
  const job = latestJob(businessId, requirement.id, "sourcing");
  if (isActive(job)) return { code: "SOURCING_RUNNING", say: phrase("sourcing_running_none", language) };
  if (!job) return { code: "NOT_SOURCED", say: phrase("sourcing_not_started", language) };
  if (job.status === "cancelled") return { code: "NO_VENDORS", say: phrase("job_cancelled", language) };
  return { code: "NO_VENDORS", say: phrase("sourcing_found_none", language) };
}

/** Why a requirement has no quotes: a negotiation still running says so instead of "no quotes". */
function noQuotes(businessId, requirement, language) {
  if (isActive(latestJob(businessId, requirement.id, "negotiation"))) {
    return { code: "NEGOTIATION_RUNNING", say: phrase("negotiation_running_no_quote", language) };
  }
  return { code: "NO_QUOTES", say: phrase("deals_empty", language) };
}

/** A tool just spoke a finished search's result: the narrator must not say it again. */
function sourcingResultSpoken(businessId, requirementId) {
  require("../agora/narrator").suppress(businessId, `sourcing.done:${requirementId}`);
}

/**
 * Vendors of a requirement Sahay may deal with, best first (scoring.rankVendors under the owner's
 * rules: avoided vendors left out, a preferred one first on a tie); the order vendorRank counts in.
 */
function rankedVendors(businessId, requirement) {
  return policy.rankedVendors(businessId, requirement);
}

/** "Several qualify" is never resolved by guessing: the owner hears the choices. */
function ambiguous(language, choices) {
  return new ToolError("AMBIGUOUS", phrase("choose", language, { n: choices.length, list: choices.slice(0, 3).join(", ") }), {
    status: 409,
    details: { choices },
  });
}

function approvalChoice(businessId, approval, language) {
  const quote = repo.getQuote(businessId, approval.quote_id);
  const vendor = quote && repo.getVendor(businessId, quote.vendor_id);
  return phrase("choice_deal", language, { vendor: vendor?.name ?? "", sim: Boolean(quote?.simulated), total: money(approval.total_amount) });
}

function vendorSummary(v, requirement, rank) {
  const comparable = comparableListedPrice(v, requirement.unit);
  return {
    rank,
    vendorId: v.id,
    name: v.name,
    city: v.city,
    kind: v.kind,
    simulated: v.simulated,
    listedPrice: v.listed_price,
    listedUnit: v.listed_unit,
    listedPriceText: v.listed_price_text,
    comparablePrice: comparable ? round2(comparable.value) : null,
    priceUnit: comparable ? requirement.unit : null,
    rating: v.rating,
    ratingCount: v.rating_count,
    score: v.score,
    sourceUrl: v.source_url,
  };
}

/** How a finished negotiation ended, from the outcome stored on its job (session.finish). */
function negotiationOutcomeSay(outcome, language) {
  if (!outcome || !outcome.vendorName) return phrase("job_done_negotiation", language);
  const vars = { vendor: outcome.vendorName, sim: Boolean(outcome.simulated) };
  if (outcome.agreed && outcome.unitPrice != null) {
    return phrase("job_done_negotiation_agreed", language, { ...vars, price: money(outcome.unitPrice), unit: unitWord(outcome.unit, language) });
  }
  return phrase("job_done_negotiation_no_deal", language, vars);
}

/** rankDeals output -> the deal shape of architecture.md. */
function toDeal(deal, requirement, vendorsById) {
  const vendor = vendorsById.get(deal.vendor_id);
  return {
    quoteId: deal.id,
    vendorId: deal.vendor_id,
    vendorName: vendor?.name ?? null,
    simulated: Boolean(deal.simulated),
    unitPrice: deal.unit_price,
    unit: deal.unit,
    quantity: requirement.quantity,
    freight: deal.freight,
    goodsCost: deal.goods_cost,
    landedCost: deal.landed_cost,
    leadTimeDays: deal.lead_time_days,
    moq: deal.moq,
    status: deal.status,
    flags: deal.flags,
    reason: deal.reason,
    rank: deal.rank,
  };
}

/** Ranked deals for a requirement, best first. Shared with GET /api/state. */
function rankedDeals(businessId, requirementId) {
  const requirement = repo.getRequirement(businessId, requirementId);
  if (!requirement) return [];
  const quotes = repo.listQuotes(businessId, { requirement_id: requirementId });
  if (!quotes.length) return [];
  const vendorsById = new Map(repo.listVendors(businessId, { requirement_id: requirementId }).map((v) => [v.id, v]));
  return rankDeals(quotes, requirement).map((deal) => toDeal(deal, requirement, vendorsById));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `decide(history)` on this call's Agora /history. /history can lag the transcript by about
 * 0.5 s, so an answer that is not there yet is looked for again before the refusal stands.
 */
async function withHistory(ctx, decide) {
  const agent = require("../agora/agent");
  for (let attempt = 1; ; attempt++) {
    try {
      return decide(await agent.history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS }));
    } catch (err) {
      if (VOICE_RETRY.has(err?.code) && attempt < HISTORY_ATTEMPTS) {
        await sleep(HISTORY_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
}

/* ----------------------------------------------------- sourcing runner --- */

/** Identity of a listing, so a re-run does not store the same seller twice. */
/** Stored rows have the cleaned name (db/vendor-text.js), so a fresh listing is keyed the same way. */
const listingKey = (v) => (v.glusr_id ? `g:${v.glusr_id}` : `n:${String(vendorText(v.name)).toLowerCase()}|${v.phone ?? ""}`);

/**
 * The sourcing job: IndiaMART listings (findVendors resolves the category slug
 * itself) -> scoreVendor -> persist -> vendor.found per vendor -> shortlist.
 * Nothing found is a failure with the reason, never an empty success.
 */
async function runSourcing(job) {
  const { businessId, input, signal } = job;
  const requirement = repo.getRequirement(businessId, input.requirementId);
  if (!requirement) throw new Error("The requirement no longer exists.");

  job.progress(`Searching IndiaMART for ${requirement.item}${requirement.city ? ` in ${requirement.city}` : ""}.`);
  const found = await findVendors({ item: requirement.item, city: requirement.city ?? null, limit: DISCOVERY_LIMIT, signal });
  const reason = found.reason;
  const source = found.source ?? {};
  if (!found.length) {
    throw new Error(
      reason === "no_category_found"
        ? `IndiaMART has no category page with listings for "${requirement.item}".${source.detail ? ` ${source.detail}` : ""}`
        : `IndiaMART returned no listings for "${requirement.item}".`,
    );
  }
  job.progress(
    `Found ${found.length} listings in "${source.category ?? source.slug ?? requirement.item}"${source.scope === "national" ? " (nationwide: no page for this city)" : ""}.`,
    { total: found.length, scope: source.scope ?? null, category: source.category ?? null, url: source.url ?? null },
  );

  const seen = new Set(repo.listVendors(businessId, { requirement_id: requirement.id }).map(listingKey));
  let stored = 0;
  for (const listing of found) {
    signal.throwIfAborted();
    const key = listingKey(listing);
    if (seen.has(key)) continue;
    seen.add(key);
    const { score, breakdown, assumed, flags } = scoreVendor(listing, requirement);
    const row = repo.createVendor(businessId, {
      ...listing,
      requirement_id: requirement.id,
      source: "indiamart",
      score,
      score_breakdown: { ...breakdown, assumed, flags },
    });
    stored += 1;
    events.emit(businessId, "vendor.found", { requirementId: requirement.id, vendor: row }, { actor: "system" });
    job.progress(`Scored ${row.name}.`, { done: stored, total: found.length });
  }

  repo.updateRequirement(businessId, requirement.id, { status: "sourced" });
  const ranked = rankedVendors(businessId, requirement);
  const shortlist = ranked.slice(0, SHORTLIST_SIZE).map((v, i) => vendorSummary(v, requirement, i + 1));
  return {
    requirementId: requirement.id,
    unit: requirement.unit,
    count: ranked.length,
    category: source.category ?? null,
    scope: source.scope ?? null,
    sourceUrl: source.url ?? null,
    shortlist,
  };
}

/**
 * Start the sourcing job for a requirement, or hand back the one already running for it.
 * Returns `{ jobId, already }`; throws ToolError BUSY when the global search cap is full.
 */
function beginSourcing(ctx, requirement, language) {
  const active = repo.listJobs(ctx.businessId, { requirement_id: requirement.id, kind: "sourcing" }).find(isActive);
  if (active) return { jobId: active.id, already: true };
  // Global cap on searches running at once, across all businesses (security review r1 #1).
  const release = require("../limits").tryAcquire("sourcing");
  if (!release) throw new ToolError("BUSY", phrase("busy", language), { status: 503, message: "Too many vendor searches are running." });
  try {
    repo.updateRequirement(ctx.businessId, requirement.id, { status: "sourcing" });
    require("../agora/narrator").suppress(ctx.businessId, "job.started");
    return { jobId: jobs.startJob(ctx.businessId, "sourcing", { requirementId: requirement.id }, runSourcing, { onSettled: release }), already: false };
  } catch (err) {
    release();
    throw err;
  }
}

/* ------------------------------------------------ owner's own words --- */

/**
 * The owner's latest turns, to check a requirement against (E2E r4 bug 4): in a call, the ASR
 * turns of Agora /history (the model's copy is not trusted over them); otherwise, or when the
 * history cannot be read, the `owner_words` the model passed. Null when there is neither.
 */
async function ownerWords(ctx, args) {
  if (ctx.agentId) {
    try {
      return { turns: evidence.ownerTurns(await require("../agora/agent").history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS })), source: "history" };
    } catch {
      // the call history is unavailable: fall back to the model's copy below
    }
  }
  return args.owner_words ? { turns: [args.owner_words], source: "owner_words" } : null;
}

/** Fields of a save_requirement call the owner's turns do not bear out ([] when all do, or when nothing can be checked). */
async function unheardFields(ctx, args, claim) {
  if (!claim.item && claim.quantity == null && !claim.unit) return [];
  let said = await ownerWords(ctx, args);
  if (!said) return [];
  let missing = evidence.notHeard(said.turns, claim);
  if (missing.length && said.source === "history") {
    // /history can lag the final transcript by about 0.5 s: look once more before refusing.
    await sleep(HISTORY_RETRY_MS);
    said = (await ownerWords(ctx, args)) ?? said;
    missing = evidence.notHeard(said.turns, claim);
  }
  return missing;
}

/* ------------------------------------------------------------ approval --- */

/**
 * request_approval for a deal this call's agent has already read out: nothing is spoken again.
 * The owner's answer since the read-back (approvals.answerToReadback, best effort) tells the model
 * which confirm_approval call to make. This never decides anything: only confirm_approval, through
 * the gate, approves or rejects.
 */
async function awaitingAnswer(ctx, approval, result, language) {
  let ownerReply;
  try {
    const history = await require("../agora/agent").history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS });
    ownerReply = approvals.classifyUtterance(approvals.answerToReadback(ctx.businessId, approval, history, { agentId: ctx.agentId }).text);
  } catch {
    ownerReply = undefined; // no answer since the read-back, or the history is unavailable
  }
  const decision = { affirmative: "approve", negative: "reject" }[ownerReply] ?? null;
  if (!decision) require("../agora/narrator").holdForApproval(ctx.businessId, approval.id);
  return {
    ...result,
    status: "awaiting_answer",
    readbackSpoken: true,
    ...(ownerReply ? { ownerReply } : {}),
    next: "confirm_approval",
    hint: decision
      ? `The owner has already answered this deal (${ownerReply}). Call confirm_approval with decision ${decision} now, with no id; do not call request_approval again.`
      : "This deal was already read out and the owner was asked. When the owner answers, call confirm_approval with no id (decision approve on a clear yes, reject on a no); do not call request_approval again unless the owner asks to hear the deal again (repeat: true).",
    say: phrase(decision ? "approval_recording" : "approval_question", language),
  };
}

/** Gate refusals after which a later clear yes gets the deal read out again (confirm_approval). */
const REREAD_ON = new Set(["NOT_AFFIRMATIVE", "READBACK_SUPERSEDED", "ANSWER_DURING_READBACK"]);

/**
 * The read-back as the owner hears it: the stored one is in the business language, the spoken one
 * follows the owner's language. Same figures, and the item named in that language's script.
 */
function spokenReadback(ctx, quoteId, deal, language) {
  const requirement = repo.getRequirement(ctx.businessId, repo.getQuote(ctx.businessId, quoteId)?.requirement_id);
  const item = requirement ? spokenItem(ctx.businessId, requirement, language) : deal.item;
  return approvals.buildReadback({ ...deal, item }, READBACK_LANGUAGE[language]);
}

/**
 * In a call the server speaks the read-back itself, so the yes it later accepts answers exactly these
 * words (security review r1 #2); the model only asks the short question. Nothing else may be narrated
 * between the read-back and the owner's answer to it.
 */
async function readOut(ctx, approval, readback, language) {
  require("../agora/narrator").holdForApproval(ctx.businessId, approval.id);
  try {
    await require("../agora/agent").speak(ctx.agentId, readback, { priority: "APPEND", interruptable: false });
  } catch (err) {
    throw new ToolError("READBACK_NOT_SPOKEN", phrase("readback_not_spoken", language), { status: 502, message: `The read-back could not be spoken: ${err.message}` });
  }
  approvals.recordReadbackSpoken(ctx.businessId, approval.id, { agentId: ctx.agentId, text: readback, sessionId: ctx.sessionId ?? null });
}

/* ----------------------------------------------------------- defaults --- */

const READBACK_LANGUAGE = { "hi-IN": "hi", "kn-IN": "kn", "en-IN": "en" };
const dealCost = (d) => d.landedCost ?? d.goodsCost;

/** The best-ranked deal of the current requirement; a tie for best is named, not picked. */
function defaultDeal(ctx, args, language) {
  const requirement = currentRequirement(ctx, args.requirementId, language);
  const deals = rankedDeals(ctx.businessId, requirement.id);
  if (!deals.length) {
    const why = noQuotes(ctx.businessId, requirement, language);
    throw new ToolError(why.code, why.say, { status: 409 });
  }
  const eligible = deals.filter((d) => d.status === "ranked" || d.status === "freight_unknown");
  if (!eligible.length) throw new ToolError("NO_RANKABLE_DEAL", phrase("deal_none_rankable", language), { status: 409 });
  const best = eligible[0];
  const tied = eligible.filter((d) => d.status === best.status && dealCost(d) === dealCost(best));
  if (tied.length > 1) {
    throw ambiguous(language, tied.map((d) => phrase("choice_deal", language, { vendor: d.vendorName ?? "", sim: d.simulated, total: money(dealCost(d)) })));
  }
  return best;
}

/**
 * The approval create_order acts on: the one approved approval. With none approved, the one
 * pending approval is handed to the gate so the owner hears that it is not approved yet.
 */
function defaultApprovalForOrder(ctx, language) {
  const all = repo.listApprovals(ctx.businessId);
  const approved = all.filter((a) => a.status === "approved");
  if (approved.length > 1) throw ambiguous(language, approved.map((a) => approvalChoice(ctx.businessId, a, language)));
  if (approved.length === 1) return approved[0].id;
  const pending = all.filter((a) => a.status === "pending");
  if (pending.length === 1) return pending[0].id;
  throw new ToolError("NOT_APPROVED", sayFor("not_approved", language), { status: 409, message: "No approved deal to order." });
}

/** How long after confirm_approval placed an order a create_order call still means that order. */
const JUST_PLACED_MS = 10 * 60 * 1000;

/**
 * The order confirm_approval placed a moment ago, when no other deal is approved or waiting: a
 * create_order call after the owner's spoken yes then names it instead of refusing NOT_APPROVED.
 */
function justPlacedOrder(businessId, now = Date.now()) {
  if (repo.listApprovals(businessId).some((a) => a.status === "approved" || a.status === "pending")) return null;
  const last = repo.listOrders(businessId).at(-1);
  return last && now - Date.parse(last.created_at) <= JUST_PLACED_MS ? last : null;
}

/**
 * The order create_payment_link acts on: the business's most recent confirmed (unpaid) order,
 * whatever requirement or call is current (e2e r3 bug 2: a new requirement or a fresh call must
 * not hide the order that is waiting for payment).
 */
function defaultOrderForPayment(ctx, language) {
  const all = repo.listOrders(ctx.businessId);
  if (!all.length) throw new ToolError("NO_ORDER", phrase("orders_empty", language), { status: 409 });
  const payable = all.filter((o) => o.status === orders.INITIAL_STATUS).at(-1);
  if (payable) return payable.id;
  const last = all.at(-1);
  if (last.status === "paid") throw new ToolError("ORDER_ALREADY_PAID", phrase("order_already_paid", language, { po: last.po_number }), { status: 409 });
  throw new ToolError("NO_PAYABLE_ORDER", phrase("no_payable_order", language, { po: last.po_number, status: ORDER_STATUS_WORDS[last.status]?.[language] ?? last.status }), { status: 409 });
}

/**
 * The order a create_payment_link reference names: an order id as a tool returned it, else a
 * purchase order number in any script or spacing (src/orders/po-ref.js). E2E regress bug 5: the
 * model passed "SAHAY/2026/6799-0001" as orderId and the owner heard "order not found".
 */
function orderForReference(ctx, ref, language) {
  const text = String(ref).trim();
  if (repo.getOrder(ctx.businessId, text)) return text;
  const all = repo.listOrders(ctx.businessId);
  const found = findByPo(all, text);
  if (found?.order) return found.order.id;
  if (found?.ambiguous) {
    const choices = found.ambiguous.map((o) => o.po_number);
    throw new ToolError("AMBIGUOUS", phrase("po_ambiguous", language, { po: choices.join(", ") }), { status: 409, details: { choices } });
  }
  const open = all.filter((o) => o.status === orders.INITIAL_STATUS).at(-1);
  throw new ToolError("ORDER_NOT_FOUND", phrase("po_not_found", language, { po: open?.po_number ?? null }), { status: 404 });
}

/** Payment state of an order: "paid" once a verified payment is recorded, else "pending". */
function paymentOf(businessId, order) {
  const checkout = repo.getCheckoutForOrder(businessId, order.id);
  const paid = order.status === "paid" || Boolean(checkout?.paid_at);
  return { status: paid ? "paid" : "pending", linkExists: Boolean(checkout && order.payment_link_url), url: order.payment_link_url ?? null };
}

function paymentClause(order, payment, language) {
  if (order.status === "cancelled" || order.status === "paid") return null; // the status word already says it
  if (payment.status === "paid") return PAYMENT_WORDS.paid[language];
  return PAYMENT_WORDS[payment.linkExists ? "pending_link" : "pending_no_link"][language];
}

/* -------------------------------------------------------------- rules --- */

/** Gate and rule refusals said about a rule, not about an order (the codes stay the same). */
const RULE_REFUSALS = {
  NOT_AFFIRMATIVE: "rule_unclear",
  NO_ANSWER_YET: "rule_unclear",
  TYPED_ANSWER: "rule_tap",
  ANSWER_DURING_READBACK: "rule_unclear",
  READBACK_SUPERSEDED: "rule_unclear",
  NOT_NEGATIVE: "rule_forget_unclear",
  READBACK_NOT_SPOKEN: "rule_tap",
  READBACK_NOT_HEARD: "rule_tap",
  EVIDENCE_UNORDERED: "rule_tap",
  EVIDENCE_REQUIRED: "rule_tap",
  RULE_NOT_FOUND: "rule_not_found",
};

function ruleRefusal(err, language) {
  const key = RULE_REFUSALS[err?.code];
  if (!key) return err;
  return new ToolError(err.code, phrase(key, language), { status: err.code === "RULE_NOT_FOUND" ? 404 : 409, message: err.message, cause: err });
}

/** A rule from teach_rule's flat arguments: only the fields of its kind are taken. */
function ruleParams(args) {
  const fields = agentRules.KINDS[args.kind]?.fields ?? [];
  return Object.fromEntries(fields.filter((f) => args[f] !== undefined && args[f] !== null).map((f) => [f, args[f]]));
}

/** Rules forget_rule may mean: active or still suggested, narrowed by what the owner named. */
function rulesNamed(businessId, args) {
  if (args.ruleId) {
    const rule = agentRules.get(businessId, args.ruleId);
    return rule && rule.status !== "off" ? [rule] : [];
  }
  const live = agentRules.list(businessId).filter((r) => r.status !== "off");
  return live.filter((r) => {
    if (args.kind && r.kind !== args.kind) return false;
    if (args.item && !(r.params.item && (policy.covers(args.item, r.params.item) || policy.covers(r.params.item, args.item)))) return false;
    if (args.name && !(r.params.name && agentRules.fold(r.params.name) === agentRules.fold(args.name))) return false;
    return Boolean(args.kind || args.item || args.name);
  });
}

/**
 * Propose a rule and, in a call, read it out as a question ("<sentence> यह नियम रख लूँ?"), so the
 * owner's yes plainly answers it (E2E full run: the read-back was a bare statement). The same rule
 * proposed again after it was read out in this call is not replaced: the owner's answer since the
 * read-back goes to confirm_rule (the first हाँ used to "replace" the rule and need a second one).
 * `question` and `tap` are the tool's own lines for the yes/no question and the screen fallback.
 */
async function askRule(ctx, { kind, params }, language, { question, tap }) {
  const twin = agentRules.spokenTwin(ctx.businessId, ctx.agentId, { kind, params });
  if (twin) return ruleAwaitingAnswer(ctx, twin, language, question);
  const rule = agentRules.propose(ctx.businessId, { kind, params, source: "owner_said" }, { sessionId: ctx.sessionId ?? null });
  const sentence = rule.sentence[language];
  const result = { ruleId: rule.id, status: rule.status, sentence };
  // Off a call the rule is still only proposed: the reply asks, it never promises (E2E regress bug 1).
  if (!ctx.agentId) return { ...result, readbackSpoken: false, say: `${sentence} ${question} ${tap}` };
  const text = `${sentence} ${question}`;
  // The server says the rule itself, so a spoken yes can only answer exactly these words.
  require("../agora/narrator").holdForRule(ctx.businessId, rule.id);
  try {
    await require("../agora/agent").speak(ctx.agentId, text, { priority: "APPEND", interruptable: false });
  } catch (err) {
    return { ...result, readbackSpoken: false, say: `${sentence} ${tap}`, message: `The rule could not be read out: ${err.message}` };
  }
  agentRules.recordSpoken(ctx.businessId, rule.id, { agentId: ctx.agentId, text, sessionId: ctx.sessionId ?? null });
  return { ...result, readbackSpoken: true, next: "confirm_rule", hint: "The server read the rule out and asked the question. Wait for the owner; their yes or no goes to confirm_rule.", say: question };
}

/** A rule already read out in this call: nothing is spoken again; the owner's answer so far tells the model which confirm_rule to make. */
async function ruleAwaitingAnswer(ctx, rule, language, question) {
  let reply;
  try {
    reply = approvals.classifyUtterance(agentRules.spokenAnswer(ctx.businessId, rule.id, { agentId: ctx.agentId, history: await require("../agora/agent").history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS }) }));
  } catch {
    reply = undefined; // no answer since the read-back, or the history is unavailable
  }
  const decision = { affirmative: "keep", negative: "forget" }[reply] ?? null;
  return {
    ruleId: rule.id,
    status: rule.status,
    sentence: rule.sentence[language],
    readbackSpoken: true,
    alreadyAsked: true,
    ...(reply ? { ownerReply: reply } : {}),
    next: "confirm_rule",
    hint: decision
      ? `The owner has already answered this rule (${reply}). Call confirm_rule with decision ${decision} now, with no id; do not propose the rule again.`
      : "This rule was already read out and the owner was asked. When the owner answers, call confirm_rule with no id (keep on a clear yes, forget on a no); do not propose it again.",
    say: decision ? phrase("approval_recording", language) : question,
  };
}

/**
 * Offer the active usual_quantity rule for a need saved without a quantity: the server says the
 * usual quantity itself (so the owner's yes answers exactly those words) and the model asks.
 * Returns the offer, or null when there is no rule, no call or the line could not be spoken.
 */
async function offerUsualQuantity(ctx, requirement, language) {
  if (!ctx.agentId || requirement.quantity != null) return null;
  const rule = policy.usualQuantity(ctx.businessId, requirement.item);
  if (!rule || (requirement.unit && !sameUnit(requirement.unit, rule.params.unit))) return null;
  const text = phrase("usual_quantity_offer", language, {
    item: spokenItem(ctx.businessId, requirement, language),
    quantity: money(rule.params.quantity),
    unit: unitWord(rule.params.unit, language, rule.params.quantity !== 1),
  });
  require("../agora/narrator").holdForRule(ctx.businessId, rule.id);
  try {
    await require("../agora/agent").speak(ctx.agentId, text, { priority: "APPEND", interruptable: false });
  } catch {
    return null; // the owner is simply asked for the quantity
  }
  agentRules.recordSpoken(ctx.businessId, rule.id, { agentId: ctx.agentId, text, sessionId: ctx.sessionId ?? null });
  return { quantity: rule.params.quantity, unit: rule.params.unit };
}

/* -------------------------------------------------------------- tools --- */

const OWNER = [SCOPES.owner];
const NEGOTIATION = [SCOPES.negotiation];

const TOOLS = [
  {
    name: "get_business_profile",
    scopes: OWNER,
    description: "Returns this business's profile: name, owner, city, state and language.",
    inputSchema: ownerObj({}),
    async handler(ctx, args, language) {
      const business = requireRow(repo.getBusiness(ctx.businessId), language);
      const { id, name, owner_name, city, state } = business;
      return { business: { id, name, owner_name, city, state, language: business.language }, say: phrase("profile", language, { name, city: cityIn(city, language) }) };
    },
  },
  {
    name: "save_requirement",
    scopes: OWNER,
    description:
      "Saves what the owner wants to BUY from a vendor (a purchase). Never for a sale: when the owner sold something to a customer, that is draft_invoice only, never this tool. Call as soon as the item is known. To add details later, call it again without item and without any id: it updates the requirement saved in this call. An item with no id starts a new requirement. Returns missing[] (fields still needed). In a call, once nothing is missing it also starts the vendor search itself (sourcingStarted true, jobId): just speak `say`, do not call start_sourcing. The server checks the item, quantity and unit against the owner's own words; when saved is false, nothing was saved: speak `say` and wait for the owner to repeat.",
    inputSchema: ownerObj(
      {
        requirementId: idArg("requirement", "the requirement saved in this call"),
        owner_words: { type: "string", maxLength: 500, description: "The owner's last sentence, word for word as you heard it, in the owner's script. Always pass it." },
        item: { type: "string", maxLength: 200, description: "The item as the owner named it, in the owner's own script, e.g. बासमती चावल / ಬಾಸ್ಮತಿ ಅಕ್ಕಿ / basmati rice." },
        quantity: { type: "number", exclusiveMinimum: 0 },
        unit: { type: "string", maxLength: 40, description: `The unit as the owner said it (किलो, ಕಿಲೋ, kilos, pieces ...). Stored as one of: ${UNIT_CODES.join(", ")}.` },
        city: { type: "string", maxLength: 80, description: "Delivery city as the owner said it." },
        max_price_per_unit: { type: "number", exclusiveMinimum: 0, description: "Most the owner will pay per unit, in rupees." },
        target_price: { type: "number", exclusiveMinimum: 0, description: "Price per unit the owner hopes for, in rupees." },
        delivery_by: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" },
        notes: { type: "string", maxLength: 500 },
        use_usual_quantity: {
          type: "boolean",
          description: "Only after this tool returned usualQuantity and the owner then said yes to it: fills the usual quantity. The server checks the owner's own spoken yes.",
        },
      },
      [],
    ),
    async handler(ctx, args, language) {
      const fields = {};
      for (const [arg, column] of [["item", "item"], ["quantity", "quantity"], ["unit", "unit"], ["city", "city"], ["max_price_per_unit", "max_price"], ["target_price", "target_price"], ["delivery_by", "delivery_by"], ["notes", "notes"]]) {
        if (args[arg] !== undefined && args[arg] !== null && args[arg] !== "") fields[column] = typeof args[arg] === "string" ? args[arg].trim() : args[arg];
      }
      // Canonical at the boundary: "किलो", "kilos", "ಕಿಲೋ" are all stored as "kg"; an unknown unit is asked about, never guessed.
      if (fields.unit !== undefined) {
        const unit = canonicalUnit(fields.unit);
        if (!unit) throw new ToolError("UNKNOWN_UNIT", phrase("unit_unknown", language, { unit: fields.unit }), { status: 400, message: `Unknown unit "${fields.unit}".` });
        fields.unit = unit;
      }
      if (fields.city !== undefined) fields.city = cityName(fields.city);

      // The usual quantity is filled only on the owner's spoken yes to the server's own offer of it.
      let usual = null;
      if (args.use_usual_quantity) {
        if (fields.item || fields.quantity !== undefined) throw new ToolError("INVALID", sayFor("invalid", language), { message: "use_usual_quantity goes without an item or a quantity." });
        if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", phrase("quantity_ask", language), { status: 409 });
        const need = args.requirementId
          ? requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language)
          : repo.listRequirements(ctx.businessId).filter((r) => ctx.sessionId && r.session_id === ctx.sessionId).at(-1);
        const rule = need && policy.usualQuantity(ctx.businessId, need.item);
        if (!rule) throw new ToolError("RULE_NOT_FOUND", phrase("quantity_ask", language), { status: 409 });
        try {
          await withHistory(ctx, (history) => agentRules.spokenYes(ctx.businessId, rule.id, { agentId: ctx.agentId, history }));
        } catch (err) {
          throw new ToolError(err?.code ?? "NOT_AFFIRMATIVE", phrase("quantity_ask", language), { status: 409, message: err?.message, cause: err });
        }
        usual = { quantity: rule.params.quantity, unit: rule.params.unit };
        Object.assign(fields, usual);
      }

      const update = Boolean(args.requirementId || !fields.item);
      let target = null;
      if (update) {
        target = args.requirementId
          ? requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language)
          : ctx.sessionId && repo.listRequirements(ctx.businessId).filter((r) => r.session_id === ctx.sessionId).at(-1);
        if (!target) throw new ToolError("INVALID", sayFor("invalid", language), { message: "item is required for a new requirement." });
        if (!Object.keys(fields).length) throw new ToolError("INVALID", sayFor("invalid", language), { message: "Nothing to update." });
      } else {
        target = recentTwin(ctx.businessId, fields);
      }

      // Only what this call changes has to be in the owner's words; a value sent again unchanged does not.
      const changed = (column) => fields[column] !== undefined && (!target || fields[column] !== target[column]);
      const notHeard = await unheardFields(ctx, args, {
        item: changed("item") ? fields.item : undefined,
        quantity: !usual && changed("quantity") ? fields.quantity : undefined,
        unit: !usual && changed("unit") ? fields.unit : undefined,
      });
      if (notHeard.length) {
        return {
          requirementId: target?.id ?? null,
          saved: false,
          missing: notHeard,
          sourcingStarted: false,
          say: phrase("requirement_not_heard", language, { missing: notHeard.map((m) => MISSING_WORDS[m][language]).join(", ") }),
        };
      }

      // A sale is never a purchase: a new need in the same turn as draft_invoice is the sale misread (E2E full run).
      if (!target && toolCalls.startedSince(ctx.businessId, ["draft_invoice"], Date.now() - SALE_TURN_MS)) {
        return {
          requirementId: null,
          saved: false,
          sale: true,
          sourcingStarted: false,
          hint: "This turn is a sale to a customer (draft_invoice): nothing was saved as a purchase. Say nothing about buying, vendors or a delivery city; speak only the say of draft_invoice.",
          say: "",
        };
      }
      const requirement = target
        ? repo.updateRequirement(ctx.businessId, target.id, fields)
        : repo.createRequirement(ctx.businessId, { ...fields, session_id: ctx.sessionId ?? undefined });
      events.emit(ctx.businessId, "requirement.saved", requirement, { sessionId: ctx.sessionId, actor: "agent" });
      const missing = missingFields(requirement);
      const item = spokenItem(ctx.businessId, requirement, language);
      if (missing.length) {
        const offer = missing.includes("quantity") ? await offerUsualQuantity(ctx, requirement, language) : null;
        if (offer) {
          return { requirementId: requirement.id, requirement, saved: true, missing, sourcingStarted: false, usualQuantity: offer, next: "save_requirement with use_usual_quantity on a yes", say: phrase("usual_quantity_question", language) };
        }
        const say = phrase("requirement_missing", language, { item, missing: missing.map((m) => MISSING_WORDS[m][language]).join(", ") });
        return { requirementId: requirement.id, requirement, saved: true, missing, sourcingStarted: false, say };
      }
      const vars = {
        quantity: money(requirement.quantity),
        unit: unitWord(requirement.unit, language, requirement.quantity !== 1),
        item,
        city: cityIn(requirement.city, language),
      };
      const result = { requirementId: requirement.id, requirement, saved: true, missing, sourcingStarted: false };

      // In a call, a complete requirement that was never searched starts its search here, so the
      // model needs no second tool call (E2E r4 bug 3). start_sourcing stays for retries.
      if (!ctx.agentId || latestJob(ctx.businessId, requirement.id, "sourcing")) return { ...result, say: phrase("requirement_saved", language, vars) };
      try {
        const { jobId } = beginSourcing(ctx, requirement, language);
        return { ...result, sourcingStarted: true, jobId, say: phrase("requirement_saved_searching", language, vars) };
      } catch (err) {
        if (err?.code !== "BUSY") throw err;
        return { ...result, sourcingError: "BUSY", say: `${phrase("requirement_saved", language, vars)} ${err.say}` };
      }
    },
  },
  {
    name: "start_sourcing",
    scopes: OWNER,
    description:
      "Starts finding and scoring real vendors on IndiaMART for the current requirement. Returns a jobId at once; progress is announced. In a call save_requirement already starts the first search; call this when the owner asks to search (again), or when save_requirement returned sourcingStarted false with nothing missing.",
    inputSchema: ownerObj({ requirementId: idArg("requirement", "the latest requirement") }),
    async handler(ctx, args, language) {
      const requirement = currentRequirement(ctx, args.requirementId, language);
      const item = spokenItem(ctx.businessId, requirement, language);
      const missing = missingFields(requirement).filter((m) => m !== "city");
      if (missing.length) {
        throw new ToolError("REQUIREMENT_INCOMPLETE", phrase("requirement_missing", language, { item, missing: missing.map((m) => MISSING_WORDS[m][language]).join(", ") }), {
          status: 400,
          details: { missing },
        });
      }
      const { jobId, already } = beginSourcing(ctx, requirement, language);
      if (already) return { jobId, already: true, say: phrase("sourcing_already", language) };
      return { jobId, requirementId: requirement.id, say: phrase("sourcing_started", language, { item }) };
    },
  },
  {
    name: "get_job_status",
    scopes: OWNER,
    description: "Status of a sourcing or negotiation job; without jobId, the one running now or else the latest.",
    inputSchema: ownerObj({ jobId: idArg("job", "the running or latest job") }),
    async handler(ctx, args, language) {
      let job;
      if (args.jobId) job = requireRow(repo.getJob(ctx.businessId, args.jobId), language);
      else {
        const all = repo.listJobs(ctx.businessId);
        job = all.filter((j) => j.status === "queued" || j.status === "running").at(-1) ?? all.at(-1);
        if (!job) return { jobId: null, status: "none", say: phrase("no_jobs", language) };
      }
      const progress = Array.isArray(job.progress) && job.progress.length ? job.progress[job.progress.length - 1] : null;
      let say;
      if (job.status === "queued") say = phrase("job_queued", language);
      else if (job.status === "running") {
        const found = job.kind === "sourcing" ? repo.listVendors(ctx.businessId, { requirement_id: job.requirement_id }).length : 0;
        say = job.kind !== "sourcing"
          ? phrase("job_running_negotiation", language)
          : found
            ? phrase("job_running_sourcing", language, { count: found })
            : phrase("sourcing_running_none", language);
      } else if (job.status === "done" && job.kind === "sourcing") {
        say = phrase("job_done_sourcing", language, { count: job.result?.count ?? 0, national: job.result?.scope === "national" });
        if (job.requirement_id) sourcingResultSpoken(ctx.businessId, job.requirement_id);
      } else if (job.status === "done") {
        say = negotiationOutcomeSay(job.result?.outcome, language);
      } else if (job.status === "cancelled") say = phrase("job_cancelled", language);
      else say = phrase("job_failed", language);
      return { jobId: job.id, kind: job.kind, status: job.status, progress, result: job.result ?? null, error: job.error ?? null, say };
    },
  },
  {
    name: "get_shortlist",
    scopes: OWNER,
    description:
      "The vendors found for the current requirement, best first, each with its rank (1 = best) and its price per the requirement unit when the listing allows one (comparablePrice).",
    inputSchema: ownerObj({ requirementId: idArg("requirement", "the latest requirement"), limit: { type: "integer", minimum: 1, maximum: 10 } }),
    async handler(ctx, args, language) {
      const requirement = currentRequirement(ctx, args.requirementId, language);
      const ranked = rankedVendors(ctx.businessId, requirement);
      const vendors = ranked.slice(0, args.limit ?? SHORTLIST_SIZE).map((v, i) => vendorSummary(v, requirement, i + 1));
      if (!ranked.length) return { requirementId: requirement.id, vendors, say: noVendors(ctx.businessId, requirement, language).say };
      if (latestJob(ctx.businessId, requirement.id, "sourcing")?.status === "done") sourcingResultSpoken(ctx.businessId, requirement.id);
      const unit = unitWord(requirement.unit, language);
      const comparable = ranked
        .map((vendor) => ({ vendor, price: comparableListedPrice(vendor, requirement.unit)?.value ?? null }))
        .filter((x) => x.price != null);
      const say = comparable.length
        ? phrase("shortlist", language, {
            count: ranked.length,
            comparable: comparable.length,
            name: comparable[0].vendor.name,
            city: cityIn(comparable[0].vendor.city, language),
            price: money(comparable[0].price),
            unit,
          })
        : phrase("shortlist_no_comparable", language, { count: ranked.length, name: ranked[0].name, unit });
      return { requirementId: requirement.id, vendors, say };
    },
  },
  {
    name: "start_negotiation",
    scopes: OWNER,
    description:
      "Starts a voice negotiation for the current requirement. Pick the vendor with vendorRank (1 = best, as get_shortlist ranks them) or leave both vendorRank and vendorId out to use the best-ranked vendor whose listing has a price per the requirement unit. counterpart 'simulated' (default) = a clearly labelled simulated vendor priced from that vendor's listing; 'human' = a real person joins by link. Returns a jobId at once.",
    inputSchema: ownerObj({
      requirementId: idArg("requirement", "the latest requirement"),
      vendorRank: { type: "integer", minimum: 1, maximum: 50, description: "Optional. The vendor's place in the shortlist, 1 = best." },
      vendorId: idArg("vendor", "vendorRank, or the best vendor with a comparable price"),
      counterpart: { type: "string", enum: ["simulated", "human"], description: "Default simulated." },
    }),
    async handler(ctx, args, language, { businessLanguage }) {
      const counterpart = args.counterpart ?? "simulated";
      let vendor = null;
      let requirement;
      if (args.vendorId) {
        vendor = requireRow(repo.getVendor(ctx.businessId, args.vendorId), language);
        requirement = args.requirementId ? currentRequirement(ctx, args.requirementId, language) : requireRow(repo.getRequirement(ctx.businessId, vendor.requirement_id), language);
        if (vendor.requirement_id !== requirement.id) throw new ToolError("NOT_FOUND", sayFor("not_found", language), { message: "That vendor was not found for this requirement." });
      } else {
        requirement = currentRequirement(ctx, args.requirementId, language);
      }
      const ranked = rankedVendors(ctx.businessId, requirement);
      if (!ranked.length) {
        const why = noVendors(ctx.businessId, requirement, language);
        throw new ToolError(why.code, why.say, { status: 409 });
      }
      const unit = unitWord(requirement.unit, language);
      const comparableAt = ranked.findIndex((v) => comparableListedPrice(v, requirement.unit));
      if (!vendor && args.vendorRank) {
        vendor = ranked[args.vendorRank - 1];
        if (!vendor) throw new ToolError("NOT_FOUND", phrase("rank_out_of_range", language, { count: ranked.length }), { status: 404 });
      }
      if (!vendor) {
        vendor = comparableAt >= 0 ? ranked[comparableAt] : counterpart === "human" ? ranked[0] : null;
        if (!vendor) throw new ToolError("NO_LISTED_PRICE", phrase("no_comparable_vendor", language, { unit }), { status: 409 });
      }
      if (counterpart === "simulated" && !comparableListedPrice(vendor, requirement.unit)) {
        throw new ToolError(
          "NO_LISTED_PRICE",
          comparableAt >= 0
            ? phrase("no_listed_price_try", language, { vendor: vendor.name, unit, rank: comparableAt + 1, alt: ranked[comparableAt].name })
            : phrase("no_comparable_vendor", language, { unit }),
          { status: 409, details: { suggestedRank: comparableAt >= 0 ? comparableAt + 1 : null } },
        );
      }
      const session = require("../negotiation/session");
      require("../agora/narrator").suppress(ctx.businessId, "job.started");
      const started = await session.startNegotiation({
        businessId: ctx.businessId,
        ownerSessionId: ctx.sessionId ?? null,
        requirementId: requirement.id,
        vendorId: vendor.id,
        counterpart,
        language: businessLanguage,
        sayLanguage: language,
      });
      const startedSay = counterpart === "human"
        ? phrase("negotiation_started_human", language)
        : phrase("negotiation_started_simulated", language, { vendor: vendor.name });
      // The owner hears when their own rule set the ceiling, and which figure it replaced.
      const cap = started.ceiling?.byRule
        ? ` ${phrase("negotiation_rule_cap", language, { price: money(started.ceiling.price), unit, owner: started.ceiling.ownerMax != null ? money(started.ceiling.ownerMax) : null })}`
        : "";
      const say = `${startedSay}${cap}`;
      return { ...started, vendorId: vendor.id, vendorName: vendor.name, vendorRank: ranked.findIndex((v) => v.id === vendor.id) + 1, counterpart, say };
    },
  },
  {
    name: "get_ranked_deals",
    scopes: OWNER,
    description:
      "All quotes for the current requirement ranked by landed cost (price x quantity + freight), best first, with reasons. When approvalCanFollow is true, `say` ends by asking whether to read the deal out for approval; if the owner says yes, call request_approval with no arguments (the server then reads the deal out itself).",
    inputSchema: ownerObj({ requirementId: idArg("requirement", "the latest requirement") }),
    async handler(ctx, args, language) {
      const requirement = currentRequirement(ctx, args.requirementId, language);
      const deals = rankedDeals(ctx.businessId, requirement.id);
      if (!deals.length) return { requirementId: requirement.id, deals, approvalCanFollow: false, say: noQuotes(ctx.businessId, requirement, language).say };
      const best = deals[0];
      if (best.status === "unrankable") return { requirementId: requirement.id, deals, approvalCanFollow: false, say: phrase("deal_none_rankable", language) };
      const sentence = phrase("deal_best", language, {
        vendor: best.vendorName,
        sim: best.simulated,
        price: money(best.unitPrice),
        unit: unitWord(best.unit, language),
        landed: best.landedCost != null ? money(best.landedCost) : null,
        goods: best.goodsCost != null ? money(best.goodsCost) : null,
      });
      // Ask only when request_approval with no arguments would put exactly this deal up
      // (defaultDeal): rankable, not tied for best, and not ordered already.
      const eligible = deals.filter((d) => d.status === "ranked" || d.status === "freight_unknown");
      const tied = eligible.filter((d) => d.status === best.status && dealCost(d) === dealCost(best)).length > 1;
      const ordered = repo.listOrders(ctx.businessId, { quote_id: best.quoteId }).length > 0;
      const approvalCanFollow = eligible[0] === best && !tied && !ordered;
      return {
        requirementId: requirement.id,
        deals,
        approvalCanFollow,
        say: approvalCanFollow ? `${sentence} ${phrase("deal_offer_approval", language)}` : sentence,
      };
    },
  },
  {
    name: "request_approval",
    scopes: OWNER,
    description:
      "Asks the owner to approve one deal; without quoteId, the best-ranked deal of the current requirement. Call it once per deal. In a call the server reads the deal out to the owner itself; you then say only `say` (a short question) and wait. The owner's yes or no to that question is answered with confirm_approval, never with request_approval again. Never repeat or paraphrase the figures. repeat: true only when the owner asks to hear the deal again.",
    inputSchema: ownerObj({
      quoteId: idArg("quote", "the best-ranked deal"),
      requirementId: idArg("requirement", "the latest requirement"),
      repeat: { type: "boolean", description: "Only when the owner asks to hear the deal again: the server reads it out once more." },
    }),
    async handler(ctx, args, language) {
      const quoteId = args.quoteId ?? defaultDeal(ctx, args, language).quoteId;
      const { approval, deal } = approvals.requestApproval(ctx.businessId, quoteId, { sessionId: ctx.sessionId ?? null });
      const readback = spokenReadback(ctx, quoteId, deal, language);
      const result = { approvalId: approval.id, quoteId, status: approval.status, totalAmount: approval.total_amount };
      // No call (or the deal is already approved): nothing can be answered by voice, so the model may read it out.
      if (!ctx.agentId || approval.status !== "pending") return { ...result, readback, say: readback };

      // Already read out in this call (in any language): asking again is not a reason to read it
      // again; the owner's answer belongs to confirm_approval (E2E r4: three read-backs for one yes).
      const readBefore = repo.listApprovalReadbacks(ctx.businessId, { approval_id: approval.id, agent_id: ctx.agentId }).length > 0;
      if (readBefore && !args.repeat) return awaitingAnswer(ctx, approval, result, language);

      await readOut(ctx, approval, readback, language);
      return { ...result, readbackSpoken: true, say: phrase("approval_question", language) };
    },
  },
  {
    name: "confirm_approval",
    scopes: OWNER,
    description:
      "Records the owner's spoken yes or no to the deal request_approval put up: call it, with no id, as soon as the owner answers that question (decision approve on a clear yes, reject on a no). Only one deal waits at a time. The server reads the owner's own words from the call and approves only on a clear yes to the deal it read out. On approve the server places the order and issues the purchase order itself and says the result aloud: do not call create_order after it; say only `say`.",
    inputSchema: ownerObj({ approvalId: idArg("approval", "the one approval waiting"), decision: { type: "string", enum: ["approve", "reject"] } }, ["decision"]),
    async handler(ctx, args, language) {
      let approval;
      if (args.approvalId) approval = requireRow(repo.getApproval(ctx.businessId, args.approvalId), language);
      else {
        // At most one pending approval per business (approvals.requestApproval + DB trigger).
        approval = repo.listApprovals(ctx.businessId, { status: "pending" })[0];
        if (!approval) throw new ToolError("NO_PENDING_APPROVAL", phrase("no_pending_approval", language), { status: 409 });
      }
      if (approval.status !== "pending") throw new ToolError("ALREADY_DECIDED", sayFor("already_decided", language), { details: { status: approval.status } });
      if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", sayFor("no_voice_evidence", language), { status: 409 });

      // The gate reads the owner's answer from this call's /history itself and ties it to the
      // read-back the server spoke (approvals.answerToReadback). /history can lag the transcript
      // by about 0.5 s, so an answer not there yet is looked for again.
      // Gate refusals map to a spoken line in errors.js CODE_MAP.
      let laterYes = false;
      let decided;
      try {
        decided = await withHistory(ctx, (history) => {
          try {
            return approvals.confirmApproval(ctx.businessId, approval.id, { decision: args.decision, via: "voice", agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null });
          } catch (err) {
            // Security review r2 #3: only the owner's FIRST spoken turn after the read-back, with
            // nothing else said or run in between, answers it. A clear yes that came later (after a
            // maybe, or after the model asked something else) is not consent to these figures, so the
            // server reads the deal out again and the owner's next yes answers exactly that.
            laterYes = args.decision === "approve" && REREAD_ON.has(err?.code) && approvals.isAffirmative(approvals.lastOwnerWords(history));
            throw err;
          }
        });
      } catch (err) {
        if (!laterYes) throw err;
        const deal = approvals.loadDeal(ctx.businessId, approval.quote_id);
        await readOut(ctx, approval, spokenReadback(ctx, approval.quote_id, deal, language), language);
        return { approvalId: approval.id, status: "pending", readbackSpoken: true, readAgain: true, refused: err.code, next: "confirm_approval on the owner's answer", say: phrase("approval_question", language) };
      }
      const result = { approvalId: decided.id, status: decided.status, evidenceUtterance: decided.evidence_utterance };
      if (decided.status !== "approved") return outcome.settle(ctx, phrase("approval_rejected", language), language, result);
      // The spoken yes IS the owner's approval: the server places the order now, exactly as the
      // Yes card's tick does (orders.placeApproved, same gate), instead of waiting for another
      // utterance and a create_order call (E2E full run, bug 3a). The PO number is said by the server.
      require("../agora/narrator").suppress(ctx.businessId, "order.created");
      let order;
      try {
        order = await orders.placeApproved(ctx.businessId, decided.id, { sessionId: ctx.sessionId ?? null });
      } catch (err) {
        const why = toToolError(err, language);
        return outcome.settle(ctx, `${phrase("approval_approved", language)} ${why.say}`, language, { ...result, orderId: null, orderError: why.code });
      }
      return outcome.settle(
        ctx,
        `${phrase("approval_approved", language)} ${phrase("order_created", language, { po: order.po_number, sim: Boolean(order.simulated) })}`,
        language,
        { ...result, orderId: order.id, poNumber: order.po_number, amount: order.amount, pdfUrl: `/api/orders/${encodeURIComponent(order.id)}/po.pdf`, next: "create_payment_link only if the owner asks to pay" },
      );
    },
  },
  {
    name: "create_order",
    scopes: OWNER,
    description:
      "Places the order for the approved deal and issues the purchase order (approvalId only if several are approved). Refused unless the owner approved this exact deal.",
    inputSchema: ownerObj({ approvalId: idArg("approval", "the one approved deal") }),
    async handler(ctx, args, language) {
      // confirm_approval already placed the order for the owner's spoken yes: asking again names it.
      const placed = args.approvalId ? null : justPlacedOrder(ctx.businessId);
      if (placed) {
        return { orderId: placed.id, poNumber: placed.po_number, amount: placed.amount, alreadyPlaced: true, say: phrase("order_created", language, { po: placed.po_number, sim: Boolean(placed.simulated) }) };
      }
      const approvalId = args.approvalId ?? defaultApprovalForOrder(ctx, language);
      require("../agora/narrator").suppress(ctx.businessId, "order.created");
      let order;
      try {
        // The gate: orders.createOrder -> approvals.assertApproved, for this exact approval and business.
        order = await orders.createOrder(ctx.businessId, approvalId, { sessionId: ctx.sessionId ?? null });
      } catch (err) {
        if (err?.code !== "PO_NOT_ISSUED" || !err.orderId) throw err;
        const placed = repo.getOrder(ctx.businessId, err.orderId);
        return { orderId: placed.id, poNumber: placed.po_number, pdfUrl: null, poIssued: false, say: sayFor("po_failed", language) };
      }
      return {
        orderId: order.id,
        poNumber: order.po_number,
        amount: order.amount,
        pdfUrl: `/api/orders/${encodeURIComponent(order.id)}/po.pdf`,
        poIssued: true,
        say: phrase("order_created", language, { po: order.po_number, sim: Boolean(order.simulated) }),
      };
    },
  },
  {
    name: "create_payment_link",
    scopes: OWNER,
    description:
      "Makes the Razorpay test-mode payment link (a Sahay pay page) for an order that was approved and placed. Call it whenever the owner asks for a payment link or to pay, with no arguments: it finds the business's most recent confirmed, unpaid order by itself, whatever requirement or call is current. Never ask which order. Only when the owner names a purchase order number, pass it as po_number exactly as said or typed (any script or spacing). Asking again returns the same link.",
    inputSchema: ownerObj({
      orderId: idArg("order", "the most recent confirmed, unpaid order"),
      po_number: { type: "string", minLength: 1, maxLength: 80, description: "Optional. A purchase order number the owner said or typed, as it was said (e.g. SAHAY/2026/6799-0001, or only 0001)." },
    }),
    async handler(ctx, args, language) {
      const ref = args.po_number ?? args.orderId;
      const orderId = ref ? orderForReference(ctx, ref, language) : defaultOrderForPayment(ctx, language);
      require("../agora/narrator").suppress(ctx.businessId, "payment.link");
      // The gate: payments.createPaymentLink -> approvals.assertOrderApproved.
      const link = await payments.createPaymentLink(ctx.businessId, orderId);
      return {
        orderId: link.orderId,
        poNumber: link.poNumber,
        url: link.url,
        amount: link.amount,
        currency: link.currency,
        testMode: true,
        existing: link.existing,
        say: phrase("payment_link", language, { po: link.poNumber }),
      };
    },
  },
  {
    name: "get_order_status",
    scopes: OWNER,
    description:
      "Status and payment state (pending or paid, whether a payment link exists) of the business's orders. With no arguments it covers the most recent orders, whatever requirement or call is current; orderId only for one specific order.",
    inputSchema: ownerObj({ orderId: idArg("order", "the most recent orders") }),
    async handler(ctx, args, language) {
      const all = args.orderId ? [requireRow(repo.getOrder(ctx.businessId, args.orderId), language)] : repo.listOrders(ctx.businessId);
      const list = all.slice(-RECENT_ORDERS).map((o) => ({
        orderId: o.id,
        poNumber: o.po_number,
        status: o.status,
        amount: o.amount,
        currency: o.currency,
        simulated: o.simulated,
        payment: paymentOf(ctx.businessId, o),
        pdfUrl: `/api/orders/${encodeURIComponent(o.id)}/po.pdf`,
      }));
      if (!list.length) return { orders: list, say: phrase("orders_empty", language) };
      const latest = list[list.length - 1];
      return {
        orders: list,
        say: phrase("order_status", language, {
          po: latest.poNumber,
          status: ORDER_STATUS_WORDS[latest.status]?.[language] ?? latest.status,
          payment: paymentClause(latest, latest.payment, language),
          more: all.length > 1,
          count: all.length,
        }),
      };
    },
  },

  /* ---- "My Sahay": rules the owner teaches by talking. None of them can order or approve. ---- */
  {
    name: "teach_rule",
    scopes: OWNER,
    description:
      "When the owner tells you how they like to buy, propose it as one rule: max_price (item, unit, price per unit in rupees), prefer_vendor (name), avoid_vendor (name), usual_quantity (item, quantity, unit), reply_language (language) or bargain_style (style gentle, balanced or tough). In a call the server reads the rule out itself; then say only `say` (a short question) and wait. The owner's yes or no is answered with confirm_rule. A rule never places an order or approves a deal.",
    inputSchema: ownerObj(
      {
        kind: { type: "string", enum: Object.keys(agentRules.KINDS) },
        item: { type: "string", maxLength: 200, description: "max_price, usual_quantity: the item in the owner's own words and script." },
        unit: { type: "string", maxLength: 40, description: `max_price, usual_quantity: the unit as the owner said it. Stored as one of: ${UNIT_CODES.join(", ")}.` },
        price: { type: "number", exclusiveMinimum: 0, description: "max_price: the most to pay per unit, in rupees." },
        quantity: { type: "number", exclusiveMinimum: 0, description: "usual_quantity: how much the owner usually buys." },
        name: { type: "string", maxLength: 200, description: "prefer_vendor, avoid_vendor: the vendor's name as the owner said it." },
        language: { type: "string", enum: LANGS, description: "reply_language: the language to always reply in." },
        style: { type: "string", enum: agentRules.BARGAIN_STYLES, description: "bargain_style: gentle, balanced or tough." },
      },
      ["kind"],
    ),
    async handler(ctx, args, language) {
      return askRule(ctx, { kind: args.kind, params: ruleParams(args) }, language, { question: phrase("rule_question", language), tap: phrase("rule_tap", language) });
    },
  },
  {
    name: "confirm_rule",
    scopes: OWNER,
    description:
      "Records the owner's spoken yes or no to the rule teach_rule just read out: call it, with no id, as soon as the owner answers (decision keep on a clear yes, forget on a no). The server checks the owner's own spoken words; a typed yes never keeps a rule (the owner taps the tick on the screen instead).",
    inputSchema: ownerObj({ ruleId: idArg("rule", "the rule read out last in this call"), decision: { type: "string", enum: ["keep", "forget"] } }, ["decision"]),
    async handler(ctx, args, language) {
      if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", phrase("rule_tap", language), { status: 409 });
      const rule = args.ruleId ? agentRules.get(ctx.businessId, args.ruleId) : agentRules.lastSpokenSuggestion(ctx.businessId, ctx.agentId);
      if (!rule) throw new ToolError("NO_SPOKEN_RULE", phrase("no_spoken_rule", language), { status: 409 });
      let decided;
      try {
        decided = await withHistory(ctx, (history) =>
          agentRules.decide(ctx.businessId, rule.id, args.decision, { via: "voice", agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null }),
        );
      } catch (err) {
        throw ruleRefusal(err, language);
      }
      return outcome.settle(ctx, phrase(decided.status === "active" ? "rule_kept" : "rule_forgotten", language), language, { ruleId: decided.id, status: decided.status });
    },
  },
  {
    name: "forget_rule",
    scopes: OWNER,
    description:
      "When the owner asks you to drop one of their rules: name it by kind and its item or vendor name (or ruleId from get_my_agent). Several matches are read out for the owner to choose.",
    inputSchema: ownerObj({
      ruleId: idArg("rule", "the rule named by kind, item or name"),
      kind: { type: "string", enum: Object.keys(agentRules.KINDS) },
      item: { type: "string", maxLength: 200 },
      name: { type: "string", maxLength: 200 },
    }),
    async handler(ctx, args, language) {
      if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", phrase("rule_tap", language), { status: 409 });
      const named = rulesNamed(ctx.businessId, args);
      if (!named.length) throw new ToolError("RULE_NOT_FOUND", phrase("rule_not_found", language), { status: 404 });
      if (named.length > 1) throw ambiguous(language, named.map((r) => r.sentence[language]));
      let decided;
      try {
        decided = await withHistory(ctx, (history) =>
          agentRules.decide(ctx.businessId, named[0].id, "forget", { via: "voice", agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null }),
        );
      } catch (err) {
        throw ruleRefusal(err, language);
      }
      return { ruleId: decided.id, status: decided.status, say: phrase("rule_forgotten", language) };
    },
  },
  {
    name: "get_my_agent",
    scopes: OWNER,
    description: "The owner's own Sahay: speaking speed, bargaining style, language, the rules in force (and any waiting for a yes) and what Sahay remembers from past orders.",
    inputSchema: ownerObj({}),
    async handler(ctx, args, language) {
      const rules = agentRules.list(ctx.businessId).filter((r) => r.status !== "off");
      const active = rules.filter((r) => r.status === "active");
      const say = active.length
        ? phrase("my_agent_rules", language, { count: active.length, list: active.slice(0, 3).map((r) => r.sentence[language]).join(" ") })
        : phrase("my_agent_empty", language);
      return { profile: agentProfile.get(ctx.businessId), rules, memories: agentMemories.list(ctx.businessId), say };
    },
  },

  /* ---- negotiation agent only: numbers come from strategy.js, the model only words them ---- */
  {
    name: "get_negotiation_brief",
    scopes: NEGOTIATION,
    description: "What you are buying and the exact opening line to say. Call once at the start.",
    inputSchema: obj({}),
    async handler(ctx) {
      return require("../negotiation/session").brief(ctx);
    },
  },
  {
    name: "record_vendor_offer",
    scopes: NEGOTIATION,
    description:
      "Call every time the vendor names a price. Records it and returns your next move (counter, accept or walk_away) with the exact sentence to say next in `say`.",
    inputSchema: obj(
      {
        price_per_unit: { type: "number", exclusiveMinimum: 0, description: "The vendor's price per unit in rupees, as they said it." },
        unit: { type: "string", maxLength: 40, description: "The unit the vendor's price is per, if they said one." },
        is_final: { type: "boolean", description: "True when the vendor says this is their final price." },
        freight: { type: "number", minimum: 0, description: "Freight in rupees for the whole order, only if the vendor said it." },
        lead_time_days: { type: "integer", minimum: 0, description: "Delivery time in days, only if the vendor said it." },
        vendor_sentence: { type: "string", maxLength: 500, description: "The vendor's sentence that named the price, word for word." },
      },
      ["price_per_unit"],
    ),
    async handler(ctx, args) {
      return require("../negotiation/session").recordVendorOffer(ctx, args);
    },
  },
];
TOOLS.push(...require("./stock")({ ownerObj, idArg, withHistory, unheardFields, askRule })); // STK: stock tools
TOOLS.push(...require("./sell")({ ownerObj, idArg, withHistory })); // SELL: add_customer, set_item, draft_invoice, request_invoice_approval, confirm_invoice
TOOLS.push(...require("./khata").TOOLS); // KHATA: record_payment, who_owes_me, send_payment_reminder

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Names of the tools a scope may call (for MCP allowed_tools). */
function toolNames(scope) {
  return TOOLS.filter((t) => t.scopes.includes(scope)).map((t) => t.name);
}

function toolsFor(scope) {
  return TOOLS.filter((t) => t.scopes.includes(scope));
}

/**
 * Run one tool. ctx must come from a verified bearer. Throws ToolError.
 * @param {{businessId: string, sessionId?: string|null, agentId?: string|null, actor?: string, toolScope: string}} ctx
 */
async function callTool(ctx, name, args = {}) {
  if (!ctx || typeof ctx.businessId !== "string" || !ctx.businessId) throw new ToolError("UNAUTHORIZED", sayFor("internal", "en-IN"), { status: 401 });
  const businessLanguage = languageOf(ctx.businessId);
  // `say` follows the language the owner just used; the business language is the fallback. An
  // owner's reply_language rule fixes it, whatever the model passes.
  const fixedLanguage = policy.replyLanguage(ctx.businessId);
  const modelLanguage = LANGS.includes(args?.reply_language) ? args.reply_language : null;
  let replyLanguage = fixedLanguage ?? modelLanguage;
  let language = replyLanguage ?? businessLanguage;
  const tool = BY_NAME.get(name);
  if (!tool || !tool.scopes.includes(ctx.toolScope)) {
    throw new ToolError("UNKNOWN_TOOL", sayFor("internal", language), { status: 404, message: `No tool ${name} for this agent.` });
  }
  args = normalizeArgs(tool.inputSchema, args);
  const problem = validateArgs(tool.inputSchema, args);
  // `details.problem` names the argument (never a value), so the model can correct its next call.
  if (problem) throw new ToolError("INVALID_ARGUMENTS", sayFor("invalid", language), { status: 400, message: problem, details: { problem } });
  let snapshot = null;
  if (!fixedLanguage && ctx.toolScope === SCOPES.owner) {
    // In a call the owner's own latest words decide, not the model's reply_language (src/agora/language.js).
    const heard = await require("../agora/language").resolveReplyLanguage(ctx, modelLanguage);
    if (heard.language) language = replyLanguage = heard.language;
    snapshot = heard.contents;
  }
  if (replyLanguage) require("../agora/narrator").useLanguage(ctx.businessId, replyLanguage);
  const end = toolCalls.begin(ctx.businessId, name, { answer: Boolean(args?.decision || args?.confirm) });
  try {
    // The tool's own first /history read reuses the one just made for the language (one round trip).
    return await require("../agora/agent").withHistorySnapshot(ctx.agentId, snapshot, () => tool.handler(ctx, args ?? {}, language, { businessLanguage }));
  } catch (err) {
    const toolError = toToolError(err, language);
    if (toolError.code === "INTERNAL" || toolError.status >= 500) {
      events.emit(ctx.businessId, "error", { code: toolError.code, message: toolError.message, say: toolError.say ?? null, tool: name }, { sessionId: ctx.sessionId ?? null, actor: "system" });
    }
    // The server already acted on this answer (src/agora/confirm-watch.js) and said the result:
    // the model's late call finds nothing waiting, and is told so instead of "there is nothing".
    if (NOTHING_WAITING.has(toolError.code) && require("../agora/confirm-watch").doneRecently(ctx.businessId, name)) {
      return { alreadyDone: true, by: "server", hint: outcome.SPOKEN_HINT, say: outcome.HAND_BACK[langKey(language)] };
    }
    throw toolError;
  } finally {
    end();
  }
}

module.exports = {
  knDative,
  TOOLS,
  SCOPES,
  callTool,
  toolNames,
  toolsFor,
  validateArgs,
  rankedDeals,
  runSourcing,
  phrase,
  spokenItem,
  money,
  SIM_LABEL,
  PHRASES,
  /** Word tables spliced into `say` lines, per group -> key -> language (for the native-script test). */
  SAY_WORDS: { missing: MISSING_WORDS, orderStatus: ORDER_STATUS_WORDS, payment: PAYMENT_WORDS, labels: { sim: SIM_LABEL, unnamedItem: UNNAMED_ITEM } },
};
