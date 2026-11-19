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
 * "the current one" (latest requirement, best comparable vendor, best deal, the
 * one approval or order waiting). A default is never a guess between several
 * candidates: then the tool refuses with AMBIGUOUS and names the choices.
 *
 * Irreversible steps go through the business modules' own gates:
 * create_order -> orders.createOrder (approvals.assertApproved inside),
 * create_payment_link -> payments.createPaymentLink (assertOrderApproved inside).
 */

const repo = require("../db/repo");
const events = require("../events");
const jobs = require("../jobs");
const approvals = require("../approvals");
const orders = require("../orders");
const payments = require("../orders/payments");
const { findVendors } = require("../discovery/indiamart");
const { candidateSlugs, cityName } = require("../discovery/slug");
const { scoreVendor, rankDeals, rankVendors, comparableListedPrice } = require("../procurement/scoring");
const { canonicalUnit, unitWord, UNIT_CODES } = require("../procurement/units");
const { ToolError, toToolError, sayFor, langKey, LANGS } = require("./errors");

/** Which agent may call a tool. The bearer's sessions row kind decides the scope. */
const SCOPES = Object.freeze({ owner: "owner", negotiation: "negotiation" });

const SHORTLIST_SIZE = 5;
const DISCOVERY_LIMIT = 10;
const HISTORY_ATTEMPTS = 3;
const HISTORY_RETRY_MS = 600;

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

const MISSING_WORDS = {
  item: { "hi-IN": "क्या सामान चाहिए", "kn-IN": "ಯಾವ ವಸ್ತು ಬೇಕು", "en-IN": "which item" },
  quantity: { "hi-IN": "कितनी मात्रा", "kn-IN": "ಎಷ್ಟು ಪ್ರಮಾಣ", "en-IN": "how much" },
  unit: { "hi-IN": "किस इकाई में", "kn-IN": "ಯಾವ ಘಟಕದಲ್ಲಿ", "en-IN": "in which unit" },
  city: { "hi-IN": "किस शहर में डिलीवरी", "kn-IN": "ಯಾವ ನಗರಕ್ಕೆ ಡೆಲಿವರಿ", "en-IN": "delivery to which city" },
};

