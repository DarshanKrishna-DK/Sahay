"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
  SAHAY_ACCESS_CODE: "open-sesame-2026",
  TRUST_CF_CONNECTING_IP: "1", // the cloudflared opt-in, so each test can pick its client IP
});

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, beforeEach } = require("node:test");

const { createApp } = require("../server");
const auth = require("../src/auth");
const repo = require("../src/db/repo");
const events = require("../src/events");
const limits = require("../src/limits");
const lockout = require("../src/accounts/lockout");
const store = require("../src/accounts/store");

const CODE = "open-sesame-2026";
const ORIGIN = "https://sahay.test";
let ipCounter = 0;
/** A fresh documentation-range client IP per call site, so per-IP limits do not leak between tests. */
const freshIp = () => `203.0.113.${(ipCounter += 1) % 250}`;
let phoneCounter = 0;
const freshPhone = () => `98${String(70000000 + (phoneCounter += 1)).padStart(8, "0")}`;

beforeEach(() => {
  limits.reset();
  lockout.reset();
});

async function withApp(run) {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** TRUST_CF_CONNECTING_IP=1: the server trusts CF-Connecting-IP from loopback, so tests can pick the client IP. */
async function call(base, method, urlPath, { cookie, body, ip = "198.51.100.7" } = {}) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      "CF-Connecting-IP": ip,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

const details = (overrides = {}) => ({ phone: freshPhone(), pin: "4821", name: "Asha Kirana", city: "Bengaluru", language: "hi-IN", accessCode: CODE, ...overrides });

async function register(base, overrides = {}, opts = {}) {
  const body = details(overrides);
  const out = await call(base, "POST", "/api/auth/register", { body, ip: opts.ip ?? freshIp(), cookie: opts.cookie });
  return { ...out, body };
}

/* ---------------------------------------------------------- register --- */

test("register creates an account and a business, answers 201 and sets the HttpOnly session cookie", async () => {
  await withApp(async (base) => {
    const out = await register(base, { phone: "98765 43210" });
    assert.equal(out.status, 201, JSON.stringify(out.json));
    assert.deepEqual(Object.keys(out.json).sort(), ["account", "business"]);
    assert.deepEqual(out.json.account, { id: out.json.account.id, phone: "+919876543210", phone_verified: false });
    assert.equal(out.json.business.name, "Asha Kirana");
    assert.equal(out.json.business.language, "hi-IN");
    const setCookie = out.res.headers.get("set-cookie");
    assert.match(setCookie, /^sahay_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const claims = auth.verifySession(out.cookie.slice("sahay_session=".length), { scope: "browser" });
    assert.equal(claims.accountId, out.json.account.id, "the cookie is bound to the account");
    assert.equal(claims.businessId, out.json.business.id, "and to the business");

    const state = await call(base, "GET", "/api/state", { cookie: out.cookie });
    assert.equal(state.status, 200, "the account cookie opens the existing browser API");
    assert.equal(state.json.business.id, out.json.business.id);
    assert.equal(store.ownerOf(out.json.business.id), out.json.account.id);
  });
});

test("register claims the device-session business when the typed shop name is its name (case and spaces aside)", async () => {
  await withApp(async (base) => {
    const device = await call(base, "POST", "/api/session", { body: { name: "Old Device Shop", city: "Mysuru", language: "kn-IN", accessCode: CODE }, ip: freshIp() });
    const out = await register(base, { name: "  old   DEVICE shop ", city: "Mysuru", language: "kn-IN", accessCode: undefined }, { cookie: device.cookie });
    assert.equal(out.status, 201, JSON.stringify(out.json));
    assert.equal(out.json.business.id, device.json.business.id);
    assert.equal(out.json.business.name, "Old Device Shop", "a claimed business keeps its details");
    assert.equal(store.ownerOf(device.json.business.id), out.json.account.id);
  });
});

test("register with an old device cookie and another shop name makes a new business with the typed details (E2E 2026-11-19 bug 1a)", async () => {
  await withApp(async (base) => {
    const device = await call(base, "POST", "/api/session", { body: { name: "Sri Ganesh Provisions", city: "Mysuru", language: "kn-IN", accessCode: CODE }, ip: freshIp() });
    // A new business needs the access code like any other; the old cookie does not stand in for it.
    const noCode = await register(base, { name: "Annapurna Kirana", city: "Bengaluru", language: "hi-IN", accessCode: undefined }, { cookie: device.cookie });
    assert.equal(noCode.status, 403);
    assert.equal(noCode.json.code, "ACCESS_CODE_REQUIRED");
    for (const claimDevice of [false, "true", 1]) {
      const sneaky = await register(base, { name: "Annapurna Kirana", accessCode: undefined, claimDevice }, { cookie: device.cookie });
      assert.equal(sneaky.status, 403, `claimDevice ${JSON.stringify(claimDevice)} is not an explicit claim`);
    }

    const out = await register(base, { name: "Annapurna Kirana", city: "Bengaluru", language: "hi-IN" }, { cookie: device.cookie });
    assert.equal(out.status, 201, JSON.stringify(out.json));
    assert.notEqual(out.json.business.id, device.json.business.id, "the old business is not adopted");
    assert.deepEqual([out.json.business.name, out.json.business.city, out.json.business.language], ["Annapurna Kirana", "Bengaluru", "hi-IN"]);
    assert.equal(store.ownerOf(device.json.business.id), null, "the old device business stays unclaimed");
    const me = await call(base, "GET", "/api/auth/me", { cookie: out.cookie });
    assert.equal(me.json.business.name, "Annapurna Kirana");
  });
});

test("register claims the device-session business when the client explicitly asks (claimDevice: true)", async () => {
  await withApp(async (base) => {
    const device = await call(base, "POST", "/api/session", { body: { name: "Old Device Shop", city: "Mysuru", language: "kn-IN", accessCode: CODE }, ip: freshIp() });
    assert.equal(device.status, 200);
    const out = await register(base, { name: "Typed Again", language: "kn-IN", accessCode: undefined, claimDevice: true }, { cookie: device.cookie });
    assert.equal(out.status, 201, JSON.stringify(out.json));
    assert.equal(out.json.business.id, device.json.business.id, "the same business, now owned by the account");
    assert.equal(out.json.business.name, "Old Device Shop", "a claimed business keeps its details");
    assert.equal(store.ownerOf(device.json.business.id), out.json.account.id);

    // A second account cannot claim it with the same old device cookie.
    const again = await register(base, { accessCode: CODE }, { cookie: device.cookie });
    assert.equal(again.status, 201);
    assert.notEqual(again.json.business.id, device.json.business.id, "an owned business is never claimed twice; a new one is made");
    assert.equal(store.ownerOf(device.json.business.id), out.json.account.id);
  });
});

test("register never takes a business id from the body", async () => {
  await withApp(async (base) => {
    const victim = repo.createBusiness(repo.newId("biz"), { name: "Victim Shop", language: "en-IN" });
    const out = await register(base, { businessId: victim.id });
    assert.equal(out.status, 201);
    assert.notEqual(out.json.business.id, victim.id);
    assert.equal(store.ownerOf(victim.id), null);
  });
});

test("register validates phone, PIN, name and language, and creates nothing on failure", async () => {
  await withApp(async (base) => {
    const cases = [
      [{ phone: "12345" }, "INVALID_PHONE"],
      [{ phone: "5876543210" }, "INVALID_PHONE"],
      [{ pin: "123" }, "INVALID_PIN"],
      [{ pin: "12345" }, "INVALID_PIN"],
      [{ pin: 4821 }, "INVALID_PIN"],
      [{ name: "" }, "BUSINESS_DETAILS_REQUIRED"],
      [{ city: "" }, "BUSINESS_DETAILS_REQUIRED"],
      [{ name: "<script>" }, "INVALID"],
      [{ language: "fr-FR" }, "INVALID"],
    ];
    for (const [overrides, code] of cases) {
      const out = await register(base, overrides);
      assert.equal(out.status, 400, JSON.stringify(overrides));
      assert.equal(out.json.code, code, JSON.stringify(overrides));
      assert.equal(out.cookie, null);
      if (overrides.phone === undefined) assert.equal(store.findByPhone(`+91${out.body.phone}`), null);
    }
  });
});

test("a phone that already has an account answers 409 PHONE_TAKEN with a line in the owner's language", async () => {
  await withApp(async (base) => {
    const phone = freshPhone();
    assert.equal((await register(base, { phone })).status, 201);
    const again = await register(base, { phone: `+91${phone}`, language: "kn-IN" });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "PHONE_TAKEN");
    assert.match(again.json.say, /[ಀ-೿]/, "Kannada script");
    assert.equal(again.cookie, null);
  });
});

test("register needs the access code for a new business (403), and counts in the same per-IP window as /api/session", async () => {
  await withApp(async (base) => {
    const missing = await register(base, { accessCode: undefined });
    assert.equal(missing.status, 403);
    assert.equal(missing.json.code, "ACCESS_CODE_REQUIRED");
    assert.equal(store.findByPhone(`+91${missing.body.phone}`), null, "no account without the code");

    const ip = "192.0.2.50";
    for (let i = 0; i < 3; i++) assert.equal((await register(base, {}, { ip })).status, 201);
    for (let i = 0; i < 2; i++) {
      const s = await call(base, "POST", "/api/session", { ip, body: { name: "Shop", city: "Pune", language: "en-IN", accessCode: CODE } });
      assert.equal(s.status, 200);
    }
    const limited = await register(base, {}, { ip });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, "RATE_LIMITED");
    assert.ok(Number(limited.res.headers.get("retry-after")) > 0);
    assert.match(limited.json.say, /[ऀ-ॿ]/, "Hindi in Devanagari");
  });
});

