"use strict";

/**
 * One negotiation, run as a background job (decisions.md D1, "Negotiation").
 *
 * A second Agora channel holds Sahay's negotiator agent (managed LLM + MCP tools
 * of scope "negotiation": every price it says comes from strategy.buyerMove via
 * record_vendor_offer) and a counterpart:
 *   (a) "simulated": a labelled simulated vendor agent (vendor-agent.js), or
 *   (b) "human": a person who opens a one-time join link.
 *
 * Mode "agents" (default): both agents in one channel, each with remote_rtc_uids
 * set to the other's uid. UNVERIFIED: whether an Agora agent subscribes to and
 * transcribes another agent's audio has not been seen live. If a simulated run
 * hears no vendor turn within STALL_MS it switches to mode "loop".
 * Mode "loop" (config.negotiation.mode = "loop", simulated only): the server
 * computes both sides with strategy.js and voices every line with /speak on two
 * agents that listen to nobody.
 *
 * Turns are read from the negotiator's /history (agents) or known directly
 * (loop), stored with repo.appendNegotiationTurn and emitted as negotiation.turn.
 * At the end the quote is extracted (llm.completeJSON) and accepted only if its
 * price matches the price agreed in code, is not above the owner's maximum, and
 * its quoted_sentence appears in the vendor's own words.
 */

const crypto = require("node:crypto");
const { config } = require("../config");
const repo = require("../db/repo");
const events = require("../events");
const jobs = require("../jobs");
const auth = require("../auth");
const strategy = require("./strategy");
const llm = require("../llm");
const { comparableListedPrice } = require("../procurement/scoring");
const { computeLandedCost } = require("../procurement/landed-cost");
const { sameUnit, unitWord } = require("../procurement/units");
const agent = require("../agora/agent");
const { buildRtcRtmToken } = require("../agora/token");
const vendorAgent = require("./vendor-agent");
const { ToolError, sayFor, langKey } = require("../tools/errors");

const UIDS = Object.freeze({ negotiator: 2001, vendor: 2002, listener: 2003, human: 2004, nobody: 2999 });
const MAX_ROUNDS = vendorAgent.DEFAULT_MAX_ROUNDS;
const SESSION_SECONDS = 20 * 60;
const HUMAN_LINK_SECONDS = 15 * 60;
const NEGOTIATION_MCP_NAME = "sahayneg";

const timing = {
  pollMs: 1500,
  stallMs: 45000, // simulated agents mode: no vendor turn by then -> loop mode
  humanJoinMs: 5 * 60 * 1000,
  maxMs: 6 * 60 * 1000,
  closingGraceMs: 4000,
  msPerChar: 75, // loop mode: wait for a line to be spoken before the next one
  minLineMs: 1500,
};

/** negotiation sessionId -> runtime of a running negotiation in this process */
const runtimes = new Map();
/** one-time human join code -> { businessId, sessionId, expiresAt } */
const joinCodes = new Map();

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));

function registry() {
  return require("../tools/registry");
}

/* -------------------------------------------------------------- lines --- */

