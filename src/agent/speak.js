"use strict";

/**
 * Speak-it: every card in the app has a 🔊 that reads it aloud, so reading is never required.
 * The browser sends only a key ("now", "rule:<id>", "memory:<id>", "approval:<id>", "order:<id>",
 * "need:<id>"); the sentence is always built here from this business's own rows, in its current
 * reply language and script. Free text from a client is never spoken.
 *
 * In a live call the agent says it (/speak APPEND). Otherwise Murf Falcon renders it over HTTP
 * (POST https://<region>.api.murf.ai/v1/speech/stream, docs/build/agora-findings.md "Track B3"),
 * as MP3, cached on disk by the hash of everything that shapes the audio.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");
const repo = require("../db/repo");
const approvals = require("../approvals");
const agent = require("../agora/agent");
const { unitWord } = require("../procurement/units");
const { cityIn } = require("../discovery/slug");
const { langKey } = require("../tools/errors");
const rules = require("./rules");
const memories = require("./memories");
const profile = require("./profile");
const policy = require("./policy");
const { AgentError } = require("./errors");

const MURF_HOSTS = { global: "global.api.murf.ai", in: "in.api.murf.ai" };
const MURF_MODEL = "falcon-2.1";
const SAMPLE_RATE = 24000;
/** Murf `rate` (-50..50) per profile voice_speed. */
const RATE = Object.freeze({ slow: -20, normal: 0 });
const REQUEST_TIMEOUT_MS = 15000;
const READBACK_LANGUAGE = { "hi-IN": "hi", "kn-IN": "kn", "en-IN": "en" };
const KEY = /^(?:now|(rule|memory|approval|order|need):([A-Za-z0-9_]{1,64}))$/;

let fetchImpl = (...args) => fetch(...args);