/* ------------------------------------------------------- login, me, logout --- */

test("login with the right PIN answers {account, business} and a cookie; me reads it back; logout clears it", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const login = await call(base, "POST", "/api/auth/login", { body: { phone: reg.body.phone, pin: "4821" } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    assert.deepEqual(login.json.account, reg.json.account);
    assert.equal(login.json.business.id, reg.json.business.id);
    assert.ok(login.cookie);

    const me = await call(base, "GET", "/api/auth/me", { cookie: login.cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(me.json, { account: reg.json.account, business: reg.json.business });

    const out = await call(base, "POST", "/api/auth/logout", { cookie: login.cookie });
    assert.equal(out.status, 204);
    assert.match(out.res.headers.get("set-cookie"), /^sahay_session=;.*Max-Age=0/);
  });
});

test("GET /api/auth/me is 401 NOT_SIGNED_IN without a cookie, with a device-only cookie, or with a forged account", async () => {
  await withApp(async (base) => {
    const none = await call(base, "GET", "/api/auth/me");
    assert.equal(none.status, 401);
    assert.equal(none.json.code, "NOT_SIGNED_IN");

    const device = await call(base, "POST", "/api/session", { body: { name: "Device", city: "Pune", language: "en-IN", accessCode: CODE }, ip: freshIp() });
    const deviceMe = await call(base, "GET", "/api/auth/me", { cookie: device.cookie });
    assert.equal(deviceMe.status, 401);
    assert.equal(deviceMe.json.code, "NOT_SIGNED_IN");

    // A correctly signed cookie for an account that does not own the business.
    const a = await register(base);
    const b = await register(base);
    const crossed = auth.signSession({ businessId: b.json.business.id, sessionId: "web_x", scope: "browser", exp: Math.floor(Date.now() / 1000) + 600, accountId: a.json.account.id });
    const crossedMe = await call(base, "GET", "/api/auth/me", { cookie: `sahay_session=${crossed}` });
    assert.equal(crossedMe.status, 401);
    assert.equal(crossedMe.json.code, "NOT_SIGNED_IN");

    const garbage = await call(base, "GET", "/api/auth/me", { cookie: "sahay_session=v1.abc.def" });
    assert.equal(garbage.status, 401);
  });
});

test("a wrong PIN is 401 WRONG_PIN, and an unknown phone looks exactly the same", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const wrong = await call(base, "POST", "/api/auth/login", { body: { phone: reg.body.phone, pin: "0000" } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, "WRONG_PIN");
    assert.equal(wrong.cookie, null);
    const unknown = await call(base, "POST", "/api/auth/login", { body: { phone: freshPhone(), pin: "0000" } });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.json, wrong.json);
  });
});