/** Phrase book. Each entry: (vars) => sentence, per language. */
const PHRASES = {
  profile: {
    "hi-IN": (v) => `यह ${v.name} का खाता है${v.city ? `, शहर ${v.city}` : ""}।`,
    "kn-IN": (v) => `ಇದು ${v.name} ಅವರ ಖಾತೆ${v.city ? `, ನಗರ ${v.city}` : ""}.`,
    "en-IN": (v) => `This is the account of ${v.name}${v.city ? ` in ${v.city}` : ""}.`,
  },
  requirement_saved: {
    "hi-IN": (v) => `ठीक है, ${v.quantity} ${v.unit} ${v.item} लिख लिया${v.city ? `, ${v.city} के लिए` : ""}।`,
    "kn-IN": (v) => `ಸರಿ, ${v.quantity} ${v.unit} ${v.item} ಬರೆದುಕೊಂಡೆ${v.city ? `, ${v.city}ಗೆ` : ""}.`,
    "en-IN": (v) => `Noted: ${v.quantity} ${v.unit} of ${v.item}${v.city ? ` for ${v.city}` : ""}.`,
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
  choice_order: {
    "hi-IN": (v) => `ऑर्डर ${v.po}`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po}`,
    "en-IN": (v) => `order ${v.po}`,
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
    "hi-IN": (v) => `ऑर्डर बन गया, खरीद आदेश नंबर ${v.po}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ಆಗಿದೆ, ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ ${v.po}.`,
    "en-IN": (v) => `The order is placed, purchase order number ${v.po}.`,
  },
  payment_link: {
    "hi-IN": () => "भुगतान का टेस्ट लिंक बन गया है, स्क्रीन पर दिख रहा है।",
    "kn-IN": () => "ಪಾವತಿಯ ಟೆಸ್ಟ್ ಲಿಂಕ್ ಸಿದ್ಧವಾಗಿದೆ, ಪರದೆಯ ಮೇಲೆ ಕಾಣುತ್ತಿದೆ.",
    "en-IN": () => "The test-mode payment link is ready and on the screen.",
  },
  orders_empty: {
    "hi-IN": () => "अभी कोई ऑर्डर नहीं है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಆರ್ಡರ್ ಇಲ್ಲ.",
    "en-IN": () => "There are no orders yet.",
  },
  order_status: {
    "hi-IN": (v) => `ऑर्डर ${v.po} ${v.status} है${v.more ? `, कुल ${v.count} ऑर्डर हैं` : ""}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po} ${v.status}${v.more ? `, ಒಟ್ಟು ${v.count} ಆರ್ಡರ್‌ಗಳಿವೆ` : ""}.`,
    "en-IN": (v) => `Order ${v.po} is ${v.status}${v.more ? `; there are ${v.count} orders in all` : ""}.`,
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

/** A script that would be read wrongly inside a sentence of this language. */
const FOREIGN_SCRIPT = {
  "en-IN": /[\p{Script=Devanagari}\p{Script=Kannada}]/u,
  "hi-IN": /\p{Script=Kannada}/u,
  "kn-IN": /\p{Script=Devanagari}/u,
};

/** Said when no rule can name the item in the sentence's own script. */
const UNNAMED_ITEM = { "hi-IN": "आपका बताया सामान", "kn-IN": "ನೀವು ಹೇಳಿದ ವಸ್ತು", "en-IN": "the requested item" };

/**
 * The item as said in a `language` sentence: the owner's own words when their script fits,
 * else the IndiaMART category found by sourcing ("Basmati Rice"), else the English trade
 * name the category rules derive ("basmati rice"), else a plain "the requested item":
 * a word in another script is never read out by this language's voice.
 */
function spokenItem(businessId, requirement, language) {
  const lang = langKey(language);
  const item = String(requirement.item ?? "");
  if (!FOREIGN_SCRIPT[lang].test(item)) return item;
  const category = sourcedCategory(businessId, requirement.id);
  if (category && !FOREIGN_SCRIPT[lang].test(category)) return category;
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

/** Vendors of a requirement, best first (scoring.rankVendors); the order vendorRank counts in. */
function rankedVendors(businessId, requirement) {
  return rankVendors(repo.listVendors(businessId, { requirement_id: requirement.id }), requirement);
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

/* ----------------------------------------------------- sourcing runner --- */

/** Identity of a listing, so a re-run does not store the same seller twice. */
const listingKey = (v) => (v.glusr_id ? `g:${v.glusr_id}` : `n:${String(v.name).toLowerCase()}|${v.phone ?? ""}`);

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

/** The order create_payment_link acts on: the one order still awaiting a link, else the latest order. */
function defaultOrderForPayment(ctx, language) {
  const all = repo.listOrders(ctx.businessId);
  if (!all.length) throw new ToolError("NO_ORDER", phrase("orders_empty", language), { status: 409 });
  const awaiting = all.filter((o) => o.status === orders.INITIAL_STATUS && !o.payment_link_url);
  if (awaiting.length > 1) throw ambiguous(language, awaiting.map((o) => phrase("choice_order", language, { po: o.po_number })));
  return (awaiting[0] ?? all.at(-1)).id;
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
      return { business: { id, name, owner_name, city, state, language: business.language }, say: phrase("profile", language, { name, city }) };
    },
  },
  {
    name: "save_requirement",
    scopes: OWNER,
    description:
      "Saves what the owner wants to buy. Call as soon as the item is known. To add details later, call it again without item and without any id: it updates the requirement saved in this call. Returns missing[] (fields still needed before sourcing). An item with no id starts a new requirement.",
    inputSchema: ownerObj(
      {
        requirementId: idArg("requirement", "the requirement saved in this call"),
        item: { type: "string", maxLength: 200, description: "The item as the owner named it, e.g. basmati chawal." },
        quantity: { type: "number", exclusiveMinimum: 0 },
        unit: { type: "string", maxLength: 40, description: `The unit as the owner said it (किलो, ಕಿಲೋ, kilos, pieces ...). Stored as one of: ${UNIT_CODES.join(", ")}.` },
        city: { type: "string", maxLength: 80, description: "Delivery city as the owner said it." },
        max_price_per_unit: { type: "number", exclusiveMinimum: 0, description: "Most the owner will pay per unit, in rupees." },
        target_price: { type: "number", exclusiveMinimum: 0, description: "Price per unit the owner hopes for, in rupees." },
        delivery_by: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" },
        notes: { type: "string", maxLength: 500 },
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

      let requirement;
      if (args.requirementId || !fields.item) {
        const target = args.requirementId
          ? requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language)
          : ctx.sessionId && repo.listRequirements(ctx.businessId).filter((r) => r.session_id === ctx.sessionId).at(-1);
        if (!target) throw new ToolError("INVALID", sayFor("invalid", language), { message: "item is required for a new requirement." });
        if (!Object.keys(fields).length) throw new ToolError("INVALID", sayFor("invalid", language), { message: "Nothing to update." });
        requirement = repo.updateRequirement(ctx.businessId, target.id, fields);
      } else {
        requirement = repo.createRequirement(ctx.businessId, { ...fields, session_id: ctx.sessionId ?? undefined });
      }
      events.emit(ctx.businessId, "requirement.saved", requirement, { sessionId: ctx.sessionId, actor: "agent" });
      const missing = missingFields(requirement);
      const item = spokenItem(ctx.businessId, requirement, language);
      const say = missing.length
        ? phrase("requirement_missing", language, { item, missing: missing.map((m) => MISSING_WORDS[m][language]).join(", ") })
        : phrase("requirement_saved", language, {
            quantity: money(requirement.quantity),
            unit: unitWord(requirement.unit, language, requirement.quantity !== 1),
            item,
            city: requirement.city,
          });
      return { requirementId: requirement.id, requirement, missing, say };
    },
  },
  {
    name: "start_sourcing",
    scopes: OWNER,
    description: "Starts finding and scoring real vendors on IndiaMART for the current requirement. Returns a jobId at once; progress is announced.",
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
      const active = repo.listJobs(ctx.businessId, { requirement_id: requirement.id, kind: "sourcing" }).find((j) => j.status === "queued" || j.status === "running");
      if (active) return { jobId: active.id, already: true, say: phrase("sourcing_already", language) };
      repo.updateRequirement(ctx.businessId, requirement.id, { status: "sourcing" });
      require("../agora/narrator").suppress(ctx.businessId, "job.started");
      const jobId = jobs.startJob(ctx.businessId, "sourcing", { requirementId: requirement.id }, runSourcing);
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
            city: comparable[0].vendor.city,
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
      const say = counterpart === "human"
        ? phrase("negotiation_started_human", language)
        : phrase("negotiation_started_simulated", language, { vendor: vendor.name });
      return { ...started, vendorId: vendor.id, vendorName: vendor.name, vendorRank: ranked.findIndex((v) => v.id === vendor.id) + 1, counterpart, say };
    },
  },
  {
    name: "get_ranked_deals",
    scopes: OWNER,
    description: "All quotes for the current requirement ranked by landed cost (price x quantity + freight), best first, with reasons.",
    inputSchema: ownerObj({ requirementId: idArg("requirement", "the latest requirement") }),
    async handler(ctx, args, language) {
      const requirement = currentRequirement(ctx, args.requirementId, language);
      const deals = rankedDeals(ctx.businessId, requirement.id);
      if (!deals.length) return { requirementId: requirement.id, deals, say: noQuotes(ctx.businessId, requirement, language).say };
      const best = deals[0];
      if (best.status === "unrankable") return { requirementId: requirement.id, deals, say: phrase("deal_none_rankable", language) };
      return {
        requirementId: requirement.id,
        deals,
        say: phrase("deal_best", language, {
          vendor: best.vendorName,
          sim: best.simulated,
          price: money(best.unitPrice),
          unit: unitWord(best.unit, language),
          landed: best.landedCost != null ? money(best.landedCost) : null,
          goods: best.goodsCost != null ? money(best.goodsCost) : null,
        }),
      };
    },
  },
  {
    name: "request_approval",
    scopes: OWNER,
    description:
      "Asks the owner to approve one deal; without quoteId, the best-ranked deal of the current requirement. Returns readback: speak it word for word, then wait for a yes or no.",
    inputSchema: ownerObj({ quoteId: idArg("quote", "the best-ranked deal"), requirementId: idArg("requirement", "the latest requirement") }),
    async handler(ctx, args, language) {
      const quoteId = args.quoteId ?? defaultDeal(ctx, args, language).quoteId;
      const { approval, deal } = approvals.requestApproval(ctx.businessId, quoteId, { sessionId: ctx.sessionId ?? null });
      // The stored read-back is in the business language; the spoken one follows the owner's language. Same figures,
      // and the item named in that language's script (the stored one keeps the owner's words).
      const requirement = repo.getRequirement(ctx.businessId, repo.getQuote(ctx.businessId, quoteId)?.requirement_id);
      const item = requirement ? spokenItem(ctx.businessId, requirement, language) : deal.item;
      const readback = approvals.buildReadback({ ...deal, item }, READBACK_LANGUAGE[language]);
      return { approvalId: approval.id, quoteId, status: approval.status, readback, totalAmount: approval.total_amount, say: readback };
    },
  },
  {
    name: "confirm_approval",
    scopes: OWNER,
    description:
      "Records the owner's spoken decision on the approval that is waiting (approvalId only if several are). The server reads the owner's own last words from the call and approves only on a clear yes.",
    inputSchema: ownerObj({ approvalId: idArg("approval", "the one approval waiting"), decision: { type: "string", enum: ["approve", "reject"] } }, ["decision"]),
    async handler(ctx, args, language) {
      let approval;
      if (args.approvalId) approval = requireRow(repo.getApproval(ctx.businessId, args.approvalId), language);
      else {
        const pending = repo.listApprovals(ctx.businessId, { status: "pending" });
        if (!pending.length) throw new ToolError("NO_PENDING_APPROVAL", phrase("no_pending_approval", language), { status: 409 });
        if (pending.length > 1) throw ambiguous(language, pending.map((a) => approvalChoice(ctx.businessId, a, language)));
        approval = pending[0];
      }
      if (approval.status !== "pending") throw new ToolError("ALREADY_DECIDED", sayFor("already_decided", language), { details: { status: approval.status } });
      if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", sayFor("no_voice_evidence", language), { status: 409 });

      const agent = require("../agora/agent");
      let heard = null;
      for (let attempt = 1; attempt <= HISTORY_ATTEMPTS; attempt++) {
        heard = agent.lastUserUtterance(await agent.history(ctx.agentId));
        // The answer must be newer than the question; /history can lag the transcript by about 0.5 s.
        if (heard && (!heard.at || heard.at >= approval.requested_at)) break;
        heard = null;
        if (attempt < HISTORY_ATTEMPTS) await sleep(HISTORY_RETRY_MS);
      }
      if (!heard) throw new ToolError("NO_VOICE_EVIDENCE", sayFor("not_affirmative", language), { status: 409 });
      if (args.decision === "approve" && !approvals.isAffirmative(heard.text)) {
        throw new ToolError("NOT_AFFIRMATIVE", sayFor("not_affirmative", language), { details: { heard: heard.text } });
      }
      const decided = approvals.confirmApproval(ctx.businessId, approval.id, {
        decision: args.decision,
        via: "voice",
        evidenceUtterance: heard.text,
        evidenceAt: heard.at,
        sessionId: ctx.sessionId ?? null,
      });
      return {
        approvalId: decided.id,
        status: decided.status,
        evidenceUtterance: heard.text,
        say: phrase(decided.status === "approved" ? "approval_approved" : "approval_rejected", language),
      };
    },
  },
  {
    name: "create_order",
    scopes: OWNER,
    description:
      "Places the order for the approved deal and issues the purchase order (approvalId only if several are approved). Refused unless the owner approved this exact deal.",
    inputSchema: ownerObj({ approvalId: idArg("approval", "the one approved deal") }),
    async handler(ctx, args, language) {
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
        say: phrase("order_created", language, { po: order.po_number }),
      };
    },
  },
  {
    name: "create_payment_link",
    scopes: OWNER,
    description: "Creates a Razorpay test-mode payment link for an order that exists and was approved (orderId only if several orders await payment).",
    inputSchema: ownerObj({ orderId: idArg("order", "the order awaiting payment") }),
    async handler(ctx, args, language) {
      const orderId = args.orderId ?? defaultOrderForPayment(ctx, language);
      require("../agora/narrator").suppress(ctx.businessId, "payment.link");
      // The gate: payments.createPaymentLink -> approvals.assertOrderApproved.
      const link = await payments.createPaymentLink(ctx.businessId, orderId);
      return { orderId: link.orderId, url: link.url, amount: link.amount, currency: link.currency, testMode: true, say: phrase("payment_link", language) };
    },
  },
  {
    name: "get_order_status",
    scopes: OWNER,
    description: "Status of one order, or of all orders of this business when orderId is left out.",
    inputSchema: ownerObj({ orderId: idArg("order", "all orders") }),
    async handler(ctx, args, language) {
      const rows = args.orderId ? [requireRow(repo.getOrder(ctx.businessId, args.orderId), language)] : repo.listOrders(ctx.businessId);
      const list = rows.map((o) => ({
        orderId: o.id,
        poNumber: o.po_number,
        status: o.status,
        amount: o.amount,
        currency: o.currency,
        simulated: o.simulated,
        paymentLinkUrl: o.payment_link_url ?? null,
        pdfUrl: `/api/orders/${encodeURIComponent(o.id)}/po.pdf`,
      }));
      if (!list.length) return { orders: list, say: phrase("orders_empty", language) };
      const latest = list[list.length - 1];
      return {
        orders: list,
        say: phrase("order_status", language, {
          po: latest.poNumber,
          status: ORDER_STATUS_WORDS[latest.status]?.[language] ?? latest.status,
          more: list.length > 1,
          count: list.length,
        }),
      };
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
  // `say` follows the language the owner just used; the business language is the fallback.
  const replyLanguage = LANGS.includes(args?.reply_language) ? args.reply_language : null;
  const language = replyLanguage ?? businessLanguage;
  const tool = BY_NAME.get(name);
  if (!tool || !tool.scopes.includes(ctx.toolScope)) {
    throw new ToolError("UNKNOWN_TOOL", sayFor("internal", language), { status: 404, message: `No tool ${name} for this agent.` });
  }
  const problem = validateArgs(tool.inputSchema, args);
  if (problem) throw new ToolError("INVALID_ARGUMENTS", sayFor("invalid", language), { status: 400, message: problem });
  if (replyLanguage) require("../agora/narrator").useLanguage(ctx.businessId, replyLanguage);
  try {
    return await tool.handler(ctx, args ?? {}, language, { businessLanguage });
  } catch (err) {
    const toolError = toToolError(err, language);
    if (toolError.code === "INTERNAL" || toolError.status >= 500) {
      events.emit(ctx.businessId, "error", { code: toolError.code, message: toolError.message, tool: name }, { sessionId: ctx.sessionId ?? null, actor: "system" });
    }
    throw toolError;
  }
}

module.exports = {
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
};
