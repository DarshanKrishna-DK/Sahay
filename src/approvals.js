"use strict";

/**
 * The approval gate.
 *
 * An order, a rate acceptance or a payment link needs an approval row for that
 * exact deal and that business. The sentence the owner hears is built here from
 * database values, never by a model. A spoken approval is accepted only when the
 * owner's own words are a clear yes; anything else leaves the approval pending.
 */

const db = require("./db");
const events = require("./events");
const repo = require("./db/repo");

class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

/* -------------------------------------------------------------- units --- */

/** Units Sahay can compare and say aloud. `en` is [one, many]. */
const UNITS = {
  kg: { en: ["kg", "kg"], hi: "किलो", kn: "ಕೆಜಿ", names: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "किलो", "किलोग्राम", "ಕೆಜಿ", "ಕಿಲೋ"] },
  gram: { en: ["gram", "grams"], hi: "ग्राम", kn: "ಗ್ರಾಂ", names: ["g", "gm", "gms", "gram", "grams", "ग्राम", "ಗ್ರಾಂ"] },
  quintal: { en: ["quintal", "quintals"], hi: "क्विंटल", kn: "ಕ್ವಿಂಟಾಲ್", names: ["quintal", "quintals", "qtl", "क्विंटल", "ಕ್ವಿಂಟಾಲ್"] },
  tonne: { en: ["tonne", "tonnes"], hi: "टन", kn: "ಟನ್", names: ["ton", "tons", "tonne", "tonnes", "mt", "टन", "ಟನ್"] },
  litre: { en: ["litre", "litres"], hi: "लीटर", kn: "ಲೀಟರ್", names: ["l", "ltr", "litre", "litres", "liter", "liters", "लीटर", "ಲೀಟರ್"] },
  metre: { en: ["metre", "metres"], hi: "मीटर", kn: "ಮೀಟರ್", names: ["m", "mtr", "metre", "metres", "meter", "meters", "मीटर", "ಮೀಟರ್"] },
  piece: { en: ["piece", "pieces"], hi: "पीस", kn: "ಪೀಸ್", names: ["pc", "pcs", "piece", "pieces", "nos", "पीस", "नग", "ಪೀಸ್"] },
  bag: { en: ["bag", "bags"], hi: "बोरी", kn: "ಚೀಲ", names: ["bag", "bags", "बोरी", "बैग", "ಚೀಲ"] },
  box: { en: ["box", "boxes"], hi: "डिब्बा", kn: "ಬಾಕ್ಸ್", names: ["box", "boxes", "डिब्बा", "ಬಾಕ್ಸ್"] },
  packet: { en: ["packet", "packets"], hi: "पैकेट", kn: "ಪ್ಯಾಕೆಟ್", names: ["packet", "packets", "pkt", "पैकेट", "ಪ್ಯಾಕೆಟ್"] },
  dozen: { en: ["dozen", "dozen"], hi: "दर्जन", kn: "ಡಜನ್", names: ["dozen", "doz", "दर्जन", "ಡಜನ್"] },
};

const unitText = (unit) => String(unit ?? "").normalize("NFC").trim().toLowerCase().replace(/\.+$/, "");

const UNIT_BY_NAME = new Map(
  Object.entries(UNITS).flatMap(([key, unit]) => unit.names.map((name) => [unitText(name), key])),
);

/** The unit two quantities must share to be multiplied; an unknown unit is compared as written. */
function canonicalUnit(unit) {
  const text = unitText(unit);
  return UNIT_BY_NAME.get(text) ?? text;
}

function spokenUnit(unit, lang, quantity) {
  const known = UNITS[canonicalUnit(unit)];
  if (!known) return String(unit).trim();
  return lang === "en" ? known.en[quantity === 1 ? 0 : 1] : known[lang];
}

/* ----------------------------------------------------------- the deal --- */

const READBACK_LANGUAGES = { "en-IN": "en", "hi-IN": "hi", "kn-IN": "kn" };
const round2 = (n) => Math.round(n * 100) / 100;
const amountText = (n) => String(round2(n));

/**
 * Read the deal behind a quote from the database and check that it is complete
 * and consistent enough to put a figure in front of the owner.
 */
