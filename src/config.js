require("dotenv").config();

/**
 * Central configuration. Every model/endpoint value here was verified against
 * the live APIs (see scripts/doctor.js) rather than assumed from documentation.
 */
const config = {
  port: Number(process.env.PORT || 3000),

  anakin: {
    key: process.env.ANAKIN_API_KEY || "",
    base: process.env.ANAKIN_BASE_URL || "https://api.anakin.io/v1",
    // /url-scraper, /crawl and /map are ASYNC job endpoints: they return
    // { jobId } and must be polled. Only /search is synchronous.
    pollIntervalMs: 1500,
    pollMaxAttempts: 40,
    country: process.env.ANAKIN_COUNTRY || "in",
  },

  groq: {
    key: process.env.GROQ_API_KEY || "",
    base: "https://api.groq.com/openai/v1",
    // Reasoning/ranking model - quality matters most here.
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    // High-volume per-page extraction. Deliberately a DIFFERENT model: Groq
    // rate-limits per model, so this gives extraction its own token budget
    // instead of competing with the ranking calls for one 8k/min ceiling.
    extractModel: process.env.GROQ_EXTRACT_MODEL || "openai/gpt-oss-20b",
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || "qwen/qwen3.8-27b",
  },

  sarvam: {
    key: process.env.SARVAM_API_KEY || "",
    base: "https://api.sarvam.ai",
    translateModel: process.env.SARVAM_TRANSLATE_MODEL || "sarvam-translate:v1",
    ttsModel: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
    ttsSpeaker: process.env.SARVAM_TTS_SPEAKER || "priya",
    sttModel: process.env.SARVAM_STT_MODEL || "saarika:v2.5",
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    // Long polling needs no public URL, so the bot works on a laptop exactly
    // as it will in production. Set TELEGRAM_WEBHOOK_URL to switch modes.
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || "",
    enabled: process.env.TELEGRAM_ENABLED !== "false",
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    base: "https://api.razorpay.com/v1",
  },

  procurement: {
    // How many vendors to negotiate with, and how many deals to present.
    shortlistSize: Number(process.env.SHORTLIST_SIZE || 5),
    maxCandidates: Number(process.env.MAX_CANDIDATES || 12),
    maxNegotiationTurns: Number(process.env.MAX_NEGOTIATION_TURNS || 10),
    // Scoring weights (PRD v2 section 6.3, stage 2). Must sum to 1.
    weights: {
      price: 0.35,
      locality: 0.25,
      moq: 0.20,
      availability: 0.10,
      contactability: 0.10,
    },
    // Which channel carries the negotiation. "telegram-voice" is live today;
    // "pstn" activates once carrier credentials are supplied.
    channel: process.env.NEGOTIATION_CHANNEL || "telegram-voice",
  },

  telephony: {
    provider: process.env.TELEPHONY_PROVIDER || "",
    accountSid: process.env.TELEPHONY_ACCOUNT_SID || "",
    authToken: process.env.TELEPHONY_AUTH_TOKEN || "",
    callerId: process.env.TELEPHONY_CALLER_ID || "",
  },

  dbFile: process.env.DB_FILE || require("path").join(__dirname, "..", "data", "sahay.db"),
};

/** Languages Sarvam supports that we expose in the UI. */
const LANGUAGES = [
  { code: "en-IN", label: "English", native: "English" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు" },
  { code: "mr-IN", label: "Marathi", native: "मराठी" },
  { code: "bn-IN", label: "Bengali", native: "বাংলা" },
  { code: "gu-IN", label: "Gujarati", native: "ગુજરાતી" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം" },
  { code: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "od-IN", label: "Odia", native: "ଓଡ଼ିଆ" },
];

/**
 * Fail loudly at boot rather than silently degrading to fake data.
 * The PRD is explicit that a failed fetch must alert, never silently go stale.
 */
function missingKeys() {
  const missing = [];
  if (!config.anakin.key) missing.push("ANAKIN_API_KEY");
  if (!config.groq.key) missing.push("GROQ_API_KEY");
  if (!config.sarvam.key) missing.push("SARVAM_API_KEY");
  return missing;
}

module.exports = { config, LANGUAGES, missingKeys };