/** Tests replace the network boundary. Pass null to restore the global fetch. */
function setFetch(fn) {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

/** data/speak next to the purchase orders (a throwaway folder when the database is in memory). */
const cacheDir = () => path.join(path.dirname(config.poDir), "speak");

/** Lazy: the tool registry requires this module's neighbours, so it is read at call time. */
const registry = () => require("../tools/registry");

const notFound = () => new AgentError("SPEAK_KEY_NOT_FOUND", "Nothing to read aloud for that key.");
const money = (n) => String(Math.round(n * 100) / 100);

/* ------------------------------------------------------------ sentences --- */

const NOW = {
  approval: { "hi-IN": "एक सौदा आपकी हाँ का इंतज़ार कर रहा है।", "kn-IN": "ಒಂದು ವ್ಯವಹಾರ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ.", "en-IN": "A deal is waiting for your yes." },
  negotiation: { "hi-IN": "मैं अभी विक्रेता से मोल-भाव कर रही हूँ।", "kn-IN": "ನಾನು ಈಗ ಮಾರಾಟಗಾರರೊಂದಿಗೆ ಚೌಕಾಸಿ ಮಾಡುತ್ತಿದ್ದೇನೆ.", "en-IN": "I am bargaining with a vendor right now." },
  sourcing: { "hi-IN": "मैं अभी विक्रेता खोज रही हूँ।", "kn-IN": "ನಾನು ಈಗ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ.", "en-IN": "I am looking for vendors right now." },
  rule: { "hi-IN": "एक नया नियम आपकी हाँ का इंतज़ार कर रहा है।", "kn-IN": "ಒಂದು ಹೊಸ ನಿಯಮ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ.", "en-IN": "A new rule is waiting for your yes." },
  free: { "hi-IN": "मैं अभी खाली हूँ; बताइए, क्या चाहिए?", "kn-IN": "ನಾನು ಈಗ ಖಾಲಿ ಇದ್ದೇನೆ; ಏನು ಬೇಕು ಹೇಳಿ?", "en-IN": "I am free right now; tell me what you need." },
};

const ORDER_EXTRA = {
  total: { "hi-IN": (a) => `कुल ${a} रुपये।`, "kn-IN": (a) => `ಒಟ್ಟು ${a} ರೂಪಾಯಿ.`, "en-IN": (a) => `Total ${a} rupees.` },
  simulated: { "hi-IN": "यह ऑर्डर सिम्युलेटेड विक्रेता से है।", "kn-IN": "ಈ ಆರ್ಡರ್ ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್ ಅವರಿಂದ.", "en-IN": "This order is with a simulated vendor." },
};

const NEED = {
  "hi-IN": (v) => `${v.amount ? `${v.amount} ` : ""}${v.item}${v.city ? `, ${v.city} के लिए` : ""}।`,
  "kn-IN": (v) => `${v.amount ? `${v.amount} ` : ""}${v.item}${v.city ? `, ${registry().knDative(v.city)}` : ""}.`,
  "en-IN": (v) => `${v.amount ? `${v.amount} of ` : ""}${v.item}${v.city ? ` for ${v.city}` : ""}.`,
};

/** The language the owner hears now: an active reply_language rule, else the business language. */
function currentLanguage(businessId) {
  const business = repo.getBusiness(businessId);
  if (!business) throw notFound();
  return langKey(policy.replyLanguage(businessId) ?? business.language);
}

function nowSentence(businessId, language) {
  const running = (kind) => repo.listJobs(businessId, { kind }).some((j) => j.status === "queued" || j.status === "running");
  const state = repo.listApprovals(businessId, { status: "pending" }).length
    ? "approval"
    : running("negotiation")
      ? "negotiation"
      : running("sourcing")
        ? "sourcing"
        : rules.list(businessId, { status: "suggested" }).length
          ? "rule"
          : "free";
  return NOW[state][language];
}

function approvalSentence(businessId, id, language) {
  const approval = repo.getApproval(businessId, id);
  if (!approval) throw notFound();
  const deal = approvals.loadDeal(businessId, approval.quote_id);
  const requirement = repo.getRequirement(businessId, repo.getQuote(businessId, approval.quote_id).requirement_id);
  // Same figures as the stored read-back; the item named in this language's script.
  return approvals.buildReadback({ ...deal, item: registry().spokenItem(businessId, requirement, language) }, READBACK_LANGUAGE[language]);
}

function orderSentence(businessId, id, language) {
  const order = repo.getOrder(businessId, id);
  if (!order) throw notFound();
  const { SAY_WORDS, phrase } = registry();
  const checkout = repo.getCheckoutForOrder(businessId, order.id);
  const paid = order.status === "paid" || Boolean(checkout?.paid_at);
  const payment = order.status === "paid" || order.status === "cancelled"
    ? null
    : SAY_WORDS.payment[paid ? "paid" : checkout && order.payment_link_url ? "pending_link" : "pending_no_link"][language];
  const status = SAY_WORDS.orderStatus[order.status]?.[language] ?? order.status;
  return [
    phrase("order_status", language, { po: order.po_number, status, payment, more: false }),
    ORDER_EXTRA.total[language](money(order.amount)),
    ...(order.simulated ? [ORDER_EXTRA.simulated[language]] : []),
  ].join(" ");
}

function needSentence(businessId, id, language) {
  const need = repo.getRequirement(businessId, id);
  if (!need) throw notFound();
  const amount = need.quantity != null && need.unit ? `${money(need.quantity)} ${unitWord(need.unit, language, need.quantity !== 1)}` : null;
  const city = need.city ? (language === "en-IN" ? need.city : cityIn(need.city, language)) : null;
  return NEED[language]({ amount, item: registry().spokenItem(businessId, need, language), city });
}

/**
 * The sentence a key stands for, built from this business's rows: `{ text, language }`.
 * A key that is malformed or names another business's row is SPEAK_KEY_NOT_FOUND.
 */
function sentenceFor(businessId, key) {
  const match = typeof key === "string" ? KEY.exec(key) : null;
  if (!match) throw notFound();
  const language = currentLanguage(businessId);
  const [, kind, id] = match;
  let text;
  if (!kind) text = nowSentence(businessId, language);
  else if (kind === "rule") {
    const rule = rules.get(businessId, id);
    if (!rule) throw notFound();
    text = rule.why ? `${rule.sentence[language]} ${rule.why[language]}` : rule.sentence[language];
  } else if (kind === "memory") {
    const memory = memories.list(businessId).find((m) => m.id === id);
    if (!memory) throw notFound();
    text = memory.sentence[language];
  } else if (kind === "approval") text = approvalSentence(businessId, id, language);
  else if (kind === "order") text = orderSentence(businessId, id, language);
  else text = needSentence(businessId, id, language);
  return { text, language };
}

/* ---------------------------------------------------------------- audio --- */

/** MP3 of `text` from Murf Falcon, from the disk cache when this exact audio was made before. */
async function murfAudio(text, { language, voiceSpeed }) {
  const host = MURF_HOSTS[config.murf.region ?? "global"];
  if (!config.murf.key || !host) throw new AgentError("MURF_NOT_CONFIGURED", "MURF_API_KEY and a valid MURF_REGION are required to read a card aloud.");
  const voiceId = config.murf.voices[language];
  if (!voiceId) throw new AgentError("MURF_VOICE_MISSING", `No Murf voice is configured for ${language}.`);
  const body = { text, voiceId, model: MURF_MODEL, locale: language, format: "MP3", sampleRate: SAMPLE_RATE, channelType: "MONO", rate: RATE[voiceSpeed] ?? 0 };

  const file = path.join(cacheDir(), `${crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex")}.mp3`);
  try {
    return await fs.promises.readFile(file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  let res;
  try {
    res = await fetchImpl(`https://${host}/v1/speech/stream`, {
      method: "POST",
      headers: { "api-key": config.murf.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AgentError("MURF_FAILED", `Murf did not answer: ${err.name === "TimeoutError" ? "timed out" : err.message}`);
  }
  if (!res.ok) throw new AgentError("MURF_FAILED", `Murf answered ${res.status}.`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) throw new AgentError("MURF_FAILED", "Murf answered with no audio.");

  await fs.promises.mkdir(cacheDir(), { recursive: true });
  const partial = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.part`;
  await fs.promises.writeFile(partial, audio);
  await fs.promises.rename(partial, file);
  return audio;
}

/**
 * Read the card `key` aloud. With `agentId` (the owner's live call) the agent says it and the
 * result is `{kind: "spoken"}`; otherwise `{kind: "audio", audio}` (MP3 bytes).
 */
async function speak(businessId, key, { agentId = null } = {}) {
  const { text, language } = sentenceFor(businessId, key);
  if (agentId) {
    await agent.speak(agentId, text, { priority: "APPEND", interruptable: true });
    return { kind: "spoken" };
  }
  return { kind: "audio", audio: await murfAudio(text, { language, voiceSpeed: profile.get(businessId).voice_speed }) };
}

module.exports = { speak, sentenceFor, setFetch, cacheDir, RATE };