const BUYER_LINES = {
  disclosure: {
    "hi-IN": (v) => `नमस्ते, मैं सहाय हूँ, ${v.business} की ओर से बात कर रहा एक स्वचालित सहायक।`,
    "kn-IN": (v) => `ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, ${v.business} ಪರವಾಗಿ ಮಾತನಾಡುತ್ತಿರುವ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ.`,
    "en-IN": (v) => `Hello, this is Sahay, an automated assistant speaking for ${v.business}.`,
  },
  opening: {
    "hi-IN": (v) => `हमें ${v.quantity} ${v.unit} ${v.item} चाहिए${v.city ? `, ${v.city} में डिलीवरी` : ""}; आपका सबसे अच्छा भाव प्रति ${v.unitOne} क्या होगा?`,
    "kn-IN": (v) => `ನಮಗೆ ${v.quantity} ${v.unit} ${v.item} ಬೇಕು${v.city ? `, ${v.city}ಗೆ ಡೆಲಿವರಿ` : ""}; ಒಂದು ${v.unitOne}ಗೆ ನಿಮ್ಮ ಉತ್ತಮ ಬೆಲೆ ಎಷ್ಟು?`,
    "en-IN": (v) => `We need ${v.quantity} ${v.unit} of ${v.item}${v.city ? `, delivered in ${v.city}` : ""}; what is your best price per ${v.unitOne}?`,
  },
  counter: {
    "hi-IN": (v) => `हम ${v.price} रुपये प्रति ${v.unit} दे सकते हैं, क्या इस पर बात बनेगी?`,
    "kn-IN": (v) => `ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ ಕೊಡಬಹುದು, ಇದಕ್ಕೆ ಒಪ್ಪುತ್ತೀರಾ?`,
    "en-IN": (v) => `We can pay ${v.price} rupees per ${v.unit}; can you do that?`,
  },
  accept: {
    "hi-IN": (v) => `ठीक है, ${v.price} रुपये प्रति ${v.unit} पर बात पक्की; मालिक की मंज़ूरी के बाद ऑर्डर भेजेंगे, धन्यवाद।`,
    "kn-IN": (v) => `ಸರಿ, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಒಪ್ಪಿಗೆ; ಮಾಲೀಕರ ಒಪ್ಪಿಗೆಯ ನಂತರ ಆರ್ಡರ್ ಕಳುಹಿಸುತ್ತೇವೆ, ಧನ್ಯವಾದ.`,
    "en-IN": (v) => `Agreed at ${v.price} rupees per ${v.unit}; we will send the order after the owner approves. Thank you.`,
  },
  walk_away: {
    "hi-IN": () => "माफ़ कीजिए, इस भाव पर हम आगे नहीं बढ़ पाएँगे, धन्यवाद।",
    "kn-IN": () => "ಕ್ಷಮಿಸಿ, ಈ ಬೆಲೆಗೆ ನಾವು ಮುಂದುವರಿಯಲು ಆಗುವುದಿಲ್ಲ, ಧನ್ಯವಾದ.",
    "en-IN": () => "Sorry, we cannot go ahead at that price. Thank you.",
  },
  clarify_unit: {
    "hi-IN": (v) => `कृपया प्रति ${v.unit} का भाव बताइए।`,
    "kn-IN": (v) => `ದಯವಿಟ್ಟು ಒಂದು ${v.unit}ಗೆ ಬೆಲೆ ಹೇಳಿ.`,
    "en-IN": (v) => `Please give me the price per ${v.unit}.`,
  },
};

const buyerLine = (key, language, vars = {}) => BUYER_LINES[key][langKey(language)](vars);

/* ------------------------------------------------------------ prompts --- */

function negotiatorPrompt(rt) {
  const script = rt.language === "kn-IN" ? "Kannada script" : rt.language === "en-IN" ? "English" : "Hindi in Devanagari script";
  return [
    `You are Sahay, an automated assistant negotiating to buy ${itemSpoken(rt)} for ${rt.business.name}. You speak to a vendor${rt.counterpart === "simulated" ? " who is a simulated vendor in a demo" : ""}.`,
    "The system has already said that you are an automated assistant. Do not repeat it.",
    `Speak only ${script}. One or two short sentences per turn. No lists, no ids.`,
    "First call get_negotiation_brief and say its `say` text word for word.",
    "Every time the vendor names a price or agrees to one, call record_vendor_offer with that price per unit (and freight or delivery days only if the vendor said them). Then say the tool's `say` text word for word. That text holds the only price you may offer.",
    "Never say any number that did not come from a tool. Never agree to a price on your own: only when record_vendor_offer returns action accept. When it returns accept or walk_away, say its text and then stay silent.",
    "If the vendor does not say a price, ask for their price per unit.",
  ].join("\n");
}

/* ----------------------------------------------------------- runtime --- */

function unitSpoken(rt, many = false) {
  return unitWord(rt.requirement.unit, rt.language, many);
}

/** The item in the negotiation language (the IndiaMART category when the owner's words are in another script). */
function itemSpoken(rt) {
  return registry().spokenItem(rt.businessId, rt.requirement, rt.language);
}

function runtimeFor(ctx) {
  const rt = runtimes.get(ctx.sessionId);
  if (!rt || rt.businessId !== ctx.businessId) {
    throw new ToolError("NEGOTIATION_NOT_RUNNING", sayFor("not_found", "en-IN"), { status: 409, message: "No negotiation is running for this session." });
  }
  return rt;
}

/** Tool get_negotiation_brief. */
function brief(ctx) {
  const rt = runtimeFor(ctx);
  const r = rt.requirement;
  return {
    item: r.item,
    quantity: r.quantity,
    unit: r.unit,
    round: rt.round,
    maxRounds: MAX_ROUNDS,
    counterpart: rt.counterpart,
    say: buyerLine("opening", rt.language, {
      quantity: money(r.quantity),
      unit: unitSpoken(rt, r.quantity !== 1),
      unitOne: unitSpoken(rt),
      item: itemSpoken(rt),
      city: r.city,
    }),
  };
}

