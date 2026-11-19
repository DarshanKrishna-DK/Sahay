"use strict";

// The test bootstrap (test/_env.js): no live third-party key reaches a test unless opted in, and
// every fake key lives there, obviously fake and low-entropy.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("a key set in the environment or in .env never reaches config: optional services are blank, the others are the fakes", () => {
  const { FAKE } = require("./_env");
  const seen = probe(
    { RAZORPAY_KEY_ID: "rzp_test_fromenv", MURF_API_KEY: "m", AGORA_CUSTOMER_SECRET: "a", GROQ_API_KEY: "g", TELEGRAM_BOT_TOKEN: "t", SARVAM_API_KEY: "s" },
    READ_CONFIG,
  );
  assert.deepEqual(seen, { razorpay: null, murf: FAKE.MURF_API_KEY, agora: FAKE.AGORA_CUSTOMER_SECRET, groq: null, telegram: null, sarvam: FAKE.SARVAM_API_KEY });
});

test("a service opted in with <SERVICE>_LIVE_TEST=1 keeps its key; the others stay blank or fake", () => {
  const seen = probe({ RAZORPAY_LIVE_TEST: "1", RAZORPAY_KEY_ID: "rzp_test_optin", GROQ_API_KEY: "g", MURF_LIVE_TEST: "1", MURF_API_KEY: "m" }, READ_CONFIG);
  assert.equal(seen.razorpay, "rzp_test_optin");
  assert.equal(seen.murf, "m");
  assert.equal(seen.groq, null);
  assert.equal(probe({ RAZORPAY_LIVE_TEST: "1" }, `console.log(JSON.stringify(process.env.RAZORPAY_LIVE_TEST))`), "1", "the opt-in flag itself is never blanked");
});

test("this test process itself runs on the bootstrap's environment", () => {
  assert.ok(require.cache[require.resolve("./_env")], "test/_env.js was preloaded");
  const { FAKE, BASELINE, SERVICES, isOptIn } = require("./_env");
  for (const [service, names] of Object.entries(SERVICES)) {
    if (isOptIn(service)) continue;
    for (const name of names) assert.equal(process.env[name], BASELINE.includes(name) ? FAKE[name] : "", name);
  }
});

test("every fake key is obviously fake and low-entropy, and no test file carries a key of its own", () => {
  const { FAKE } = require("./_env");
  for (const [name, value] of Object.entries(FAKE)) {
    assert.ok(new Set(value).size <= 16, `${name} has few distinct characters`);
    assert.ok(/^x+$|^[ac]+$|fake/.test(value), `${name} reads as fake`);
  }
  const KEY_NAMES = /\b(SESSION_SIGNING_SECRET|AGORA_APP_ID|AGORA_APP_CERTIFICATE|AGORA_CUSTOMER_ID|AGORA_CUSTOMER_SECRET|MURF_API_KEY|SARVAM_API_KEY|RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|GROQ_API_KEY|TELEGRAM_BOT_TOKEN)\b\s*[:=]\s*["'`][^"'`]/;
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith(".js") && !["_env.js", "test-env.test.js", "config.test.js"].includes(f))) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, KEY_NAMES, `${file} sets a key itself`);
    assert.doesNotMatch(source, /["'`/][0-9a-f]{32,}["'`/]/i, `${file} holds a 32+ character hex literal`);
  }
});
