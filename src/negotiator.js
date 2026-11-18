const groq = require("./groq");
const db = require("./db");
const { getChannel } = require("./channels");
const { config } = require("./config");
const { toPlainText } = require("./text");

/**
 * The negotiation agent.
 *
 * It runs the same six-question conversation a buyer would run - rate, MOQ,
 * lead time, delivery, payment terms, one polite push on price - and it is
 * bound by three rules that are not configurable:
 *
 *   1. It discloses that it is an automated assistant, in its first sentence.
 *   2. It never commits to an order. Only the owner does that.
 *   3. It never quotes one vendor's price to another.
 *
 * Everything it learns is written to a transcript, and every term in the final
 * quote is extracted from that transcript with a confidence score - so a rate
 * that reaches a purchase order can always be traced to the sentence in which
 * the vendor said it.
 */

const OBJECTIVES = [
  "confirm the vendor supplies the material and grade wanted",
  "get the rate for the buyer's quantity",
  "get the minimum order quantity",
  "get the lead time",
  "get delivery terms, including whether freight is included and to which city",
  "get payment terms",
  "make one polite attempt to improve the rate toward the buyer's target",
];

function brief(business, rfq, vendor) {
  return [
    `You are a procurement assistant calling ${vendor.name} on behalf of ${business.name}, a ${business.category || "small business"} in ${business.city || ""} ${business.state || "India"}.`,
    "",
    "REQUIREMENT",
    `- Material: ${rfq.material}`,
    `- Quantity: ${rfq.quantity ?? "not fixed"} ${rfq.unit || ""}`,
    `- Target price: ${rfq.target_price ? `₹${rfq.target_price} per ${rfq.unit || "unit"}` : "not stated - find out their rate"}`,
    `- Deliver to: ${rfq.delivery_city || "buyer's city"}`,
    rfq.needed_by ? `- Needed by: ${rfq.needed_by}` : "- No hard deadline",
    rfq.quality_notes ? `- Quality notes: ${rfq.quality_notes}` : "",
    vendor.listed_price ? `- Their listed rate online is ${vendor.listed_price_text || vendor.listed_price}. Treat it as indicative only.` : "",
    "",
    "WHAT YOU MUST ACHIEVE, in roughly this order:",
    ...OBJECTIVES.map((o, i) => `${i + 1}. ${o}`),
    "",
    "HARD RULES",
    "- Your FIRST message must state that you are an automated assistant calling on behalf of the buyer, and name the buyer. This is mandatory.",
    "- Never agree to place an order, sign anything, or confirm a purchase. If pushed, say the owner will confirm.",
    "- Never mention another supplier's name or price.",
    "- Never invent a detail about the buyer you were not given.",
    "- If the vendor asks not to be contacted again, acknowledge politely and end the call.",
    "",
    "STYLE",
    "- You are on a phone call. One short turn at a time - two or three sentences at most.",
    "- Ask ONE question per turn. Do not stack questions.",
    "- Be warm, direct and businesslike, the way a trade buyer speaks. No corporate padding.",
    "- Plain speech only: no markdown, no bullet points, no lists. This will be read aloud.",
    "- When you have everything, thank them, say the owner will review and revert, and end.",
  ].filter(Boolean).join("\n");
}

/** The agent's next spoken turn, plus whether it thinks the call is done. */
async function nextTurn(business, rfq, vendor, history) {
  const out = await groq.chatJSON([
    { role: "system", content: `${brief(business, rfq, vendor)}\n\nReturn ONLY JSON: {"say":"your next spoken turn","done":true|false,"reason":"why you are ending, if done"}. Set done=true only once you have the rate and have thanked them, or the vendor has refused or ended the conversation.` },
    {
      role: "user",
      content: history.length
        ? `Conversation so far:\n${history.map((h) => `${h.speaker === "agent" ? "You" : vendor.name}: ${h.text}`).join("\n")}\n\nYour next turn:`
        : "Begin the call. Remember: your first sentence must disclose that you are an automated assistant calling on behalf of the buyer.",
    },
  ], { temperature: 0.4, maxTokens: 400 });

  return { say: toPlainText(out.say || ""), done: !!out.done, reason: out.reason || null };
}

/**
 * Read the finished transcript and pull out the deal.
 * Every field carries a confidence, and anything the vendor did not actually
 * say stays null - a purchase order must never contain a guessed rate.
 */
async function extractQuote(rfq, vendor, history) {
  return groq.chatJSON([
    {
      role: "system",
      content:
        "You extract the commercial terms a supplier agreed to during a recorded procurement call. " +
        'Return ONLY JSON: {"rate":number|null,"rate_text":"","unit":"","moq":""|null,"moq_value":number|null,' +
        '"lead_time_days":number|null,"lead_time_text":""|null,"delivery_terms":""|null,"freight":number|null,' +
        '"payment_terms":""|null,"confidence":0-1,"caveat":""|null,"quoted_sentence":"the vendor sentence stating the rate",' +
        '"refused":true|false,"do_not_contact":true|false}. ' +
        "Only record what the VENDOR actually said. If they never gave a rate, rate must be null and confidence 0. " +
        "freight is a separate delivery charge in rupees if one was quoted, else null. " +
        "Set do_not_contact true only if the vendor explicitly asked not to be contacted again.",
    },
    {
      role: "user",
      content: `Requirement: ${rfq.quantity ?? "?"} ${rfq.unit || ""} of ${rfq.material} to ${rfq.delivery_city || "buyer"}.\n` +
        `Vendor: ${vendor.name}\n\nTranscript:\n${history.map((h) => `${h.speaker === "agent" ? "Agent" : "Vendor"}: ${h.text}`).join("\n")}`,
    },
  ], { temperature: 0.1, maxTokens: 900 });
}

