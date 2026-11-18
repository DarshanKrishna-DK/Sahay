"use strict";

/**
 * The agent tools: one registry, used by the MCP server (owner and negotiation
 * agents) and by any server-side caller.
 *
 * `ctx = { businessId, sessionId, agentId, actor, toolScope }` is built ONLY from a
 * verified bearer (src/mcp-server.js) - never from tool arguments. Every result
 * the agent speaks carries `say`: one short sentence in the business language and
 * its own script, built here from stored data. Errors are ToolErrors with `say`.
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
const { scoreVendor, rankDeals } = require("../procurement/scoring");
const { normaliseUnit } = require("../procurement/landed-cost");
const { ToolError, toToolError, sayFor, langKey } = require("./errors");

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

const UNIT_WORDS = {
  kg: { "hi-IN": "किलो", "kn-IN": "ಕೆಜಿ", "en-IN": "kilogram" },
  g: { "hi-IN": "ग्राम", "kn-IN": "ಗ್ರಾಂ", "en-IN": "gram" },
  quintal: { "hi-IN": "क्विंटल", "kn-IN": "ಕ್ವಿಂಟಾಲ್", "en-IN": "quintal" },
  tonne: { "hi-IN": "टन", "kn-IN": "ಟನ್", "en-IN": "tonne" },
  litre: { "hi-IN": "लीटर", "kn-IN": "ಲೀಟರ್", "en-IN": "litre" },
  ml: { "hi-IN": "मिलीलीटर", "kn-IN": "ಮಿಲಿಲೀಟರ್", "en-IN": "millilitre" },
  metre: { "hi-IN": "मीटर", "kn-IN": "ಮೀಟರ್", "en-IN": "metre" },
  piece: { "hi-IN": "पीस", "kn-IN": "ಪೀಸ್", "en-IN": "piece" },
  bag: { "hi-IN": "बोरी", "kn-IN": "ಚೀಲ", "en-IN": "bag" },
  box: { "hi-IN": "डिब्बा", "kn-IN": "ಬಾಕ್ಸ್", "en-IN": "box" },
  pack: { "hi-IN": "पैक", "kn-IN": "ಪ್ಯಾಕ್", "en-IN": "pack" },
  packet: { "hi-IN": "पैकेट", "kn-IN": "ಪ್ಯಾಕೆಟ್", "en-IN": "packet" },
  dozen: { "hi-IN": "दर्जन", "kn-IN": "ಡಜನ್", "en-IN": "dozen" },
};

/** Unit names in Devanagari and Kannada script, mapped to landed-cost's canonical names. */
const NATIVE_UNITS = new Map(
  Object.entries(UNIT_WORDS).flatMap(([key, words]) => [[words["hi-IN"], key], [words["kn-IN"], key]]).concat([
    ["किलोग्राम", "kg"], ["ಕಿಲೋ", "kg"], ["नग", "piece"], ["बैग", "bag"], ["ಕೆಜಿ", "kg"],
  ]),
);

/** Canonical unit ("kg", "piece", ...) for English, Hindi or Kannada spellings; unknown units lower-cased. */
function canonicalUnit(unit) {
  if (unit == null) return null;
  const text = String(unit).normalize("NFC").trim();
  return normaliseUnit(NATIVE_UNITS.get(text) ?? text);
}

