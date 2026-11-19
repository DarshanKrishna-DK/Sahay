"use strict";

/**
 * The only module that reads the environment.
 *
 * Nothing here invents a value for a missing key: an unset key is `null`, it is
 * listed by `missingKeys()`, and the boot script decides to stop. A Razorpay key
 * that is not a test key is refused outright, here, before anything can use it.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const RAZORPAY_TEST_PREFIX = "rzp_test_";
const MIN_SESSION_SECRET_LENGTH = 32;

/** Extraction model chosen in docs/build/decisions.md (D1). */
const GROQ_EXTRACT_MODEL = "openai/gpt-oss-20b";

class ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

/**
 * How a simulated negotiation runs. "loop" (default): the server computes both sides and
 * voices them through two Agora agents with /speak, deterministic. "agents": two LLM agents
 * in one channel hear each other (opt-in; falls back to "loop" when they stall).
 */
const NEGOTIATION_MODES = ["loop", "agents"];
function positiveInt(value, fallback, name) {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  return n;
}

function negotiationMode(value) {
  const mode = (value ?? "loop").toLowerCase();
  if (!NEGOTIATION_MODES.includes(mode)) {
    throw new ConfigError("INVALID_NEGOTIATION_MODE", `NEGOTIATION_MODE must be one of ${NEGOTIATION_MODES.join(", ")}.`);
  }
  return mode;
}

/** Keys the product cannot run without. `missingKeys()` reports the unset ones. */
const REQUIRED = [
  ["PUBLIC_URL", (c) => c.publicUrl],
  ["SESSION_SIGNING_SECRET", (c) => c.sessionSecret],
  ["AGORA_APP_ID", (c) => c.agora.appId],
  ["AGORA_APP_CERTIFICATE", (c) => c.agora.appCertificate],
  ["AGORA_CUSTOMER_ID", (c) => c.agora.customerId],
  ["AGORA_CUSTOMER_SECRET", (c) => c.agora.customerSecret],
  ["MURF_API_KEY", (c) => c.murf.key],
  ["MURF_VOICE_EN", (c) => c.murf.voices["en-IN"]],
  ["MURF_VOICE_HI", (c) => c.murf.voices["hi-IN"]],
  ["MURF_VOICE_KN", (c) => c.murf.voices["kn-IN"]],
  ["SARVAM_API_KEY", (c) => c.sarvam.key],
  ["GROQ_API_KEY", (c) => c.groq.key],
  ["RAZORPAY_KEY_ID", (c) => c.razorpay.keyId],
  ["RAZORPAY_KEY_SECRET", (c) => c.razorpay.keySecret],
];

/**
 * Freeze an object and make sure printing it (console.log, JSON.stringify,
 * util.inspect) never shows the named secret fields.
 */
function sealed(obj, secretFields = []) {
  const redacted = () => {
    const view = {};
    for (const [k, v] of Object.entries(obj)) {
      view[k] = secretFields.includes(k) && v != null ? "[redacted]" : v;
    }
    return view;
  };
  Object.defineProperty(obj, "toJSON", { value: redacted });
  Object.defineProperty(obj, util.inspect.custom, { value: redacted });
  return Object.freeze(obj);
}

