"use strict";

// The test bootstrap (test/_env.js): no live third-party key reaches a test unless opted in.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

/** Run `code` in a fresh node with the bootstrap preloaded and `env` (plus PATH); returns its JSON output. */
function probe(env, code) {
  const out = execFileSync(process.execPath, ["--require", "./test/_env.js", "-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DB_FILE: ":memory:", ...env },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const READ_CONFIG = `const { config } = require("./src/config"); console.log(JSON.stringify({
  razorpay: config.razorpay.keyId, murf: config.murf.key, agora: config.agora.customerSecret,
  groq: config.groq.key, telegram: config.telegram.botToken, sarvam: config.sarvam.key }));`;

test("npm test preloads the bootstrap for every test file", () => {
  const pkg = require("../package.json");
  assert.match(pkg.scripts.test, /--require \.\/test\/_env\.js/);
});

test("every service key is blank in config, even when set in the environment or in .env", () => {
  const seen = probe(
    { RAZORPAY_KEY_ID: "rzp_test_fromenv", MURF_API_KEY: "m", AGORA_CUSTOMER_SECRET: "a", GROQ_API_KEY: "g", TELEGRAM_BOT_TOKEN: "t", SARVAM_API_KEY: "s" },
    READ_CONFIG,
  );
  assert.deepEqual(seen, { razorpay: null, murf: null, agora: null, groq: null, telegram: null, sarvam: null });
});

test("a service opted in with <SERVICE>_LIVE_TEST=1 keeps its key; the others stay blank", () => {
  const seen = probe({ RAZORPAY_LIVE_TEST: "1", RAZORPAY_KEY_ID: "rzp_test_optin", GROQ_API_KEY: "g" }, READ_CONFIG);
  assert.equal(seen.razorpay, "rzp_test_optin");
  assert.equal(seen.groq, null);
  assert.equal(probe({ RAZORPAY_LIVE_TEST: "1" }, `console.log(JSON.stringify(process.env.RAZORPAY_LIVE_TEST))`), "1", "the opt-in flag itself is never blanked");
});

test("this test process itself runs with the keys blanked (unless opted in)", () => {
  assert.ok(require.cache[require.resolve("./_env")], "test/_env.js was preloaded");
  const { SERVICES, isOptIn } = require("./_env");
  for (const [service, names] of Object.entries(SERVICES)) {
    if (isOptIn(service)) continue;
    for (const name of names) assert.equal(process.env[name], "", name);
  }
});