/** A unit as spoken; an unknown unit is said as written. English plural for many. */
function unitWord(unit, language, many = false) {
  if (!unit) return "";
  const word = UNIT_WORDS[canonicalUnit(unit)]?.[langKey(language)];
  if (!word) return String(unit).trim();
  return language === "en-IN" && many ? (word === "box" ? "boxes" : `${word}s`) : word;
}

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
  shortlist_empty: {
    "hi-IN": () => "अभी कोई विक्रेता नहीं मिला है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಮಾರಾಟಗಾರರೂ ಸಿಕ್ಕಿಲ್ಲ.",
    "en-IN": () => "No vendors have been found yet.",
  },
  shortlist: {
    "hi-IN": (v) => `${v.count} विक्रेता हैं; सबसे ऊपर ${v.name}${v.city ? `, ${v.city}` : ""}${v.price ? `, लिस्टिंग भाव ${v.price} रुपये प्रति ${v.unit}` : ", लिस्टिंग में भाव नहीं लिखा"}।`,
    "kn-IN": (v) => `${v.count} ಮಾರಾಟಗಾರರಿದ್ದಾರೆ; ಮೊದಲನೆಯವರು ${v.name}${v.city ? `, ${v.city}` : ""}${v.price ? `, ಪಟ್ಟಿಯ ಬೆಲೆ ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ` : ", ಪಟ್ಟಿಯಲ್ಲಿ ಬೆಲೆ ಇಲ್ಲ"}.`,
    "en-IN": (v) => `${v.count} vendors; the top one is ${v.name}${v.city ? ` in ${v.city}` : ""}${v.price ? `, listed at ${v.price} rupees per ${v.unit}` : ", with no price in the listing"}.`,
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

/** One sentence from the phrase book in the business language. */
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
const idArg = (what) => ({ type: "string", minLength: 1, maxLength: 64, description: `The ${what} id exactly as a tool returned it.` });

/* ------------------------------------------------------------ helpers --- */

function requireRow(row, language) {
  if (!row) throw new ToolError("NOT_FOUND", sayFor("not_found", language));
  return row;
}

const missingFields = (r) => ["item", "quantity", "unit", "city"].filter((field) => r[field] == null || r[field] === "");

function vendorSummary(v) {
  return {
    vendorId: v.id,
    name: v.name,
    city: v.city,
    kind: v.kind,
    simulated: v.simulated,
    listedPrice: v.listed_price,
    listedUnit: v.listed_unit,
    listedPriceText: v.listed_price_text,
    rating: v.rating,
    ratingCount: v.rating_count,
    score: v.score,
    sourceUrl: v.source_url,
  };
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
  const shortlist = repo.listVendors(businessId, { requirement_id: requirement.id }, { limit: SHORTLIST_SIZE }).map(vendorSummary);
  return {
    requirementId: requirement.id,
    count: repo.listVendors(businessId, { requirement_id: requirement.id }).length,
    category: source.category ?? null,
    scope: source.scope ?? null,
    sourceUrl: source.url ?? null,
    shortlist,
  };
}

/* -------------------------------------------------------------- tools --- */

const OWNER = [SCOPES.owner];
const NEGOTIATION = [SCOPES.negotiation];

const TOOLS = [
  {
    name: "get_business_profile",
    scopes: OWNER,
    description: "Returns this business's profile: name, owner, city, state and language.",
    inputSchema: obj({}),
    async handler(ctx) {
      const business = requireRow(repo.getBusiness(ctx.businessId), "en-IN");
      const { id, name, owner_name, city, state, language } = business;
      return { business: { id, name, owner_name, city, state, language }, say: phrase("profile", language, { name, city }) };
    },
  },
  {
    name: "save_requirement",
    scopes: OWNER,
    description:
      "Saves what the owner wants to buy. Call as soon as the item is known; call again with requirementId to fill in more details. Returns missing[] (fields still needed before sourcing).",
    inputSchema: obj(
      {
        requirementId: { ...idArg("requirement"), description: "Give it to update a requirement saved earlier in this call." },
        item: { type: "string", maxLength: 200, description: "The item as the owner named it, e.g. basmati chawal." },
        quantity: { type: "number", exclusiveMinimum: 0 },
        unit: { type: "string", maxLength: 40, description: "kg, quintal, tonne, litre, piece, bag, box ..." },
        city: { type: "string", maxLength: 80, description: "Delivery city." },
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
      let requirement;
      if (args.requirementId) {
        requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language);
        if (!Object.keys(fields).length) throw new ToolError("INVALID", sayFor("invalid", language), { message: "Nothing to update." });
        requirement = repo.updateRequirement(ctx.businessId, args.requirementId, fields);
      } else {
        if (!fields.item) throw new ToolError("INVALID", sayFor("invalid", language), { message: "item is required for a new requirement." });
        requirement = repo.createRequirement(ctx.businessId, { ...fields, session_id: ctx.sessionId ?? undefined });
      }
      events.emit(ctx.businessId, "requirement.saved", requirement, { sessionId: ctx.sessionId, actor: "agent" });
      const missing = missingFields(requirement);
      const say = missing.length
        ? phrase("requirement_missing", language, { item: requirement.item, missing: missing.map((m) => MISSING_WORDS[m][language]).join(", ") })
        : phrase("requirement_saved", language, {
            quantity: money(requirement.quantity),
            unit: unitWord(requirement.unit, language, requirement.quantity !== 1),
            item: requirement.item,
            city: requirement.city,
          });
      return { requirementId: requirement.id, requirement, missing, say };
    },
  },
  {
    name: "start_sourcing",
    scopes: OWNER,
    description: "Starts finding and scoring real vendors on IndiaMART for a saved requirement. Returns a jobId at once; progress is announced.",
    inputSchema: obj({ requirementId: idArg("requirement") }, ["requirementId"]),
    async handler(ctx, args, language) {
      const requirement = requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language);
      const missing = missingFields(requirement).filter((m) => m !== "city");
      if (missing.length) {
        throw new ToolError("REQUIREMENT_INCOMPLETE", phrase("requirement_missing", language, { item: requirement.item, missing: missing.map((m) => MISSING_WORDS[m][language]).join(", ") }), {
          status: 400,
          details: { missing },
        });
      }
      const active = repo.listJobs(ctx.businessId, { requirement_id: requirement.id, kind: "sourcing" }).find((j) => j.status === "queued" || j.status === "running");
      if (active) return { jobId: active.id, already: true, say: phrase("sourcing_already", language) };
      repo.updateRequirement(ctx.businessId, requirement.id, { status: "sourcing" });
      require("../agora/narrator").suppress(ctx.businessId, "job.started");
      const jobId = jobs.startJob(ctx.businessId, "sourcing", { requirementId: requirement.id }, runSourcing);
      return { jobId, say: phrase("sourcing_started", language, { item: requirement.item }) };
    },
  },
  {
    name: "get_job_status",
    scopes: OWNER,
    description: "Status of a sourcing or negotiation job.",
    inputSchema: obj({ jobId: idArg("job") }, ["jobId"]),
    async handler(ctx, args, language) {
      const job = requireRow(repo.getJob(ctx.businessId, args.jobId), language);
      const progress = Array.isArray(job.progress) && job.progress.length ? job.progress[job.progress.length - 1] : null;
      let say;
      if (job.status === "queued") say = phrase("job_queued", language);
      else if (job.status === "running") {
        say = job.kind === "sourcing"
          ? phrase("job_running_sourcing", language, { count: repo.listVendors(ctx.businessId, { requirement_id: job.requirement_id }).length })
          : phrase("job_running_negotiation", language);
      } else if (job.status === "done") {
        say = job.kind === "sourcing"
          ? phrase("job_done_sourcing", language, { count: job.result?.count ?? 0, national: job.result?.scope === "national" })
          : phrase("job_done_negotiation", language);
      } else if (job.status === "cancelled") say = phrase("job_cancelled", language);
      else say = phrase("job_failed", language);
      return { jobId: job.id, kind: job.kind, status: job.status, progress, result: job.result ?? null, error: job.error ?? null, say };
    },
  },
  {
    name: "get_shortlist",
    scopes: OWNER,
    description: "The best-scored vendors found for a requirement, best first.",
    inputSchema: obj({ requirementId: idArg("requirement"), limit: { type: "integer", minimum: 1, maximum: 10 } }, ["requirementId"]),
    async handler(ctx, args, language) {
      requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language);
      const all = repo.listVendors(ctx.businessId, { requirement_id: args.requirementId });
      const vendors = all.slice(0, args.limit ?? SHORTLIST_SIZE).map(vendorSummary);
      if (!vendors.length) return { vendors, say: phrase("shortlist_empty", language) };
      const top = vendors[0];
      return {
        vendors,
        say: phrase("shortlist", language, {
          count: all.length,
          name: top.name,
          city: top.city,
          price: top.listedPrice != null ? money(top.listedPrice) : null,
          unit: unitWord(top.listedUnit, language),
        }),
      };
    },
  },
  {
    name: "start_negotiation",
    scopes: OWNER,
    description:
      "Starts a voice negotiation for a requirement with one shortlisted vendor. counterpart 'simulated' = a clearly labelled simulated vendor priced from that vendor's listing; 'human' = a real person joins by link. Returns a jobId at once.",
    inputSchema: obj(
      { requirementId: idArg("requirement"), vendorId: idArg("vendor"), counterpart: { type: "string", enum: ["simulated", "human"] } },
      ["requirementId", "vendorId", "counterpart"],
    ),
    async handler(ctx, args, language) {
      const session = require("../negotiation/session");
      require("../agora/narrator").suppress(ctx.businessId, "job.started");
      const started = await session.startNegotiation({
        businessId: ctx.businessId,
        ownerSessionId: ctx.sessionId ?? null,
        requirementId: args.requirementId,
        vendorId: args.vendorId,
        counterpart: args.counterpart,
        language,
      });
      const vendor = repo.getVendor(ctx.businessId, args.vendorId);
      const say = args.counterpart === "human"
        ? phrase("negotiation_started_human", language)
        : phrase("negotiation_started_simulated", language, { vendor: vendor?.name ?? "" });
      return { ...started, say };
    },
  },
  {
    name: "get_ranked_deals",
    scopes: OWNER,
    description: "All quotes for a requirement ranked by landed cost (price x quantity + freight), best first, with reasons.",
    inputSchema: obj({ requirementId: idArg("requirement") }, ["requirementId"]),
    async handler(ctx, args, language) {
      const requirement = requireRow(repo.getRequirement(ctx.businessId, args.requirementId), language);
      const deals = rankedDeals(ctx.businessId, requirement.id);
      if (!deals.length) return { deals, say: phrase("deals_empty", language) };
      const best = deals[0];
      if (best.status === "unrankable") return { deals, say: phrase("deal_none_rankable", language) };
      return {
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
    description: "Asks the owner to approve one quote. Returns readback: speak it word for word, then wait for a yes or no.",
    inputSchema: obj({ quoteId: idArg("quote") }, ["quoteId"]),
    async handler(ctx, args) {
      const { approval } = approvals.requestApproval(ctx.businessId, args.quoteId, { sessionId: ctx.sessionId ?? null });
      return { approvalId: approval.id, status: approval.status, readback: approval.readback, totalAmount: approval.total_amount, say: approval.readback };
    },
  },
  {
    name: "confirm_approval",
    scopes: OWNER,
    description:
      "Records the owner's spoken decision on an approval. The server reads the owner's own last words from the call and approves only on a clear yes.",
    inputSchema: obj({ approvalId: idArg("approval"), decision: { type: "string", enum: ["approve", "reject"] } }, ["approvalId", "decision"]),
    async handler(ctx, args, language) {
      const approval = requireRow(repo.getApproval(ctx.businessId, args.approvalId), language);
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
    description: "Places the order for an approved deal and issues the purchase order. Refused unless the owner approved this exact deal.",
    inputSchema: obj({ approvalId: idArg("approval") }, ["approvalId"]),
    async handler(ctx, args, language) {
      require("../agora/narrator").suppress(ctx.businessId, "order.created");
      let order;
      try {
        order = await orders.createOrder(ctx.businessId, args.approvalId, { sessionId: ctx.sessionId ?? null });
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
    description: "Creates a Razorpay test-mode payment link for an order that exists and was approved.",
    inputSchema: obj({ orderId: idArg("order") }, ["orderId"]),
    async handler(ctx, args, language) {
      require("../agora/narrator").suppress(ctx.businessId, "payment.link");
      const link = await payments.createPaymentLink(ctx.businessId, args.orderId);
      return { orderId: link.orderId, url: link.url, amount: link.amount, currency: link.currency, testMode: true, say: phrase("payment_link", language) };
    },
  },
  {
    name: "get_order_status",
    scopes: OWNER,
    description: "Status of one order, or of all orders of this business when orderId is left out.",
    inputSchema: obj({ orderId: idArg("order") }),
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
  const language = languageOf(ctx.businessId);
  const tool = BY_NAME.get(name);
  if (!tool || !tool.scopes.includes(ctx.toolScope)) {
    throw new ToolError("UNKNOWN_TOOL", sayFor("internal", language), { status: 404, message: `No tool ${name} for this agent.` });
  }
  const problem = validateArgs(tool.inputSchema, args);
  if (problem) throw new ToolError("INVALID_ARGUMENTS", sayFor("invalid", language), { status: 400, message: problem });
  try {
    return await tool.handler(ctx, args ?? {}, language);
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
  unitWord,
  canonicalUnit,
  money,
  SIM_LABEL,
};
