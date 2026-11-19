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
 * Mode "loop" (default for a simulated vendor, config.negotiation.mode): the
 * server computes both sides with strategy.js and voices every line with /speak
 * on two agents (two Murf voices) that listen to nobody. Deterministic.
 * Mode "agents" (NEGOTIATION_MODE=agents, and always for a human): both agents
 * in one channel, each with remote_rtc_uids set to the other's uid. A simulated
 * run that hears no vendor turn within stallMs, or no new turn for turnStallMs
 * after that, stops both agents and continues in mode "loop" from the same
 * round and offer.
 *
 * Turns are read from the negotiator's /history (agents) or known directly
 * (loop), stored with repo.appendNegotiationTurn and emitted as negotiation.turn;
 * every round is also a job.progress line. The quote's price is the price agreed
 * in code (record_vendor_offer accept), never a number re-read by a model; its
 * quoted_sentence is the vendor line that produced the accept. A model reads the
 * transcript only for optional terms (freight, lead time, MOQ) of a human run.
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
  turnStallMs: 40000, // simulated agents mode: no new turn for this long after the first vendor turn -> loop mode
  humanTurnStallMs: 120000, // human: silence this long after joining ends the negotiation honestly
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
  clarify_price: {
    "hi-IN": (v) => `माफ़ कीजिए, भाव साफ़ सुनाई नहीं दिया; प्रति ${v.unit} का भाव फिर से बताइए।`,
    "kn-IN": (v) => `ಕ್ಷಮಿಸಿ, ಬೆಲೆ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ; ಒಂದು ${v.unit}ಗೆ ಬೆಲೆಯನ್ನು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.`,
    "en-IN": (v) => `Sorry, I did not catch the price clearly; please say the price per ${v.unit} again.`,
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
    "Every time the vendor names a price or agrees to one, call record_vendor_offer once with that price per unit and the vendor's sentence as vendor_sentence (and freight or delivery days only if the vendor said them). Never call it twice for the same vendor sentence. Set is_final only if the vendor said the word final or last price. Then say the tool's `say` text word for word. That text holds the only price you may offer.",
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
  rt.openingSaid = true;
  return {
    item: r.item,
    quantity: r.quantity,
    unit: r.unit,
    round: rt.round,
    maxRounds: MAX_ROUNDS,
    counterpart: rt.counterpart,
    say: spokenLine(
      rt,
      buyerLine("opening", rt.language, {
        quantity: money(r.quantity),
        unit: unitSpoken(rt, r.quantity !== 1),
        unitOne: unitSpoken(rt),
        item: itemSpoken(rt),
        city: r.city,
      }),
    ),
  };
}

/** Remember which buyer price (or none) a line the negotiator is told to say carries. */
function spokenLine(rt, text, price = null) {
  rt.sayPrices.set(text.trim(), price);
  return text;
}

/**
 * Tool record_vendor_offer (and the loop's buyer side): record the vendor's ask
 * and return the buyer's next move from strategy.buyerMove.
 */
function recordVendorOffer(ctx, args) {
  const rt = runtimeFor(ctx);
  // The server took over (mode "loop"): a late call from the stopped negotiator changes nothing.
  if (rt.mode === "loop") return { action: "wait", price: null, say: "" };
  // The model sometimes calls twice for one vendor sentence; that must not spend a round.
  const ask = Number(args.price_per_unit);
  if (rt.lastReply && args.vendor_sentence && ask === rt.lastAsk && String(args.vendor_sentence) === rt.lastVendorSentence) {
    return rt.lastReply;
  }
  const reply = applyVendorOffer(rt, args);
  rt.lastReply = reply;
  rt.lastVendorSentence = args.vendor_sentence ? String(args.vendor_sentence) : null;
  return reply;
}

/** Prices a simulated vendor can have said: its scheduled asks, or a buyer counter it accepted. */
function simulatedPrices(rt) {
  return new Set([...(rt.vendorSchedule ?? []), ...rt.moves.filter((m) => m.action === "counter").map((m) => m.price)]);
}

