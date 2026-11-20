"use strict";

/**
 * The approval gate.
 *
 * An order, a rate acceptance or a payment link needs an approval row for that
 * exact deal and that business. The sentence the owner hears is built here from
 * database values, never by a model. A spoken approval is accepted only when the
 * owner's own words are a clear yes that answers the read-back the server itself
 * spoke into the call; anything else leaves the approval pending.
 */

const db = require("./db");
const events = require("./events");
const repo = require("./db/repo");
const { sameUnit, unitWord } = require("./procurement/units");
const { fitOnePiece } = require("./agora/speech-fit");

class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
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
  if (!quote.unit || !sameUnit(quote.unit, requirement.unit)) {
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

/**
 * The deal read-back, short enough for ONE /speak piece (src/agora/speech-fit.js; live check
 * 129a071: a two-piece read-back plus the model's own question went over Murf's 2 streams and the
 * call stalled). Vendor, the simulated-vendor label, quantity, item, price per unit, freight when
 * it changes the total, the landed total, delivery only when quoted, and the yes/no question.
 */
const READBACK = {
  en: (d, unit) => {
    const vendor = d.simulated ? `${d.vendorName} (${repo.SIMULATED_LABEL})` : d.vendorName;
    const freight = d.freight == null ? ", freight extra" : d.freight === 0 ? "" : `, freight ${amountText(d.freight)} rupees`;
    const lead = d.leadTimeDays == null ? "" : d.leadTimeDays === 0 ? ", delivery the same day" : `, delivery in ${d.leadTimeDays} ${d.leadTimeDays === 1 ? "day" : "days"}`;
    return `${vendor}: ${amountText(d.quantity)} ${unit(d.quantity)} of ${d.item} at ${amountText(d.unitPrice)} rupees per ${unit(1)}${freight}. Total ${amountText(d.total)} rupees${lead}. Shall I confirm this order?`;
  },
  hi: (d, unit) => {
    const vendor = d.simulated ? `${d.vendorName} (सिम्युलेटेड वेंडर)` : d.vendorName;
    const freight = d.freight == null ? ", भाड़ा अलग" : d.freight === 0 ? "" : `, भाड़ा ${amountText(d.freight)} रुपये`;
    const lead = d.leadTimeDays == null ? "" : d.leadTimeDays === 0 ? ", डिलीवरी उसी दिन" : `, डिलीवरी ${d.leadTimeDays} दिन में`;
    return `${vendor} से ${amountText(d.quantity)} ${unit(d.quantity)} ${d.item}, ${amountText(d.unitPrice)} रुपये प्रति ${unit(1)}${freight}। कुल ${amountText(d.total)} रुपये${lead}। क्या मैं यह ऑर्डर पक्का करूँ?`;
  },
  kn: (d, unit) => {
    const vendor = d.simulated ? `${d.vendorName} (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)` : d.vendorName;
    const freight = d.freight == null ? ", ಸಾಗಣೆ ವೆಚ್ಚ ಬೇರೆ" : d.freight === 0 ? "" : `, ಸಾಗಣೆ ${amountText(d.freight)} ರೂಪಾಯಿ`;
    const lead = d.leadTimeDays == null ? "" : d.leadTimeDays === 0 ? ", ಅದೇ ದಿನ ಡೆಲಿವರಿ" : `, ${d.leadTimeDays} ದಿನದಲ್ಲಿ ಡೆಲಿವರಿ`;
    return `${vendor} ಅವರಿಂದ ${amountText(d.quantity)} ${unit(d.quantity)} ${d.item}, ಒಂದು ${unit(1)}ಗೆ ${amountText(d.unitPrice)} ರೂಪಾಯಿ${freight}. ಒಟ್ಟು ${amountText(d.total)} ರೂಪಾಯಿ${lead}. ಈ ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲೇ?`;
  },
};

/**
 * The money sentence: vendor, quantity, unit price, freight, landed total and
 * lead time, in the given language and its own script. Amounts are plain digits
 * so a speech engine reads them as numbers. Always one /speak piece: a very long
 * vendor or item name is shortened word by word for speech (figures never are).
 */
function buildReadback(deal, language = deal.language) {
  const sentence = READBACK[language];
  if (!sentence) throw new ApprovalError("UNSUPPORTED_LANGUAGE", `No read-back wording for "${language}".`);
  const unit = (quantity) => unitWord(deal.unit, language, quantity !== 1, { short: true });
  return fitOnePiece((v) => sentence({ ...deal, vendorName: v.vendor, item: v.item }, unit), { vendor: deal.vendorName, item: deal.item }, ["vendor", "item"]);
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
  "हाँ", "हां", "जी हाँ", "जी हां", "हाँ जी", "हां जी", "ठीक है", "ठीक", "कर दो", "कर दीजिए", "कर दीजिये", "कर दें", "करो", "कीजिए",
  "पक्का", "पक्का करो", "पक्का कर दो", "मंज़ूर", "मंज़ूर है", "बिल्कुल", "बिलकुल", "ज़रूर", "सही है", "चलेगा", "ओके", "यस", "कन्फर्म", "आगे बढ़ो",
  "haan", "han", "haanji", "ji haan", "ji han", "haan ji", "theek hai", "thik hai", "theek", "thik", "kar do", "kar dijiye",
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

/** Tag particles that end a request ("कर दो ना"): neutral as the last word after a yes, a no anywhere else. */
const TAG = new Set(["ना", "na", "naa", "ನಾ"].map(normalise));

/** Short sounds that are a yes only when they are the entire reply. */
const WHOLE_REPLY_YES = new Set(["हा", "haa"].map(normalise));

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
  // "हाँ कर दो ना" / "haan kar do na" / "ಮಾಡಿ ನಾ": a trailing tag particle after a clear yes is emphasis,
  // not a no (security review r2 #6). Only the last word, and only when everything before it is a yes.
  const head = tokens.slice(0, -1);
  if (head.length && TAG.has(tokens.at(-1)) && !(head.length === 1 && WHOLE_REPLY_YES.has(head[0])) && classifyUtterance(head.join(" ")) === "affirmative") {
    return String(text).includes("?") ? "unclear" : "affirmative";
  }
  if (strip(tokens, NO).found > 0) return "negative";
  if (String(text).includes("?")) return "unclear";
  // "हा" / "haa" is a yes only as the whole reply; "हा हा" is laughter (security review r1 #8).
  if (tokens.length === 1 && WHOLE_REPLY_YES.has(tokens[0])) return "affirmative";
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

/* ------------------------------------------------- stale approvals --- */

/**
 * Live 2026-11-20: a deal put to the owner at 02:07 stayed in Needs-you for a day; at 18:58 the owner
 * tapped Yes and got APPROVAL_STALE ("the deal changed"), because its read-back no longer matched
 * the deal as the code builds it now. A waiting approval now expires (it is withdrawn: status
 * "rejected" with no decided_via, the same as when another deal replaces it) when:
 * - "deal_changed": its read-back no longer matches the deal (or the deal cannot be built);
 * - "too_old": nobody asked about it for APPROVAL_MAX_AGE_MS (since it was requested or last read out);
 * - "superseded": the owner has since started a new need for the same item.
 * Its audit row (approval.decided) carries `expired: <reason>`. Nothing is ever approved here.
 */
const APPROVAL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const itemKey = (text) =>
  String(text ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
const sameItem = (a, b) => {
  const x = itemKey(a);
  const y = itemKey(b);
  return Boolean(x && y) && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `));
};

/** Why a pending approval no longer stands, or null while it does. */
function staleReason(businessId, approval, now = Date.now()) {
  if (!approval || approval.status !== "pending") return null;
  let deal;
  try {
    deal = loadDeal(businessId, approval.quote_id);
  } catch {
    return "deal_changed";
  }
  if (!matchesDeal(approval, deal)) return "deal_changed";
  const lastAsked = Math.max(Date.parse(approval.requested_at), ...repo.listApprovalReadbacks(businessId, { approval_id: approval.id }).map((r) => Date.parse(r.spoken_at)).filter(Number.isFinite));
  if (now - lastAsked > APPROVAL_MAX_AGE_MS) return "too_old";
  const need = repo.getRequirement(businessId, repo.getQuote(businessId, approval.quote_id)?.requirement_id);
  if (need && repo.listRequirements(businessId).some((r) => r.id !== need.id && r.created_at >= approval.requested_at && sameItem(r.item, need.item))) return "superseded";
  return null;
}

const EXPIRED_TEXT = {
  deal_changed: "The deal changed after this approval was requested.",
  too_old: "Nobody answered this approval for six hours.",
  superseded: "A newer need for the same item replaced this one.",
};

/** Withdraw one stale pending approval. Returns its reason, or null when it still stands (or is not pending). */
function expireIfStale(businessId, approvalId, { now = Date.now(), sessionId = null } = {}) {
  return db.transaction(() => {
    const approval = repo.getApproval(businessId, approvalId);
    const reason = staleReason(businessId, approval, now);
    if (!reason || !repo.withdrawApproval(businessId, approval.id)) return null;
    events.emit(businessId, "approval.decided", { ...summary(approval), status: "rejected", expired: reason, reason: EXPIRED_TEXT[reason] }, { sessionId, actor: "system" });
    return reason;
  });
}

/** Expire every stale pending approval of a business. Returns [{approvalId, reason}]. */
function expireStale(businessId, options = {}) {
  return repo
    .listApprovals(businessId, { status: "pending" })
    .map((a) => ({ approvalId: a.id, reason: expireIfStale(businessId, a.id, options) }))
    .filter((x) => x.reason);
}

/** Every business (boot and the periodic sweep). Returns the number expired; never throws. */
function expireStaleAll(options = {}) {
  let count = 0;
  for (const { business_id: businessId } of db.prepare("SELECT DISTINCT business_id FROM approvals WHERE status = 'pending'").all()) {
    try {
      count += expireStale(businessId, options).length;
    } catch (err) {
      console.warn(`[approvals] could not check stale approvals of a business: ${err.message}`);
    }
  }
  return count;
}

let sweepTimer = null;
/** Expire stale approvals now and every `everyMs`. Returns stop(). */
function startExpiry({ everyMs = 10 * 60 * 1000 } = {}) {
  const expired = expireStaleAll();
  if (expired) console.warn(`[approvals] withdrew ${expired} stale approval(s) waiting for the owner.`);
  if (!sweepTimer) {
    sweepTimer = setInterval(() => expireStaleAll(), everyMs);
    sweepTimer.unref?.();
  }
  return () => {
    clearInterval(sweepTimer);
    sweepTimer = null;
  };
}

/**
 * Ask for the owner's approval of one quote. Returns `{ approval, deal, created }`.
 * Asking again for an unchanged deal returns the approval that is already open
 * (pending, or approved and not yet used); if the deal has changed since, the
 * old approval is withdrawn and a new one is created. Only one approval of a
 * business is pending at a time: putting up a deal withdraws any other deal that
 * is still waiting for the owner (DB trigger approvals_one_pending_per_business).
 */
function requestApproval(businessId, quoteId, { sessionId = null } = {}) {
  return db.transaction(() => {
    expireStale(businessId, { sessionId }); // a stale one waiting for the same quote is replaced, never re-read
    const deal = loadDeal(businessId, quoteId);
    if (repo.listOrders(businessId, { quote_id: quoteId }).length) {
      throw new ApprovalError("ALREADY_ORDERED", "An order has already been placed for this quote.");
    }
    const withdraw = (open, reason) => {
      repo.withdrawApproval(businessId, open.id);
      events.emit(businessId, "approval.decided", { ...summary(open), status: "rejected", reason }, { sessionId, actor: "system" });
    };

    let kept = null;
    for (const open of repo.listApprovals(businessId, { quote_id: quoteId })) {
      if (open.status !== "pending" && open.status !== "approved") continue;
      if (!kept && matchesDeal(open, deal)) kept = open;
      else withdraw(open, "The deal changed after this approval was requested.");
    }
    for (const other of repo.listApprovals(businessId, { status: "pending" })) {
      if (other.quote_id !== quoteId) withdraw(other, "Another deal was put to the owner for approval.");
    }
    if (kept) return { approval: kept, deal, created: false };

    const approval = repo.createApproval(businessId, { quote_id: quoteId, readback: buildReadback(deal), total_amount: deal.total });
    events.emit(businessId, "approval.requested", { ...summary(approval), language: deal.language }, { sessionId, actor: "agent" });
    return { approval, deal, created: true };
  });
}

/* ------------------------------------------- the read-back, as heard --- */

/**
 * The server spoke `text` (this approval's read-back) into the owner's call through
 * the agent `agentId`. Only a read-back recorded here can be answered by voice.
 */
function recordReadbackSpoken(businessId, approvalId, { agentId, text, sessionId = null }) {
  return db.transaction(() => {
    const approval = repo.getApproval(businessId, approvalId);
    if (!approval) throw new ApprovalError("APPROVAL_NOT_FOUND", "There is no such approval for this business.");
    if (approval.status !== "pending") throw new ApprovalError("ALREADY_DECIDED", `This approval is already ${approval.status}.`);
    const row = repo.recordApprovalReadback(businessId, approvalId, { agent_id: agentId, spoken_text: text });
    events.emit(businessId, "approval.spoken", { approvalId, quoteId: approval.quote_id, readback: row.spoken_text, spokenAt: row.spoken_at }, { sessionId, actor: "agent" });
    return row;
  });
}

/** Owner speech that ends before the read-back's audio by more than this is not an answer to it. */
const ANSWER_OVERLAP_MS = 500;

const collapse = (text) => String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const isServerLine = (item) => item?.role === "assistant" && item?.metadata?.source === "command" && typeof item.content === "string";
const isOwnerAsr = (item) => item?.role === "user" && item?.metadata?.source === "asr" && typeof item.content === "string" && item.content.trim() !== "";
/** A message the owner typed in the console (Agora /history source "message"): never an answer to a read-back. */
const isOwnerTyped = (item) => item?.role === "user" && item?.metadata?.source === "message" && typeof item.content === "string" && item.content.trim() !== "";

/** The pieces /speak sends for a text (agent.splitUtf8), each as /history shows it. */
function spokenPieces(text) {
  return require("./agora/agent").splitUtf8(text).map(collapse);
}

/**
 * The owner's answer to this approval's read-back, from the call's /history `contents`.
 * See answerAfterSpoken; the read-backs are the ones the server spoke for this approval.
 */
function answerToReadback(businessId, approval, contents, { agentId }) {
  const own = agentId ? repo.listApprovalReadbacks(businessId, { approval_id: approval.id, agent_id: agentId }) : [];
  return answerAfterSpoken(businessId, contents, { agentId, spoken: own.map((row) => row.spoken_text), subject: { approvalId: approval.id } });
}

/**
 * The owner's answer to something the server itself spoke into this call (an approval's read-back,
 * or a rule's sentence: src/agent/rules.js), from the call's /history `contents` (Agora keeps them
 * in turn order). `spoken` are the texts the server spoke for this subject through `agentId`;
 * `subject` ({approvalId} or {ruleId}) says which recorded read-backs are this one's own.
 * Fails closed:
 * - the server must have spoken it through this agent;
 * - every piece of it must be in the history as a server line, not interrupted;
 * - the answer is the owner's FIRST ASR turn after it (security review r2 #3), in array order AND
 *   by a larger numeric turn_id (an item without a turn_id cannot be ordered, so it is not
 *   evidence); a typed message before it means the owner's reply was typed (TYPED_ANSWER);
 * - nothing else may stand between the read-back and that turn: no tool call or result other than
 *   the subject's own asking or answering tool, and no assistant line (model, narrator, card) other
 *   than the subject's own short question (ASKED; `subject.kind`, or implied by approvalId/ruleId);
 * - when Agora gives both speech timings, the owner must not have spoken over it;
 * - no other question the server spoke (another approval or rule, a reorder, an invoice, an item's
 *   tax: every `*_readbacks` table) may have been spoken in between.
 * Returns `{ text, turnId, index }`; throws an ApprovalError otherwise.
 */
function answerAfterSpoken(businessId, contents, { agentId, spoken = [], subject = {} }) {
  if (!agentId || !spoken.length) throw new ApprovalError("READBACK_NOT_SPOKEN", "This was not read out to the owner in this call.");
  if (!Array.isArray(contents)) throw new ApprovalError("EVIDENCE_REQUIRED", "The call history is needed as evidence.");
  const readbacks = spoken.map(spokenPieces);

  const { anchor, pieces } = readbackEnd(contents, readbacks);
  if (anchor < 0) throw new ApprovalError("READBACK_NOT_HEARD", "The read-back is not in the call history.");
  const heard = [anchor];
  for (let p = pieces.length - 2, at = anchor; p >= 0; p--) {
    let found = -1;
    for (let i = at - 1; i >= 0 && found < 0; i--) if (isServerLine(contents[i]) && collapse(contents[i].content) === pieces[p]) found = i;
    if (found < 0) throw new ApprovalError("READBACK_NOT_HEARD", "Part of the read-back is missing from the call history.");
    heard.push(found);
    at = found;
  }
  if (heard.some((i) => contents[i].metadata?.interrupted)) {
    throw new ApprovalError("READBACK_NOT_HEARD", "The read-back was cut off before the owner heard all of it.");
  }

  // The answer is the owner's FIRST spoken turn after the read-back, never a later one (security
  // review r2 #3: a yes to a question the model asked afterwards must not approve this).
  let answerAt = -1;
  for (let i = anchor + 1; i < contents.length && answerAt < 0; i++) if (isOwnerAsr(contents[i])) answerAt = i;
  const between = contents.slice(anchor + 1, answerAt < 0 ? contents.length : answerAt);
  // A typed reply is the owner's words, but never consent: they press the card or say it aloud,
  // and they are told so instead of "I did not hear a clear yes" (final-2 E).
  if (between.some(isOwnerTyped)) throw new ApprovalError("TYPED_ANSWER", "A typed reply cannot answer a read-back; the owner must say it aloud or press the button.");
  const intruder = interveningItem(between, contents, subject);
  if (intruder) throw new ApprovalError("READBACK_SUPERSEDED", `Something else happened after this was read out (${intruder}).`);
  if (answerAt < 0) throw new ApprovalError("NO_ANSWER_YET", "The owner has not answered since the read-back.");

  const said = contents[answerAt];
  const read = contents[anchor];
  if (!Number.isFinite(said.turn_id) || !Number.isFinite(read.turn_id) || !(said.turn_id > read.turn_id)) {
    throw new ApprovalError("EVIDENCE_UNORDERED", "The call history does not show that the answer came after the read-back.");
  }
  if (Number.isFinite(read.speech_end_ms) && Number.isFinite(said.speech_start_ms) && said.speech_start_ms < read.speech_end_ms - ANSWER_OVERLAP_MS) {
    throw new ApprovalError("ANSWER_DURING_READBACK", "The owner spoke while the read-back was still playing.");
  }

  const own = new Set(readbacks.flat());
  const others = new Set(
    otherSpokenQuestions(businessId, subject)
      .flatMap(spokenPieces)
      .filter((piece) => !own.has(piece)),
  );
  for (let i = anchor + 1; i < answerAt; i++) {
    if (isServerLine(contents[i]) && others.has(collapse(contents[i].content))) {
      throw new ApprovalError("READBACK_SUPERSEDED", "Something else was read out after this one.");
    }
  }
  return { text: said.content.trim(), turnId: said.turn_id, index: answerAt };
}

/** Index of the last server line that ends one of `readbacks` (each a list of /speak pieces), and that read-back's pieces; anchor -1 when none. */
function readbackEnd(contents, readbacks) {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (!isServerLine(contents[i])) continue;
    const line = collapse(contents[i].content);
    const pieces = readbacks.find((p) => p[p.length - 1] === line);
    if (pieces) return { anchor: i, pieces };
  }
  return { anchor: -1, pieces: null };
}

/**
 * The owner's LATEST spoken turn after the read-back of `spoken` (the last one in this call), in
 * array and turn order, as `{ text, turnId, index }`; null when there is none. Not an answer and
 * never evidence for a decision (answerAfterSpoken binds only the first): the confirmation watchdog
 * uses it to see that a clear yes came after a first answer that was not one, and then has the
 * question read out again (src/agora/confirm-watch.js).
 */
function lastOwnerTurnAfterSpoken(contents, spoken = []) {
  if (!Array.isArray(contents) || !spoken.length) return null;
  const { anchor } = readbackEnd(contents, spoken.map(spokenPieces));
  if (anchor < 0) return null;
  for (let i = contents.length - 1; i > anchor; i--) {
    const item = contents[i];
    if (!isOwnerAsr(item)) continue;
    const read = contents[anchor];
    if (!Number.isFinite(item.turn_id) || !Number.isFinite(read.turn_id) || !(item.turn_id > read.turn_id)) return null;
    return { text: item.content.trim(), turnId: item.turn_id, index: i };
  }
  return null;
}

/** A lazily read phrase table entry in the three read-back languages. */
const allLanguages = (entry) => ["hi-IN", "kn-IN", "en-IN"].map((language) => entry[language]());

/**
 * What may stand between a read-back and the owner's answer, per kind of subject: the tools that ask
 * or answer this very question (their call and result items appear in /history around the read-back
 * the tool spoke), and the subject's own short question, which the model says from the tool's `say`.
 * Anything else (another tool, a narrator or card line, any other model sentence) means the owner's
 * next words may answer something else (security review r2 #3).
 */
const ASKED = {
  approval: { tools: ["request_approval", "confirm_approval"], questions: () => allLanguages(require("./tools/registry").PHRASES.approval_question) },
  rule: {
    // A rule's own sentence, a reorder level (set_reorder_level), or the usual quantity (save_requirement).
    tools: ["teach_rule", "set_reorder_level", "save_requirement", "confirm_rule"],
    questions: () => {
      const { PHRASES } = require("./tools/registry");
      return [...allLanguages(PHRASES.rule_question), ...allLanguages(PHRASES.usual_quantity_question), ...allLanguages(require("./stock/say").LINES.level_question)];
    },
  },
  invoice: { tools: ["request_invoice_approval", "confirm_invoice"], questions: () => allLanguages(require("./tools/sell").PHRASES.invoice_question) },
  receipt: { tools: ["record_payment"], questions: () => allLanguages(require("./tools/khata").PHRASES.payment_question) },
  reorder: { tools: ["confirm_reorder"], questions: () => [] },
  item_tax: { tools: ["set_item"], questions: () => allLanguages(require("./tools/sell").PHRASES.item_tax_question) },
};

/** The kind of a subject: given, or implied by its id. */
const kindOf = (subject) => subject.kind ?? (subject.approvalId ? "approval" : subject.ruleId ? "rule" : null);

/** A tool name as Agora's MCP client writes it ("<server>__<tool>"), without the server prefix. */
const bareTool = (name) => String(name ?? "").replace(/^[A-Za-z0-9]+__/, "");

/**
 * The first item between the read-back and the answer that is not allowed there, described for the
 * error message; null when there is none. Fails closed: an unknown tool result or role is an intruder.
 */
function interveningItem(between, contents, subject) {
  const asked = ASKED[kindOf(subject)] ?? { tools: [], questions: () => [] };
  const questions = new Set(asked.questions().map(normalise));
  const calls = new Map();
  for (const item of contents) for (const call of Array.isArray(item?.tool_calls) ? item.tool_calls : []) calls.set(call?.id, bareTool(call?.name ?? call?.function?.name));
  for (const item of between) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.tool_calls) && item.tool_calls.length) {
      const other = item.tool_calls.map((call) => bareTool(call?.name ?? call?.function?.name)).find((name) => !asked.tools.includes(name));
      if (other !== undefined) return `tool ${other}`;
    }
    if (item.role === "tool") {
      const name = calls.get(item.tool_call_id);
      if (!asked.tools.includes(name)) return `tool ${name ?? "result"}`;
      continue;
    }
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    if (item.role === "assistant" && questions.has(normalise(content))) continue;
    return `${item.role ?? "unknown"} line`;
  }
  return null;
}

/**
 * Every table of questions the server speaks into a call and waits on a yes for: a table named
 * `<subject>_readbacks` with business_id and spoken_text columns (approval, rule, reorder,
 * invoice, item tax, and any added later). Read from the schema, so a new kind of question can
 * never be forgotten here (coordinator security note: a yes to a reorder or invoice question must
 * not approve a deal that is still waiting, nor the other way round).
 */
function spokenQuestionTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%readbacks'")
    .all()
    .map((row) => row.name)
    .filter((name) => /^[a-z][a-z0-9_]*_readbacks$/.test(name))
    .filter((name) => {
      const columns = new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name));
      return columns.has("business_id") && columns.has("spoken_text");
    });
}

/**
 * The texts of every question the server spoke for this business except the subject being
 * answered (its own read-backs are also dropped piece by piece by the caller).
 */
function otherSpokenQuestions(businessId, subject = {}) {
  const texts = [];
  for (const table of spokenQuestionTables()) {
    let rows = db.prepare(`SELECT * FROM "${table}" WHERE business_id = ?`).all(businessId);
    if (table === "approval_readbacks" && subject.approvalId) rows = rows.filter((row) => row.approval_id !== subject.approvalId);
    if (table === "rule_readbacks" && subject.ruleId) rows = rows.filter((row) => row.rule_id !== subject.ruleId);
    for (const row of rows) if (typeof row.spoken_text === "string" && row.spoken_text.trim()) texts.push(row.spoken_text);
  }
  return texts;
}

/** The owner's last words in the call, for a spoken rejection (no read-back binding needed to say no). */
function lastOwnerWords(contents) {
  const item = Array.isArray(contents) ? contents.findLast(isOwnerAsr) : null;
  return item ? item.content.trim() : "";
}

/**
 * Record the owner's decision on a pending approval.
 * - via "button": the owner pressed approve or reject in the console, where the
 *   read-back is on screen.
 * - via "voice": `history` is the call's Agora /history contents, fetched by the
 *   caller from `agentId` (never words from the model). An approval needs a clear
 *   yes that answers the read-back the server spoke (answerToReadback); a
 *   rejection needs the owner's last words not to be a yes.
 */
function confirmApproval(businessId, approvalId, { decision, via, agentId = null, history, sessionId = null } = {}) {
  if (decision !== "approve" && decision !== "reject") throw new ApprovalError("INVALID_DECISION", 'decision is "approve" or "reject".');
  if (via !== "voice" && via !== "button") throw new ApprovalError("INVALID_VIA", 'via is "voice" or "button".');
  // A yes to a deal that no longer stands is never taken: the approval is withdrawn and the owner told to bargain again.
  if (decision === "approve") {
    const current = repo.getApproval(businessId, approvalId);
    // Withdrawn by the server already (a screen opened before the sweep): the same clear line, not "already rejected".
    const reason = via === "button" && current?.status === "rejected" && !current.decided_via ? "withdrawn" : expireIfStale(businessId, approvalId, { sessionId });
    if (reason) {
      const err = new ApprovalError("APPROVAL_EXPIRED", "This deal is old. Ask Sahay to bargain again.");
      err.details = { reason };
      throw err;
    }
  }

  return db.transaction(() => {
    const approval = repo.getApproval(businessId, approvalId);
    if (!approval) throw new ApprovalError("APPROVAL_NOT_FOUND", "There is no such approval for this business.");
    if (approval.status !== "pending") throw new ApprovalError("ALREADY_DECIDED", `This approval is already ${approval.status}.`);

    let utterance = null;
    if (via === "voice") {
      utterance = decision === "approve" ? answerToReadback(businessId, approval, history, { agentId }).text : lastOwnerWords(history);
      if (!utterance) throw new ApprovalError("EVIDENCE_REQUIRED", "A spoken decision needs the owner's words as evidence.");
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
  requestApproval, recordReadbackSpoken, confirmApproval, assertApproved, assertOrderApproved,
  answerToReadback, answerAfterSpoken, lastOwnerTurnAfterSpoken, lastOwnerWords, isAffirmative, classifyUtterance, isOwnerAsr, spokenQuestionTables,
  buildReadback, loadDeal,
  staleReason, expireIfStale, expireStale, expireStaleAll, startExpiry, APPROVAL_MAX_AGE_MS,
};
