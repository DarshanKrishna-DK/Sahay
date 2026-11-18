const db = require("./db");
const sarvam = require("./sarvam");
const negotiator = require("./negotiator");
const procurement = require("./procurement");
const { toPlainText } = require("./text");

/**
 * Live, turn-by-turn negotiation driven from a browser.
 *
 * The automated channels in src/channels/ run the whole conversation in a
 * loop. This runs the SAME conversation one turn at a time over plain HTTP, so
 * a human can take the vendor's seat and actually talk to the agent: speak,
 * hear it answer, speak again.
 *
 * It deliberately reuses `negotiator.nextTurn` and `negotiator.extractQuote`.
 * A demo path with its own private logic would prove nothing about the product;
 * this is the production brain with a person on the other end of the line.
 */

const MAX_TURNS = 14;

/** Create a vendor row on the fly so a live call can start without discovery. */
function ensureVendor(business, rfq, { vendorId, vendorName, vendorLocation }) {
  if (vendorId) {
    const v = db.getVendor(Number(vendorId));
    if (!v || v.business_id !== business.id) throw new Error("No such vendor.");
    return v;
  }
  if (!vendorName) throw new Error("Give the vendor a name, or pick one from the shortlist.");
  const id = db.addVendor({
    business_id: business.id, rfq_id: rfq.id, name: vendorName,
    location: vendorLocation || null, phone: "live-session",
    shortlisted: true, score: 0.5, shortlist_reason: "Added for a live negotiation",
  });
  return db.getVendor(id);
}

/**
 * Open a live call. Returns the agent's opening turn - which, per the
 * negotiation brief, always discloses that it is an automated assistant.
 */
async function start(business, { rfqId, vendorId, vendorName, vendorLocation, language }) {
  const rfq = db.getRFQ(business.id, Number(rfqId));
  if (!rfq) throw new Error("Start from a requirement first, so the agent knows what it is buying.");

  const vendor = ensureVendor(business, rfq, { vendorId, vendorName, vendorLocation });
  const lang = language || business.language || "hi-IN";

  const negotiationId = db.startNegotiation({
    business_id: business.id, rfq_id: rfq.id, vendor_id: vendor.id,
    channel: "live-voice", language: lang,
  });

  const { say } = await negotiator.nextTurn(business, rfq, vendor, []);
  const text = toPlainText(say);
  db.addTranscriptLine(negotiationId, 1, "agent", text, null);
  db.audit(business.id, "live_negotiation_started", { negotiationId, vendor: vendor.name });

  return {
    negotiationId,
    vendor: { id: vendor.id, name: vendor.name, location: vendor.location },
    rfq,
    language: lang,
    turn: { speaker: "agent", text, ...(await voice(text, lang)) },
    done: false,
  };
}

/** Render one agent turn in the vendor's language, with audio when possible. */
async function voice(text, lang) {
  if (lang === "en-IN") {
    try { return { textLocal: text, audio: await sarvam.textToSpeech(text, "en-IN") }; }
    catch { return { textLocal: text, audio: [] }; }
  }
  let localised = text;
  try { localised = await sarvam.translate(text, lang, "en-IN"); } catch { /* English still works */ }
  try { return { textLocal: localised, audio: await sarvam.textToSpeech(localised, lang) }; }
  catch { return { textLocal: localised, audio: [] }; }
}

/** Rebuild the conversation the agent has seen so far. */
function history(negotiationId) {
  return db.getTranscript(negotiationId).map((l) => ({ speaker: l.speaker, text: l.text }));
}

/**
 * One exchange: the vendor says something, the agent answers.
 * Accepts either audio (transcribed by Sarvam) or typed text, because a demo
 * on a laptop without a working microphone should still be demonstrable.
 */
