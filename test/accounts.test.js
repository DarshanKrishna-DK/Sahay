"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { normalisePhone, maskPhone } = require("../src/accounts/phone");
const pin = require("../src/accounts/pin");
const lockout = require("../src/accounts/lockout");
const store = require("../src/accounts/store");
const passkeys = require("../src/accounts/passkeys");
const { AccountError } = require("../src/accounts/errors");
const repo = require("../src/db/repo");

const hasCode = (code) => (err) => err instanceof AccountError && err.code === code;

/* ------------------------------------------------------------- phone --- */

test("an Indian mobile number is stored as +91 and ten digits, whichever way it was typed", () => {
  for (const typed of ["9876543210", "+91 98765 43210", "91-9876543210", "09876543210", " (987) 654-3210 "]) {
    assert.equal(normalisePhone(typed), "+919876543210", typed);
  }
});

test("a number that is not an Indian mobile is refused", () => {
  for (const bad of ["", "12345", "5876543210", "98765432101", "+1 9876543210", "98765abcde", null, 9876543210, "९८७६५४३२१०"]) {
    assert.throws(() => normalisePhone(bad), hasCode("INVALID_PHONE"), String(bad));
  }
});

test("a masked phone shows only the last four digits", () => {
  assert.equal(maskPhone("+919876543210"), "+91******3210");
  assert.equal(maskPhone("nonsense"), "***");
});

/* --------------------------------------------------------------- PIN --- */

test("a PIN is exactly four ASCII digits", () => {
  assert.equal(pin.isPin("0042"), true);
  for (const bad of ["123", "12345", "12a4", "١٢٣٤", 1234, null, " 1234"]) assert.equal(pin.isPin(bad), false, String(bad));
});

test("a hashed PIN verifies, a different PIN does not, and the hash never contains the PIN", async () => {
  const stored = await pin.hashPin("4821");
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.ok(!stored.includes("4821"));
  assert.equal(await pin.verifyPin("4821", stored), true);
  assert.equal(await pin.verifyPin("4822", stored), false);
  assert.notEqual(await pin.hashPin("4821"), stored, "every hash has its own salt");
});

test("a malformed stored hash fails verification instead of throwing", async () => {
  for (const bad of [null, "", "plain", "scrypt$1$8$1$AA$AA", "md5$16384$8$1$AAAA$AAAA", "scrypt$16384$8$1$$"]) {
    assert.equal(await pin.verifyPin("1234", bad), false, String(bad));
  }
});

test("hashPin refuses something that is not a PIN", async () => {
  await assert.rejects(pin.hashPin("12345"), hasCode("INVALID_PIN"));
});

/* ----------------------------------------------------------- lockout --- */

beforeEach(() => lockout.reset());

const PHONE = "+919800000100";
const at = (address, phone = PHONE) => ({ phone, address });

test("five wrong PINs lock the phone+address pair for fifteen minutes; the fifth failure reports the lock", () => {
  const t0 = 1_000_000;
  for (let i = 1; i <= 4; i++) {
    const done = lockout.attempt(at("a"), t0);
    assert.equal(done.locked, false);
    assert.deepEqual(done.finish(false, t0), { locked: false, retryAfterSeconds: 0, lockedNow: null }, `failure ${i}`);
  }
  const fifth = lockout.attempt(at("a"), t0);
  assert.deepEqual(fifth.finish(false, t0), { locked: true, retryAfterSeconds: 15 * 60, lockedNow: "pair" });
  const blocked = lockout.attempt(at("a"), t0 + 60_000);
  assert.equal(blocked.locked, true);
  assert.equal(blocked.retryAfterSeconds, 14 * 60);
  assert.equal(lockout.attempt(at("b"), t0).locked, false, "the same phone from another address is not pair-locked");
  assert.equal(lockout.attempt(at("a", "+919800000101"), t0).locked, false, "another phone is not locked");
  assert.equal(lockout.attempt(at("a"), t0 + 15 * 60_000).locked, false, "the pair lock ends after fifteen minutes");
});

test("ten wrong PINs for one phone within an hour lock it for an hour from EVERY address", () => {
  const t0 = 5_000_000;
  let last;
  for (let i = 0; i < 10; i++) {
    // A new address for every guess: the per-pair lock never triggers, the per-phone one does.
    const attempt = lockout.attempt(at(`203.0.113.${i}`), t0 + i * 1000);
    assert.equal(attempt.locked, false, `guess ${i + 1}`);
    last = attempt.finish(false, t0 + i * 1000);
  }
  assert.deepEqual(last, { locked: true, retryAfterSeconds: 60 * 60, lockedNow: "phone" });
  const fresh = lockout.attempt(at("198.51.100.200"), t0 + 10_000);
  assert.equal(fresh.locked, true, "a never-seen address is locked out of this phone too");
  assert.ok(fresh.retryAfterSeconds > 59 * 60);
  assert.equal(lockout.attempt(at("198.51.100.200", "+919800000102"), t0 + 10_000).locked, false, "other phones are untouched");
  assert.equal(lockout.attempt(at("198.51.100.200"), t0 + 9_000 + 60 * 60_000 + 1).locked, false, "the phone lock ends after an hour");
});

