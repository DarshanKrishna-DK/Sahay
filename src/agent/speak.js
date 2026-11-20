"use strict";

/**
 * Speak-it: every card in the app has a 🔊 that reads it aloud, so reading is never required.
 * The browser sends only a key ("now", "customers", "khata", "rule:<id>", "memory:<id>", "approval:<id>",
 * "order:<id>", "need:<id>", "invoice:<id>", "item:<id>", "owed:<customerId>"); the sentence is
 * always built here from this business's own rows, in its current reply language and script.
 * Free text from a client is never spoken.
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
const { langKey, ToolError } = require("../tools/errors");
const rules = require("./rules");
const memories = require("./memories");
const profile = require("./profile");
const policy = require("./policy");
const { AgentError } = require("./errors");

const MURF_HOSTS = { global: "global.api.murf.ai", in: "in.api.murf.ai", "us-east": "us-east.api.murf.ai" };
const MURF_MODEL = "falcon-2.1";
const SAMPLE_RATE = 24000;
/** Murf `rate` (-50..50) per profile voice_speed. */
const RATE = Object.freeze({ slow: -20, normal: 0 });
const REQUEST_TIMEOUT_MS = 15000;
const READBACK_LANGUAGE = { "hi-IN": "hi", "kn-IN": "kn", "en-IN": "en" };
/** A whole-screen key (no id), or a card key "<kind>:<id>". */
const KEY = /^(?:(now|customers|khata)|(rule|memory|approval|order|need|invoice|item|owed):([A-Za-z0-9_]{1,64}))$/;
/** Names read out by the customers key; the rest are counted ("and 3 more"). */
const CUSTOMER_NAMES_READ = 10;

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

/** An issued bill: its number, total and what is still due (amounts the way an owner says them). */
const BILL = {
  "hi-IN": (v) => `${v.name} का बिल ${v.number}। कुल ${v.total}। ${v.state}।`,
  "kn-IN": (v) => `${v.name} ಅವರ ಬಿಲ್ ${v.number}. ಒಟ್ಟು ${v.total}. ${v.state}.`,
  "en-IN": (v) => `Bill ${v.number} for ${v.name}. Total ${v.total}. ${v.state}.`,
};
const BILL_STATE = {
  unpaid: { "hi-IN": () => "अभी भुगतान नहीं हुआ", "kn-IN": () => "ಇನ್ನೂ ಪಾವತಿ ಆಗಿಲ್ಲ", "en-IN": () => "Not paid yet" },
  part: { "hi-IN": (open) => `${open} बाकी है`, "kn-IN": (open) => `${open} ಬಾಕಿ ಇದೆ`, "en-IN": (open) => `${open} still due` },
  paid: { "hi-IN": () => "भुगतान हो गया", "kn-IN": () => "ಪಾವತಿ ಆಗಿದೆ", "en-IN": () => "Paid" },
  cancelled: { "hi-IN": () => "यह बिल रद्द है", "kn-IN": () => "ಈ ಬಿಲ್ ರದ್ದಾಗಿದೆ", "en-IN": () => "Cancelled" },
};

/** The Sell screen's customer list: how many, then the names. */
const CUSTOMERS = {
  none: { "hi-IN": "अभी कोई ग्राहक नहीं है।", "kn-IN": "ಇನ್ನೂ ಗ್ರಾಹಕರು ಇಲ್ಲ.", "en-IN": "No customers yet." },
  list: {
    "hi-IN": (v) => `${v.n} ग्राहक: ${v.names}${v.more ? ` और ${v.more} अन्य` : ""}।`,
    "kn-IN": (v) => `${v.n} ${v.n === 1 ? "ಗ್ರಾಹಕ" : "ಗ್ರಾಹಕರು"}: ${v.names}${v.more ? ` ಮತ್ತು ಇನ್ನೂ ${v.more} ಜನ` : ""}.`,
    "en-IN": (v) => `${v.n} ${v.n === 1 ? "customer" : "customers"}: ${v.names}${v.more ? `, and ${v.more} more` : ""}.`,
  },
};