function loadDeal(businessId, quoteId) {
  const quote = repo.getQuote(businessId, quoteId);
  if (!quote) throw new ApprovalError("QUOTE_NOT_FOUND", "There is no such quote for this business.");
  const business = repo.getBusiness(businessId);
  const vendor = repo.getVendor(businessId, quote.vendor_id);
  const requirement = repo.getRequirement(businessId, quote.requirement_id);

  const language = READBACK_LANGUAGES[business.language];
  if (!language) {
    throw new ApprovalError("UNSUPPORTED_LANGUAGE", `Approvals can be read back in ${Object.keys(READBACK_LANGUAGES).join(", ")}, not ${business.language}.`);
  }
  if (!requirement.item || !requirement.quantity || !requirement.unit) {
    throw new ApprovalError("INCOMPLETE_DEAL", "The requirement needs an item, a quantity and a unit before a deal can be approved.");
  }
  if (!quote.unit || canonicalUnit(quote.unit) !== canonicalUnit(requirement.unit)) {
    throw new ApprovalError(
      "UNIT_MISMATCH",
      `The vendor quoted per "${quote.unit ?? "unknown unit"}" but the requirement is in "${requirement.unit}"; the total cannot be worked out.`,
    );
  }

  const goods = round2(quote.unit_price * requirement.quantity);
  const expected = round2(goods + (quote.freight ?? 0));
  if (quote.landed_cost != null && Math.abs(quote.landed_cost - expected) > 1) {
    throw new ApprovalError(
      "QUOTE_INCONSISTENT",
      "The landed cost stored on this quote no longer matches its price, the quantity and the freight. Re-rank the deals first.",
    );
  }

  return {
    quoteId: quote.id,
    language,
    vendorName: vendor.name,
    simulated: quote.simulated,
    item: requirement.item,
    quantity: requirement.quantity,
    unit: requirement.unit,
    unitPrice: quote.unit_price,
    goods,
    freight: quote.freight,
    total: round2(quote.landed_cost ?? expected),
    leadTimeDays: quote.lead_time_days,
  };
}

const READBACK = {
  en: (d, unit) => {
    const freight = d.freight == null ? "Freight is not quoted and is not in this total." : d.freight === 0 ? "No freight charge." : `Freight ${amountText(d.freight)} rupees.`;
    const lead = d.leadTimeDays == null ? "Delivery time is not confirmed." : d.leadTimeDays === 0 ? "Delivery the same day." : `Delivery in ${d.leadTimeDays} ${d.leadTimeDays === 1 ? "day" : "days"}.`;
    const vendor = d.simulated ? `${d.vendorName} (${repo.SIMULATED_LABEL}, not a real supplier)` : d.vendorName;
    return `Order from ${vendor}: ${amountText(d.quantity)} ${unit(d.quantity)} of ${d.item} at ${amountText(d.unitPrice)} rupees per ${unit(1)}. ${freight} Total ${amountText(d.total)} rupees. ${lead} Shall I confirm this order?`;
  },
  hi: (d, unit) => {
    const freight = d.freight == null ? "भाड़ा बताया नहीं गया है और इस कुल में शामिल नहीं है।" : d.freight === 0 ? "भाड़ा नहीं लगेगा।" : `भाड़ा ${amountText(d.freight)} रुपये।`;
    const lead = d.leadTimeDays == null ? "डिलीवरी का समय तय नहीं हुआ है।" : d.leadTimeDays === 0 ? "डिलीवरी उसी दिन।" : `डिलीवरी ${d.leadTimeDays} दिन में।`;
    const vendor = d.simulated ? `${d.vendorName} (सिम्युलेटेड वेंडर, असली विक्रेता नहीं)` : d.vendorName;
    return `${vendor} से ऑर्डर: ${amountText(d.quantity)} ${unit(d.quantity)} ${d.item}, ${amountText(d.unitPrice)} रुपये प्रति ${unit(1)} के भाव पर। ${freight} कुल ${amountText(d.total)} रुपये। ${lead} क्या मैं यह ऑर्डर पक्का करूँ?`;
  },
  kn: (d, unit) => {
    const freight = d.freight == null ? "ಸಾಗಣೆ ವೆಚ್ಚ ತಿಳಿಸಿಲ್ಲ, ಅದು ಈ ಒಟ್ಟು ಮೊತ್ತದಲ್ಲಿ ಸೇರಿಲ್ಲ." : d.freight === 0 ? "ಸಾಗಣೆ ವೆಚ್ಚ ಇಲ್ಲ." : `ಸಾಗಣೆ ವೆಚ್ಚ ${amountText(d.freight)} ರೂಪಾಯಿ.`;
    const lead = d.leadTimeDays == null ? "ಡೆಲಿವರಿ ಸಮಯ ಖಚಿತವಾಗಿಲ್ಲ." : d.leadTimeDays === 0 ? "ಅದೇ ದಿನ ಡೆಲಿವರಿ." : d.leadTimeDays === 1 ? "1 ದಿನದಲ್ಲಿ ಡೆಲಿವರಿ." : `${d.leadTimeDays} ದಿನಗಳಲ್ಲಿ ಡೆಲಿವರಿ.`;
    const vendor = d.simulated ? `${d.vendorName} (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್, ನಿಜವಾದ ಮಾರಾಟಗಾರ ಅಲ್ಲ)` : d.vendorName;
    return `${vendor} ಅವರಿಂದ ಆರ್ಡರ್: ${amountText(d.quantity)} ${unit(d.quantity)} ${d.item}, ಒಂದು ${unit(1)} ಬೆಲೆ ${amountText(d.unitPrice)} ರೂಪಾಯಿ. ${freight} ಒಟ್ಟು ${amountText(d.total)} ರೂಪಾಯಿ. ${lead} ಈ ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲೇ?`;
  },
};

