"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");
const express = require("express");

const auth = require("../src/auth");

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
const claims = (overrides = {}) => ({ businessId: "biz_a", sessionId: "ses_1", scope: "browser", exp: inAnHour(), ...overrides });
const hasCode = (code) => (err) => err instanceof auth.AuthError && err.code === code;

/** Build a token the way auth.js does, with any secret and any payload. */
function forge(payload, secret = process.env.SESSION_SIGNING_SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`v1.${body}`).digest("base64url");
  return `v1.${body}.${signature}`;
}

test("a signed session verifies and returns exactly its claims", () => {
  const session = claims();
  const token = auth.signSession(session);
  assert.deepEqual(auth.verifySession(token), session);
  assert.deepEqual(auth.verifySession(token, { scope: "browser" }), session);
  assert.equal(token, forge(session), "the token format is v1.<payload>.<hmac-sha256>");
});

test("a token whose payload was changed is rejected", () => {
  const [version, , signature] = auth.signSession(claims()).split(".");
  const swapped = Buffer.from(JSON.stringify(claims({ businessId: "biz_victim" }))).toString("base64url");
  assert.throws(() => auth.verifySession(`${version}.${swapped}.${signature}`), hasCode("BAD_SIGNATURE"));
});

test("a token whose signature was changed is rejected, whichever character is altered", () => {
  const token = auth.signSession(claims());
  const [version, payload, signature] = token.split(".");
  for (let i = 0; i < signature.length; i += 1) {
    const replacement = signature[i] === "A" ? "B" : "A";
    const altered = signature.slice(0, i) + replacement + signature.slice(i + 1);
    assert.throws(() => auth.verifySession(`${version}.${payload}.${altered}`), hasCode("BAD_SIGNATURE"), `position ${i}`);
  }
  assert.throws(() => auth.verifySession(`${version}.${payload}.${signature}A`), hasCode("BAD_SIGNATURE"));
  assert.throws(() => auth.verifySession(`${version}.${payload}.`), hasCode("BAD_SIGNATURE"));
});

test("a token signed with another secret is rejected", () => {
  assert.throws(() => auth.verifySession(forge(claims(), "y".repeat(48))), hasCode("BAD_SIGNATURE"));
});

test("an expired token is rejected even though its signature is valid", () => {
  const expired = forge(claims({ exp: Math.floor(Date.now() / 1000) - 1 }));
  assert.throws(() => auth.verifySession(expired), hasCode("EXPIRED"));
  const expiringNow = forge(claims({ exp: Math.floor(Date.now() / 1000) }));
  assert.throws(() => auth.verifySession(expiringNow), hasCode("EXPIRED"));
});

test("a token cannot be issued without a future expiry, a tenant or a known scope", () => {
  const invalid = hasCode("INVALID_CLAIMS");
  assert.throws(() => auth.signSession(claims({ exp: undefined })), invalid);
  assert.throws(() => auth.signSession(claims({ exp: Math.floor(Date.now() / 1000) - 10 })), invalid);
  assert.throws(() => auth.signSession(claims({ exp: Date.now() / 1000 + 0.5 })), invalid);
  assert.throws(() => auth.signSession(claims({ businessId: "" })), invalid);
  assert.throws(() => auth.signSession(claims({ sessionId: undefined })), invalid);
  assert.throws(() => auth.signSession(claims({ scope: "admin" })), invalid);
});

test("malformed tokens and validly signed tokens with bad claims are rejected", () => {
  const malformed = hasCode("MALFORMED");
  for (const junk of [undefined, null, "", "not-a-token", "v1.only-two", "v2.a.b", "a.b.c.d"]) {
    assert.throws(() => auth.verifySession(junk), malformed, String(junk));
  }
  assert.throws(() => auth.verifySession(forge({ businessId: "biz_a", sessionId: "ses_1", scope: "browser" })), malformed, "no exp");
  assert.throws(() => auth.verifySession(forge(claims({ businessId: 42 }))), malformed);
  assert.throws(() => auth.verifySession(forge(claims({ scope: "root" }))), malformed);
  assert.throws(() => auth.verifySession(forge("just a string")), malformed);
});

test("a token is only valid for the scope it was signed for", () => {
  const mcpToken = auth.signSession(claims({ scope: "mcp" }));
  assert.throws(() => auth.verifySession(mcpToken, { scope: "browser" }), hasCode("WRONG_SCOPE"));
  assert.equal(auth.verifySession(mcpToken, { scope: "mcp" }).scope, "mcp");
});