/** The Money screen's header: the total owed, from how many customers, and who owes the most. */
const KHATA = {
  one: {
    "hi-IN": (v) => `कुल ${v.total} बाकी हैं, एक ग्राहक से: ${v.name}।`,
    "kn-IN": (v) => `ಒಟ್ಟು ${v.total} ಬಾಕಿ ಇದೆ, ಒಬ್ಬ ಗ್ರಾಹಕರಿಂದ: ${v.name}.`,
    "en-IN": (v) => `In all ${v.total} is due, from one customer: ${v.name}.`,
  },
  many: {
    "hi-IN": (v) => `कुल ${v.total} बाकी हैं, ${v.n} ग्राहकों से। सबसे ज़्यादा ${v.name} के, ${v.amount}।`,
    "kn-IN": (v) => `ಒಟ್ಟು ${v.total} ಬಾಕಿ ಇದೆ, ${v.n} ಗ್ರಾಹಕರಿಂದ. ಹೆಚ್ಚು ಬಾಕಿ ${v.name} ಅವರದು, ${v.amount}.`,
    "en-IN": (v) => `In all ${v.total} is due from ${v.n} customers. The most is from ${v.name}, ${v.amount}.`,
  },
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
 * A bill waiting for the owner's yes is read exactly as the server's read-back (same figures, same
 * question); an issued one says its number, total and what is still due.
 */
function invoiceSentence(businessId, id, language) {
  const invoice = require("../sell/invoices").get(businessId, id);
  if (!invoice) throw notFound();
  if (invoice.status === "draft" || invoice.status === "pending") return require("../sell/gate").buildReadback(businessId, invoice, language);
  const khata = require("../sell/khata");
  const customer = require("../sell/customers").get(businessId, invoice.customerId);
  const open = invoice.status === "paid" || invoice.status === "cancelled" ? 0 : khata.invoiceOpenPaise(businessId, invoice);
  const state =
    invoice.status === "cancelled" ? BILL_STATE.cancelled[language]()
      : invoice.status === "paid" || open <= 0 ? BILL_STATE.paid[language]()
        : open < invoice.totals.totalPaise ? BILL_STATE.part[language](khata.spokenRupees(open, language))
          : BILL_STATE.unpaid[language]();
  return BILL[language]({ name: customer?.name ?? invoice.recipient?.name ?? "", number: invoice.number, total: khata.spokenRupees(invoice.totals.totalPaise, language), state });
}

function customersSentence(businessId, language) {
  const names = require("../sell/customers").list(businessId).map((c) => c.name).filter(Boolean);
  if (!names.length) return CUSTOMERS.none[language];
  const read = names.slice(0, CUSTOMER_NAMES_READ);
  return CUSTOMERS.list[language]({ n: names.length, names: read.join(", "), more: names.length - read.length });
}

/** Same rows and amounts as who_owes_me (khata.owed: largest first), so screen, call and speaker agree. */
function khataSentence(businessId, language) {
  const khata = require("../sell/khata");
  const rows = khata.owed(businessId);
  if (!rows.length) return require("../tools/khata").PHRASES.owed_none[language]();
  const total = khata.spokenRupees(rows.reduce((s, r) => s + r.amount_paise, 0), language);
  const [top] = rows;
  if (rows.length === 1) return KHATA.one[language]({ total, name: top.customer.name });
  return KHATA.many[language]({ total, n: rows.length, name: top.customer.name, amount: khata.spokenRupees(top.amount_paise, language) });
}

function itemSentence(businessId, id, language) {
  const item = require("../stock/items").get(businessId, id);
  if (!item) throw notFound();
  return require("../stock/say").stockOne(businessId, item, language).say;
}

function owedSentence(businessId, customerId, language) {
  const customer = require("../sell/customers").get(businessId, customerId);
  if (!customer) throw notFound();
  return require("../tools/khata").owedOne(businessId, customer, language).say;
}

/**
 * The sentence a key stands for, built from this business's rows: `{ text, language }`.
 * A key that is malformed or names another business's row is SPEAK_KEY_NOT_FOUND.
 */
function sentenceFor(businessId, key) {
  const match = typeof key === "string" ? KEY.exec(key) : null;
  if (!match) throw notFound();
  const language = currentLanguage(businessId);
  const [, screen, kind, id] = match;
  let text;
  if (screen === "now") text = nowSentence(businessId, language);
  else if (screen === "customers") text = customersSentence(businessId, language);
  else if (screen === "khata") text = khataSentence(businessId, language);
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
  else if (kind === "invoice") text = invoiceSentence(businessId, id, language);
  else if (kind === "item") text = itemSentence(businessId, id, language);
  else if (kind === "owed") text = owedSentence(businessId, id, language);
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

const READBACK_PENDING = {
  "hi-IN": "अभी एक सवाल आपकी हाँ या ना का इंतज़ार कर रहा है; पहले उसका जवाब दीजिए या स्क्रीन पर बटन दबाइए।",
  "kn-IN": "ಈಗ ಒಂದು ಪ್ರಶ್ನೆ ನಿಮ್ಮ ಹೌದು ಅಥವಾ ಇಲ್ಲ ಉತ್ತರಕ್ಕೆ ಕಾಯುತ್ತಿದೆ; ಮೊದಲು ಅದಕ್ಕೆ ಉತ್ತರಿಸಿ ಅಥವಾ ಪರದೆಯ ಮೇಲಿನ ಬಟನ್ ಒತ್ತಿ.",
  "en-IN": "A question is waiting for your yes or no; please answer it first, or use the buttons on the screen.",
};

/**
 * Read the card `key` aloud. With `agentId` (the owner's live call) the agent says it and the
 * result is `{kind: "spoken"}`; otherwise `{kind: "audio", audio}` (MP3 bytes).
 *
 * While a read-back waits for the owner's answer in that call, nothing is spoken (409
 * READBACK_PENDING): a card line between the question and the answer would make the owner's next
 * words an answer to it (security review r2 #3). It is not played in the browser either, where the
 * owner's microphone could pick it up as the owner's own turn.
 */
async function speak(businessId, key, { agentId = null } = {}) {
  const { text, language } = sentenceFor(businessId, key);
  if (agentId && require("../agora/confirm-watch").readbackWaiting(businessId, agentId)) {
    throw new ToolError("READBACK_PENDING", READBACK_PENDING[language], { status: 409, message: "A read-back is waiting for the owner's answer in this call; nothing else is spoken until it is answered." });
  }
  if (agentId) {
    await agent.speak(agentId, text, { priority: "APPEND", interruptable: true });
    return { kind: "spoken" };
  }
  return { kind: "audio", audio: await murfAudio(text, { language, voiceSpeed: profile.get(businessId).voice_speed }) };
}

module.exports = { speak, sentenceFor, setFetch, cacheDir, RATE };