/**
 * The money sentence: vendor, quantity, unit price, freight, landed total and
 * lead time, in the given language and its own script. Amounts are plain digits
 * so a speech engine reads them as numbers.
 */
function buildReadback(deal, language = deal.language) {
  const sentence = READBACK[language];
  if (!sentence) throw new ApprovalError("UNSUPPORTED_LANGUAGE", `No read-back wording for "${language}".`);
  return sentence(deal, (quantity) => spokenUnit(deal.unit, language, quantity));
}

/** True when a stored approval still describes the deal as the database has it now. */
function matchesDeal(approval, deal) {
  return approval.total_amount === deal.total && Object.keys(READBACK).some((language) => buildReadback(deal, language) === approval.readback);
}

/* ---------------------------------------------------- spoken consent --- */

const normalise = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‌‍़'’`]/g, "") // joiners, nukta, apostrophes
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

/** Phrases as token lists, longest first, so "जी हाँ" wins over "जी". */
const phrases = (list) =>
  list
    .map((phrase) => normalise(phrase).split(" "))
    .sort((a, b) => b.length - a.length);

const YES = phrases([
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "of course", "go ahead", "confirm", "confirmed", "approve", "approved",
  "proceed", "do it", "place the order", "place it", "book it", "agreed", "fine", "alright", "all right",
  "हाँ", "हां", "हा", "जी हाँ", "जी हां", "हाँ जी", "हां जी", "ठीक है", "ठीक", "कर दो", "कर दीजिए", "कर दीजिये", "कर दें", "करो", "कीजिए",
  "पक्का", "पक्का करो", "पक्का कर दो", "मंज़ूर", "मंज़ूर है", "बिल्कुल", "बिलकुल", "ज़रूर", "सही है", "चलेगा", "ओके", "यस", "कन्फर्म", "आगे बढ़ो",
  "haan", "han", "haa", "haanji", "ji haan", "ji han", "haan ji", "theek hai", "thik hai", "theek", "thik", "kar do", "kar dijiye",
  "kar den", "karo", "kijiye", "pakka", "manzoor", "manjoor", "bilkul", "zaroor", "jaroor", "sahi hai", "chalega",
  "ಹೌದು", "ಹೂಂ", "ಹೂ", "ಹಾಂ", "ಸರಿ", "ಆಯ್ತು", "ಆಯಿತು", "ಮಾಡಿ", "ಮಾಡು", "ಖಂಡಿತ", "ಓಕೆ", "ಒಪ್ಪಿಗೆ", "ಒಪ್ಪಿಗೆ ಇದೆ", "ಮುಂದುವರಿಸಿ",
  "ಖಚಿತಪಡಿಸಿ", "ಯೆಸ್", "ಆರ್ಡರ್ ಮಾಡಿ",
  "houdu", "haudu", "howdu", "sari", "aaytu", "aytu", "maadi", "khandita",
]);

