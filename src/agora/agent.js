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

const { AsyncLocalStorage } = require("node:async_hooks");
const { config } = require("../config");
const { buildRtcRtmToken } = require("./token");

const REST_BASE = "https://api.agora.io/api/conversational-ai-agent";
/**
 * MURF_REGION -> Falcon stream-input URL (murf.ai/api/docs/api-reference/text-to-speech/stream-input,
 * checked 2026-11-20). Default global. us-east is opt-in: it allows 5 concurrent Falcon streams
 * against 2 on global and every other region (murf.ai/api/docs/resources/rate-limits), at the cost
 * of a longer round trip from India.
 */
const MURF_BASE_URLS = {
  global: "wss://global.api.murf.ai/v1/speech/stream-input",
  in: "wss://in.api.murf.ai/v1/speech/stream-input",
  "us-east": "wss://us-east.api.murf.ai/v1/speech/stream-input",
};
const MURF_MODEL = "FALCON";
const LLM_MODEL = "gpt-4.1-mini";
const { SPEAK_MAX_BYTES } = require("./speech-fit"); // docs limit 512 bytes; kept under it on purpose
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
const SLOW_GET_MS = 2000;
/**
 * Owner-call LLM history (properties.llm.max_history: "the number of conversation history messages
 * cached in the LLM"; user and agent messages and tool call information count; default 32; docs:
 * join.md, checked 2026-11-19). Kept short so a long call's context stays bounded: what is waiting
 * for the owner (a read-back, a bill, a payment) lives in the "Call status" system message, which
 * is re-sent whole and is not part of this history (E2E full run, bug 1).
 */
const OWNER_MAX_HISTORY = 16;
/** Budget for one /history read inside a tool call: the MCP server's timeout_ms (10 s) covers the whole tool. */
const TOOL_HISTORY_TIMEOUT_MS = 4000;
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

/**
 * A failure worth one more try: Agora not answering, rate limited or a 5xx. A 4xx (bad body, bad
 * credentials, conflict) would fail the same way again, so it is reported at once. One rule for the
 * owner's /join (src/routes/api.js) and the negotiation agents' /join and /speak.
 */
