"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const store = require("../src/accounts/store");
const sessions = require("../src/accounts/browser-sessions");

const later = (seconds = 3600) => Math.floor(Date.now() / 1000) + seconds;
const newBusiness = () => repo.createBusiness(repo.newId("biz"), { name: "Asha Stores", city: "Mysuru", language: "kn-IN" });
let phone = 0;
const newAccount = () => store.createAccount({ phone: `+9198000${String(++phone).padStart(5, "0")}`, pinHash: "scrypt$1$1$1$x$y" });

test("a device session (no account) is live while its business has no owner, and refused once an account claims it", () => {
  const business = newBusiness();
  const claims = { businessId: business.id, sessionId: "web_dev1", scope: "browser", exp: later() };
  assert.equal(sessions.check(claims), null);
  store.linkBusiness(business.id, newAccount().id);
  assert.equal(sessions.check(claims), "DEVICE_SESSION_CLAIMED");
});

test("an account session is live only while that account is linked to that business", () => {
  const business = newBusiness();
  const owner = newAccount();
  store.linkBusiness(business.id, owner.id);
  const claims = { businessId: business.id, sessionId: "web_acc1", scope: "browser", exp: later(), accountId: owner.id };
  assert.equal(sessions.check(claims), null);
  assert.equal(sessions.check({ ...claims, accountId: newAccount().id }), "ACCOUNT_NOT_LINKED", "another account's id in a token for this business");
  db.prepare("DELETE FROM account_businesses WHERE business_id = ?").run(business.id);
  assert.equal(sessions.check(claims), "ACCOUNT_NOT_LINKED", "the link is re-checked on every request");
});

test("a revoked session is refused; revoking twice is harmless; other sessions are untouched", () => {
  const business = newBusiness();
  const claims = { businessId: business.id, sessionId: "web_out1", scope: "browser", exp: later() };
  sessions.revoke(claims, "logout");
  sessions.revoke(claims, "logout");
  assert.equal(sessions.check(claims), "SESSION_REVOKED");
  assert.equal(sessions.check({ ...claims, sessionId: "web_out2" }), null);
  const row = db.prepare("SELECT business_id, reason, expires_at FROM revoked_sessions WHERE session_id = ?").get("web_out1");
  assert.deepEqual({ ...row }, { business_id: business.id, reason: "logout", expires_at: claims.exp });
});

test("revoke refuses a reason it does not know and claims without a session id", () => {
  assert.throws(() => sessions.revoke({ businessId: "biz_x", sessionId: "web_x", exp: later() }, "because"), /reason/);
  assert.throws(() => sessions.revoke({ businessId: "biz_x", exp: later() }, "logout"), /sessionId/);
});

test("rows of tokens that have expired anyway are pruned on the next revoke", () => {
  db.prepare("INSERT INTO revoked_sessions (session_id, business_id, reason, revoked_at, expires_at) VALUES (?, ?, 'logout', ?, ?)").run(
    "web_old", "biz_old", new Date().toISOString(), Math.floor(Date.now() / 1000) - 10,
  );
  sessions.revoke({ businessId: "biz_new", sessionId: "web_new", exp: later() }, "logout");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM revoked_sessions WHERE session_id = 'web_old'").get().n, 0);
});