test("five wrong PINs from one IP lock that phone there for 15 minutes, even for the right PIN; another IP is not locked", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const ip = "198.51.100.77";
    for (let i = 1; i <= 4; i++) {
      const out = await call(base, "POST", "/api/auth/login", { ip, body: { phone: reg.body.phone, pin: "1111" } });
      assert.equal(out.status, 401, `wrong PIN ${i}`);
    }
    const fifth = await call(base, "POST", "/api/auth/login", { ip, body: { phone: reg.body.phone, pin: "1111", language: "kn-IN" } });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.json.code, "PIN_LOCKED");
    assert.equal(fifth.res.headers.get("retry-after"), String(15 * 60));
    assert.match(fifth.json.say, /[ಀ-೿]/);

    const right = await call(base, "POST", "/api/auth/login", { ip, body: { phone: reg.body.phone, pin: "4821" } });
    assert.equal(right.status, 429, "locked: the right PIN is not even checked");
    assert.equal(right.json.code, "PIN_LOCKED");
    assert.equal(right.cookie, null);

    const elsewhere = await call(base, "POST", "/api/auth/login", { ip: "198.51.100.78", body: { phone: reg.body.phone, pin: "4821" } });
    assert.equal(elsewhere.status, 200, "the lock is per phone+IP");
  });
});