async function reply(business, negotiationId, { audioBase64, mimeType, text: typed }) {
  const neg = db.raw.prepare("SELECT * FROM negotiations WHERE id=? AND business_id=?")
    .get(Number(negotiationId), business.id);
  if (!neg) throw new Error("No such live negotiation.");
  if (neg.ended_at) throw new Error("That call has already ended.");

  const rfq = db.getRFQ(business.id, neg.rfq_id);
  const vendor = db.getVendor(neg.vendor_id);
  const lang = neg.language || business.language || "hi-IN";

  /* ---- what the vendor said ---------------------------------------- */
  let vendorText = (typed || "").trim();
  let vendorSpoken = null;
  let detected = lang;

  if (!vendorText) {
    if (!audioBase64) throw new Error("Send audio or text.");
    const buf = Buffer.from(audioBase64, "base64");
    if (buf.length < 400) throw new Error("That recording was too short to hear.");
    const stt = await sarvam.speechToText(buf, mimeType || "audio/webm");
    if (!stt.transcript.trim()) throw new Error("I could not hear anything in that recording.");
    vendorSpoken = stt.transcript;
    detected = stt.language || lang;
    vendorText = detected.startsWith("en")
      ? stt.transcript
      : await sarvam.translate(stt.transcript, "en-IN", detected);
  }

  const turnNo = db.getTranscript(negotiationId).length + 1;
  db.addTranscriptLine(negotiationId, turnNo, "vendor", vendorText, vendorSpoken);

  /* ---- what the agent says back ------------------------------------- */
  const hist = history(negotiationId);
  const { say, done } = await negotiator.nextTurn(business, rfq, vendor, hist);
  const agentText = toPlainText(say);
  db.addTranscriptLine(negotiationId, turnNo + 1, "agent", agentText, null);

  const overLimit = turnNo + 1 >= MAX_TURNS;
  const finished = done || overLimit;

  const out = {
    heard: { text: vendorText, spoken: vendorSpoken, language: detected },
    turn: { speaker: "agent", text: agentText, ...(await voice(agentText, lang)) },
    done: finished,
  };

  if (finished) out.result = await finish(business, negotiationId);
  return out;
}

/**
 * Close the call and turn the conversation into a structured quote.
 * If the vendor never actually gave a rate, no quote is written - the whole
 * point is that a purchase order can only ever be raised against a number
 * somebody really said.
 */
async function finish(business, negotiationId) {
  const neg = db.raw.prepare("SELECT * FROM negotiations WHERE id=? AND business_id=?")
    .get(Number(negotiationId), business.id);
  if (!neg) throw new Error("No such live negotiation.");

  const rfq = db.getRFQ(business.id, neg.rfq_id);
  const vendor = db.getVendor(neg.vendor_id);
  const hist = history(negotiationId);
  const turns = hist.length;

  if (!neg.ended_at) db.endNegotiation(negotiationId, "completed", turns, null);

  if (!hist.some((h) => h.speaker === "vendor")) {
    return { quote: null, reason: "The vendor never said anything, so there is nothing to quote." };
  }

  let terms;
  try { terms = await negotiator.extractQuote(rfq, vendor, hist); }
  catch (err) { return { quote: null, reason: `Could not read the terms back: ${err.message}` }; }

  if (terms.do_not_contact) db.markDoNotCall(vendor.id);

  if (terms.rate == null) {
    db.audit(business.id, "live_negotiation_no_rate", { negotiationId, vendor: vendor.name });
    return {
      quote: null,
      reason: "No rate was agreed on that call, so there is no quote to compare. Nothing has been invented.",
      terms,
    };
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

  db.audit(business.id, "live_quote_captured", {
    negotiationId, vendor: vendor.name, rate: terms.rate, said: terms.quoted_sentence,
  });

  // Fold the new quote into the ranked comparison so it lands on the board.
  let deals = [];
  try { deals = await procurement.rankDeals(business, rfq); }
  catch { /* the quote is saved either way */ }
  db.setRFQStatus(business.id, rfq.id, "quoted");

  return {
    quote: db.getQuote(business.id, quoteId),
    quotedSentence: terms.quoted_sentence,
    deals,
    transcript: db.getTranscript(negotiationId),
  };
}

module.exports = { start, reply, finish, MAX_TURNS };