const MAX_PRICE_CLARIFICATIONS = 2;

function applyVendorOffer(rt, args) {
  const unit = unitSpoken(rt);
  if (rt.state !== "open") {
    return { action: rt.state === "agreed" ? "accept" : "walk_away", price: rt.agreedPrice ?? null, final: true, say: "" };
  }
  rt.lastTurnAt = Date.now();
  if (args.unit && !sameUnit(args.unit, rt.requirement.unit)) {
    return { action: "clarify", price: null, round: rt.round, say: spokenLine(rt, buyerLine("clarify_unit", rt.language, { unit })) };
  }
  const ask = Number(args.price_per_unit);
  // A simulated vendor only ever says its scheduled asks or accepts a counter. Anything else was
  // misheard (spoken numbers through ASR): ask again rather than spend a round or agree to it.
  if (rt.counterpart === "simulated" && !simulatedPrices(rt).has(ask) && (rt.priceClarifications ?? 0) < MAX_PRICE_CLARIFICATIONS) {
    rt.priceClarifications = (rt.priceClarifications ?? 0) + 1;
    progress(rt, `Round ${Math.min(rt.round, MAX_ROUNDS)}: heard ${money(ask)} per ${rt.requirement.unit}, which the simulated vendor never offered; asking again.`, { round: rt.round, heard: ask });
    return { action: "clarify", price: null, round: rt.round, say: spokenLine(rt, buyerLine("clarify_price", rt.language, { unit })) };
  }
  rt.askHistory.push(ask);
  if (args.freight != null) rt.terms.freight = args.freight;
  if (args.lead_time_days != null) rt.terms.lead_time_days = args.lead_time_days;

  // A simulated vendor's only final price is its last scheduled ask (its floor); a model that
  // calls an earlier ask "final" is not believed.
  const vendorSaysFinal = Boolean(args.is_final) && (rt.counterpart !== "simulated" || ask <= rt.vendorPolicy.floor);
  const round = Math.min(rt.round, MAX_ROUNDS);
  const move = strategy.buyerMove({
    round,
    maxRounds: MAX_ROUNDS,
    open: rt.open,
    reservation: rt.reservation,
    ceiling: rt.ceiling,
    tick: rt.tick,
    vendorAsk: ask,
    vendorSaysFinal,
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
    rt.acceptVendorSentence = args.vendor_sentence ? String(args.vendor_sentence) : null;
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
  if (move.action === "accept") rt.acceptSay = say.trim();
  spokenLine(rt, say, move.price);
  rt.pendingOffer = { vendorAsk: ask, buyerPrice: move.price, action: move.action, say: say.trim() };
  progress(rt, roundSummary(rt, round, ask, move), { round, vendorAsk: ask, action: move.action, price: move.price, reason: move.reason, unit: rt.requirement.unit });
  return { action: move.action, price: move.price, unit: rt.requirement.unit, round, reason: move.reason, say };
}

/** "Round 2: simulated vendor asks 61 per kg; Sahay offers 52." for the Jobs panel. */
function roundSummary(rt, round, ask, move) {
  const who = rt.counterpart === "simulated" ? "simulated vendor" : "vendor";
  const unit = rt.requirement.unit;
  const reply =
    move.action === "accept"
      ? `Sahay agrees at ${money(move.price)}, pending the owner's approval`
      : move.action === "walk_away"
        ? `Sahay walks away (${move.reason})`
        : `Sahay offers ${money(move.price)}`;
  return `Round ${round}: ${who} asks ${money(ask)} per ${unit}; ${reply}.`;
}

/** A job.progress line for the negotiation job; never lets a finished or cancelled job break a turn. */
function progress(rt, message, data) {
  if (!rt.job) return;
  try {
    rt.job.progress(message, data);
  } catch {
    /* the job was cancelled or has finished; the turn itself is still recorded */
  }
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
  rt.lastTurnAt = Date.now();
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
    // An agent line is matched to the tool reply whose `say` it speaks; /history can lag behind
    // the tool calls, so "the latest reply" may already belong to a later round.
    let offer = null;
    if (speaker === "agent") {
      const text = item.content.trim();
      if (rt.sayPrices.has(text)) {
        offer = rt.sayPrices.get(text);
        if (rt.pendingOffer?.say === text) rt.pendingOffer = null;
      } else if (rt.pendingOffer) {
        offer = rt.pendingOffer.buyerPrice; // the model paraphrased: best effort
        rt.pendingOffer = null;
      }
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
  rt.lastTurnAt = started;
  let vendorTurns = 0;
  for (;;) {
    await sleep(timing.pollMs, job.signal);
    vendorTurns += ingestHistory(rt, await agent.history(negotiatorId));
    const now = Date.now();
    if (rt.state !== "open" && (rt.closingSpokenAt ? now - rt.closingSpokenAt >= timing.closingGraceMs : now - rt.decidedAt > 20000)) return "agents";
    if (rt.counterpart === "human" && !rt.humanJoinedAt && now - started > timing.humanJoinMs) {
      throw new Error("The vendor did not open the join link in time.");
    }
    if (rt.state === "open" && rt.counterpart === "simulated") {
      // E2E r2: one run sat 4 m 53 s between an agent counter and the next vendor turn.
      if (vendorTurns === 0 && now - started > timing.stallMs) return "stalled";
      if (vendorTurns > 0 && now - rt.lastTurnAt > timing.turnStallMs) {
        rt.stallNote = `no new turn for ${Math.round((now - rt.lastTurnAt) / 1000)} s after round ${Math.min(rt.round, MAX_ROUNDS)}`;
        return "stalled";
      }
    }
    if (rt.state === "open" && rt.counterpart === "human" && rt.humanJoinedAt && now - Math.max(rt.lastTurnAt, rt.humanJoinedAt) > timing.humanTurnStallMs) return "timeout";
    if (now - (rt.humanJoinedAt ?? started) > timing.maxMs) return "timeout";
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

/**
 * Mode "loop": the server plays both sides with strategy.js and voices each line with /speak.
 * It starts from the runtime's current state, so after an agents-mode stall it continues at
 * the same round with the same last offer (and does not repeat the disclosure or the opening).
 */
async function runLoop(rt, job) {
  if (rt.counterpart !== "simulated") throw new Error("The server-driven loop can only voice a simulated vendor.");
  rt.mode = "loop";
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
  if (!rt.openingSaid) await say("agent", buyer, brief({ businessId: rt.businessId, sessionId: rt.sessionId }).say);

  // rt.round only moves in applyVendorOffer, so the vendor's round and the buyer's stay in step.
  while (rt.state === "open") {
    job.signal.throwIfAborted();
    const turn = vendorAgent.vendorTurn({
      policy: rt.vendorPolicy,
      round: rt.round,
      buyerOffer: rt.lastBuyerOffer ?? null,
      language: rt.language,
      unitSpoken: unitSpoken(rt),
    });
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

/**
 * The vendor line that produced the accept: the vendor turn just before the agent's accept line
 * (the turn that speaks the accept `say` text), else the sentence the negotiator passed to
 * record_vendor_offer, else the last vendor turn. Never a model's re-copy.
 * Returns { sentence, heard } where heard says it is a recorded vendor turn.
 */
function acceptingVendorSentence(rt) {
  const acceptAt = rt.acceptSay ? rt.turns.findIndex((t) => t.speaker === "agent" && t.text.trim() === rt.acceptSay) : -1;
  if (acceptAt > 0) {
    const vendorTurn = rt.turns.slice(0, acceptAt).findLast((t) => t.speaker === "vendor");
    if (vendorTurn) return { sentence: vendorTurn.text, heard: true };
  }
  if (rt.acceptVendorSentence) return { sentence: rt.acceptVendorSentence, heard: saidByVendor(rt.acceptVendorSentence, rt.turns) };
  const lastVendor = rt.turns.findLast((t) => t.speaker === "vendor");
  return lastVendor ? { sentence: lastVendor.text, heard: true } : { sentence: null, heard: false };
}

const TERMS_SYSTEM = [
  "You read the transcript of a purchase negotiation between a buyer (AGENT) and a vendor (VENDOR).",
  "Extract only the terms the VENDOR stated besides the price: freight in rupees for the whole order, delivery time in days, minimum order quantity, payment terms.",
  "Use null for anything the vendor did not state. Never estimate.",
].join(" ");
const TERMS_HINT = '{"freight": null, "lead_time_days": null, "moq": null, "payment_terms": null}';

/** Optional terms of a human run read from the transcript by a model. Prices never come from here. */
async function extractTerms(rt, signal) {
  const transcript = rt.turns.map((t) => `${t.speaker === "vendor" ? "VENDOR" : "AGENT"}: ${t.text}`).join("\n");
  const fields = await llm.completeJSON({ system: TERMS_SYSTEM, user: transcript, schemaHint: TERMS_HINT, signal });
  return {
    freight: Number.isFinite(fields?.freight) && fields.freight >= 0 ? fields.freight : null,
    lead_time_days: Number.isInteger(fields?.lead_time_days) && fields.lead_time_days >= 0 ? fields.lead_time_days : null,
    moq: Number.isFinite(fields?.moq) && fields.moq > 0 ? fields.moq : null,
    payment_terms: typeof fields?.payment_terms === "string" && fields.payment_terms.trim() ? fields.payment_terms.trim() : null,
  };
}

/**
 * Work out the quote. The price is rt.agreedPrice, set in code when record_vendor_offer (or the
 * loop) accepted; it is checked against the owner's limits and, for a simulated vendor, against
 * the prices the simulation could have said. Returns { quote fields } or { rejected: reason }.
 */
async function extractQuote(rt, mode, signal) {
  if (rt.state !== "agreed") return { rejected: rt.state === "walked_away" ? `walked_away:${rt.walkReason}` : "no_agreement" };
  const price = rt.agreedPrice;
  if (!Number.isFinite(price) || price <= 0) return { rejected: "no_agreed_price" };
  if (price > rt.reservation) return { rejected: "above_reservation" };
  if (rt.requirement.max_price != null && price > rt.requirement.max_price) return { rejected: "above_owner_max" };
  if (rt.counterpart === "simulated" && !simulatedPrices(rt).has(price)) {
    return { rejected: "price_not_offered_by_simulated_vendor", agreed: price };
  }
  const { sentence, heard } = acceptingVendorSentence(rt);
  if (!sentence) return { rejected: "no_vendor_sentence" };

  let terms = { freight: null, lead_time_days: null, moq: null, payment_terms: null };
  let termsNote = null;
  // A simulated vendor states no terms (its prompt forbids them), so there is nothing to read.
  if (mode !== "loop" && rt.counterpart === "human") {
    try {
      terms = await extractTerms(rt, signal);
    } catch (err) {
      termsNote = `terms_not_read: ${err.message}`;
    }
  }
  return {
    unit_price: price,
    unit: rt.requirement.unit,
    moq: terms.moq,
    lead_time_days: rt.terms.lead_time_days ?? terms.lead_time_days,
    freight: rt.terms.freight ?? terms.freight,
    payment_terms: terms.payment_terms,
    quoted_sentence: sentence,
    confidence: heard ? 1 : 0.7,
    ...(termsNote ? { termsNote } : {}),
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
  const { termsNote = null, ...fields } = extracted;
  extracted = fields;
  if (termsNote) progress(rt, `Agreed; optional terms could not be read from the transcript (${termsNote}).`);
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

/** A human is always met by the agents mode; a simulated vendor by the loop unless NEGOTIATION_MODE=agents. */
function negotiationMode(counterpart) {
  return counterpart === "simulated" && config.negotiation?.mode !== "agents" ? "loop" : "agents";
}

/**
 * The negotiation is over for this process: its session is ended and it no longer blocks the
 * next one. Idempotent; called before the outcome is announced so that "negotiate again" right
 * after a walk-away is not refused as busy.
 */
function release(rt) {
  if (rt.released) return;
  rt.released = true;
  repo.updateSession(rt.businessId, rt.sessionId, { status: "ended", ended_at: new Date().toISOString() });
  runtimes.delete(rt.sessionId);
  if (rt.joinCode) joinCodes.delete(rt.joinCode);
}

/**
 * Diagnosis for a stall: the last two /history items each agent has (what each one last heard
 * or said), so the next stalled run shows which side stopped hearing the other.
 */
async function lastHeard(rt) {
  const out = {};
  for (const role of ["negotiator", "vendor"]) {
    if (!rt.agents[role]) continue;
    try {
      const items = await agent.history(rt.agents[role]);
      out[role] = items.slice(-2).map((i) => ({ role: i?.role ?? null, source: i?.metadata?.source ?? null, timestamp: i?.timestamp ?? null, text: String(i?.content ?? "").slice(0, 200) }));
    } catch (err) {
      out[role] = { error: err.message };
    }
  }
  return out;
}

async function runNegotiation(rt, job) {
  rt.job = job;
  try {
    let mode = negotiationMode(rt.counterpart);
    rt.mode = mode;
    const who = rt.counterpart === "simulated" ? `${rt.vendor.name} (simulated vendor)` : rt.vendor.name;
    job.progress(`Negotiating with ${who}: ${mode === "loop" ? "server-driven turns" : "two live agents"}, at most ${MAX_ROUNDS} rounds.`, { mode, maxRounds: MAX_ROUNDS });
    let ended = mode === "loop" ? await runLoop(rt, job) : await runAgents(rt, job);
    if (ended === "stalled") {
      rt.mode = "loop"; // late tool calls from the stopped negotiator are ignored from here on
      job.progress(
        rt.stallNote
          ? `The agents went quiet (${rt.stallNote}); switching to the server-driven negotiation from round ${Math.min(rt.round, MAX_ROUNDS)}.`
          : "The two agents could not hear each other; switching to the server-driven negotiation.",
        { mode: "loop", round: rt.round, lastHeard: await lastHeard(rt) },
      );
      // Stop the listening agents first: a model that hears the server's lines would answer them.
      await stopAgents(rt);
      mode = "loop";
      ended = await runLoop(rt, job);
    }
    if (ended === "timeout") job.progress("The negotiation ran out of time.");
    await stopAgents(rt);
    release(rt);
    return await finish(rt, mode, job.signal);
  } finally {
    await stopAgents(rt);
    release(rt);
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
  const marketEvidence = listed?.value ?? null;
  let reservation;
  try {
    // The owner's maximum is the hard ceiling; without one, the listed price.
    reservation = strategy.reservationPrice({ ownerMax: requirement.max_price ?? null, marketEvidence });
  } catch {
    throw new ToolError("MAX_PRICE_NEEDED", MAX_PRICE_NEEDED[lang], { status: 400, message: "Neither a maximum price nor a comparable listed price is known." });
  }
  let policy = null;
  if (counterpart === "simulated") {
    if (!listed) {
      throw new ToolError("NO_LISTED_PRICE", NO_LISTED_PRICE[lang], { status: 400, message: `The listing has no price per ${requirement.unit} to base a simulated vendor on.` });
    }
    policy = vendorAgent.vendorPolicy(listed.value, MAX_ROUNDS);
  }
  const ceiling = strategy.softCeiling({ reservation, marketEvidence });
  const tick = strategy.priceTick(ceiling);
  const open = strategy.openingOffer({ target: requirement.target_price ?? null, reservation, marketEvidence, tick });
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
    ceiling,
    tick,
    open,
    vendorPolicy: policy,
    vendorSchedule: policy ? vendorAgent.askSchedule(policy) : null,
    round: 1,
    askHistory: [],
    moves: [],
    turns: [],
    terms: {},
    seenHistory: new Set(),
    sayPrices: new Map(), // tool `say` text -> the buyer price it speaks
    lastTurnAt: Date.now(),
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