const NO = phrases([
  "no", "not", "nope", "nah", "never", "dont", "do not", "cancel", "stop", "reject", "decline",
  "नहीं", "नही", "ना", "न", "मत", "रद्द", "कैंसिल", "nahi", "nahin", "nai", "na", "mat", "radd",
  "ಬೇಡ", "ಬೇಡಿ", "ಇಲ್ಲ", "ಅಲ್ಲ", "ರದ್ದು", "ನಿಲ್ಲಿಸಿ", "beda", "bedi", "illa", "alla",
]);

/** Words that may surround a yes without changing its meaning. Anything else makes the reply unclear. */
const FILLER = new Set(
  [
    "please", "the", "this", "that", "thats", "it", "its", "order", "deal", "and", "sahay", "with", "them", "then", "so", "well",
    "right", "now", "i", "we", "is", "for", "me", "a", "sir", "madam", "thanks",
    "जी", "भाई", "भैया", "सहाय", "ऑर्डर", "आर्डर", "यह", "ये", "इसे", "इसको", "तो", "अब", "फिर", "बस", "और", "ही", "है",
    "ji", "bhai", "bhaiya", "yeh", "ye", "isko", "ise", "to", "ab", "phir", "bas", "aur", "hi", "hai",
    "ಸಹಾಯ್", "ಆರ್ಡರ್", "ಇದನ್ನು", "ಅದನ್ನು", "ಈ", "ಸರ್", "ಸಾರ್", "ಅಣ್ಣ", "ಈಗ", "ರೀ",
  ].map(normalise),
);

/** Remove every occurrence of the phrases; returns how many were found and the tokens left over. */
function strip(tokens, list) {
  const rest = [];
  let found = 0;
  for (let i = 0; i < tokens.length; ) {
    const phrase = list.find((candidate) => candidate.every((token, k) => tokens[i + k] === token));
    if (phrase) {
      found += 1;
      i += phrase.length;
    } else {
      rest.push(tokens[i]);
      i += 1;
    }
  }
  return { found, rest };
}

/**
 * Classify what the owner said to the approval question, in English, Hindi or
 * Kannada (native script or romanised): "affirmative", "negative" or "unclear".
 * It is deliberately strict. A yes with a condition, a question, a number or
 * any word it does not know is "unclear", and the agent has to ask again.
 */
function classifyUtterance(text) {
  const tokens = normalise(text).split(" ").filter(Boolean);
  if (!tokens.length) return "unclear";
  if (strip(tokens, NO).found > 0) return "negative";
  if (String(text).includes("?")) return "unclear";
  const { found, rest } = strip(tokens, YES);
  return found > 0 && rest.every((token) => FILLER.has(token)) ? "affirmative" : "unclear";
}

const isAffirmative = (text) => classifyUtterance(text) === "affirmative";

/* ------------------------------------------------------------ the gate --- */

function summary(approval) {
  return {
    approvalId: approval.id,
    quoteId: approval.quote_id,
    status: approval.status,
    readback: approval.readback,
    totalAmount: approval.total_amount,
  };
}

/**
 * Ask for the owner's approval of one quote. Returns `{ approval, deal, created }`.
 * Asking again for an unchanged deal returns the approval that is already open
 * (pending, or approved and not yet used); if the deal has changed since, the
 * old approval is withdrawn and a new one is created.
 */
function requestApproval(businessId, quoteId, { sessionId = null } = {}) {
  return db.transaction(() => {
    const deal = loadDeal(businessId, quoteId);
    if (repo.listOrders(businessId, { quote_id: quoteId }).length) {
      throw new ApprovalError("ALREADY_ORDERED", "An order has already been placed for this quote.");
    }

    for (const open of repo.listApprovals(businessId, { quote_id: quoteId })) {
      if (open.status !== "pending" && open.status !== "approved") continue;
      if (matchesDeal(open, deal)) return { approval: open, deal, created: false };
      repo.withdrawApproval(businessId, open.id);
      events.emit(
        businessId,
        "approval.decided",
        { ...summary(open), status: "rejected", reason: "The deal changed after this approval was requested." },
        { sessionId, actor: "system" },
      );
    }

    const approval = repo.createApproval(businessId, { quote_id: quoteId, readback: buildReadback(deal), total_amount: deal.total });
    events.emit(businessId, "approval.requested", { ...summary(approval), language: deal.language }, { sessionId, actor: "agent" });
    return { approval, deal, created: true };
  });
}