test("parallel wrong PINs cannot get past five guesses", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const ip = "198.51.100.90";
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => call(base, "POST", "/api/auth/login", { ip, body: { phone: reg.body.phone, pin: String(1000 + i) } })),
    );
    const checked = results.filter((r) => r.json.code === "WRONG_PIN").length;
    assert.ok(checked <= 5, `at most five PINs were checked, got ${checked}`);
    assert.ok(results.every((r) => r.status === 401 || r.status === 429));
  });
});

test("login validates its input", async () => {
  await withApp(async (base) => {
    assert.equal((await call(base, "POST", "/api/auth/login", { body: { phone: "123", pin: "1234" } })).json.code, "INVALID_PHONE");
    assert.equal((await call(base, "POST", "/api/auth/login", { body: { phone: freshPhone(), pin: "12" } })).json.code, "INVALID_PIN");
    assert.equal((await call(base, "POST", "/api/auth/login", { body: {} })).status, 400);
  });
});

test("the server log never carries a PIN or a full phone number", async (t) => {
  const lines = [];
  for (const method of ["log", "warn", "error", "info"]) {
    const original = console[method];
    console[method] = (...args) => lines.push(args.join(" "));
    t.after(() => {
      console[method] = original;
    });
  }
  await withApp(async (base) => {
    const reg = await register(base, { pin: "7391" });
    await call(base, "POST", "/api/auth/login", { body: { phone: reg.body.phone, pin: "7390" } });
    await call(base, "POST", "/api/auth/login", { body: { phone: reg.body.phone, pin: "7391" } });
    await register(base, { phone: reg.body.phone, pin: "7391" });
    const text = lines.join("\n");
    assert.ok(!text.includes("7391") && !text.includes("7390"), "no PIN in the log");
    assert.ok(!text.includes(reg.body.phone), "no full phone number in the log");
  });
});

/* ------------------------------------------------------------ passkeys --- */

/** A minimal CBOR encoder: unsigned/negative integers, byte strings, text and maps (Map or plain object). */
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** A software platform authenticator (ES256, "none" attestation) for one relying party. */
function softAuthenticator(rpID = "sahay.test", origin = ORIGIN) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = crypto.randomBytes(16);
  let counter = 0;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const flagsAndCount = (flags, count) => {
    const b = Buffer.alloc(5);
    b[0] = flags;
    b.writeUInt32BE(count, 1);
    return b;
  };
  return {
    id: b64u(credentialId),
    register(options) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([sha256(rpID), flagsAndCount(0x45, 0), Buffer.alloc(16), idLen, credentialId, cose]);
      const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    login(options, { sameCounter = false } = {}) {
      if (!sameCounter) counter += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha256(rpID), flagsAndCount(0x05, counter)]);
      const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}

