"use strict";

/**
 * Agora Conversational AI v2 REST: start, stop, speak, think, history.
 *
 * Every request shape here is the one verified live in spike S0
 * (docs/build/agora-findings.md sections 2, 3, 6 and 10):
 * - managed OpenAI LLM: credential_mode "managed", vendor/style "openai", params.model "gpt-4.1-mini";
 * - Sarvam ASR with params.language "unknown" (auto-detect);
 * - Murf TTS with voiceId (camelCase), region through base_url, model "FALCON";
 * - tools through llm.mcp_servers (streamable_http) + advanced_features.enable_tools;
 * - transcripts over RTM: advanced_features.enable_rtm + parameters.data_channel "rtm";
 * - no greeting_message: the disclosure is spoken through /speak INTERRUPT, interruptable false,
 *   right after /join (greeting_configs.interruptable:false was not honoured live).
 *
 * The only network boundary is `fetch`; tests replace it with `setFetch`.
 */

const { config } = require("../config");
const { buildRtcRtmToken } = require("./token");

const REST_BASE = "https://api.agora.io/api/conversational-ai-agent";
const MURF_BASE_URLS = {
  global: "wss://global.api.murf.ai/v1/speech/stream-input",
  in: "wss://in.api.murf.ai/v1/speech/stream-input",
};
const MURF_MODEL = "FALCON";
const LLM_MODEL = "gpt-4.1-mini";
const SPEAK_MAX_BYTES = 500; // docs limit 512 bytes; kept under it on purpose
/**
 * Hard cap on one owner call. The agent's RTC+RTM token and the MCP bearer both live this long
 * and are not renewed, so the cap must outlast any real call: with 30 min the agent's token
 * expired, Agora dropped the agent from the channel and the console ended the call (E2E r2).
 * The bearer is refused as soon as its sessions row ends (src/mcp-server.js), so a long exp
 * does not outlive the call.
 */
const OWNER_SESSION_SECONDS = 2 * 60 * 60;
const OWNER_IDLE_TIMEOUT_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 15000;
const RETRYABLE = new Set([429, 503, 504]);
const OWNER_MCP_SERVER_NAME = "sahay";