/**
 * Record the owner's decision on a pending approval.
 * - via "button": the owner pressed approve or reject in the console.
 * - via "voice": `evidenceUtterance` is what the owner said, taken from the call
 *   history by the caller (never from the model). To approve it must be a clear
 *   yes; `evidenceAt`, when known, must not be earlier than the request.
 */
function confirmApproval(businessId, approvalId, { decision, via, evidenceUtterance, evidenceAt, sessionId = null } = {}) {
  if (decision !== "approve" && decision !== "reject") throw new ApprovalError("INVALID_DECISION", 'decision is "approve" or "reject".');
  if (via !== "voice" && via !== "button") throw new ApprovalError("INVALID_VIA", 'via is "voice" or "button".');

  return db.transaction(() => {
    const approval = repo.getApproval(businessId, approvalId);
    if (!approval) throw new ApprovalError("APPROVAL_NOT_FOUND", "There is no such approval for this business.");
    if (approval.status !== "pending") throw new ApprovalError("ALREADY_DECIDED", `This approval is already ${approval.status}.`);

    let utterance = null;
    if (via === "voice") {
      utterance = typeof evidenceUtterance === "string" ? evidenceUtterance.trim() : "";
      if (!utterance) throw new ApprovalError("EVIDENCE_REQUIRED", "A spoken decision needs the owner's words as evidence.");
      if (evidenceAt != null && !(new Date(evidenceAt).getTime() >= Date.parse(approval.requested_at))) {
        throw new ApprovalError("EVIDENCE_TOO_OLD", "Those words were said before this approval was requested.");
      }
      const said = classifyUtterance(utterance);
      if (decision === "approve" && said !== "affirmative") {
        throw new ApprovalError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes; the approval is still pending.");
      }
      if (decision === "reject" && said === "affirmative") {
        throw new ApprovalError("NOT_NEGATIVE", "The owner's reply was a yes; it cannot be recorded as a rejection.");
      }
    }

    if (decision === "approve" && !matchesDeal(approval, loadDeal(businessId, approval.quote_id))) {
      throw new ApprovalError("APPROVAL_STALE", "The deal changed after this approval was requested; ask for approval again.");
    }

    const status = decision === "approve" ? "approved" : "rejected";
    repo.decideApproval(businessId, approvalId, { status, decided_via: via, evidence_utterance: utterance });
    const decided = repo.getApproval(businessId, approvalId);
    events.emit(businessId, "approval.decided", { ...summary(decided), via, evidenceUtterance: utterance }, { sessionId, actor: "owner" });
    return decided;
  });
}

/**
 * The guard in front of every irreversible action. Returns `{ approval, deal }`
 * when this business has an approved, unused approval with that id and the deal
 * is still exactly the one that was approved; throws an ApprovalError otherwise.
 */
function assertApproved(businessId, approvalId) {
  const approval = repo.getApproval(businessId, approvalId);
  if (!approval) throw new ApprovalError("APPROVAL_NOT_FOUND", "There is no such approval for this business.");
  if (approval.status === "consumed") throw new ApprovalError("APPROVAL_CONSUMED", "This approval has already been used for an order.");
  if (approval.status !== "approved") throw new ApprovalError("NOT_APPROVED", `This approval is ${approval.status}, not approved.`);
  const deal = loadDeal(businessId, approval.quote_id);
  if (!matchesDeal(approval, deal)) {
    throw new ApprovalError("APPROVAL_STALE", "The deal changed after it was approved; ask for approval again.");
  }
  return { approval, deal };
}

/**
 * The guard for actions on an existing order (payment link): the order must
 * rest on a used approval of the same business for the same quote and amount.
 */
function assertOrderApproved(businessId, order) {
  const approval = repo.getApproval(businessId, order.approval_id);
  const sound = approval && approval.status === "consumed" && approval.quote_id === order.quote_id && approval.total_amount === order.amount;
  if (!sound) throw new ApprovalError("ORDER_NOT_APPROVED", "This order has no matching approval on record.");
  return approval;
}

module.exports = {
  ApprovalError,
  requestApproval, confirmApproval, assertApproved, assertOrderApproved,
  isAffirmative, classifyUtterance,
  buildReadback,
};