async function addPasskey(base, reg, device = softAuthenticator()) {
  const options = await call(base, "POST", "/api/auth/passkey/register/options", { cookie: reg.cookie, body: {} });
  assert.equal(options.status, 200, JSON.stringify(options.json));
  const verify = await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: reg.cookie, body: device.register(options.json) });
  assert.equal(verify.status, 201, JSON.stringify(verify.json));
  return { device, options: options.json, verify: verify.json };
}

test("passkey registration options name the PUBLIC_URL host, prefer user verification and exclude existing keys", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const first = await addPasskey(base, reg);
    assert.equal(first.options.rp.id, "sahay.test");
    assert.equal(first.options.authenticatorSelection.userVerification, "preferred");
    assert.equal(first.options.attestation, "none");
    assert.match(first.options.user.name, /^\+91\d{10}$/);
    assert.equal(first.verify.passkey.id.startsWith("pky_"), true);

    const second = await call(base, "POST", "/api/auth/passkey/register/options", { cookie: reg.cookie, body: {} });
    assert.deepEqual(second.json.excludeCredentials.map((c) => c.id), [first.device.id]);
    const stored = store.passkeyByCredentialId(first.device.id);
    assert.equal(stored.account_id, reg.json.account.id);
    assert.equal(stored.counter, 0);
  });
});

test("passkey registration needs an account session (a device-only cookie is not enough)", async () => {
  await withApp(async (base) => {
    const none = await call(base, "POST", "/api/auth/passkey/register/options", { body: {} });
    assert.equal(none.status, 401);
    assert.equal(none.json.code, "NOT_SIGNED_IN");
    const device = await call(base, "POST", "/api/session", { body: { name: "Device", city: "Pune", language: "en-IN", accessCode: CODE }, ip: freshIp() });
    const deviceOnly = await call(base, "POST", "/api/auth/passkey/register/options", { cookie: device.cookie, body: {} });
    assert.equal(deviceOnly.status, 401);
    const verify = await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: device.cookie, body: {} });
    assert.equal(verify.status, 401);
  });
});

test("a registration response for another account's challenge, a wrong origin or a replay is rejected", async () => {
  await withApp(async (base) => {
    const a = await register(base);
    const b = await register(base);
    const optionsA = (await call(base, "POST", "/api/auth/passkey/register/options", { cookie: a.cookie, body: {} })).json;
    const stolen = await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: b.cookie, body: softAuthenticator().register(optionsA) });
    assert.equal(stolen.status, 400);
    assert.equal(stolen.json.code, "PASSKEY_REJECTED");

    const optionsB = (await call(base, "POST", "/api/auth/passkey/register/options", { cookie: b.cookie, body: {} })).json;
    const phish = await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: b.cookie, body: softAuthenticator("sahay.test", "https://evil.test").register(optionsB) });
    assert.equal(phish.status, 400);
    assert.equal(phish.json.code, "PASSKEY_REJECTED");

    const optionsB2 = (await call(base, "POST", "/api/auth/passkey/register/options", { cookie: b.cookie, body: {} })).json;
    const device = softAuthenticator();
    const response = device.register(optionsB2);
    assert.equal((await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: b.cookie, body: response })).status, 201);
    const replay = await call(base, "POST", "/api/auth/passkey/register/verify", { cookie: b.cookie, body: response });
    assert.equal(replay.status, 400, "a challenge is used once");
    assert.equal(store.listPasskeys(b.json.account.id).length, 1);
  });
});

