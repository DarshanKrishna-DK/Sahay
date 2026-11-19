"use strict";

/**
 * Test bootstrap, loaded before every test file by `npm test` (node --test --require ./test/_env.js).
 * The one place that holds the test environment.
 *
 * 1. Tests never call a live third-party API by default: the keys of every paid or external
 *    service are blanked here, before src/config.js loads .env (process.loadEnvFile never
 *    overwrites a variable that is already set, even to ""). A live check is opt-in per service:
 *      RAZORPAY_LIVE_TEST=1  MURF_LIVE_TEST=1  AGORA_LIVE_TEST=1  GROQ_LIVE_TEST=1
 *      TELEGRAM_LIVE_TEST=1  SARVAM_LIVE_TEST=1  INDIAMART_LIVE_TEST=1 (no key; checked by its tests)
 * 2. Every fake value a test needs lives in FAKE below, obviously fake and low-entropy (nothing
 *    that looks like a real key, so secret scanners have nothing to flag), yet valid for
 *    src/config.js and src/agora/token.js (32-character app id and certificate, a session secret
 *    of 32+ characters, a Razorpay key id starting rzp_test_). The BASELINE keys are set for every
 *    test file; a file that needs an optional service sets it from FAKE itself
 *    (`RAZORPAY_KEY_ID: FAKE.RAZORPAY_KEY_ID`), so a missing key stays testable.
 */

const FAKE = Object.freeze({
  SESSION_SIGNING_SECRET: "x".repeat(48),
  AGORA_APP_ID: "a".repeat(32),
  AGORA_APP_CERTIFICATE: "c".repeat(32),
  AGORA_CUSTOMER_ID: "fake-agora-customer",
  AGORA_CUSTOMER_SECRET: "fake-agora-secret",
  MURF_API_KEY: "fake-murf-key",
  SARVAM_API_KEY: "fake-sarvam-key",
  GROQ_API_KEY: "fake-groq-key",
  RAZORPAY_KEY_ID: "rzp_test_fake",
  RAZORPAY_KEY_SECRET: "fake-rzp-secret",
  TELEGRAM_BOT_TOKEN: "0:fake-telegram-token",
});

/** Set for every test file (services whose absence no test depends on). */
const BASELINE = ["SESSION_SIGNING_SECRET", "AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_CUSTOMER_ID", "AGORA_CUSTOMER_SECRET", "MURF_API_KEY", "SARVAM_API_KEY"];

/** Service -> the variables it reads (src/config.js and .env.example). */
const SERVICES = {
  RAZORPAY: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
  MURF: ["MURF_API_KEY", "MURF_REGION", "MURF_VOICE_HI", "MURF_VOICE_KN", "MURF_VOICE_EN", "MURF_VENDOR_VOICE_HI", "MURF_VENDOR_VOICE_EN"],
  AGORA: ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_CUSTOMER_ID", "AGORA_CUSTOMER_SECRET"],
  GROQ: ["GROQ_API_KEY", "GROQ_MODEL", "GROQ_EXTRACT_MODEL"],
  TELEGRAM: ["TELEGRAM_BOT_TOKEN"],
  SARVAM: ["SARVAM_API_KEY"],
};

const isOptIn = (service) => process.env[`${service}_LIVE_TEST`] === "1";
const serviceOf = (name) => Object.keys(SERVICES).find((s) => SERVICES[s].includes(name));

function blank(env = process.env) {
  const blanked = [];
  for (const [service, names] of Object.entries(SERVICES)) {
    if (isOptIn(service)) continue;
    const all = new Set([...names, ...Object.keys(env).filter((k) => k.startsWith(`${service}_`) && !k.endsWith("_LIVE_TEST"))]);
    for (const name of all) {
      env[name] = "";
      blanked.push(name);
    }
  }
  return blanked;
}

/** The baseline fakes, except for a service opted in to its live keys. */
function setBaseline(env = process.env) {
  for (const name of BASELINE) {
    const service = serviceOf(name);
    if (service && isOptIn(service)) continue;
    env[name] = FAKE[name];
  }
  if (env.DB_FILE === undefined) env.DB_FILE = ":memory:"; // never the real database
}

blank();
setBaseline();

module.exports = { FAKE, BASELINE, SERVICES, blank, isOptIn };
