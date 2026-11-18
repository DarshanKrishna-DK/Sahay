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
const OWNER_SESSION_SECONDS = 30 * 60;
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
    throw new AgoraError(code, `Agora ${method} ${path.replace(/agents\/[^/]+/, "agents/<id>")} answered ${res.status}${reason ? ` (${reason})` : ""}`, {
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

const FILLER = {
  "hi-IN": "एक सेकंड, देख रही हूँ।",
  "kn-IN": "ಒಂದು ಕ್ಷಣ, ನೋಡುತ್ತೇನೆ.",
  "en-IN": "One moment, let me check.",
};

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
 * The owner agent's system prompt. Encodes the voice-agent-rules skill; the hard
 * rules (disclosure, approval, money read-back, tenant) are also enforced in code.
 */
function systemPrompt(business, { now = new Date() } = {}) {
  const language = languageOf(business?.language);
  const where = [business?.name && `the business "${business.name}"`, business?.city && `in ${business.city}`].filter(Boolean).join(" ");
  return [
    `You are Sahay, an automated procurement assistant working for ${where || "an Indian small business"}. You talk to the owner by voice.`,
    "The system has already told the owner that you are an automated assistant. Do not greet again; answer what the owner says.",
    `Today's date in India is ${todayInIndia(now)}. The business usually speaks ${language}.`,
    "Language: reply in the language the owner just spoke. Hindi in Devanagari script, Kannada in Kannada script, English in English. Never write Hindi or Kannada in Latin letters. Code-mixed in, code-mixed out is fine.",
    "Every tool takes reply_language: always set it to the language of the owner's last sentence (hi-IN for Hindi, kn-IN for Kannada, en-IN for English), so the tool's `say` comes back in that language.",
    "Voice: you speak with a woman's voice, so in Hindi always use feminine first-person forms (मैं देख रही हूँ, बताऊँगी, कर दिया/कर दी as the object requires, मैं कर पाई), never masculine ones.",
    "Style: one or two short spoken sentences per turn. No lists, markdown, emoji, URLs, ids or tables. Use Indian number words (lakh, crore) and say units in full (kilograms, pieces, days).",
    `Before every tool call, first say a very short filler in the owner's language, for example "${FILLER[language]}", then call the tool.`,
    "Never invent a number, price, count, date, vendor or status. They come only from tool results. If a tool has not returned yet, say what is happening and that you will report back.",
    "Every tool result has a field `say`. Speak it as your answer, word for word when it contains money, a price, a quantity or a total. Never change a figure from a tool.",
    "Ids: never pass an id you did not copy exactly from a tool result in this call, and normally pass none. Every tool works on the current requirement, the best vendor, the best deal, or the one approval or order waiting when its id is left out. To pick a vendor, use vendorRank (1 = best, as get_shortlist ranks them). If a tool answers with several choices, read them to the owner and ask which one.",
    "To understand a purchase, call save_requirement as soon as you know the item, passing the unit and city as the owner said them. To add details later, call save_requirement again without an id. If its result lists missing fields, ask for them, at most two clarifying questions in total, then continue with what you have.",
    "Sourcing and negotiation take time: start them with start_sourcing or start_negotiation, say that it has started and that you will report back, then stop talking. Progress is announced automatically.",
    "Sourcing searches real vendors listed on IndiaMART. Never call those vendors, or the search, simulated.",
    "Negotiation: call start_negotiation without a vendor to negotiate with a simulated vendor priced from the best real listing that has a comparable price, unless the owner names a vendor by rank or asks for a real vendor to join by link (counterpart human). Only that negotiation counterpart is simulated: call it a simulated vendor (सिम्युलेटेड विक्रेता / ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್), and use the word simulated for nothing else.",
    "Approval: before any order call request_approval (no id: it takes the best deal), speak its readback word for word, and wait for the owner's answer. Only when the owner clearly says yes call confirm_approval with decision approve; if they say no call it with decision reject. Silence, maybe, or a question is not a yes: ask again. The server checks the owner's own words.",
    "Never say an order exists unless create_order returned an orderId. Never say a payment link exists unless create_payment_link returned a url. Payment links are Razorpay test mode.",
    "Usual order of work: save_requirement, start_sourcing, get_shortlist, start_negotiation, get_ranked_deals, request_approval, confirm_approval, create_order, create_payment_link. Use get_job_status and get_order_status when the owner asks how things are going.",
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
  const body = buildJoinBody({
    name: `sahay-${sessionId}-${now}`.slice(0, 64),
    channel,
    token,
    agentUid,
    remoteUids: [userUid],
    language: lang,
    voiceId,
    prompt: systemPrompt({ ...business, language: lang }, { now: new Date(now) }),
    mcp: {
      name: OWNER_MCP_SERVER_NAME,
      endpoint: `${config.publicUrl}/mcp`,
      bearer,
      allowedTools: registry.toolNames(registry.SCOPES.owner),
    },
    labels: { session: sessionId },
  });
  const started = await startAgent(body);
  return { ...started, language: lang, disclosure: disclosureText({ ...business, language: lang }) };
}

/** POST /leave. An agent that is already gone (404) counts as stopped. */
async function stopAgent(agentId) {
  if (!agentId) return { stopped: false };
  try {
    await call("POST", `/agents/${encodeURIComponent(agentId)}/leave`, undefined, { retry: true });
    return { stopped: true };
  } catch (err) {
    if (err instanceof AgoraError && err.status === 404) return { stopped: true, alreadyGone: true };
    throw err;
  }
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
  buildJoinBody,
  redactJoinBody,
  systemPrompt,
  disclosureText,
  startAgent,
  startOwnerAgent,
  stopAgent,
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
};