test("passkey login signs in the passkey's account with a cookie and updates the counter", async () => {
  await withApp(async (base) => {
    const reg = await register(base);
    const { device } = await addPasskey(base, reg);

    const options = await call(base, "POST", "/api/auth/passkey/login/options", { body: { phone: reg.body.phone } });
    assert.equal(options.status, 200);
    assert.equal(options.json.rpId, "sahay.test");
    assert.equal(options.json.userVerification, "preferred");
    assert.deepEqual(options.json.allowCredentials.map((c) => c.id), [device.id]);

    const login = await call(base, "POST", "/api/auth/passkey/login/verify", { body: device.login(options.json) });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    assert.deepEqual(login.json, { account: reg.json.account, business: reg.json.business });
    assert.ok(login.cookie);
    assert.equal((await call(base, "GET", "/api/auth/me", { cookie: login.cookie })).status, 200);
    assert.equal(store.passkeyByCredentialId(device.id).counter, 1);

    // Without a phone: a discoverable credential, no allow list.
    const open = await call(base, "POST", "/api/auth/passkey/login/options", { body: {} });
    assert.equal(open.status, 200);
    assert.ok(!open.json.allowCredentials?.length);
    const login2 = await call(base, "POST", "/api/auth/passkey/login/verify", { body: device.login(open.json) });
    assert.equal(login2.status, 200);
  });
});

test("passkey login rejects a replay, a reused counter, an unknown key, a forged signature and a key of another phone", async () => {
  await withApp(async (base) => {
    const a = await register(base);
    const b = await register(base);
    const { device } = await addPasskey(base, a);

    const options = (await call(base, "POST", "/api/auth/passkey/login/options", { body: {} })).json;
    const response = device.login(options);
    assert.equal((await call(base, "POST", "/api/auth/passkey/login/verify", { body: response })).status, 200);
    const replay = await call(base, "POST", "/api/auth/passkey/login/verify", { body: response });
    assert.equal(replay.status, 401);
    assert.equal(replay.json.code, "PASSKEY_REJECTED");
    assert.equal(replay.cookie, null);

    const options2 = (await call(base, "POST", "/api/auth/passkey/login/options", { body: {} })).json;
    const cloned = await call(base, "POST", "/api/auth/passkey/login/verify", { body: device.login(options2, { sameCounter: true }) });
    assert.equal(cloned.status, 401, "a counter that did not move is a cloned authenticator");

    const options3 = (await call(base, "POST", "/api/auth/passkey/login/options", { body: {} })).json;
    const stranger = await call(base, "POST", "/api/auth/passkey/login/verify", { body: softAuthenticator().login(options3) });
    assert.equal(stranger.status, 401);

    const options4 = (await call(base, "POST", "/api/auth/passkey/login/options", { body: {} })).json;
    const forged = device.login(options4);
    forged.response.signature = b64u(Buffer.from(forged.response.signature, "base64url").reverse());
    assert.equal((await call(base, "POST", "/api/auth/passkey/login/verify", { body: forged })).status, 401);

    const forB = (await call(base, "POST", "/api/auth/passkey/login/options", { body: { phone: b.body.phone } })).json;
    const wrongAccount = await call(base, "POST", "/api/auth/passkey/login/verify", { body: device.login(forB) });
    assert.equal(wrongAccount.status, 401, "options asked for phone B; A's key does not sign B in");

    assert.equal((await call(base, "POST", "/api/auth/passkey/login/verify", { body: { nonsense: true } })).status, 401);
  });
});

test("passkey login options validate the phone", async () => {
  await withApp(async (base) => {
    const bad = await call(base, "POST", "/api/auth/passkey/login/options", { body: { phone: "12" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "INVALID_PHONE");
  });
});

/* ------------------------------------------------------- browser helper --- */

test("the SimpleWebAuthn browser bundle is served from self, byte for byte the node_modules file", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/vendor/simplewebauthn-browser.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    const served = Buffer.from(await res.arrayBuffer());
    const main = require.resolve("@simplewebauthn/browser");
    const file = path.join(path.dirname(path.dirname(main)), "dist", "bundle", "index.umd.min.js");
    assert.ok(served.equals(fs.readFileSync(file)));
    assert.match(served.toString("utf8", 0, 60), /@simplewebauthn\/browser@14\.0\.0/);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  });
});
