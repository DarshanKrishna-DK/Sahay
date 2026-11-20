"use strict";

/**
 * The deal offer (live check after hardening, 2026-11-20). get_ranked_deals ends with "shall I read
 * this deal out for approval?" (approvalCanFollow). That question is not an approval: nothing waits
 * on it. When the owner's yes to it reached confirm_approval instead of request_approval, the gate
 * refused NO_PENDING_APPROVAL and the call stalled.
 *
 * This remembers, per business and call agent and for `settings.windowMs`, which deal was offered,
 * and reads from the call's /history whether the owner's latest spoken words are the first answer
 * to that offer line. confirm_approval then puts that same deal up through request_approval's own
 * path (the server reads it out and records the read-back). A yes to the offer approves nothing:
 * only the owner's next yes, to the read-back, goes through the gate (src/approvals.js).
 *
 * In memory: it describes this process's live calls only.
 */

const { isOwnerAsr } = require("../approvals");

const settings = { windowMs: 3 * 60 * 1000 };

/** `${businessId}\u0000${agentId}` -> { quoteId, requirementId, at } */
const offers = new Map();
const keyOf = (businessId, agentId) => `${businessId}\u0000${agentId}`;

/** get_ranked_deals offered this deal for approval in this call. */
function record(businessId, agentId, { quoteId, requirementId }, at = Date.now()) {
  if (!businessId || !agentId || !quoteId) return;
  for (const [key, offer] of offers) if (at - offer.at > settings.windowMs) offers.delete(key);
  offers.set(keyOf(businessId, agentId), { quoteId, requirementId: requirementId ?? null, at });
}

/** The deal offered in this call within the window, or null. */
function current(businessId, agentId, now = Date.now()) {
  if (!businessId || !agentId) return null;
  const key = keyOf(businessId, agentId);
  const offer = offers.get(key);
  if (!offer) return null;
  if (now - offer.at > settings.windowMs) {
    offers.delete(key);
    return null;
  }
  return { ...offer };
}

function clear(businessId, agentId) {
  offers.delete(keyOf(businessId, agentId));
}

class OfferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OfferError";
    this.code = code;
  }
}

const normalise = (text) => String(text ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
const isTyped = (item) => item?.role === "user" && item?.metadata?.source === "message";
const hasToolCalls = (item) => Array.isArray(item?.tool_calls) && item.tool_calls.length > 0;
const spokenLine = (item) => item?.role === "assistant" && typeof item.content === "string" && item.content.trim() !== "";

/**
 * The owner's answer to the offer, from the call's /history `contents`: the last assistant line
 * that carries one of `questions` (the offer, in any language), and the owner's first ASR turn
 * after it, which must also be the owner's latest. Between them nothing may stand: no other line,
 * no tool call or result, no typed message. Returns `{ text, turnId, index }`; throws OfferError
 * NO_ANSWER_YET (nothing spoken after the offer yet: /history may lag), NOT_OFFERED or NOT_FIRST_ANSWER.
 */
function answerToOffer(contents, questions) {
  if (!Array.isArray(contents)) throw new OfferError("NOT_OFFERED", "The call history is needed.");
  const wanted = questions.map(normalise).filter(Boolean);
  let offerAt = -1;
  for (let i = contents.length - 1; i >= 0 && offerAt < 0; i--) {
    const item = contents[i];
    if (spokenLine(item) && wanted.some((q) => normalise(item.content).includes(q))) offerAt = i;
  }
  if (offerAt < 0) throw new OfferError("NOT_OFFERED", "The deal was not offered in this call.");

  const answerAt = contents.findIndex((item, i) => i > offerAt && isOwnerAsr(item));
  if (answerAt < 0) throw new OfferError("NO_ANSWER_YET", "The owner has not answered the offer yet.");
  const intruder = (item) => spokenLine(item) || hasToolCalls(item) || item?.role === "tool" || isTyped(item);
  if (contents.slice(offerAt + 1, answerAt).some(intruder)) throw new OfferError("NOT_OFFERED", "Something else came after the offer.");
  if (contents.slice(answerAt + 1).some(isOwnerAsr)) throw new OfferError("NOT_FIRST_ANSWER", "The owner said more after answering the offer.");
  const said = contents[answerAt];
  return { text: said.content.trim(), turnId: said.turn_id, index: answerAt };
}

module.exports = { record, current, clear, answerToOffer, OfferError, settings };