class AgoraError extends Error {
  constructor(code, message, { status, reason } = {}) {
    super(message);
    this.name = "AgoraError";
    this.code = code;
    if (status !== undefined) this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}

/* ------------------------------------------------------------ transport --- */

let fetchImpl = (...args) => fetch(...args);

/** Tests replace the network boundary. Pass null to restore the global fetch. */
function setFetch(fn) {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

/**
 * One line per POST (/join, /speak, /update, /leave) with its status and duration, so a slow call
 * start can be split into its parts from the server log (E2E r3: 10.8 s from Start call to the
 * disclosure). Method, path with the agent id masked, status and milliseconds only: never a
 * header, a body or a credential.
 */
let timingLog = (line) => console.info(line);
function setTimingLog(fn) {
  timingLog = fn ?? ((line) => console.info(line));
}
const maskPath = (path) => path.replace(/agents\/[^/]+/, "agents/<id>");

function basicAuth() {
  const { customerId, customerSecret } = config.agora;
  if (!customerId || !customerSecret) throw new AgoraError("AGORA_NOT_CONFIGURED", "AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET are required.");
  return "Basic " + Buffer.from(`${customerId}:${customerSecret}`).toString("base64");
}

function projectPath(path) {
  if (!config.agora.appId) throw new AgoraError("AGORA_NOT_CONFIGURED", "AGORA_APP_ID is required.");
  return `${REST_BASE}/v2/projects/${encodeURIComponent(config.agora.appId)}${path}`;
}

/**
 * One REST call. Returns the parsed JSON body (or null for an empty 200).
 * Error bodies are `{detail, reason}`; only `reason` and the status reach the
 * error message, never a header or a credential.
 */
async function call(method, path, body, { retry = false } = {}) {
  const attempts = retry ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    let res;
    const sentAt = Date.now();
    try {
      res = await fetchImpl(projectPath(path), {
        method,
        headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof AgoraError) throw err;
      if (attempt < attempts) continue;
      throw new AgoraError("AGORA_UNREACHABLE", `Agora did not answer: ${err.name === "TimeoutError" ? "timed out" : err.message}`);
    }
    const text = await res.text();
    if (method !== "GET") timingLog(`[agora] ${method} ${maskPath(path)} ${res.status} in ${Date.now() - sentAt} ms`);
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (res.status === 200) return json;
    if (RETRYABLE.has(res.status) && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    const reason = typeof json?.reason === "string" ? json.reason : null;
    const code = res.status === 404 ? "AGENT_NOT_FOUND" : res.status === 401 ? "AGORA_UNAUTHORIZED" : res.status === 409 ? "AGENT_CONFLICT" : "AGORA_REQUEST_FAILED";
    throw new AgoraError(code, `Agora ${method} ${maskPath(path)} answered ${res.status}${reason ? ` (${reason})` : ""}`, {
      status: res.status,
      reason,
    });
  }
}

/* ------------------------------------------------------------- language --- */

const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const languageOf = (language) => (LANGUAGES.includes(language) ? language : "hi-IN");

const FAILURE_MESSAGE = {
  "hi-IN": "माफ़ कीजिए, अभी जवाब नहीं मिल पाया। कृपया दोबारा बोलिए।",
  "kn-IN": "ಕ್ಷಮಿಸಿ, ಈಗ ಉತ್ತರ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.",
  "en-IN": "Sorry, I could not get an answer just now. Please say that again.",
};

const LANGUAGE_NAMES = { "hi-IN": "Hindi", "kn-IN": "Kannada", "en-IN": "English" };

/**
 * Fallback filler the model says before a tool call when Agora's own filler words are not on
 * (a /join that refused the tuning block). The prompt lists all three, so no one language biases
 * the model (E2E r2).
 */
const FILLER = {
  "hi-IN": "एक सेकंड, देख रही हूँ।",
  "kn-IN": "ಒಂದು ಕ್ಷಣ, ನೋಡುತ್ತೇನೆ.",
  "en-IN": "One moment, let me check.",
};

/**
 * Agora "talking while waiting" (properties.filler_words, agora-findings.md "Track POLISH"):
 * static fallback phrases, at most 20 characters each in Devanagari / Kannada (docs limit for
 * non-Latin scripts) and a few words in English. Several per language so shuffle never repeats
 * the same one twice in a row; feminine Hindi forms (Sahay speaks with a woman's voice).
 */
const FILLER_PHRASES = {
  "hi-IN": ["हाँ जी, एक सेकंड।", "अच्छा, देखती हूँ।", "जी, बस एक पल।", "हम्म, देख रही हूँ।", "ठीक है, ज़रा रुकिए।", "अच्छा जी, एक मिनट।"],
  "kn-IN": ["ಸರಿ, ಒಂದು ನಿಮಿಷ.", "ಹೂಂ, ನೋಡ್ತೀನಿ.", "ಆಯ್ತು, ಒಂದು ಕ್ಷಣ.", "ಸರಿ ಸರಿ, ನೋಡ್ತೀನಿ.", "ಹಾಂ, ಒಂದು ಸೆಕೆಂಡ್."],
  "en-IN": ["Okay, one sec.", "Hmm, let me see.", "Sure, give me a moment.", "Right, checking that now.", "Got it, one moment."],
};

/** Prompt for Agora's hosted filler generator: a 2-5 word acknowledgement in the owner's own language and script. */
const FILLER_PROMPT = [
  "Write only what a warm, quick Indian shop assistant says out loud in the first second after hearing the shop owner's message, while she looks something up.",
  'Two to five words: a short acknowledgement or thinking sound, nothing else. Examples: Hindi "हाँ जी, एक सेकंड", "अच्छा, देखती हूँ", "हम्म, ज़रा देखूँ"; Kannada "ಸರಿ, ಒಂದು ನಿಮಿಷ", "ಹೂಂ, ನೋಡ್ತೀನಿ"; English "Okay, one sec", "Hmm, let me see".',
  "Use exactly the language of the owner's message: Hindi in Devanagari script with feminine forms, Kannada in Kannada script, English in English. Never write Hindi or Kannada in Latin letters.",
  "Never answer the message, never a number, price, name, promise or question.",
].join(" ");

/** Wait before a filler plays: gpt-4.1-mini starts a plain reply well within this; a tool call does not. */
const FILLER_WAIT_MS = 1000;

/**
 * Turn taking for a busy shop (agora-findings.md "Track POLISH"): VAD start of speech with a
 * slightly longer barge-in while Sahay speaks (shop noise should not cut her off), VAD end of
 * speech (semantic end of speech is English and Chinese only), interruption on start of speech.
 */
const TURN_DETECTION = {
  mode: "default",
  config: {
    start_of_speech: { mode: "vad", vad_config: { interrupt_duration_ms: 160, speaking_interrupt_duration_ms: 240, prefix_padding_ms: 800 } },
    end_of_speech: { mode: "vad", vad_config: { silence_duration_ms: 600 } },
  },
};

/** The owner-call tuning block: filler words in the call language plus turn detection. */
function voiceTuning(language) {
  return {
    filler_words: {
      enable: true,
      trigger: { fixed_time_config: { response_wait_ms: FILLER_WAIT_MS } },
      content: {
        mode: "generated",
        static_config: { phrases: [...FILLER_PHRASES[languageOf(language)]], selection_rule: "shuffle" },
        generated_config: { prompt: FILLER_PROMPT, context_message_limit: 1 },
      },
    },
    turn_detection: structuredClone(TURN_DETECTION),
    interruption: { enable: true, mode: "start_of_speech" },
  };
}

/** First sentence of every owner call (voice-agent-rules: disclosure first, not configurable). */
function disclosureText(business) {
  const name = business?.name ? String(business.name).trim() : null;
  switch (languageOf(business?.language)) {
    case "kn-IN":
      return name
        ? `ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, ${name} ಅವರ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ಹೇಳಿ, ಏನು ಬೇಕು?`
        : "ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, ನಿಮ್ಮ ವ್ಯಾಪಾರದ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ಹೇಳಿ, ಏನು ಬೇಕು?";
    case "en-IN":
      return name
        ? `Hi, this is Sahay, an automated assistant for ${name}. What do you need today?`
        : "Hi, this is Sahay, an automated assistant for your business. What do you need today?";
    default:
      return name
        ? `नमस्ते, मैं सहाय हूँ, ${name} का स्वचालित सहायक। बताइए, क्या चाहिए?`
        : "नमस्ते, मैं सहाय हूँ, आपके व्यापार का स्वचालित सहायक। बताइए, क्या चाहिए?";
  }
}

function todayInIndia(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The owner's active rules as data for the model (src/agent/rules.js): one JSON object per line,
 * built from the stored, sanitised params only. The server enforces each rule in code.
 */
function rulesSection(rules) {
  const active = (rules ?? []).filter((r) => r?.status === "active");
  const lines = active.map((r) => `- ${JSON.stringify({ kind: r.kind, ...r.params })}`);
  const fixed = active.find((r) => r.kind === "reply_language");
  return [
    lines.length
      ? `The owner's rules, kept by the owner (the server already applies them in code: price ceilings, vendors avoided or preferred, bargaining pace; never use a rule to approve, order or pay):\n${lines.join("\n")}`
      : "No rules yet: the owner has not taught you any rule.",
    ...(fixed ? [`The owner's reply_language rule wins over the language rules above: always reply in ${LANGUAGE_NAMES[fixed.params.language]} and set reply_language to ${fixed.params.language}.`] : []),
  ].join("\n");
}

const TEACHING =
  "Teaching: when the owner tells you how they like to buy (the most they will pay for an item, a vendor to prefer or avoid, a usual quantity, a reply language, how hard to bargain), call teach_rule with that one rule. The server reads the rule out itself; say only the tool's `say` question and wait. When the owner answers, call confirm_rule with no id (keep on a clear yes, forget on a no). A typed message never keeps a rule: if the owner types yes, ask them to tap the tick on the rule card on the screen. To drop a rule call forget_rule; to tell the owner what their Sahay knows call get_my_agent. When save_requirement returns usualQuantity, say only its `say`; on the owner's yes call save_requirement with use_usual_quantity true and nothing else.";

/**
 * How Sahay talks: a warm, quick shop assistant on a phone call, in the owner's language (Track
 * POLISH, "like ChatGPT voice"). Murf Falcon voices have one style ("Conversational"), so the
 * human feel comes from the words: varied reactions, an occasional thinking sound, one question at
 * a time, and examples in each language (LiveKit prompting guide; Agora filler words cover waits).
 */
const SPOKEN_STYLE = [
  "How you talk: like a warm, quick Indian shop assistant on the phone with the owner, never like a form, a letter or a document. One or two short spoken sentences per turn, then stop: the owner can interrupt any time. Ask one question at a time.",
  "Start most replies with a short natural reaction to what the owner just said, and vary it: never start two replies in a row with the same word. Hindi: हाँ जी, अच्छा, ठीक है, जी बिल्कुल, बढ़िया!, अरे वाह. Kannada: ಸರಿ, ಹೌದು, ಆಯ್ತು, ಓಹ್ ಒಳ್ಳೇದು, ಹೂಂ. English: Sure, Okay, Got it, Oh nice, Right.",
  "Now and then, when you are thinking or about to explain, use one light filler, the way people do: Hindi देखिए, हम्म, अच्छा तो; Kannada ನೋಡಿ, ಹೂಂ; English um, so, hmm. At most one per reply, never inside a price or a figure, and not in every reply.",
  "React like a person: good news gets a little warmth (बढ़िया!, ಒಳ್ಳೇದು!, Nice!), a problem gets a kind word (अरे, कोई बात नहीं; ಅಯ್ಯೋ, ಪರವಾಗಿಲ್ಲ; Ah, no problem), a maybe gets patience (कोई जल्दी नहीं; ಆರಾಮಾಗಿ ಹೇಳಿ; No rush). Never laugh, never write sounds like हाहा or haha.",
  "Never sound like you are reading: no 'please note', 'as follows', 'kindly', 'your request has been processed'. No lists, markdown, emoji, URLs, ids or tables, and never read out several vendors or options in a row: name the best one and say the rest are on the screen.",
  "Numbers: say every figure exactly as a tool gave it, in digits (the voice reads them aloud); units in full (किलो, ಕಿಲೋ, kilograms, pieces, days); large amounts in lakh and crore.",
  "Examples of the feel (the figures in real replies come only from tools):",
  'Hindi. Owner: "मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में।" You (after save_requirement): "अच्छा जी! 200 किलो बासमती चावल, बेंगलुरु के लिए; विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगी।" Owner: "कितना टाइम लगेगा?" You: "हम्म, बस एक-दो मिनट, मैं ख़ुद बता दूँगी।" Owner: "शायद, सोचता हूँ।" You: "जी, कोई जल्दी नहीं, आराम से सोच लीजिए।" Not: "आपकी आवश्यकता सफलतापूर्वक सहेज ली गई है।"',
  'Kannada. Owner: "ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು, ಬೆಂಗಳೂರಿಗೆ." You (after save_requirement): "ಸರಿ! 200 ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ, ಬೆಂಗಳೂರಿಗೆ; ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕ್ತಿದ್ದೀನಿ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳ್ತೀನಿ." Owner: "ಎಷ್ಟು ಹೊತ್ತು ಆಗುತ್ತೆ?" You: "ಹೂಂ, ಒಂದೆರಡು ನಿಮಿಷ ಅಷ್ಟೇ." Owner: "ಬೇಡ, ಬೇರೆ ನೋಡಿ." You: "ಆಯ್ತು, ಪರವಾಗಿಲ್ಲ."',
  'English. Owner: "I need 200 kilos of basmati rice in Bengaluru." You (after save_requirement): "Oh nice, got it: 200 kilograms of basmati rice for Bengaluru. I\'ve started looking for vendors and I\'ll tell you the moment I have them." Owner: "How long will it take?" You: "Hmm, just a minute or two." Owner: "Maybe, let me think." You: "Sure, no rush at all."',
];

/**
 * Whole-shop routing (business suite): which tools a sale, a payment received and a stock change
 * go to, and the one consent rule for every confirmation. The gates enforce it in code
 * (approvals.answerAfterSpoken); this only keeps the model from calling the wrong tool.
 */
const SHOP_WORK = [
  "Selling: a sale to a customer is a bill. Call draft_invoice with the customer and each line (item, quantity, unit, and price per unit if said), then request_invoice_approval in the same turn. A sale is never save_requirement: save_requirement is only for something the shop buys. If draft_invoice says an item is not saved yet, call set_item with its name, unit and selling price; pass hsn and gst_rate only when the owner said both, never fill them yourself; the server reads them back, and on the owner's clear yes call set_item again with only confirm true. Call add_customer only to save a customer's phone, GSTIN or state. The owner's yes or no to a bill goes to confirm_invoice.",
  "GST: bills are plain bills without GST until the shop's GSTIN is saved. Never ask for the shop's GSTIN unless the owner says the shop is GST-registered; then ask them to add the GST number in the Sell settings on the screen.",
  "Khata: when the owner says a customer paid, call record_payment with customer, amount, mode (cash or upi) and owner_words. The server reads the payment back; say only its `say` and wait. When the owner answers, call record_payment again with only decision (confirm on a clear yes, cancel on a no). who_owes_me tells who owes how much (pass customer for one person). send_payment_reminder prepares a reminder the owner sends from the WhatsApp button on the screen; nothing is sent by itself.",
  "Stock: set_opening_stock when the owner says how much of an item they have; get_stock for what is left or low; mark_order_delivered when a purchase order's goods have arrived; set_reorder_level when the owner says at what level to buy more (their answer to its read-back goes to confirm_rule). When the server has asked whether to buy more of a low item, the owner's yes or no goes to confirm_reorder with no item: a yes starts a vendor search only, never an order.",
  "Confirmations: for every deal, bill, payment received, item tax, rule or reorder, the server reads it out first; you say only the tool's `say` question, never repeat its figures, then wait. Only the owner's spoken yes after that read-back counts: a typed yes never counts (ask the owner to say it aloud or press the yes button on the card on the screen), and silence, maybe or a question is not a yes. The answer goes to the tool for that kind: confirm_approval for a deal, confirm_invoice for a bill, record_payment with decision for a payment, set_item with confirm for an item's tax, confirm_rule for a rule or a reorder level, confirm_reorder for buying more. If more than one thing is waiting, the owner's answer goes to the one read out last.",
  'Hindi sale and payment. Owner: "Ramesh Traders को 50 किलो बासमती, 90 रुपये किलो।" You (after draft_invoice and request_invoice_approval; the server reads the bill out): "बिल बना दूँ?" Owner: "हाँ, बना दो।" You (after confirm_invoice): "बढ़िया! बिल बन गया, व्हाट्सऐप वाला बटन स्क्रीन पर है।" Owner: "रमेश ने दो हज़ार रुपये नकद दिए।" You (after record_payment; the server reads it back): "खाते में लिख दूँ?" Owner: "हाँ।" You (after record_payment with decision confirm): "लिख लिया!"',
  'Kannada sale and payment. Owner: "Ramesh Traders ಅವರಿಗೆ 50 ಕಿಲೋ ಬಾಸ್ಮತಿ, ಕಿಲೋಗೆ 90 ರೂಪಾಯಿ." You (after draft_invoice and request_invoice_approval; the server reads the bill out): "ಬಿಲ್ ಮಾಡಲೇ?" Owner: "ಹೌದು, ಮಾಡಿ." You (after confirm_invoice): "ಆಯ್ತು! ಬಿಲ್ ಆಯ್ತು, ವಾಟ್ಸಾಪ್ ಬಟನ್ ಪರದೆಯ ಮೇಲಿದೆ." Owner: "ರಮೇಶ್ ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ನಗದು ಕೊಟ್ರು." You (after record_payment; the server reads it back): "ಖಾತೆಯಲ್ಲಿ ಬರೆಯಲೇ?" Owner: "ಹೌದು." You (after record_payment with decision confirm): "ಬರೆದುಕೊಂಡೆ!"',
  'English sale and payment. Owner: "Ramesh Traders, 50 kilos of basmati at 90 rupees a kilo." You (after draft_invoice and request_invoice_approval; the server reads the bill out): "Shall I make this bill?" Owner: "Yes, go ahead." You (after confirm_invoice): "Done! The bill is made; the WhatsApp button is on your screen." Owner: "Ramesh paid two thousand rupees in cash." You (after record_payment; the server reads it back): "Shall I write this in the khata?" Owner: "Yes." You (after record_payment with decision confirm): "Written down!"',
];

/** What happens while a tool runs: Agora plays a filler itself, or (without it) the model says one. */
function waitingLine(fillerWords) {
  return fillerWords
    ? 'Tools: when you need a tool, call it straight away without saying anything first; while it runs, the call plays a short filler like "हाँ जी, एक सेकंड" by itself, so never add your own "one moment" before a tool.'
    : `Before every tool call, first say a very short filler in the owner's language, then call the tool: in English "${FILLER["en-IN"]}", in Hindi "${FILLER["hi-IN"]}", in Kannada "${FILLER["kn-IN"]}".`;
}

/**
 * The owner agent's system prompt. Encodes the voice-agent-rules skill; the hard
 * rules (disclosure, approval, money read-back, tenant) are also enforced in code.
 * `rules` are the owner's rules (only the active ones are listed). `fillerWords` says whether
 * Agora's own filler words are on for this call (voiceTuning); default true.
 */
function systemPrompt(business, { now = new Date(), rules = [], fillerWords = true } = {}) {
  const language = languageOf(business?.language);
  const where = [business?.name && `the business "${business.name}"`, business?.city && `in ${business.city}`].filter(Boolean).join(" ");
  return [
    `You are Sahay, an automated assistant that runs the shop for ${where || "an Indian small business"}: buying from vendors, selling to customers, the khata (who owes the shop) and stock. You talk to the owner by voice.`,
    "The system has already told the owner that you are an automated assistant. Do not greet again; answer what the owner says.",
    `Today's date in India is ${todayInIndia(now)}.`,
    "Language: choose the language of every reply, filler included, from the owner's most recent sentence only. An English sentence gets an English reply; a Hindi sentence gets Hindi in Devanagari script; a Kannada sentence gets Kannada in Kannada script. Hindi or Kannada words written in Latin letters count as Hindi or Kannada: answer them in their own script. Code-mixed: reply in the language most of the owner's words are in. Never write Hindi or Kannada in Latin letters.",
    "Script: a Hindi reply uses only Devanagari and a Kannada reply only Kannada script, for every word: fillers, loanwords, item names and city names (बेंगलुरु in Hindi, ಬೆಂಗಳೂರು in Kannada). Never put a Devanagari word in a Kannada reply or a Kannada word in a Hindi reply, and never a word that joins Latin letters to Devanagari or Kannada letters. Inside Hindi or Kannada the only Latin letters allowed are a vendor's, customer's or business's own name, a purchase-order or bill number and the word Razorpay; digits are fine. If a tool's `say` has a city or an item in another script, say that word in the reply's script.",
    `The greeting was spoken in ${LANGUAGE_NAMES[language]} because that is the business's language. That greeting does not decide your reply language, and neither do your earlier replies or the language of tool results. When the owner switches language, switch with them at once.`,
    "Every tool takes reply_language: always set it to the language of the owner's last sentence (hi-IN for Hindi, kn-IN for Kannada, en-IN for English), so the tool's `say` comes back in that language.",
    "Voice: you speak with a woman's voice, so when you speak Hindi always use feminine first-person forms (मैं देख रही हूँ, बताऊँगी, कर दिया/कर दी as the object requires, मैं कर पाई), never masculine ones.",
    ...SPOKEN_STYLE,
    waitingLine(fillerWords),
    "Never invent a number, price, count, date, vendor or status. They come only from tool results. If a tool has not returned yet, say what is happening and that you will report back.",
    "Every tool result has a field `say`. Speak it as your answer, word for word when it contains money, a price, a quantity or a total; you may put one short natural reaction in front of it (अच्छा जी, ಸರಿ, Okay). Never change a figure from a tool. If a `say` is not in the language of the owner's last sentence, say the same thing in the owner's language with every vendor name and figure unchanged.",
    "Ids: never pass an id you did not copy exactly from a tool result in this call, and normally pass none. Every tool works on the current requirement, the best vendor, the best deal, or the one approval or order waiting when its id is left out. To pick a vendor, use vendorRank (1 = best, as get_shortlist ranks them). If a tool answers with several choices, say the first one or two and ask which one.",
    "To understand a purchase, call save_requirement as soon as you know the item, passing item, unit and city in the words and script the owner used (बासमती चावल, ಬಾಸ್ಮತಿ ಅಕ್ಕಿ, basmati rice). When the owner states a purchase with its quantity, even one said before or in another language, call save_requirement with the item and no id. To add details later, call save_requirement again without item and without an id. If its result lists missing fields, ask for them, at most two clarifying questions in total, then continue with what you have. Always pass owner_words: the owner's last sentence word for word. Pass only an item, quantity and unit the owner actually said; if the owner's words are cut off (for example only a number), never fill them in from earlier turns: ask the owner to say it again. When save_requirement returns saved false, nothing was saved: speak its `say` and wait.",
    "Once nothing is missing, save_requirement starts the vendor search itself in a call (sourcingStarted true): speak its `say` and stop; do not call start_sourcing as well. If it returns an empty missing list with sourcingStarted false and no sourcingError, call start_sourcing in the same turn, right after speaking its `say`, without asking anything first. A maximum price is optional: never ask for it before the search has started. If the owner gives one, pass it to save_requirement as max_price_per_unit; otherwise you may ask for it once, after the search has finished and before a negotiation starts.",
    "Sourcing and negotiation take time: start them with start_sourcing or start_negotiation, say that it has started and that you will report back, then stop talking. Progress and results are announced to the owner automatically, so do not call get_job_status or get_shortlist right after starting a job just to report it, and do not repeat an announcement.",
    "Jobs: when the owner asks to search or to negotiate, call start_sourcing or start_negotiation every time, even to try again after a negotiation ended or failed; the tool itself answers if one is still running. Never say a search or negotiation is already running, finished or failed from memory of earlier turns: that comes only from a tool result in this turn or from the latest Call status system message, which the server keeps current.",
    "Sourcing searches real vendors listed on IndiaMART. Never call those vendors, or the search, simulated.",
    "Negotiation: call start_negotiation without a vendor to negotiate with a simulated vendor priced from the best real listing that has a comparable price, unless the owner names a vendor by rank or asks for a real vendor to join by link (counterpart human). Only that negotiation counterpart is simulated: call it a simulated vendor (सिम्युलेटेड विक्रेता / ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್), and use the word simulated for nothing else.",
    "Approval: before any order call request_approval once (no id: it takes the best deal). The server itself reads the deal out to the owner; you only say the tool's `say` question, never repeat the figures, then wait for the owner's answer. Once request_approval has returned, the owner's next yes or no answers it: call confirm_approval with no id (the one deal waiting), decision approve on a clear yes, reject on a no. Never call request_approval again for that answer, and never ask whether to ask for approval about a deal already read out; call request_approval again only if the owner asks to hear the deal again, with repeat true. If the owner says maybe or later, say there is no hurry: the deal keeps waiting and their next yes or no still goes to confirm_approval. If a tool result has a `hint` or `next`, follow it. Silence, maybe, or a question is not a yes: ask again. The server checks the owner's own words. A typed yes never approves: the owner presses the yes card on the screen or says it aloud.",
    "Never say an order exists unless create_order returned an orderId or the latest Call status says the order was placed. Never say a payment link exists unless create_payment_link returned a url. Payment links are Razorpay test mode.",
    "Usual order of buying: save_requirement, start_sourcing, get_shortlist, start_negotiation, get_ranked_deals, request_approval, confirm_approval, create_order, create_payment_link. Use get_job_status and get_order_status when the owner asks how things are going.",
    TEACHING,
    ...SHOP_WORK,
    rulesSection(rules),
  ].join("\n");
}

/* ------------------------------------------------------------ join body --- */

function murfBaseUrl() {
  const region = config.murf.region ?? "global";
  const url = MURF_BASE_URLS[region];
  if (!url) throw new AgoraError("MURF_REGION_INVALID", `MURF_REGION must be one of: ${Object.keys(MURF_BASE_URLS).join(", ")}.`);
  return url;
}

/**
 * Build a /join body. Pure apart from reading keys from config.
 * @param {object} o
 * @param {string} o.name               unique agent name
 * @param {string} o.channel
 * @param {string} o.token              RTC+RTM token minted for o.agentUid
 * @param {number|string} o.agentUid
 * @param {(number|string)[]} o.remoteUids  docs: only one uid is supported
 * @param {string} o.language           hi-IN | kn-IN | en-IN (Murf locale and ASR hint)
 * @param {string} o.voiceId            Murf voice id
 * @param {string} o.prompt             system prompt
 * @param {{name: string, endpoint: string, bearer: string, allowedTools: string[]}} [o.mcp]
 * @param {number} [o.idleTimeout]
 * @param {object} [o.labels]
 * @param {boolean} [o.tuning]           add filler words, turn detection and interruption (owner calls)
 */
function buildJoinBody(o) {
  for (const field of ["name", "channel", "token", "voiceId", "prompt"]) {
    if (!o[field]) throw new AgoraError("JOIN_BODY_INVALID", `A join body needs ${field}.`);
  }
  if (!Array.isArray(o.remoteUids) || o.remoteUids.length !== 1) {
    throw new AgoraError("JOIN_BODY_INVALID", "remote_rtc_uids takes exactly one uid (docs: only one is supported).");
  }
  if (!config.sarvam.key) throw new AgoraError("SARVAM_NOT_CONFIGURED", "SARVAM_API_KEY is required.");
  if (!config.murf.key) throw new AgoraError("MURF_NOT_CONFIGURED", "MURF_API_KEY is required.");
  const language = languageOf(o.language);

  const llm = {
    credential_mode: "managed",
    vendor: "openai",
    style: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    params: { model: LLM_MODEL },
    system_messages: [{ role: "system", content: o.prompt }],
    failure_message: FAILURE_MESSAGE[language],
    max_history: 32,
  };
  const advanced = { enable_rtm: true };
  if (o.mcp) {
    if (!/^[A-Za-z0-9]{1,48}$/.test(o.mcp.name)) throw new AgoraError("JOIN_BODY_INVALID", "An MCP server name is letters and digits, at most 48.");
    if (!/^https:\/\//.test(o.mcp.endpoint)) throw new AgoraError("PUBLIC_URL_NOT_HTTPS", "Agora reaches the MCP server only over public HTTPS: set PUBLIC_URL to an https URL.");
    if (!Array.isArray(o.mcp.allowedTools) || o.mcp.allowedTools.length === 0 || o.mcp.allowedTools.length > 32) {
      throw new AgoraError("JOIN_BODY_INVALID", "allowed_tools lists 1 to 32 registered tool names.");
    }
    llm.mcp_servers = [
      {
        name: o.mcp.name,
        endpoint: o.mcp.endpoint,
        transport: "streamable_http",
        headers: { Authorization: `Bearer ${o.mcp.bearer}` },
        allowed_tools: o.mcp.allowedTools,
        timeout_ms: 10000,
      },
    ];
    advanced.enable_tools = true;
  }

  const body = {
    name: o.name,
    properties: {
      channel: o.channel,
      token: o.token,
      agent_rtc_uid: String(o.agentUid),
      remote_rtc_uids: o.remoteUids.map(String),
      enable_string_uid: false,
      idle_timeout: o.idleTimeout ?? OWNER_IDLE_TIMEOUT_SECONDS,
      advanced_features: advanced,
      asr: { vendor: "sarvam", language, params: { api_key: config.sarvam.key, language: "unknown" } },
      llm,
      tts: {
        vendor: "murf",
        params: {
          api_key: config.murf.key,
          base_url: murfBaseUrl(),
          voiceId: o.voiceId,
          locale: language,
          rate: 0,
          pitch: 0,
          model: MURF_MODEL,
          sample_rate: 24000,
        },
      },
      parameters: { data_channel: "rtm", enable_metrics: true, enable_error_message: true },
    },
  };
  if (o.labels) body.properties.labels = o.labels;
  if (o.tuning) Object.assign(body.properties, voiceTuning(language));
  return body;
}

/** Deep copy with every credential replaced; safe for logs and evidence files. */
function redactJoinBody(body) {
  const copy = structuredClone(body);
  const p = copy.properties;
  p.token = "<redacted>";
  if (p.asr?.params?.api_key) p.asr.params.api_key = "<redacted>";
  if (p.tts?.params?.api_key) p.tts.params.api_key = "<redacted>";
  for (const server of p.llm?.mcp_servers ?? []) {
    for (const header of Object.keys(server.headers ?? {})) server.headers[header] = "<redacted>";
  }
  return copy;
}

/* ------------------------------------------------------------ lifecycle --- */

/** POST /join. Returns `{agentId, status, createTs}`. */
async function startAgent(body) {
  const json = await call("POST", "/join", body);
  if (!json?.agent_id) throw new AgoraError("JOIN_BAD_RESPONSE", "Agora answered /join without an agent_id.");
  return { agentId: json.agent_id, status: json.status ?? null, createTs: json.create_ts ?? null };
}

/**
 * Start the owner's voice agent in `channel`, listening to `userUid`.
 * The MCP bearer is a signed session (auth scope "mcp", bound to an owner sessions row)
 * that lives as long as the call.
 * Lazy requires keep this module loadable without the business layer in tests.
 */
async function startOwnerAgent({ businessId, sessionId, channel, agentUid, userUid, language, now = Date.now() }) {
  const repo = require("../db/repo");
  const auth = require("../auth");
  const registry = require("../tools/registry");
  const business = repo.getBusiness(businessId);
  if (!business) throw new AgoraError("BUSINESS_NOT_FOUND", "No such business.");
  const lang = languageOf(language ?? business.language);
  const voiceId = config.murf.voices[lang];
  if (!voiceId) throw new AgoraError("MURF_VOICE_MISSING", `No Murf voice configured for ${lang}.`);
  if (!config.publicUrl) throw new AgoraError("PUBLIC_URL_MISSING", "PUBLIC_URL is required for the MCP endpoint.");

  const exp = Math.floor(now / 1000) + OWNER_SESSION_SECONDS;
  // auth scope "mcp"; which tools the bearer may call follows from the sessions row kind ("owner").
  const bearer = auth.signSession({ businessId, sessionId, scope: "mcp", exp });
  const { token } = buildRtcRtmToken(channel, agentUid, OWNER_SESSION_SECONDS);
  const rules = require("../agent/rules").active(businessId);
  const promptFor = (fillerWords) => systemPrompt({ ...business, language: lang }, { now: new Date(now), rules, fillerWords });
  const bodyFor = (tuning) => buildJoinBody({
    name: `sahay-${sessionId}-${now}`.slice(0, 64),
    channel,
    token,
    agentUid,
    remoteUids: [userUid],
    language: lang,
    voiceId,
    prompt: promptFor(tuning),
    mcp: {
      name: OWNER_MCP_SERVER_NAME,
      endpoint: `${config.publicUrl}/mcp`,
      bearer,
      allowedTools: registry.toolNames(registry.SCOPES.owner),
    },
    labels: { session: sessionId },
    tuning,
  });
  let tuning = true;
  let started;
  try {
    started = await startAgent(bodyFor(true));
  } catch (err) {
    // The tuning block (filler words, turn detection) is DOCS ONLY until a live /join takes it:
    // a 400 for it must not cost the owner the call, so join once more with the S0-verified body.
    if (!(err instanceof AgoraError) || err.status !== 400) throw err;
    console.warn(`[agora] /join refused the voice tuning block (${err.message}); joining without filler words and turn tuning.`);
    tuning = false;
    started = await startAgent(bodyFor(false));
  }
  const prompt = promptFor(tuning);
  callPrompts.set(started.agentId, { prompt, businessId, language: lang, now, status: "", fillerWords: tuning });
  return { ...started, language: lang, voiceTuning: tuning, disclosure: disclosureText({ ...business, language: lang }) };
}

/**
 * agentId -> {prompt, businessId, language, now, status}: the system prompt it joined with (or the
 * latest rebuilt by refreshRules) and the last call status, so /update can re-send both.
 */
const callPrompts = new Map();

function systemMessages(known) {
  const messages = [{ role: "system", content: known.prompt }];
  if (known.status) messages.push({ role: "system", content: known.status });
  return messages;
}

function timeInIndia(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/**
 * Tell a running owner agent's LLM the current state of the call's jobs, so it never answers
 * "already running" from memory (E2E r2). /speak lines are not documented to enter the LLM
 * context, so the state goes in as a second system message.
 *
 * POST /agents/{id}/update {"properties":{"llm":{"system_messages":[...]}}} (docs: update.md;
 * system_messages are prepended to every LLM request). Only system_messages is sent: /update
 * overwrites `params` entirely when it is present. The join prompt is re-sent word for word.
 */
async function updateCallStatus(agentId, status, { now = new Date() } = {}) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "updateCallStatus needs an agent id.");
  const known = callPrompts.get(agentId);
  if (!known) throw new AgoraError("AGENT_UNKNOWN", "No owner agent with that id was started by this server.");
  const text = String(status ?? "").trim();
  known.status = text ? `Call status (from the server, ${timeInIndia(now)} IST): ${text}` : "";
  return call("POST", `/agents/${encodeURIComponent(agentId)}/update`, { properties: { llm: { system_messages: systemMessages(known) } } });
}

/**
 * Re-send a running owner agent's prompt with the business's rules as they are now (a rule was
 * kept or forgotten during the call), keeping its last call status. Same /update as above.
 */
async function refreshRules(agentId, businessId) {
  const known = callPrompts.get(agentId);
  if (!known || known.businessId !== businessId) throw new AgoraError("AGENT_UNKNOWN", "No owner agent of this business with that id was started by this server.");
  const business = require("../db/repo").getBusiness(businessId);
  known.prompt = systemPrompt({ ...business, language: known.language }, { now: new Date(known.now), rules: require("../agent/rules").active(businessId), fillerWords: known.fillerWords !== false });
  return call("POST", `/agents/${encodeURIComponent(agentId)}/update`, { properties: { llm: { system_messages: systemMessages(known) } } });
}

/** POST /leave. An agent that is already gone (404) counts as stopped. */
async function stopAgent(agentId) {
  if (!agentId) return { stopped: false };
  callPrompts.delete(agentId);
  try {
    await call("POST", `/agents/${encodeURIComponent(agentId)}/leave`, undefined, { retry: true });
    return { stopped: true };
  } catch (err) {
    if (err instanceof AgoraError && err.status === 404) return { stopped: true, alreadyGone: true };
    throw err;
  }
}

/**
 * GET /agents/{id} -> `{message, start_ts, stop_ts, status, agent_id, name}` (agora-findings.md,
 * "Query status", VERIFIED). `status` is IDLE | STARTING | RUNNING | STOPPING | STOPPED | FAILED.
 * An agent Agora no longer knows answers 404 (AgoraError with status 404).
 */
async function agentStatus(agentId) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "agentStatus needs an agent id.");
  const json = await call("GET", `/agents/${encodeURIComponent(agentId)}`);
  return { status: typeof json?.status === "string" ? json.status : null, stopTs: json?.stop_ts ?? null };
}

/* ------------------------------------------------------------- speaking --- */

const SENTENCE_END = /[।॥.!?]\s*/gu;

/**
 * Split text into pieces of at most `maxBytes` UTF-8 bytes, preferring sentence
 * ends, then spaces, never cutting inside a code point.
 */
function splitUtf8(text, maxBytes = SPEAK_MAX_BYTES) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  if (bytes(clean) <= maxBytes) return [clean];

  const sentences = clean.split(SENTENCE_END).length > 1 ? clean.match(/[^।॥.!?]+[।॥.!?]*\s*/gu) : [clean];
  const pieces = [];
  let current = "";
  const pushHard = (segment) => {
    // A single segment over the limit: cut at spaces, then at code points.
    let rest = segment;
    while (bytes(rest) > maxBytes) {
      let cut = "";
      for (const word of rest.split(/(\s+)/)) {
        if (bytes(cut + word) > maxBytes) break;
        cut += word;
      }
      if (!cut.trim()) {
        cut = "";
        for (const ch of rest) {
          if (bytes(cut + ch) > maxBytes) break;
          cut += ch;
        }
      }
      pieces.push(cut.trim());
      rest = rest.slice(cut.length);
    }
    return rest;
  };
  for (const sentence of sentences) {
    if (bytes(current + sentence) <= maxBytes) {
      current += sentence;
      continue;
    }
    if (current.trim()) pieces.push(current.trim());
    current = bytes(sentence) > maxBytes ? pushHard(sentence) : sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}

/**
 * POST /speak. Text over the byte limit is sent as several requests: the first
 * with the given priority, the rest APPEND so they play in order.
 * @param {{priority?: 'INTERRUPT'|'APPEND'|'IGNORE', interruptable?: boolean}} [options]
 */
async function speak(agentId, text, { priority = "APPEND", interruptable = true } = {}) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "speak needs an agent id.");
  if (!["INTERRUPT", "APPEND", "IGNORE"].includes(priority)) throw new AgoraError("SPEAK_INVALID", `Unknown priority ${priority}.`);
  const pieces = splitUtf8(text);
  if (!pieces.length) throw new AgoraError("SPEAK_INVALID", "Nothing to speak.");
  const results = [];
  for (const [index, piece] of pieces.entries()) {
    results.push(
      await call("POST", `/agents/${encodeURIComponent(agentId)}/speak`, {
        text: piece,
        priority: index === 0 ? priority : "APPEND",
        interruptable,
      }),
    );
  }
  return { pieces: pieces.length, results };
}