function loadConfig(env = process.env) {
  const read = (name) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  const portText = read("PORT");
  const port = portText === null ? 3000 : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("INVALID_PORT", "PORT must be a whole number between 1 and 65535.");
  }

  let publicUrl = read("PUBLIC_URL");
  if (publicUrl !== null) {
    let parsed;
    try {
      parsed = new URL(publicUrl);
    } catch {
      throw new ConfigError("INVALID_PUBLIC_URL", "PUBLIC_URL must be a full http(s) URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ConfigError("INVALID_PUBLIC_URL", "PUBLIC_URL must be a full http(s) URL.");
    }
    publicUrl = publicUrl.replace(/\/+$/, "");
  }

  const sessionSecret = read("SESSION_SIGNING_SECRET");
  if (sessionSecret !== null && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ConfigError(
      "WEAK_SESSION_SECRET",
      `SESSION_SIGNING_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters (use 32 random bytes).`,
    );
  }

  const razorpayKeyId = read("RAZORPAY_KEY_ID");
  if (razorpayKeyId !== null && !razorpayKeyId.startsWith(RAZORPAY_TEST_PREFIX)) {
    throw new ConfigError(
      "RAZORPAY_LIVE_KEY",
      `RAZORPAY_KEY_ID is not a test key. Sahay only runs with Razorpay test mode (${RAZORPAY_TEST_PREFIX}...).`,
    );
  }

  const dbFile = read("DB_FILE") ?? path.join(ROOT, "data", "sahay-v2.db");
  // An in-memory database (tests) gets its own throwaway folder, so test POs never land next
  // to (or overwrite) the real business's purchase orders (security review r1 #4).
  const dataDir = dbFile === ":memory:"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "sahay-test-"))
    : path.dirname(path.resolve(dbFile));

  return sealed(
    {
      port,
      // Loopback by default: the tunnel (cloudflared) runs on this machine. A host such as Render needs HOST=0.0.0.0.
      host: read("HOST") ?? "127.0.0.1",
      // Behind a hosting proxy on a private network (Hugging Face Spaces): trust its X-Forwarded-For.
      trustForwardedFor: read("TRUST_FORWARDED_FOR") === "1",
      publicUrl,
      dbFile,
      poDir: path.join(dataDir, "po"),
      sessionSecret,
      agora: sealed(
        {
          appId: read("AGORA_APP_ID"),
          appCertificate: read("AGORA_APP_CERTIFICATE"),
          customerId: read("AGORA_CUSTOMER_ID"),
          customerSecret: read("AGORA_CUSTOMER_SECRET"),
        },
        ["appCertificate", "customerId", "customerSecret"],
      ),
      murf: sealed(
        {
          key: read("MURF_API_KEY"),
          region: read("MURF_REGION"),
          voices: Object.freeze({
            "en-IN": read("MURF_VOICE_EN"),
            "hi-IN": read("MURF_VOICE_HI"),
            "kn-IN": read("MURF_VOICE_KN"),
          }),
        },
        ["key"],
      ),
      sarvam: sealed({ key: read("SARVAM_API_KEY") }, ["key"]),
      groq: sealed(
        {
          key: read("GROQ_API_KEY"),
          base: "https://api.groq.com/openai/v1",
          model: read("GROQ_MODEL"),
          extractModel: read("GROQ_EXTRACT_MODEL") ?? GROQ_EXTRACT_MODEL,
        },
        ["key"],
      ),
      razorpay: sealed(
        {
          keyId: razorpayKeyId,
          keySecret: read("RAZORPAY_KEY_SECRET"),
          base: "https://api.razorpay.com/v1",
        },
        ["keyId", "keySecret"],
      ),
      telegram: sealed({ botToken: read("TELEGRAM_BOT_TOKEN") }, ["botToken"]),
      // Demo aid: when set, payment_due fires N seconds after an order and delivery_check 2N.
      followups: Object.freeze({
        delaySeconds: read("FOLLOWUP_DELAY_SECONDS") === null ? null : Number(read("FOLLOWUP_DELAY_SECONDS")),
      }),
      negotiation: Object.freeze({ mode: negotiationMode(read("NEGOTIATION_MODE")) }),
      // Cost guards for a public URL (security review r1 #1). Global, across all businesses.
      limits: Object.freeze({
        ownerCalls: positiveInt(read("SAHAY_MAX_OWNER_CALLS"), 3, "SAHAY_MAX_OWNER_CALLS"),
        negotiations: positiveInt(read("SAHAY_MAX_NEGOTIATIONS"), 1, "SAHAY_MAX_NEGOTIATIONS"),
        sourcing: positiveInt(read("SAHAY_MAX_SOURCING_JOBS"), 3, "SAHAY_MAX_SOURCING_JOBS"),
        callSeconds: positiveInt(read("SAHAY_MAX_CALL_SECONDS"), 45 * 60, "SAHAY_MAX_CALL_SECONDS"),
      }),
      // Optional: when set, POST /api/session must carry this code to create a business.
      accessCode: read("SAHAY_ACCESS_CODE"),
    },
    ["sessionSecret", "accessCode"],
  );
}

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const config = loadConfig();

/** Names of the required environment variables that are not set. */
function missingKeys(cfg = config) {
  return REQUIRED.filter(([, get]) => get(cfg) == null).map(([name]) => name);
}

module.exports = { config, loadConfig, missingKeys, ConfigError, RAZORPAY_TEST_PREFIX };