/**
 * Run one full negotiation against one vendor.
 * Returns the persisted quote, or null when the vendor gave no usable rate.
 */
async function negotiate(business, rfq, vendor, { channel: channelName, language, emit = () => {} } = {}) {
  const name = channelName || config.procurement.channel;
  const lang = language || business.language || "hi-IN";
  const negotiationId = db.startNegotiation({
    business_id: business.id, rfq_id: rfq.id, vendor_id: vendor.id, channel: name, language: lang,
  });

  if (vendor.do_not_call) {
    db.endNegotiation(negotiationId, "skipped", 0, "Vendor is on the do-not-call list.");
    return null;
  }

  const history = [];
  let turn = 0;

  const record = ({ speaker, text, textLocal }) => {
    turn += 1;
    history.push({ speaker, text });
    db.addTranscriptLine(negotiationId, turn, speaker, text, textLocal);
    emit({ phase: "negotiating", vendor: vendor.name, speaker, text });
  };

  let session;
  try {
    session = getChannel(name).create({
      target: vendor.phone, language: lang, vendorName: vendor.name, onTurn: record,
    });
    await session.open();
  } catch (err) {
    db.endNegotiation(negotiationId, "unreachable", 0, err.message);
    db.audit(business.id, "negotiation_unreachable", { vendor: vendor.name, error: err.message });
    emit({ phase: "negotiation_failed", vendor: vendor.name, error: err.message });
    return null;
  }

  let ended = "completed";
  try {
    for (let i = 0; i < config.procurement.maxNegotiationTurns; i++) {
      const { say, done } = await nextTurn(business, rfq, vendor, history);
      if (!say) break;
      await session.speak(say, lang);
      if (done) break;

      const reply = await session.listen();
      if (reply === null) { ended = "no_answer"; break; }
      if (reply.empty) continue;
    }
  } catch (err) {
    ended = "failed";
    db.endNegotiation(negotiationId, "failed", turn, err.message);
    db.audit(business.id, "negotiation_failed", { vendor: vendor.name, error: err.message });
    await session.close().catch(() => {});
    emit({ phase: "negotiation_failed", vendor: vendor.name, error: err.message });
    return null;
  }

  await session.close().catch(() => {});

  // Nothing was said back - there is no quote to extract, and inventing one
  // would be the single worst thing this system could do.
  const vendorSpoke = history.some((h) => h.speaker === "vendor");
  if (!vendorSpoke) {
    db.endNegotiation(negotiationId, ended === "completed" ? "no_answer" : ended, turn, "Vendor did not respond.");
    emit({ phase: "negotiation_failed", vendor: vendor.name, error: "Vendor did not respond." });
    return null;
  }

  emit({ phase: "extracting_quote", vendor: vendor.name });
  let terms;
  try {
    terms = await extractQuote(rfq, vendor, history);
  } catch (err) {
    db.endNegotiation(negotiationId, "unparsed", turn, err.message);
    return null;
  }

  if (terms.do_not_contact) {
    db.markDoNotCall(vendor.id);
    db.audit(business.id, "vendor_do_not_call", { vendor: vendor.name });
  }

  db.endNegotiation(negotiationId, ended, turn, null);

  if (terms.rate == null) {
    db.audit(business.id, "negotiation_no_rate", { vendor: vendor.name, refused: !!terms.refused });
    return null;
  }

  const goods = rfq.quantity ? terms.rate * rfq.quantity : null;
  const landed = goods != null ? Number((goods + (terms.freight ?? 0)).toFixed(2)) : null;

  const quoteId = db.addQuote({
    business_id: business.id, rfq_id: rfq.id, vendor_id: vendor.id, negotiation_id: negotiationId,
    rate: terms.rate, rate_text: terms.rate_text, unit: terms.unit || rfq.unit,
    moq: terms.moq, lead_time_days: terms.lead_time_days, lead_time_text: terms.lead_time_text,
    delivery_terms: terms.delivery_terms, payment_terms: terms.payment_terms,
    freight: terms.freight, landed_cost: landed, total_cost: landed,
    confidence: terms.confidence, caveat: terms.caveat,
  });

  db.audit(business.id, "quote_captured", {
    vendor: vendor.name, rate: terms.rate, confidence: terms.confidence,
    said: terms.quoted_sentence, negotiationId,
  });
  emit({ phase: "quote", vendor: vendor.name, rate: terms.rate, unit: terms.unit || rfq.unit });

  return { quoteId, negotiationId, ...terms, landed_cost: landed };
}

/**
 * Negotiate with every shortlisted vendor.
 * Sequential by design: these are real conversations with real people, and a
 * vendor should never be talking to two instances of the agent at once.
 */
async function negotiateAll(business, rfq, vendors, opts = {}) {
  const results = [];
  for (const v of vendors) {
    opts.emit?.({ phase: "calling", vendor: v.name, detail: `Contacting ${v.name}` });
    try {
      const q = await negotiate(business, rfq, v, opts);
      results.push({ vendor: v, quote: q, ok: !!q });
    } catch (err) {
      results.push({ vendor: v, quote: null, ok: false, error: err.message });
    }
  }
  return results;
}

// nextTurn and extractQuote are exported so src/live-negotiation.js can drive
// the same conversation one turn at a time with a human on the other end.
module.exports = { negotiate, negotiateAll, brief, nextTurn, extractQuote, OBJECTIVES };