test("a right PIN clears the pair's failures but not the phone's hourly count", () => {
  for (let i = 0; i < 4; i++) lockout.attempt(at("a"), 0).finish(false, 0);
  lockout.attempt(at("a"), 0).finish(true, 0);
  for (let i = 0; i < 4; i++) assert.equal(lockout.attempt(at("a"), 0).finish(false, 0).locked, false, "pair count restarted");
  // 8 failures so far on the phone; two more from anywhere reach ten.
  lockout.attempt(at("z"), 0).finish(false, 0);
  assert.equal(lockout.attempt(at("y"), 0).finish(false, 0).lockedNow, "phone");
});

test("attempts still in flight count against the limit, so parallel guesses cannot exceed five per pair", () => {
  const inFlight = [];
  for (let i = 0; i < 5; i++) {
    const a = lockout.attempt(at("a"), 0);
    assert.equal(a.locked, false);
    inFlight.push(a);
  }
  assert.equal(lockout.attempt(at("a"), 0).locked, true, "a sixth parallel attempt is refused before any result");
});

test("parallel guesses from many addresses cannot exceed ten per phone", () => {
  const admitted = Array.from({ length: 20 }, (_, i) => lockout.attempt(at(`a${i}`), 0)).filter((a) => !a.locked);
  assert.equal(admitted.length, 10);
});

test("failures older than the window are forgotten", () => {
  for (let i = 0; i < 4; i++) lockout.attempt(at("a"), 0).finish(false, 0);
  const later = 15 * 60_000 + 1;
  assert.equal(lockout.attempt(at("a"), later).finish(false, later).locked, false);
});

test("lockout keys are capped: the oldest unlocked entries are evicted first, live locks are kept", () => {
  for (let i = 0; i < 10; i++) lockout.attempt(at(`x${i}`), 0).finish(false, 0); // PHONE locked
  for (let i = 0; i < lockout.MAX_KEYS + 50; i++) lockout.attempt(at("a", `+91980${String(i).padStart(7, "0")}`), 1).finish(false, 1);
  assert.ok(lockout.size() <= lockout.MAX_KEYS, `size ${lockout.size()}`);
  assert.equal(lockout.attempt(at("q"), 2).locked, true, "a phone lock survives a flood of new keys");
});

/* ------------------------------------------------------------- store --- */

function newBusiness(name = "Lakshmi Stores") {
  return repo.createBusiness(repo.newId("biz"), { name, city: "Mysuru", language: "kn-IN" });
}

test("an account is created with its phone, unverified, and found by phone", async () => {
  const account = store.createAccount({ phone: "+919800000001", pinHash: await pin.hashPin("1111") });
  assert.match(account.id, /^acc_[0-9a-f]+$/);
  assert.deepEqual(store.publicAccount(account), { id: account.id, phone: "+919800000001", phone_verified: false });
  assert.equal(store.findByPhone("+919800000001").id, account.id);
  assert.equal(store.findByPhone("+919800000999"), null);
  assert.equal(store.getAccount(account.id).id, account.id);
  assert.equal(store.getAccount("acc_missing"), null);
});

test("a phone can hold only one account", async () => {
  const pinHash = await pin.hashPin("1111");
  store.createAccount({ phone: "+919800000002", pinHash });
  assert.throws(() => store.createAccount({ phone: "+919800000002", pinHash }), hasCode("PHONE_TAKEN"));
});

test("createAccount refuses a phone that was not normalised and a missing hash", () => {
  assert.throws(() => store.createAccount({ phone: "9800000003", pinHash: "x" }), hasCode("INVALID_PHONE"));
  assert.throws(() => store.createAccount({ phone: "+919800000003", pinHash: "" }), hasCode("INVALID"));
});

test("a business has at most one owner account, and linking is checked both ways", async () => {
  const business = newBusiness();
  const a = store.createAccount({ phone: "+919800000004", pinHash: await pin.hashPin("1111") });
  const b = store.createAccount({ phone: "+919800000005", pinHash: await pin.hashPin("2222") });
  assert.equal(store.ownerOf(business.id), null);
  store.linkBusiness(business.id, a.id);
  assert.equal(store.ownerOf(business.id), a.id);
  assert.equal(store.isLinked(business.id, a.id), true);
  assert.equal(store.isLinked(business.id, b.id), false);
  assert.deepEqual(store.businessesOf(a.id), [business.id]);
  assert.throws(() => store.linkBusiness(business.id, b.id), hasCode("ALREADY_CLAIMED"));
  assert.throws(() => store.linkBusiness("", a.id), (err) => err.code === "BUSINESS_REQUIRED");
});