const isTransient = (err) => err?.name === "AgoraError" && (err.code === "AGORA_UNREACHABLE" || [429, 500, 502, 503, 504].includes(err.status));

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
async function call(method, path, body, { retry = false, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const attempts = retry ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    let res;
    const sentAt = Date.now();
    try {
      res = await fetchImpl(projectPath(path), {
        method,
        headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof AgoraError) throw err;
      if (attempt < attempts) continue;
      throw new AgoraError("AGORA_UNREACHABLE", `Agora did not answer: ${err.name === "TimeoutError" ? "timed out" : err.message}`);
    }
    const text = await res.text();
    const took = Date.now() - sentAt;
    // A slow GET is logged too: a tool that reads /history must answer before the MCP timeout_ms (E2E full run: 11.3 s).
    if (method !== "GET" || took >= SLOW_GET_MS) timingLog(`[agora] ${method} ${maskPath(path)} ${res.status} in ${took} ms`);
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
  "Use exactly the language of the owner's message, in that language's own script: Hindi in Devanagari script with feminine forms, Kannada in Kannada script, English in English, and any other Indian language in its own script. Hinglish (Hindi grammar with English words, or Hindi in Latin letters) gets Hindi in Devanagari; Kanglish gets Kannada in Kannada script. Never write Hindi or Kannada in Latin letters.",
  "Never answer the message, never a number, price, name, promise or question.",
  'Never apologise, console or react to a problem (no "कोई बात नहीं", "दिक्कत", "माफ़", "ಪರವಾಗಿಲ್ಲ", "sorry", "no problem"), and never say that anything is done, saved or made: you do not know the result yet.',
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

/**
 * The owner-call tuning block: filler words in the call language plus turn detection.
 * `fillerMode` "generated" (Agora writes a filler in the owner's language, static phrases as its
 * fallback) or "static" (the call language's phrases only). Agora's platform docs say generated
 * fillers are refused with a managed LLM ("Generated fillers require a cascaded OpenAI, Groq or xAI
 * BYOK LLM"); the v2 /join page does not say so. So an owner /join that is refused with generated
 * fillers is tried once with static ones before it drops the whole block (startOwnerAgent).
 */
function voiceTuning(language, fillerMode = "generated") {
  const content = { mode: fillerMode === "static" ? "static" : "generated", static_config: { phrases: [...FILLER_PHRASES[languageOf(language)]], selection_rule: "shuffle" } };
  if (content.mode === "generated") content.generated_config = { prompt: FILLER_PROMPT, context_message_limit: 1 };
  return {
    filler_words: {
      enable: true,
      trigger: { fixed_time_config: { response_wait_ms: FILLER_WAIT_MS } },
      content,
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
  "Teaching: when the owner tells you how they like to buy (the most they will pay for an item, a vendor to prefer or avoid, a usual quantity, a reply language, how hard to bargain), call teach_rule with that one rule. The server reads the rule out itself and asks the question; the tool's `say` is empty: say nothing and wait. When the owner answers, call confirm_rule with no id (keep on a clear yes, forget on a no). A typed message never keeps a rule: if the owner types yes, ask them to tap the tick on the rule card on the screen. To drop a rule call forget_rule; to tell the owner what their Sahay knows call get_my_agent. When save_requirement returns usualQuantity, the server has asked about it and `say` is empty: say nothing; on the owner's yes call save_requirement with use_usual_quantity true and nothing else.";

/**
 * Reply language, every turn, with no switching command (owner requirement 2026-11-20). Sarvam
 * transcribes each utterance in its own script (params.language "unknown"), so the owner's words
 * show the language; the server applies the same rule to tool `say` lines (src/agora/language.js).
 */
const LANGUAGE_RULES = [
  "Language: choose the language of every reply, filler included, from the owner's most recent sentence only, every turn, with no command needed: the owner may switch language in any sentence. An English sentence gets an English reply; a Hindi sentence gets Hindi in Devanagari script; a Kannada sentence gets Kannada in Kannada script.",
  "Hindi or Kannada words written in Latin letters count as Hindi or Kannada: answer them in their own script. Romanised Hindi looks like mujhe, chahiye, kya, hai, nahi, kitna, mera, batao, karo; romanised Kannada looks like nanage, beku, eshtu, ide, illa, maadi, houdu, akki.",
  "Code-mixed: reply in the language the sentence is built in (its verbs, pronouns, question words and case endings), even when most nouns are English. Hinglish gets Hindi in Devanagari, Kanglish gets Kannada in Kannada script; English loanwords such as stock, order, delivery or bill are then written in that script (स्टॉक, ऑर्डर; ಸ್ಟಾಕ್, ಆರ್ಡರ್).",
  'Examples: "mujhe 50 kilo sugar chahiye" -> Hindi; "मेरा order कब आएगा?" -> Hindi; "ನನ್ನ stock ಎಷ್ಟು ಇದೆ?" -> Kannada; "nanage eradu nooru kilo akki beku" -> Kannada; "Who owes me money?" -> English; "stock check karo" -> Hindi.',
  "A bare ok, yes, hmm, a number or a name does not change the language: keep the language of your previous reply. If the owner speaks another Indian language (Tamil, Telugu, Marathi, Bengali, Gujarati, Malayalam, Punjabi, Odia), reply in that language in its own script. Never write Hindi or Kannada in Latin letters.",
];

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
  "React like a person: good news gets a little warmth (बढ़िया!, ಒಳ್ಳೇದು!, Nice!), a maybe gets patience (कोई जल्दी नहीं; ಆರಾಮಾಗಿ ಹೇಳಿ; No rush). A kind word (अरे, कोई बात नहीं; ಅಯ್ಯೋ, ಪರವಾಗಿಲ್ಲ; Ah, no problem) only when the owner tells you of a problem; never before a result that succeeded, never before figures, and never as an opener to a question like who owes money. When a tool fails, say only its `say`, word for word, with no opener and no guess about why (never दिक्कत हुई, never a guess about units or missing details). Never laugh, never write sounds like हाहा or haha.",
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
  "Selling: a sale to a customer is a bill. Call draft_invoice with the customer and each line (item, quantity, unit, and price per unit if said), then request_invoice_approval in the same turn. A sale is never save_requirement: save_requirement is only for something the shop buys. If draft_invoice says an item is not saved yet, call set_item with its name, unit and selling price; pass hsn and gst_rate only when the owner said both, never fill them yourself; the server reads them back, and on the owner's clear yes call set_item again with only confirm true. When the owner asks to add a customer, call add_customer at once with the name; phone, GSTIN, state and address are optional, so never ask for them before saving. A sale never calls save_requirement and never asks about vendors or a delivery city. The owner's yes or no to a bill goes to confirm_invoice; a yes to 'shall I read it out?' also goes to confirm_invoice, which reads the bill out first.",
  "GST: bills are plain bills without GST until the shop's GSTIN is saved. Never ask for the shop's GSTIN unless the owner says the shop is GST-registered; then ask them to add the GST number in the Sell settings on the screen.",
  "Khata: when the owner says a customer paid, call record_payment with customer, amount, mode (cash or upi) and owner_words. The server reads the payment back and asks; `say` is empty: say nothing and wait. When the owner answers, call record_payment again with only decision (confirm on a clear yes, cancel on a no). who_owes_me tells who owes how much (pass customer for one person). send_payment_reminder prepares a reminder the owner sends from the WhatsApp button on the screen; nothing is sent by itself.",
  "Stock: set_opening_stock when the owner says how much of an item they have; get_stock for what is left or low; mark_order_delivered when a purchase order's goods have arrived; set_reorder_level when the owner says at what level to buy more (the server reads the rule out as a question; the owner's answer goes to confirm_rule, never to set_reorder_level again). When the server has asked whether to buy more of a low item (\"... कम है ... और मँगाऊँ?\"), the owner's yes or no goes to confirm_reorder with no item: a yes starts a vendor search only, never an order.",
  "Confirmations: for every deal, bill, payment received, item tax, rule or reorder, the server reads it out first and asks the yes/no question itself; the tool's `say` is then empty: say nothing at all (not the question, never a figure) and wait for the owner. Whenever a tool's `say` is empty, say nothing. Only the owner's spoken yes after that read-back counts: a typed yes never counts (ask the owner to say it aloud or press the yes button on the card on the screen), and silence, maybe or a question is not a yes. The answer goes to the tool for that kind: confirm_approval for a deal, confirm_invoice for a bill, record_payment with decision for a payment, set_item with confirm for an item's tax, confirm_rule for a rule or a reorder level, confirm_reorder for buying more. If more than one thing is waiting, the owner's answer goes to the one read out last.",
  'Hindi sale and payment. Owner: "Ramesh Traders को 50 किलो बासमती, 90 रुपये किलो।" You call draft_invoice and request_invoice_approval; the server reads the bill out and asks; you say nothing. Owner: "हाँ, बना दो।" You call confirm_invoice with approve; the server says the result aloud itself, and you say nothing. Owner: "रमेश ने दो हज़ार रुपये नकद दिए।" You call record_payment; the server reads it back and asks; you say nothing. Owner: "हाँ।" You call record_payment with decision confirm and say nothing: the server speaks the result.',
  'Kannada sale and payment. Owner: "Ramesh Traders ಅವರಿಗೆ 50 ಕಿಲೋ ಬಾಸ್ಮತಿ, ಕಿಲೋಗೆ 90 ರೂಪಾಯಿ." You call draft_invoice and request_invoice_approval; the server reads the bill out and asks; you say nothing. Owner: "ಹೌದು, ಮಾಡಿ." You call confirm_invoice with approve and say nothing: the server speaks the result. Owner: "ರಮೇಶ್ ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ನಗದು ಕೊಟ್ರು." You call record_payment; the server reads it back. Owner: "ಹೌದು." You call record_payment with decision confirm and say nothing: the server speaks the result.',
  'English sale and payment. Owner: "Ramesh Traders, 50 kilos of basmati at 90 rupees a kilo." You call draft_invoice and request_invoice_approval; the server reads the bill out; you say its say. Owner: "Yes, go ahead." You call confirm_invoice with approve and say nothing: the server speaks the result. Owner: "Ramesh paid two thousand rupees in cash." You call record_payment; the server reads it back. Owner: "Yes." You call record_payment with decision confirm and say nothing: the server speaks the result.',
];

/**
 * The one rule against false confirmations (E2E full run, bug 1: "बिल बन गया" / "लिख लिया" with
 * nothing issued or recorded). The server also says every result aloud itself and acts on a yes the
 * model left alone (src/agora/outcome.js, src/agora/confirm-watch.js); this keeps the model from
 * claiming one first.
 */
const DONE_ONLY_FROM_TOOLS =
  "Results: never say that something was done (a bill made, a payment written down, an order placed, a deal approved, a rule kept, a search started, a customer saved) unless a tool you called in THIS turn returned it; then say that tool's `say` and nothing more about it. When the owner says yes or no to something the server read out, always call its confirm tool in that same turn, even if you think it is already done: never answer a yes from memory or from earlier turns. If a tool returned an error, say only its `say`: nothing was done.";

/**
 * Every owner turn gets an answer (owner requirement 2026-11-20: "no matter what the question is or
 * how it is asked, the agent has to answer with respect to the business"). Shop questions go to the
 * shop's own records (get_business_facts), anything else gets one honest sentence. The server also
 * speaks a line itself when a turn is left unanswered (src/agora/answer-watch.js).
 */
const ANSWER_EVERY_TURN = [
  "Answer every turn: whenever the owner speaks or types, reply out loud in the owner's language, one or two short sentences. Never stay silent, never leave a question hanging. The only silence allowed is when a tool returned an empty `say` because the server itself is speaking.",
  "Questions about this shop (what is in stock or running low, who owes money and how much, today's bills or sales, payments received, orders and their payment, what is being bought now, suppliers and past deals and prices, the owner's rules and settings, the shop's own details, or a summary of the day): call get_business_facts with the matching topic, or a more specific tool when it fits (get_stock with an item, who_owes_me with a customer, get_order_status), and say its `say`. Never answer them from memory, never say you cannot see the records, and never fill a gap yourself: an empty record is said honestly by the tool.",
  'Out of scope (weather, news, cricket, films, politics, general knowledge, homework, coding, health or legal advice, anything not about running this shop): say one short polite sentence in the owner\'s language that you do not have information on that, then what you can help with, and stop. No reason, no lecture, no made-up answer, no tool call. Hindi: "माफ़ कीजिए, इसकी जानकारी मेरे पास नहीं है; मैं आपकी दुकान का स्टॉक, बिल, उधार, ऑर्डर और ख़रीद संभालती हूँ।" Kannada: "ಕ್ಷಮಿಸಿ, ಅದರ ಬಗ್ಗೆ ನನ್ನ ಬಳಿ ಮಾಹಿತಿ ಇಲ್ಲ; ನಿಮ್ಮ ಅಂಗಡಿಯ ಸ್ಟಾಕ್, ಬಿಲ್, ಬಾಕಿ, ಆರ್ಡರ್ ಮತ್ತು ಖರೀದಿ ನೋಡಿಕೊಳ್ಳುತ್ತೇನೆ." English: "Sorry, I don\'t have information on that; I can help with your shop\'s stock, bills, dues, orders and buying."',
  "Greetings, thanks or small talk: one warm short line, then ask what they need. Who are you or are you a person: you are Sahay, an automated assistant for this shop. Unclear, cut off or half-heard words: ask one short question to clarify (which item, how much, say it again), never guess and never go quiet.",
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
    ...ANSWER_EVERY_TURN,
    `Today's date in India is ${todayInIndia(now)}.`,
    ...LANGUAGE_RULES,
    "Script: a Hindi reply uses only Devanagari and a Kannada reply only Kannada script, for every word: fillers, loanwords, item names and city names (बेंगलुरु in Hindi, ಬೆಂಗಳೂರು in Kannada). Never put a Devanagari word in a Kannada reply or a Kannada word in a Hindi reply, and never a word that joins Latin letters to Devanagari or Kannada letters. Inside Hindi or Kannada the only Latin letters allowed are a vendor's, customer's or business's own name, a purchase-order or bill number and the word Razorpay; digits are fine. If a tool's `say` has a city or an item in another script, say that word in the reply's script.",
    `The greeting was spoken in ${LANGUAGE_NAMES[language]} because that is the business's language. That greeting does not decide your reply language, and neither do your earlier replies or the language of tool results. When the owner switches language, switch with them at once.`,
    "Every tool takes reply_language: always set it to the language of the owner's last sentence (hi-IN for Hindi, kn-IN for Kannada, en-IN for English), so the tool's `say` comes back in that language. For any other Indian language set en-IN and say the tool's `say` in the owner's language. The server also reads the owner's own last words and corrects reply_language when it is wrong, so a `say` can come back in the owner's language even if you passed another: speak it as it is.",
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
    "Approval: before any order call request_approval once (no id: it takes the best deal). When get_ranked_deals asked whether to read the deal out for approval and the owner says yes, that yes asks to hear the deal and approves nothing: call request_approval, not confirm_approval. The server itself reads the deal out to the owner and asks the question itself; the tool's `say` is empty: say nothing, never repeat the figures, and wait for the owner's answer. Once request_approval has returned, the owner's next yes or no answers it: call confirm_approval with no id (the one deal waiting), decision approve on a clear yes, reject on a no. Never call request_approval again for that answer, and never ask whether to ask for approval about a deal already read out; call request_approval again only if the owner asks to hear the deal again, with repeat true. If the owner says maybe or later, say there is no hurry: the deal keeps waiting and their next yes or no still goes to confirm_approval. If a tool result has a `hint` or `next`, follow it. Silence, maybe, or a question is not a yes: ask again. The server checks the owner's own words. A typed yes never approves: the owner presses the yes card on the screen or says it aloud.",
    "Never say an order exists unless create_order returned an orderId or the latest Call status says the order was placed. Never say a payment link exists unless create_payment_link returned a url. Payment links are Razorpay test mode.",
    "Usual order of buying: save_requirement, start_sourcing, get_shortlist, start_negotiation, get_ranked_deals, request_approval, confirm_approval (on approve it places the order itself: no create_order after it), create_payment_link. Use get_job_status and get_order_status when the owner asks how things are going.",
    TEACHING,
    ...SHOP_WORK,
    DONE_ONLY_FROM_TOOLS,
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
 * @param {boolean|"generated"|"static"} [o.tuning]  add filler words (generated by default, or static), turn detection and interruption (owner calls)
 * @param {number} [o.maxHistory]        llm.max_history (default 32, the docs default)
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
    max_history: o.maxHistory ?? 32,
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
      // Sarvam detects the language of every utterance with params.language "unknown" (Agora sarvam.md;
      // Sarvam STT: "unknown" = auto-detect, one of 22 Indic languages or English). Nothing else is
      // pinned: no top-level asr.language (Agora: params.language takes precedence; default en-US),
      // no model and no mode, so Sarvam's default transcribe mode writes each language in its own
      // script (Hinglish in Devanagari). Verified offline on the test clips (agora-findings.md,
      // "Multilingual owner calls").
      asr: { vendor: "sarvam", params: { api_key: config.sarvam.key, language: "unknown" } },
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
  if (o.tuning) Object.assign(body.properties, voiceTuning(language, o.tuning === "static" ? "static" : "generated"));
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
  const promptFor = (fillerWords) => systemPrompt({ ...business, language: lang }, { now: new Date(now), rules, fillerWords: Boolean(fillerWords) });
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
    maxHistory: OWNER_MAX_HISTORY,
  });
  // Generated fillers, then static fillers, then the S0-verified body: the tuning block is DOCS
  // ONLY until a live /join takes it, and a 400 for it must not cost the owner the call.
  let started;
  let tuning;
  for (const attempt of ["generated", "static", false]) {
    tuning = attempt;
    try {
      started = await startAgent(bodyFor(attempt));
      break;
    } catch (err) {
      if (!attempt || !(err instanceof AgoraError) || err.status !== 400) throw err;
      console.warn(`[agora] /join refused the voice tuning block with ${attempt} filler words (${err.message}); ${attempt === "generated" ? "trying static filler words" : "joining without filler words and turn tuning"}.`);
    }
  }
  const prompt = promptFor(Boolean(tuning));
  callPrompts.set(started.agentId, { prompt, businessId, language: lang, now, status: "", fillerWords: Boolean(tuning) });
  bindLane(started.agentId, businessId);
  return { ...started, language: lang, voiceTuning: Boolean(tuning), fillerMode: tuning || null, disclosure: disclosureText({ ...business, language: lang }) };
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
  laneOfAgent.delete(agentId);
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
 * Speech lanes: at most ONE server-initiated line in flight per business (Murf Falcon allows 2
 * concurrent streams outside US-East, and a stream over the limit closes the WebSocket with 4029,
 * stopping every context on it: agora-findings.md "Live check 129a071 stall"). The owner's agent
 * and, during a negotiation, the negotiator and simulated vendor agents share their business's
 * lane, so a narrator line never plays on top of a read-back or a negotiation line.
 *
 * Agora does not tell the server when a /speak line has finished, so a line is taken to last
 * as long as the negotiation loop already assumes (msPerChar per character, at least minLineMs).
 * Every /speak piece waits in its lane until the previous piece is expected to have finished, at
 * most maxWaitMs (a tool must answer within the MCP timeout_ms of 10 s); after that it is sent
 * anyway and the overlap is logged. INTERRUPT cuts what is playing, so it never waits.
 * releaseLane: the owner has answered by voice, so the line before it has finished.
 */
const pacing = { msPerChar: config.speech?.msPerChar ?? 75, minLineMs: config.speech?.minLineMs ?? 1500, maxWaitMs: 5000 };
/** lane key -> { busyUntil: ms, tail: Promise } */
const lanes = new Map();
/** agentId -> lane key (owner agents and negotiation agents are bound to their business) */
const laneOfAgent = new Map();

const lineMs = (text) => Math.max(pacing.minLineMs, String(text).length * pacing.msPerChar);
const laneKey = (agentId) => laneOfAgent.get(agentId) ?? `agent:${agentId}`;
const laneOf = (key) => {
  if (!lanes.has(key)) lanes.set(key, { busyUntil: 0, tail: Promise.resolve() });
  return lanes.get(key);
};

/** Bind an agent's /speak lines to its business's lane (owner and negotiation agents). */
function bindLane(agentId, businessId) {
  if (agentId && businessId) laneOfAgent.set(agentId, `business:${businessId}`);
}

/** The owner answered by voice: whatever this agent's lane was playing has ended. */
function releaseLane(agentId) {
  const lane = agentId ? lanes.get(laneKey(agentId)) : null;
  if (lane) lane.busyUntil = Math.min(lane.busyUntil, Date.now());
}

/** Milliseconds until this agent's lane is expected to be quiet (0 when it is). */
function laneBusyMs(agentId) {
  const lane = agentId ? lanes.get(laneKey(agentId)) : null;
  return lane ? Math.max(0, lane.busyUntil - Date.now()) : 0;
}

/** Tests: change the pacing (pass nothing to read it). */
function configureSpeechPacing(overrides = {}) {
  Object.assign(pacing, overrides);
  return { ...pacing };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Send one /speak piece in its lane: after the lane's current line (at most maxWaitMs), then mark the lane busy for this piece. */
function sendInLane(agentId, body) {
  const lane = laneOf(laneKey(agentId));
  const send = async () => {
    if (body.priority !== "INTERRUPT") {
      const deadline = Date.now() + pacing.maxWaitMs;
      while (Date.now() < lane.busyUntil && Date.now() < deadline) await pause(Math.min(lane.busyUntil, deadline) - Date.now());
      if (Date.now() < lane.busyUntil) timingLog(`[agora] /speak sent ${lane.busyUntil - Date.now()} ms before the previous line is expected to end (waited ${pacing.maxWaitMs} ms)`);
    }
    const result = await call("POST", `/agents/${encodeURIComponent(agentId)}/speak`, body);
    lane.busyUntil = Date.now() + lineMs(body.text);
    return result;
  };
  // INTERRUPT cuts the lane at once; everything else is sent in order.
  const run = body.priority === "INTERRUPT" ? send() : lane.tail.then(send, send);
  if (body.priority !== "INTERRUPT") lane.tail = run.catch(() => {});
  return run;
}

/**
 * POST /speak. Text over the byte limit is sent as several requests: the first
 * with the given priority, the rest APPEND so they play in order. Every piece goes
 * through the agent's speech lane (see above), so pieces never overlap each other
 * or another server line of the same business.
 * @param {{priority?: 'INTERRUPT'|'APPEND'|'IGNORE', interruptable?: boolean}} [options]
 */
async function speak(agentId, text, { priority = "APPEND", interruptable = true } = {}) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "speak needs an agent id.");
  if (!["INTERRUPT", "APPEND", "IGNORE"].includes(priority)) throw new AgoraError("SPEAK_INVALID", `Unknown priority ${priority}.`);
  const pieces = splitUtf8(text);
  if (!pieces.length) throw new AgoraError("SPEAK_INVALID", "Nothing to speak.");
  const results = [];
  for (const [index, piece] of pieces.entries()) {
    results.push(await sendInLane(agentId, { text: piece, priority: index === 0 ? priority : "APPEND", interruptable }));
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

/**
 * One tool call's /history snapshot: the read made for the reply language just before the tool
 * runs (src/agora/language.js) is handed to the tool's own first read of the same agent, so the
 * language costs no second round trip. Scoped to that tool call only (AsyncLocalStorage): the
 * narrator and the confirmation watchdog never see it. Used once; older than SNAPSHOT_MS it is
 * not used at all.
 */
const snapshotScope = new AsyncLocalStorage();
const SNAPSHOT_MS = 1000;

/** Run `fn` with `contents` (just read from /history of `agentId`) as its first read of that agent. */
function withHistorySnapshot(agentId, contents, fn) {
  if (!agentId || !Array.isArray(contents)) return fn();
  return snapshotScope.run({ agentId, contents, at: Date.now() }, fn);
}

/** GET /history (running agents only). Returns the `contents` array. */
async function history(agentId, { timeoutMs } = {}) {
  if (!agentId) throw new AgoraError("AGENT_REQUIRED", "history needs an agent id.");
  const snapshot = snapshotScope.getStore();
  if (snapshot?.agentId === agentId && snapshot.contents) {
    const { contents, at } = snapshot;
    snapshot.contents = null;
    if (Date.now() - at <= SNAPSHOT_MS) return contents.slice();
  }
  // A bounded read (tools, the confirmation watchdog) is tried once; the default keeps one retry.
  const json = await call("GET", `/agents/${encodeURIComponent(agentId)}/history`, undefined, timeoutMs ? { timeoutMs } : { retry: true });
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
  isTransient,
  OWNER_MAX_HISTORY,
  TOOL_HISTORY_TIMEOUT_MS,
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
  bindLane,
  releaseLane,
  laneBusyMs,
  configureSpeechPacing,
  think,
  history,
  withHistorySnapshot,
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