/**
 * Tool record_vendor_offer (and the loop's buyer side): record the vendor's ask
 * and return the buyer's next move from strategy.buyerMove.
 */
function recordVendorOffer(ctx, args) {
  const rt = runtimeFor(ctx);
  return applyVendorOffer(rt, args);
}

function applyVendorOffer(rt, args) {
  const unit = unitSpoken(rt);
  if (rt.state !== "open") {
    return { action: rt.state === "agreed" ? "accept" : "walk_away", price: rt.agreedPrice ?? null, final: true, say: "" };
  }
  if (args.unit && !sameUnit(args.unit, rt.requirement.unit)) {
    return { action: "clarify", price: null, round: rt.round, say: buyerLine("clarify_unit", rt.language, { unit }) };
  }
  const ask = Number(args.price_per_unit);
  rt.askHistory.push(ask);
  if (args.freight != null) rt.terms.freight = args.freight;
  if (args.lead_time_days != null) rt.terms.lead_time_days = args.lead_time_days;
  if (args.vendor_sentence) rt.vendorSentences.push(String(args.vendor_sentence));

  const round = Math.min(rt.round, MAX_ROUNDS);
  const move = strategy.buyerMove({
    round,
    maxRounds: MAX_ROUNDS,
    open: rt.open,
    reservation: rt.reservation,
    vendorAsk: ask,
    vendorSaysFinal: Boolean(args.is_final),
    askHistory: rt.askHistory,
  });
  rt.round += 1;
  rt.lastAsk = ask;
  rt.moves.push({ round, ask, action: move.action, price: move.price, reason: move.reason, at: new Date().toISOString() });

  let say;
  if (move.action === "accept") {
    rt.state = "agreed";
    rt.agreedPrice = move.price;
    rt.decidedAt = Date.now();
    say = buyerLine("accept", rt.language, { price: money(move.price), unit });
  } else if (move.action === "walk_away") {
    rt.state = "walked_away";
    rt.walkReason = move.reason;
    rt.decidedAt = Date.now();
    say = buyerLine("walk_away", rt.language);
  } else {
    rt.lastBuyerOffer = move.price;
    say = buyerLine("counter", rt.language, { price: money(move.price), unit });
  }
  rt.pendingOffer = { vendorAsk: ask, buyerPrice: move.price, action: move.action };
  return { action: move.action, price: move.price, unit: rt.requirement.unit, round, reason: move.reason, say };
}

/* ------------------------------------------------------------- turns --- */

function recordTurn(rt, { speaker, text, offer = null }) {
  const turn = {
    speaker,
    text,
    round: Math.min(rt.round, MAX_ROUNDS),
    ts: new Date().toISOString(),
    ...(offer != null ? { offer, unit: rt.requirement.unit } : {}),
  };
  rt.turns.push(turn);
  repo.appendNegotiationTurn(rt.businessId, rt.negotiationId, turn);
  events.emit(
    rt.businessId,
    "negotiation.turn",
    { negotiationId: rt.negotiationId, vendorId: rt.vendor.id, counterpart: rt.counterpart, ...turn },
    { sessionId: rt.sessionId, actor: speaker === "vendor" ? "vendor" : "agent" },
  );
}

/** A line the server spoke with /speak: recorded now; its /history echo (source "command") is skipped. */
function serverSaid(rt, speaker, text) {
  rt.serverLines.add(text.trim());
  recordTurn(rt, { speaker, text });
}

/** Turn new /history items into negotiation turns. Returns how many vendor turns were seen. */
function ingestHistory(rt, contents) {
  let vendorTurns = 0;
  for (const item of contents) {
    if (typeof item?.content !== "string" || !item.content.trim()) continue;
    const source = item.metadata?.source;
    let speaker = null;
    if (item.role === "user" && source === "asr") speaker = "vendor";
    else if (item.role === "assistant" && (source === "llm" || source === "command")) speaker = "agent";
    if (!speaker) continue;
    if (source === "command" && rt.serverLines.has(item.content.trim())) continue;
    const key = `${item.turn_id ?? ""}|${item.role}|${item.timestamp ?? ""}|${item.content.length}`;
    if (rt.seenHistory.has(key)) continue;
    rt.seenHistory.add(key);
    let offer = null;
    if (speaker === "agent" && rt.pendingOffer) {
      offer = rt.pendingOffer.buyerPrice;
      rt.pendingOffer = null;
    }
    recordTurn(rt, { speaker, text: item.content.trim(), offer });
    if (speaker === "vendor") vendorTurns += 1;
    if (speaker === "agent" && rt.decidedAt && (item.timestamp ?? Date.now()) >= rt.decidedAt) rt.closingSpokenAt = Date.now();
  }
  return vendorTurns;
}