/* ------------------------------------------------- middleware over HTTP --- */

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.post("/login", (req, res) => {
    auth.setSessionCookie(req, res, auth.signSession(claims()));
    res.json({ ok: true });
  });
  app.post("/logout", (req, res) => {
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });
  app.all("/api/whoami", auth.requireSession, (req, res) => res.json(req.auth));
  app.all("/mcp", auth.requireBearer, (req, res) => res.json(req.auth));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const cookieOf = (token) => ({ cookie: `other=1; ${auth.COOKIE_NAME}=${token}; theme=dark` });

test("the session cookie is HttpOnly, SameSite=Strict and expires with the token", async () => {
  const response = await fetch(`${base}/login`, { method: "POST" });
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, new RegExp(`^${auth.COOKIE_NAME}=v1\\.`));
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\//);
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)[1]);
  assert.ok(maxAge > 3590 && maxAge <= 3600);
  assert.doesNotMatch(cookie, /Secure/, "plain http on localhost");

  const viaProxy = await fetch(`${base}/login`, { method: "POST", headers: { "x-forwarded-proto": "https" } });
  assert.match(viaProxy.headers.get("set-cookie"), /; Secure/);

  const loggedOut = await fetch(`${base}/logout`, { method: "POST" });
  assert.match(loggedOut.headers.get("set-cookie"), /Max-Age=0/);
});

test("requireSession resolves the tenant from the cookie and from nowhere else", async () => {
  const token = auth.signSession(claims({ businessId: "biz_real" }));
  const response = await fetch(`${base}/api/whoami?businessId=biz_victim`, {
    method: "POST",
    headers: { ...cookieOf(token), "content-type": "application/json" },
    body: JSON.stringify({ businessId: "biz_victim", business_id: "biz_victim" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).businessId, "biz_real");
});

test("requireSession answers 401 without a valid browser cookie", async () => {
  const status = async (headers) => {
    const response = await fetch(`${base}/api/whoami`, { headers });
    return [response.status, (await response.json()).code];
  };
  assert.deepEqual(await status({}), [401, "MALFORMED"]);
  assert.deepEqual(await status(cookieOf("garbage")), [401, "MALFORMED"]);
  assert.deepEqual(await status(cookieOf(forge(claims({ exp: 1 })))), [401, "EXPIRED"]);
  assert.deepEqual(await status(cookieOf(forge(claims(), "y".repeat(48)))), [401, "BAD_SIGNATURE"]);
  assert.deepEqual(await status(cookieOf(auth.signSession(claims({ scope: "mcp" })))), [401, "WRONG_SCOPE"]);
  // A browser token in the Authorization header is not a cookie.
  assert.deepEqual(await status({ authorization: `Bearer ${auth.signSession(claims())}` }), [401, "MALFORMED"]);
});

test("requireBearer accepts only a bearer token signed for the mcp scope", async () => {
  const call = async (headers) => {
    const response = await fetch(`${base}/mcp`, { method: "POST", headers });
    return [response.status, await response.json()];
  };
  const mcpToken = auth.signSession(claims({ businessId: "biz_agent", sessionId: "ses_voice", scope: "mcp" }));

  const [okStatus, okBody] = await call({ authorization: `Bearer ${mcpToken}` });
  assert.equal(okStatus, 200);
  assert.equal(okBody.businessId, "biz_agent");
  assert.equal(okBody.sessionId, "ses_voice");

  assert.equal((await call({}))[0], 401);
  assert.equal((await call({ authorization: mcpToken }))[0], 401, "no Bearer prefix");
  assert.equal((await call({ authorization: `Basic ${mcpToken}` }))[0], 401);
  assert.equal((await call(cookieOf(mcpToken)))[0], 401, "a cookie is not a bearer token");
  assert.deepEqual((await call({ authorization: `Bearer ${auth.signSession(claims())}` }))[1].code, "WRONG_SCOPE");
  assert.deepEqual((await call({ authorization: `Bearer ${forge(claims({ scope: "mcp", exp: 1 }))}` }))[1].code, "EXPIRED");
});

test("a session may carry the signed-in account; it round-trips and is absent when not given", () => {
  const withAccount = claims({ accountId: "acc_1" });
  assert.deepEqual(auth.verifySession(auth.signSession(withAccount)), withAccount);
  assert.equal("accountId" in auth.verifySession(auth.signSession(claims())), false, "a device session has no account");
});

test("an accountId that is not a non-empty string is refused when signing and when verifying", () => {
  for (const accountId of ["", 42, null, ["acc_1"]]) {
    assert.throws(() => auth.signSession(claims({ accountId })), hasCode("INVALID_CLAIMS"), String(accountId));
    assert.throws(() => auth.verifySession(forge(claims({ accountId }))), hasCode("MALFORMED"), String(accountId));
  }
});