/**
 * POST /think: inject text as a user message so the LLM words a reply.
 * Defaults append in every state so an owner turn is never cut.
 */
async function think(agentId, text, { onListening = "append", onThinking = "append", onSpeaking = "append", interruptable = true, metadata } = {}) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "think needs an agent id.");
  const body = {
    text: String(text),
    on_listening_action: onListening,
    on_thinking_action: onThinking,
    on_speaking_action: onSpeaking,
    interruptable,
  };
  if (metadata) body.metadata = metadata;
  return call("POST", `/agents/${encodeURIComponent(agentId)}/think`, body);
}

/** GET /history (running agents only). Returns the `contents` array. */
async function history(agentId) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "history needs an agent id.");
  const json = await call("GET", `/agents/${encodeURIComponent(agentId)}/history`, undefined, { retry: true });
  if (!Array.isArray(json?.contents)) throw new AgoraError("HISTORY_BAD_RESPONSE", "Agora answered /history without contents.");
  return json.contents;
}

/**
 * The last thing a human said: the last item with role "user" and
 * metadata.source "asr" (LIVE shape, agora-findings.md section 10). `at` is the
 * item's `timestamp` (ms since epoch on Agora's clock).
 */
function lastUserUtterance(contents) {
  for (let i = (contents?.length ?? 0) - 1; i >= 0; i--) {
    const item = contents[i];
    if (item?.role === "user" && item?.metadata?.source === "asr" && typeof item.content === "string" && item.content.trim()) {
      const ms = Number.isFinite(item.timestamp) ? item.timestamp : Number.isFinite(item.speech_end_ms) ? item.speech_end_ms : null;
      return { text: item.content.trim(), at: ms == null ? null : new Date(ms).toISOString(), turnId: item.turn_id ?? null };
    }
  }
  return null;
}

module.exports = {
  AgoraError,
  setFetch,
  setTimingLog,
  buildJoinBody,
  redactJoinBody,
  systemPrompt,
  disclosureText,
  startAgent,
  startOwnerAgent,
  stopAgent,
  agentStatus,
  updateCallStatus,
  refreshRules,
  speak,
  think,
  history,
  lastUserUtterance,
  splitUtf8,
  languageOf,
  MURF_BASE_URLS,
  OWNER_SESSION_SECONDS,
  SPEAK_MAX_BYTES,
  FILLER,
  FILLER_PHRASES,
  FILLER_PROMPT,
  TURN_DETECTION,
  voiceTuning,
};
