"use strict";

// Rate limits when no tunnel header is trusted (the default; security review r2 #1): every
// loopback caller is the same "untrusted" caller, a forged CF-Connecting-IP or X-Forwarded-For
// mints no new bucket, and the shared bucket has a larger, global cap than one address.

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  TELEGRAM_BOT_TOKEN: "",
  SAHAY_ACCESS_CODE: "open-sesame-2026",
  TRUST_PROXY: "",
  TRUST_CF_CONNECTING_IP: "",
  TRUST_FORWARDED_FOR: "",
  RAZORPAY_KEY_ID: FAKE.RAZORPAY_KEY_ID, // a pay link is looked up only with Razorpay configured; nothing calls it here
  RAZORPAY_KEY_SECRET: FAKE.RAZORPAY_KEY_SECRET,
});

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { createApp } = require("../server");
const events = require("../src/events");
const limits = require("../src/limits");
const { RATE } = require("../src/routes/api");

const CODE = "open-sesame-2026";

beforeEach(() => limits.reset());

async function withApp(run) {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function newBusiness(base, i, headers = {}) {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ name: `Shop ${i}`, language: "en-IN", accessCode: CODE }),
  });
  return res.status;
}

test("untrusted callers share one global sign-up bucket: forged headers do not help, honest users are not stopped at the per-IP 5", async () => {
  const cap = RATE.newBusiness.untrusted.max;
  assert.ok(cap > RATE.newBusiness.perIp.max);
  await withApp(async (base) => {
    for (let i = 0; i < cap; i++) {
      const forged = i % 2 ? { "CF-Connecting-IP": `203.0.113.${i}` } : { "X-Forwarded-For": `198.51.100.${i}` };
      assert.equal(await newBusiness(base, i, forged), 200, `business ${i + 1} of ${cap}`);
    }
    assert.equal(await newBusiness(base, "over", { "CF-Connecting-IP": "192.0.2.77" }), 429, "a fresh forged address is still the same caller");
    assert.equal(await newBusiness(base, "plain"), 429);
  });
});

test("an unknown pay token counts against the caller's (here: the shared untrusted) bucket and ends in 429", async () => {
  const cap = RATE.badPayToken.untrusted.max;
  limits.reset();
  for (let i = 0; i < cap; i++) assert.equal(limits.allow("pay:bad-token:untrusted", cap, RATE.badPayToken.untrusted.windowMs), true);
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/pay/pay_${"A".repeat(22)}`, { headers: { "CF-Connecting-IP": "203.0.113.5" } });
    assert.equal(res.status, 429);
  });
});