/* ----------------------------------------------------------- agents --- */

function negotiationBearer(rt) {
  return auth.signSession({ businessId: rt.businessId, sessionId: rt.sessionId, scope: "mcp", exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
}

function ownerVoice(language) {
  const voiceId = config.murf.voices[language];
  if (!voiceId) throw new Error(`No Murf voice configured for ${language}.`);
  return voiceId;
}

async function startNegotiatorAgent(rt, { remoteUid, withTools, idleTimeout = 60 }) {
  const { token } = buildRtcRtmToken(rt.channel, UIDS.negotiator, SESSION_SECONDS);
  const body = agent.buildJoinBody({
    name: `sahay-neg-${rt.sessionId}-${Date.now()}`.slice(0, 64),
    channel: rt.channel,
    token,
    agentUid: UIDS.negotiator,
    remoteUids: [remoteUid],
    language: rt.language,
    voiceId: ownerVoice(rt.language),
    prompt: negotiatorPrompt(rt),
    idleTimeout,
    labels: { session: rt.sessionId, role: "negotiator" },
    ...(withTools
      ? {
          mcp: {
            name: NEGOTIATION_MCP_NAME,
            endpoint: `${config.publicUrl}/mcp`,
            bearer: negotiationBearer(rt),
            allowedTools: registry().toolNames(registry().SCOPES.negotiation),
          },
        }
      : {}),
  });
  const { agentId } = await agent.startAgent(body);
  rt.agents.negotiator = agentId;
  repo.updateSession(rt.businessId, rt.sessionId, { agent_id: agentId, status: "active" });
  return agentId;
}

async function startVendorAgent(rt, { remoteUid, idleTimeout = 60 }) {
  const { token } = buildRtcRtmToken(rt.channel, UIDS.vendor, SESSION_SECONDS);
  const body = agent.buildJoinBody({
    name: `sahay-sim-${rt.sessionId}-${Date.now()}`.slice(0, 64),
    channel: rt.channel,
    token,
    agentUid: UIDS.vendor,
    remoteUids: [remoteUid],
    language: rt.language,
    voiceId: vendorAgent.VENDOR_VOICE_ID,
    prompt: vendorAgent.vendorPrompt({
      language: rt.language,
      item: itemSpoken(rt),
      quantity: rt.requirement.quantity,
      unit: rt.requirement.unit,
      unitSpoken: unitSpoken(rt),
      schedule: rt.vendorSchedule,
      floor: rt.vendorPolicy.floor,
    }),
    idleTimeout,
    labels: { session: rt.sessionId, role: "simulated-vendor" },
  });
  const { agentId } = await agent.startAgent(body);
  rt.agents.vendor = agentId;
  return agentId;
}

async function stopAgents(rt) {
  for (const role of ["negotiator", "vendor"]) {
    const agentId = rt.agents[role];
    if (!agentId) continue;
    rt.agents[role] = null;
    try {
      await agent.stopAgent(agentId);
    } catch (err) {
      console.warn(`[negotiation] could not stop the ${role} agent: ${err.message}`);
    }
  }
}

const lineMs = (text) => Math.max(timing.minLineMs, String(text).length * timing.msPerChar);

/* ------------------------------------------------------------- modes --- */

/** Mode "agents": two Agora agents talk; turns come from the negotiator's /history. */
async function runAgents(rt, job) {
  const counterpartUid = rt.counterpart === "human" ? UIDS.human : UIDS.vendor;
  const negotiatorId = await startNegotiatorAgent(rt, { remoteUid: counterpartUid, withTools: true });
  const disclosure = buyerLine("disclosure", rt.language, { business: rt.business.name });
  await agent.speak(negotiatorId, disclosure, { priority: "INTERRUPT", interruptable: false });
  serverSaid(rt, "agent", disclosure);

  if (rt.counterpart === "simulated") {
    const vendorId = await startVendorAgent(rt, { remoteUid: UIDS.negotiator });
    await sleep(lineMs(disclosure), job.signal);
    const intro = vendorAgent.introText(rt.language);
    await agent.speak(vendorId, intro, { priority: "INTERRUPT", interruptable: false });
    serverSaid(rt, "vendor", intro);
    await sleep(lineMs(intro), job.signal);
    rt.introduced = true;
    await kickOff(rt);
  } else {
    job.progress("Waiting for the vendor to open the join link.", { joinUrl: rt.joinUrl });
  }

  const started = Date.now();
  let vendorTurns = 0;
  for (;;) {
    await sleep(timing.pollMs, job.signal);
    vendorTurns += ingestHistory(rt, await agent.history(negotiatorId));
    if (rt.state !== "open" && (rt.closingSpokenAt ? Date.now() - rt.closingSpokenAt >= timing.closingGraceMs : Date.now() - rt.decidedAt > 20000)) return "agents";
    if (rt.counterpart === "human" && !rt.humanJoinedAt && Date.now() - started > timing.humanJoinMs) {
      throw new Error("The vendor did not open the join link in time.");
    }
    if (rt.counterpart === "simulated" && vendorTurns === 0 && Date.now() - started > timing.stallMs) return "stalled";
    if (Date.now() - (rt.humanJoinedAt ?? started) > timing.maxMs) return "timeout";
  }
}

/** Ask the negotiator's model to begin (it then calls get_negotiation_brief). */
async function kickOff(rt) {
  if (rt.kickedOff || !rt.agents.negotiator) return;
  rt.kickedOff = true;
  await agent.think(rt.agents.negotiator, "The vendor is on the line now. Begin: call get_negotiation_brief and say its text.", {
    onListening: "interrupt",
    onThinking: "append",
    onSpeaking: "append",
  });
}

/** Mode "loop": the server plays both sides with strategy.js and voices each line with /speak. */
async function runLoop(rt, job) {
  if (rt.counterpart !== "simulated") throw new Error("The server-driven loop can only voice a simulated vendor.");
  // Agents that listen to a uid nobody uses: they only speak what /speak sends. That uid never
  // joins, so idle_timeout is 0 (never) and the finally block of the job always calls /leave.
  const buyer = rt.agents.negotiator ?? (await startNegotiatorAgent(rt, { remoteUid: UIDS.nobody, withTools: false, idleTimeout: 0 }));
  const seller = rt.agents.vendor ?? (await startVendorAgent(rt, { remoteUid: UIDS.nobody, idleTimeout: 0 }));
  const say = async (speaker, agentId, text, offer = null) => {
    await agent.speak(agentId, text, { priority: "APPEND", interruptable: false });
    recordTurn(rt, { speaker, text, offer });
    await sleep(lineMs(text), job.signal);
  };

  if (!rt.introduced) {
    await say("agent", buyer, buyerLine("disclosure", rt.language, { business: rt.business.name }));
    await say("vendor", seller, vendorAgent.introText(rt.language));
    rt.introduced = true;
  }
  await say("agent", buyer, brief({ businessId: rt.businessId, sessionId: rt.sessionId }).say);

  let vendorRound = 1;
  while (rt.state === "open") {
    job.signal.throwIfAborted();
    const turn = vendorAgent.vendorTurn({
      policy: rt.vendorPolicy,
      round: vendorRound,
      buyerOffer: rt.lastBuyerOffer ?? null,
      language: rt.language,
      unitSpoken: unitSpoken(rt),
    });
    vendorRound += 1;
    await say("vendor", seller, turn.text, turn.price);
    const move = applyVendorOffer(rt, { price_per_unit: turn.price, is_final: turn.final, vendor_sentence: turn.text });
    rt.pendingOffer = null;
    await say("agent", buyer, move.say, move.price);
  }
  return "loop";
}

/* --------------------------------------------------------- the quote --- */

const normalise = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

/** True when `sentence` is (a part of) something the vendor actually said. */
function saidByVendor(sentence, turns) {
  const wanted = normalise(sentence);
  if (wanted.length < 4) return false;
  return turns.some((t) => t.speaker === "vendor" && normalise(t.text).includes(wanted));
}

const EXTRACT_SYSTEM = [
  "You read the transcript of a purchase negotiation between a buyer (AGENT) and a vendor (VENDOR).",
  "Extract the final price the vendor agreed to, per unit, only as stated in the transcript.",
  "quoted_sentence must be copied character for character from one VENDOR line: the line where the vendor stated or accepted that price.",
  "Use null for anything the transcript does not state. Never estimate. confidence is 0 to 1.",
].join(" ");
const EXTRACT_HINT =
  '{"unit_price": 185, "unit": "kg", "moq": null, "lead_time_days": null, "freight": null, "payment_terms": null, "quoted_sentence": "...", "confidence": 0.9}';

/**
 * Work out the quote. Loop mode knows every figure (no model); agents mode asks
 * llm.completeJSON and cross-checks it against the price agreed in code.
 * Returns { quote fields } or { rejected: reason }.
 */
async function extractQuote(rt, mode, signal) {
  if (rt.state !== "agreed") return { rejected: rt.state === "walked_away" ? `walked_away:${rt.walkReason}` : "no_agreement" };
  const lastVendor = [...rt.turns].reverse().find((t) => t.speaker === "vendor");
  let fields;
  if (mode === "loop") {
    fields = { unit_price: rt.agreedPrice, unit: rt.requirement.unit, quoted_sentence: lastVendor?.text ?? null, confidence: 1, freight: null, lead_time_days: null, moq: null, payment_terms: null };
  } else {
    const transcript = rt.turns.map((t) => `${t.speaker === "vendor" ? "VENDOR" : "AGENT"}: ${t.text}`).join("\n");
    fields = await llm.completeJSON({ system: EXTRACT_SYSTEM, user: transcript, schemaHint: EXTRACT_HINT, signal });
  }
  const price = Number(fields.unit_price);
  if (!Number.isFinite(price) || price <= 0) return { rejected: "no_price_in_transcript" };
  if (Math.abs(price - rt.agreedPrice) > Math.max(0.01, rt.agreedPrice * 0.005)) return { rejected: "price_differs_from_agreed", extracted: price, agreed: rt.agreedPrice };
  if (price > rt.reservation) return { rejected: "above_reservation" };
  if (rt.requirement.max_price != null && price > rt.requirement.max_price) return { rejected: "above_owner_max" };
  if (fields.unit && !sameUnit(fields.unit, rt.requirement.unit)) return { rejected: "unit_mismatch" };
  if (!fields.quoted_sentence || !saidByVendor(fields.quoted_sentence, rt.turns)) return { rejected: "quoted_sentence_not_in_transcript" };

  const freight = rt.terms.freight ?? (Number.isFinite(fields.freight) ? fields.freight : null);
  const leadTime = rt.terms.lead_time_days ?? (Number.isInteger(fields.lead_time_days) ? fields.lead_time_days : null);
  return {
    unit_price: rt.agreedPrice,
    unit: rt.requirement.unit,
    moq: Number.isFinite(fields.moq) ? fields.moq : null,
    lead_time_days: leadTime,
    freight,
    payment_terms: typeof fields.payment_terms === "string" ? fields.payment_terms : null,
    quoted_sentence: fields.quoted_sentence,
    confidence: Number.isFinite(fields.confidence) ? Math.max(0, Math.min(1, fields.confidence)) : null,
  };
}

async function finish(rt, mode, signal) {
  let quote = null;
  let extracted;
  try {
    extracted = await extractQuote(rt, mode, signal);
  } catch (err) {
    extracted = { rejected: `extraction_failed: ${err.message}` };
  }
  if (!extracted.rejected) {
    const { landed_cost } = computeLandedCost({ unit_price: extracted.unit_price, unit: extracted.unit, freight: extracted.freight }, rt.requirement);
    quote = repo.createQuote(rt.businessId, {
      ...extracted,
      requirement_id: rt.requirement.id,
      vendor_id: rt.vendor.id,
      negotiation_id: rt.negotiationId,
      landed_cost,
    });
    events.emit(rt.businessId, "quote.recorded", quote, { sessionId: rt.sessionId, actor: "system" });
  }
  const outcome = {
    agreed: Boolean(quote),
    state: rt.state,
    mode,
    unitPrice: quote?.unit_price ?? null,
    unit: rt.requirement.unit,
    unitWord: unitSpoken(rt),
    quoteId: quote?.id ?? null,
    vendorName: rt.vendor.name,
    simulated: rt.counterpart === "simulated",
    rounds: rt.moves.length,
    reason: extracted.rejected ?? null,
  };
  const status = quote ? "agreed" : rt.state === "walked_away" ? "walked_away" : "no_deal";
  repo.updateNegotiation(rt.businessId, rt.negotiationId, { status, outcome, ended_at: new Date().toISOString() });
  events.emit(rt.businessId, "negotiation.ended", { negotiationId: rt.negotiationId, status, outcome }, { sessionId: rt.sessionId, actor: "system" });
  return { negotiationId: rt.negotiationId, status, outcome };
}

/* ------------------------------------------------------------ the job --- */

function negotiationMode() {
  return config.negotiation?.mode === "loop" ? "loop" : "agents";
}

async function runNegotiation(rt, job) {
  try {
    let mode = negotiationMode() === "loop" && rt.counterpart === "simulated" ? "loop" : "agents";
    let ended = mode === "loop" ? await runLoop(rt, job) : await runAgents(rt, job);
    if (ended === "stalled") {
      job.progress("The two agents could not hear each other; switching to the server-driven negotiation.", { mode: "loop" });
      mode = "loop";
      ended = await runLoop(rt, job);
    }
    if (ended === "timeout") job.progress("The negotiation ran out of time.");
    return await finish(rt, mode, job.signal);
  } finally {
    await stopAgents(rt);
    repo.updateSession(rt.businessId, rt.sessionId, { status: "ended", ended_at: new Date().toISOString() });
    runtimes.delete(rt.sessionId);
    if (rt.joinCode) joinCodes.delete(rt.joinCode);
  }
}

/**
 * Start a negotiation job. Validates everything that would make the numbers
 * dishonest before any agent starts. Returns { jobId, negotiationId, joinUrl? }.
 * `language` is the language of the negotiation itself; refusals are said in
 * `sayLanguage` (the owner's reply language), defaulting to it.
 */
async function startNegotiation({ businessId, ownerSessionId = null, requirementId, vendorId, counterpart, language, sayLanguage }) {
  const negotiationLanguage = langKey(language);
  const lang = langKey(sayLanguage ?? language);
  const requirement = repo.getRequirement(businessId, requirementId);
  const vendor = repo.getVendor(businessId, vendorId);
  if (!requirement || !vendor || vendor.requirement_id !== requirementId) {
    throw new ToolError("NOT_FOUND", sayFor("not_found", lang));
  }
  if (counterpart !== "simulated" && counterpart !== "human") throw new ToolError("INVALID", sayFor("invalid", lang));
  if (!requirement.quantity || !requirement.unit) {
    throw new ToolError("REQUIREMENT_INCOMPLETE", sayFor("invalid", lang), { status: 400, message: "The requirement needs a quantity and a unit." });
  }
  for (const rt of runtimes.values()) {
    if (rt.businessId === businessId) {
      throw new ToolError("NEGOTIATION_BUSY", NEGOTIATION_BUSY[lang], { status: 409, message: "One negotiation at a time (Murf stream limit)." });
    }
  }
  if (!config.publicUrl || !/^https:\/\//.test(config.publicUrl)) {
    throw new ToolError("PUBLIC_URL_NOT_HTTPS", sayFor("internal", lang), { status: 500, message: "PUBLIC_URL must be https for the negotiation agents." });
  }

  const listed = comparableListedPrice(vendor, requirement.unit);
  let reservation;
  try {
    reservation = strategy.reservationPrice({ ownerMax: requirement.max_price ?? null, marketEvidence: listed?.value ?? null });
  } catch {
    throw new ToolError("MAX_PRICE_NEEDED", MAX_PRICE_NEEDED[lang], { status: 400, message: "Neither a maximum price nor a comparable listed price is known." });
  }
  let policy = null;
  if (counterpart === "simulated") {
    if (!listed) {
      throw new ToolError("NO_LISTED_PRICE", NO_LISTED_PRICE[lang], { status: 400, message: `The listing has no price per ${requirement.unit} to base a simulated vendor on.` });
    }
    policy = vendorAgent.vendorPolicy(listed.value);
  }
  const open = strategy.openingOffer({ target: requirement.target_price ?? null, reservation });
  const business = repo.getBusiness(businessId);

  const channel = `neg-${crypto.randomBytes(6).toString("hex")}`;
  const session = repo.createSession(businessId, { kind: "negotiation", channel, status: "starting" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: requirementId, vendor_id: vendorId, session_id: session.id, counterpart });

  const rt = {
    businessId,
    ownerSessionId,
    sessionId: session.id,
    negotiationId: negotiation.id,
    channel,
    business,
    requirement,
    vendor,
    counterpart,
    language: negotiationLanguage,
    reservation,
    open,
    vendorPolicy: policy,
    vendorSchedule: policy ? vendorAgent.askSchedule(policy, MAX_ROUNDS) : null,
    round: 1,
    askHistory: [],
    moves: [],
    turns: [],
    terms: {},
    vendorSentences: [],
    seenHistory: new Set(),
    serverLines: new Set(),
    state: "open",
    agents: { negotiator: null, vendor: null },
  };
  if (counterpart === "human") {
    rt.joinCode = crypto.randomBytes(16).toString("base64url");
    rt.joinUrl = `${config.publicUrl}/vendor/${rt.joinCode}`;
    joinCodes.set(rt.joinCode, { businessId, sessionId: session.id, expiresAt: Date.now() + HUMAN_LINK_SECONDS * 1000 });
  }
  runtimes.set(session.id, rt);

  let jobId;
  try {
    jobId = jobs.startJob(businessId, "negotiation", { requirementId, vendorId, negotiationId: negotiation.id, counterpart }, (job) => runNegotiation(rt, job));
  } catch (err) {
    runtimes.delete(session.id);
    if (rt.joinCode) joinCodes.delete(rt.joinCode);
    throw err;
  }
  rt.jobId = jobId;
  return { jobId, negotiationId: negotiation.id, ...(rt.joinUrl ? { joinUrl: rt.joinUrl } : {}) };
}

const NEGOTIATION_BUSY = {
  "hi-IN": "एक मोल-भाव पहले से चल रहा है, उसके ख़त्म होने के बाद अगला शुरू करूँगी।",
  "kn-IN": "ಒಂದು ಚೌಕಾಸಿ ಈಗಾಗಲೇ ನಡೆಯುತ್ತಿದೆ, ಅದು ಮುಗಿದ ನಂತರ ಮುಂದಿನದು ಶುರು ಮಾಡುತ್ತೇನೆ.",
  "en-IN": "A negotiation is already running; I will start the next one after it ends.",
};
const MAX_PRICE_NEEDED = {
  "hi-IN": "मोल-भाव से पहले बताइए, प्रति इकाई ज़्यादा से ज़्यादा कितना देंगे?",
  "kn-IN": "ಚೌಕಾಸಿಗೆ ಮೊದಲು ಹೇಳಿ, ಒಂದು ಘಟಕಕ್ಕೆ ಗರಿಷ್ಠ ಎಷ್ಟು ಕೊಡುತ್ತೀರಿ?",
  "en-IN": "Before I negotiate, what is the most you will pay per unit?",
};
const NO_LISTED_PRICE = {
  "hi-IN": "इस विक्रेता की लिस्टिंग में इस इकाई का भाव नहीं है, कोई दूसरा विक्रेता चुनिए।",
  "kn-IN": "ಈ ಮಾರಾಟಗಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಈ ಘಟಕದ ಬೆಲೆ ಇಲ್ಲ, ಬೇರೆ ಮಾರಾಟಗಾರರನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.",
  "en-IN": "This vendor's listing has no price in that unit; please pick another vendor.",
};

/* --------------------------------------------------- human / listener --- */

/** The join page asks for its token with the one-time code. Null when unknown or expired. */
function humanJoinInfo(code) {
  const entry = joinCodes.get(String(code ?? ""));
  if (!entry || entry.expiresAt < Date.now()) return null;
  const rt = runtimes.get(entry.sessionId);
  if (!rt) return null;
  const { token, expiresAt, appId } = buildRtcRtmToken(rt.channel, UIDS.human, SESSION_SECONDS);
  return {
    appId,
    channel: rt.channel,
    uid: UIDS.human,
    token,
    expiresAt,
    businessName: rt.business.name,
    item: rt.requirement.item,
    disclosure: buyerLine("disclosure", rt.language, { business: rt.business.name }),
  };
}

/** The human vendor has joined the channel: let the negotiator begin. */
async function humanJoined(code) {
  const entry = joinCodes.get(String(code ?? ""));
  const rt = entry && runtimes.get(entry.sessionId);
  if (!rt) return false;
  if (!rt.humanJoinedAt) rt.humanJoinedAt = Date.now();
  await kickOff(rt);
  return true;
}

/** A listen-only token for the owner's console (uid not listed by any agent, so it is never heard). */
function listenerToken(businessId, negotiationId) {
  for (const rt of runtimes.values()) {
    if (rt.businessId === businessId && rt.negotiationId === negotiationId) {
      const { token, expiresAt, appId } = buildRtcRtmToken(rt.channel, UIDS.listener, SESSION_SECONDS);
      return { appId, channel: rt.channel, uid: UIDS.listener, token, expiresAt };
    }
  }
  return null;
}

/** Shutdown: cancel every running negotiation job (its finally block stops the agents). */
async function stopAll() {
  const pending = [];
  for (const rt of runtimes.values()) {
    if (rt.jobId) {
      try {
        jobs.cancelJob(rt.businessId, rt.jobId);
      } catch {
        /* already finished */
      }
      pending.push(jobs.whenSettled(rt.jobId));
    }
  }
  await Promise.allSettled(pending);
}

/** Tests: shorten the waits. */
function configureTiming(overrides) {
  Object.assign(timing, overrides);
}

module.exports = {
  UIDS,
  MAX_ROUNDS,
  startNegotiation,
  brief,
  recordVendorOffer,
  humanJoinInfo,
  humanJoined,
  listenerToken,
  stopAll,
  configureTiming,
  negotiatorPrompt,
  saidByVendor,
  extractQuote,
};