test("passkeys are stored per account, found by credential id, and the counter only moves forward", async () => {
  const account = store.createAccount({ phone: "+919800000006", pinHash: await pin.hashPin("1111") });
  const publicKey = new Uint8Array([1, 2, 3, 4]);
  const saved = store.addPasskey(account.id, { credentialId: "cred-AAA", publicKey, counter: 0, transports: ["internal"] });
  assert.match(saved.id, /^pky_/);
  const found = store.passkeyByCredentialId("cred-AAA");
  assert.equal(found.account_id, account.id);
  assert.deepEqual(found.publicKey, publicKey);
  assert.deepEqual(found.transports, ["internal"]);
  assert.equal(store.listPasskeys(account.id).length, 1);
  assert.throws(() => store.addPasskey(account.id, { credentialId: "cred-AAA", publicKey, counter: 0 }), hasCode("PASSKEY_EXISTS"));
  store.updatePasskeyCounter("cred-AAA", 7);
  assert.equal(store.passkeyByCredentialId("cred-AAA").counter, 7);
  store.updatePasskeyCounter("cred-AAA", 3);
  assert.equal(store.passkeyByCredentialId("cred-AAA").counter, 7, "a lower counter never overwrites a higher one");
  assert.equal(store.passkeyByCredentialId("cred-none"), null);
});

/* ------------------------------------------------- passkey relying party --- */

test("the relying party is the PUBLIC_URL host, or localhost when the page is on localhost", () => {
  assert.deepEqual(passkeys.relyingParty({ hostname: "sahay.example.in", protocol: "https", host: "sahay.example.in" }, "https://sahay.example.in"), {
    rpID: "sahay.example.in",
    origin: "https://sahay.example.in",
  });
  assert.deepEqual(passkeys.relyingParty({ hostname: "localhost", protocol: "http", host: "localhost:3000" }, "https://sahay.example.in"), {
    rpID: "localhost",
    origin: "http://localhost:3000",
  });
  // Any other host (an IP, a forged Host header) still gets the public relying party.
  assert.deepEqual(passkeys.relyingParty({ hostname: "127.0.0.1", protocol: "http", host: "127.0.0.1:3000" }, "https://sahay.example.in").rpID, "sahay.example.in");
});

test("without PUBLIC_URL, passkeys are unavailable except on localhost", () => {
  assert.throws(() => passkeys.relyingParty({ hostname: "example.com", protocol: "https", host: "example.com" }, null), hasCode("PASSKEY_UNAVAILABLE"));
});

test("a challenge is used once and expires", () => {
  passkeys.challenges.reset();
  passkeys.challenges.remember("abc", { kind: "login", accountId: null, rp: { rpID: "x", origin: "https://x" } }, 0);
  assert.equal(passkeys.challenges.take("abc", "register", 1), null, "a login challenge is not a registration challenge");
  passkeys.challenges.remember("abc", { kind: "login", accountId: null, rp: { rpID: "x", origin: "https://x" } }, 0);
  assert.equal(passkeys.challenges.take("abc", "login", 1).kind, "login");
  assert.equal(passkeys.challenges.take("abc", "login", 2), null, "taken once");
  passkeys.challenges.remember("old", { kind: "login", accountId: null, rp: {} }, 0);
  assert.equal(passkeys.challenges.take("old", "login", 5 * 60_000 + 1), null, "expired");
});

test("a response with no readable challenge is rejected", async () => {
  await assert.rejects(passkeys.verifyAuthentication({ id: "x", response: { clientDataJSON: "not-json" } }), hasCode("PASSKEY_REJECTED"));
  await assert.rejects(passkeys.verifyAuthentication(null), hasCode("PASSKEY_REJECTED"));
});

/* ------------------------------------------- device business at signup --- */

test("signup claims a device business only for the same shop name (case, spaces, Unicode form aside) or an explicit claimDevice: true", () => {
  const { deviceBusinessToClaim } = require("../src/accounts");
  const device = { id: "biz_device", name: "Sri  Ganesh Provisions" };
  const claim = (typedName, claimDevice) => deviceBusinessToClaim({ device, typedName, claimDevice });
  assert.equal(claim("sri ganesh provisions"), "biz_device");
  assert.equal(claim("  SRI GANESH   PROVISIONS "), "biz_device");
  assert.equal(deviceBusinessToClaim({ device: { id: "b", name: "आशा किराना" }, typedName: "आशा किराना".normalize("NFD") }), "b");
  assert.equal(claim("Annapurna Kirana"), null, "another shop name makes a new business");
  assert.equal(claim("Annapurna Kirana", true), "biz_device", "unless the client explicitly asks to keep this device's shop");
  for (const loose of [false, "true", 1, undefined]) assert.equal(claim("Annapurna Kirana", loose), null);
  assert.equal(deviceBusinessToClaim({ device: null, typedName: "x", claimDevice: true }), null, "nothing to claim");
});
