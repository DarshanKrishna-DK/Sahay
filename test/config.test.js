"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const util = require("node:util");

const { loadConfig, missingKeys, ConfigError } = require("../src/config");

const ROOT = path.join(__dirname, "..");
const SECRET = "s".repeat(32);

const FULL_ENV = {
  PORT: "4100",
  PUBLIC_URL: "https://sahay.example.test/",
  DB_FILE: path.join(ROOT, "data", "elsewhere", "sahay.db"),
  SESSION_SIGNING_SECRET: SECRET,
  AGORA_APP_ID: "agora-app",
  AGORA_APP_CERTIFICATE: "agora-cert",
  AGORA_CUSTOMER_ID: "agora-customer",
  AGORA_CUSTOMER_SECRET: "agora-secret",
  MURF_API_KEY: "murf-key",
  MURF_REGION: "in",
  MURF_VOICE_EN: "voice-en",
  MURF_VOICE_HI: "voice-hi",
  MURF_VOICE_KN: "voice-kn",
  SARVAM_API_KEY: "sarvam-key",
  GROQ_API_KEY: "groq-key",
  RAZORPAY_KEY_ID: "rzp_test_abc123",
  RAZORPAY_KEY_SECRET: "razorpay-secret",
  TELEGRAM_BOT_TOKEN: "telegram-token",
};

test("a complete environment is read into one config object with nothing missing", () => {
  const config = loadConfig(FULL_ENV);
  assert.equal(config.port, 4100);
  assert.equal(config.publicUrl, "https://sahay.example.test");
  assert.equal(config.dbFile, FULL_ENV.DB_FILE);
  assert.equal(config.poDir, path.join(ROOT, "data", "elsewhere", "po"));
  assert.equal(config.sessionSecret, SECRET);
  assert.equal(config.agora.appCertificate, "agora-cert");
  assert.deepEqual({ ...config.murf.voices }, { "en-IN": "voice-en", "hi-IN": "voice-hi", "kn-IN": "voice-kn" });
  assert.equal(config.razorpay.keyId, "rzp_test_abc123");
  assert.equal(config.telegram.botToken, "telegram-token");
  assert.deepEqual(missingKeys(config), []);
});

test("an empty environment yields no invented keys and lists every required one as missing", () => {
  const config = loadConfig({});
  for (const value of [
    config.publicUrl, config.sessionSecret, config.agora.appId, config.agora.appCertificate, config.agora.customerId,
    config.agora.customerSecret, config.murf.key, config.murf.region, config.murf.voices["hi-IN"], config.sarvam.key,
    config.groq.key, config.razorpay.keyId, config.razorpay.keySecret, config.telegram.botToken,
  ]) {
    assert.equal(value, null);
  }
  assert.deepEqual(missingKeys(config), [
    "PUBLIC_URL", "SESSION_SIGNING_SECRET", "AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_CUSTOMER_ID",
    "AGORA_CUSTOMER_SECRET", "MURF_API_KEY", "MURF_VOICE_EN", "MURF_VOICE_HI", "MURF_VOICE_KN", "SARVAM_API_KEY",
    "GROQ_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
  ]);
});

test("a blank value counts as missing", () => {
  assert.deepEqual(missingKeys(loadConfig({ ...FULL_ENV, MURF_API_KEY: "   " })), ["MURF_API_KEY"]);
});

test("a live Razorpay key is refused, and the error does not repeat the key", () => {
  const liveKey = "rzp_live_fake001";
  assert.throws(
    () => loadConfig({ ...FULL_ENV, RAZORPAY_KEY_ID: liveKey }),
    (err) => err instanceof ConfigError && err.code === "RAZORPAY_LIVE_KEY" && !err.message.includes(liveKey),
  );
});

test("boot fails when the environment holds a live Razorpay key", () => {
  const liveKey = "rzp_live_fake001";
  const child = spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: ROOT,
    env: { ...process.env, DB_FILE: ":memory:", RAZORPAY_KEY_ID: liveKey, RAZORPAY_KEY_SECRET: "anything" },
    encoding: "utf8",
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /RAZORPAY_KEY_ID is not a test key/);
  assert.ok(!child.stderr.includes(liveKey) && !child.stdout.includes(liveKey));
});

test("boot succeeds with a test Razorpay key", () => {
  const child = spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: ROOT,
    env: { ...process.env, DB_FILE: ":memory:", RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "anything" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
});

test("malformed settings are refused instead of being coerced", () => {
  const refuses = (env, code) => assert.throws(() => loadConfig({ ...FULL_ENV, ...env }), (err) => err instanceof ConfigError && err.code === code);
  refuses({ PORT: "abc" }, "INVALID_PORT");
  refuses({ PORT: "70000" }, "INVALID_PORT");
  refuses({ PORT: "3000.5" }, "INVALID_PORT");
  refuses({ PUBLIC_URL: "sahay.example.test" }, "INVALID_PUBLIC_URL");
  refuses({ PUBLIC_URL: "ftp://sahay.example.test" }, "INVALID_PUBLIC_URL");
  refuses({ SESSION_SIGNING_SECRET: "too-short" }, "WEAK_SESSION_SECRET");
});

test("the port falls back to 3000 only when PORT is unset", () => {
  const { PORT, ...withoutPort } = FULL_ENV;
  assert.equal(loadConfig(withoutPort).port, 3000);
});

test("printing the config never shows a secret", () => {
  const config = loadConfig(FULL_ENV);
  const printed = [
    util.inspect(config, { depth: 5 }),
    JSON.stringify(config),
    util.inspect(config.razorpay),
    JSON.stringify(config.agora),
    util.format("%o", config.murf),
  ].join("\n");
  for (const secret of [SECRET, "agora-cert", "agora-customer", "agora-secret", "murf-key", "sarvam-key", "groq-key", "rzp_test_abc123", "razorpay-secret", "telegram-token"]) {
    assert.ok(!printed.includes(secret), `a secret was printed: ${secret.slice(0, 4)}...`);
  }
  assert.match(printed, /\[redacted\]/);
});

test("the config cannot be changed after it is loaded", () => {
  const config = loadConfig(FULL_ENV);
  assert.throws(() => {
    config.razorpay.keyId = "rzp_live_swapped";
  }, TypeError);
  assert.equal(config.razorpay.keyId, "rzp_test_abc123");
});
