"use strict";

/**
 * Test bootstrap, loaded before every test file by `npm test` (node --test --require ./test/_env.js).
 *
 * Tests never call a live third-party API by default: the keys of every paid or external service
 * are blanked here, before src/config.js loads .env (process.loadEnvFile never overwrites a variable
 * that is already set, even to ""). A test that needs a key sets its own fake one and fakes the
 * network. A live check is opt-in per service:
 *   RAZORPAY_LIVE_TEST=1  MURF_LIVE_TEST=1  AGORA_LIVE_TEST=1  GROQ_LIVE_TEST=1
 *   TELEGRAM_LIVE_TEST=1  SARVAM_LIVE_TEST=1  INDIAMART_LIVE_TEST=1 (no key; checked by its tests)
 */

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

blank();

module.exports = { SERVICES, blank, isOptIn };
