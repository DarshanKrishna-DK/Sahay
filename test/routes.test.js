"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  SESSION_SIGNING_SECRET: "test-secret-".padEnd(48, "x"),
  PUBLIC_URL: "https://sahay.test",
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210", // fake test value
  AGORA_CUSTOMER_ID: "test-customer",
  AGORA_CUSTOMER_SECRET: "test-customer-secret",
  MURF_API_KEY: "test-murf-key",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  SARVAM_API_KEY: "test-sarvam-key",
  TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createApp } = require("../server");
const agent = require("../src/agora/agent");
const narrator = require("../src/agora/narrator");
const repo = require("../src/db/repo");
const events = require("../src/events");

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

function fakeAgora(t, handler = () => ({ json: { agent_id: "AGR", create_ts: 1, status: "RUNNING" } })) {
  const calls = [];
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const out = handler(url, body) ?? { json: {} };
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  });
  t.after(() => agent.setFetch(null));
  return calls;
}

async function call(base, method, path, { cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null };
}

async function signUp(base, details = { name: "Asha Kirana", city: "Bengaluru", language: "hi-IN" }) {
  const out = await call(base, "POST", "/api/session", { body: details });
  assert.equal(out.status, 200);
  const cookie = out.res.headers.get("set-cookie").split(";")[0];
  return { cookie, business: out.json.business };
}

test("health, security headers and the static console", async () => {
  await withApp(async (base) => {
    const health = await call(base, "GET", "/healthz");
    assert.deepEqual(health.json, { ok: true });
    assert.equal(health.res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.res.headers.get("x-frame-options"), "DENY");
    assert.equal(health.res.headers.get("x-powered-by"), null);
    assert.equal(health.res.headers.get("access-control-allow-origin"), null, "no CORS");
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /html/);
  });
});

test("POST /api/session needs business details, never takes a business id, and sets an HttpOnly cookie", async () => {
  await withApp(async (base) => {
    const empty = await call(base, "POST", "/api/session", { body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.code, "BUSINESS_DETAILS_REQUIRED");

    const other = repo.newId("biz");
    repo.createBusiness(other, { name: "Someone Else", language: "en-IN" });
    const sneaky = await call(base, "POST", "/api/session", { body: { businessId: other } });
    assert.equal(sneaky.status, 400, "a business id in the body does not log in");

    const out = await call(base, "POST", "/api/session", { body: { name: "Asha Kirana", city: "Bengaluru", language: "kn-IN" } });
    assert.equal(out.status, 200);
    assert.equal(out.json.business.language, "kn-IN");
    const setCookie = out.res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const cookie = setCookie.split(";")[0];
    const again = await call(base, "POST", "/api/session", { cookie, body: {} });
    assert.equal(again.json.business.id, out.json.business.id, "a valid cookie loads the same business");
  });
});

test("every /api route except /api/session needs the cookie", async () => {
  await withApp(async (base) => {
    for (const [method, path] of [["GET", "/api/state"], ["POST", "/api/voice/token"], ["POST", "/api/voice/start"], ["POST", "/api/voice/stop"], ["POST", "/api/approvals/apr_x/decision"], ["GET", "/api/orders/ord_x/po.pdf"], ["GET", "/api/events"], ["POST", "/api/telegram/link-code"]]) {
      const out = await call(base, method, path, method === "POST" ? { body: {} } : {});
      assert.equal(out.status, 401, `${method} ${path}`);
    }
  });
});

test("voice: token, renewal on the same channel, start = join then disclosure INTERRUPT not interruptable, stop = leave", async (t) => {
  const calls = fakeAgora(t);
  await withApp(async (base) => {
    const { cookie, business } = await signUp(base);
    const seen = [];
    const stop = events.subscribe(business.id, (e) => seen.push(e.type));

    const token = await call(base, "POST", "/api/voice/token", { cookie });
    assert.equal(token.status, 200);
    assert.equal(token.json.appId, process.env.AGORA_APP_ID);
    assert.equal(token.json.uid, 1002);
    assert.equal(token.json.agentUid, 1001);
    assert.match(token.json.token, /^007/);
    assert.ok(Date.parse(token.json.expiresAt) > Date.now());
    const renewed = await call(base, "POST", "/api/voice/token", { cookie });
    assert.equal(renewed.json.channel, token.json.channel, "renewal keeps the channel");

    const wrong = await call(base, "POST", "/api/voice/start", { cookie, body: { channel: "someone-elses" } });
    assert.equal(wrong.status, 409);

    const started = await call(base, "POST", "/api/voice/start", { cookie, body: { channel: token.json.channel } });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal(started.json.agentId, "AGR");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/join$/);
    assert.equal(calls[0].body.properties.channel, token.json.channel);
    assert.deepEqual(calls[0].body.properties.remote_rtc_uids, ["1002"]);
    assert.match(calls[1].url, /\/agents\/AGR\/speak$/);
    assert.equal(calls[1].body.priority, "INTERRUPT");
    assert.equal(calls[1].body.interruptable, false);
    assert.match(calls[1].body.text, /^नमस्ते, मैं सहाय हूँ, Asha Kirana का स्वचालित सहायक।/);
    assert.ok(narrator.isLive(business.id));

    const twice = await call(base, "POST", "/api/voice/start", { cookie, body: {} });
    assert.equal(twice.status, 409);

    const state = await call(base, "GET", "/api/state", { cookie });
    assert.equal(state.json.voice.agentId, "AGR");
    const session = repo.listSessions(business.id, { kind: "owner" })[0];
    assert.equal(session.agent_id, "AGR");
    assert.equal(session.status, "active");

    const stopped = await call(base, "POST", "/api/voice/stop", { cookie, body: {} });
    assert.deepEqual(stopped.json, { stopped: true });
    assert.match(calls[2].url, /\/agents\/AGR\/leave$/);
    assert.ok(!narrator.isLive(business.id));
    assert.equal(repo.getSession(business.id, session.id).status, "ended");
    stop();
    assert.ok(seen.includes("session.started") && seen.includes("session.ended"));
  });
});

test("voice start that cannot speak the disclosure stops the agent and fails", async (t) => {
  const calls = fakeAgora(t, (url) => (url.endsWith("/speak") ? { status: 503, json: { reason: "busy" } } : { json: { agent_id: "AGX" } }));
  await withApp(async (base) => {
    const { cookie } = await signUp(base);
    await call(base, "POST", "/api/voice/token", { cookie });
    const started = await call(base, "POST", "/api/voice/start", { cookie, body: {} });
    assert.equal(started.status, 502);
    assert.ok(calls.some((c) => c.url.endsWith("/agents/AGX/leave")), "agent stopped");
  });
});

test("state is scoped to the cookie's business; a button decision on another business's approval is not found", async () => {
  await withApp(async (base) => {
    const a = await signUp(base, { name: "Shop A", language: "en-IN" });
    const b = await signUp(base, { name: "Shop B", language: "en-IN" });
    const need = repo.createRequirement(a.business.id, { item: "rice", quantity: 10, unit: "kg" });
    const vendor = repo.createVendor(a.business.id, { requirement_id: need.id, source: "indiamart", name: "V" });
    const neg = repo.createNegotiation(a.business.id, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "human" });
    const quote = repo.createQuote(a.business.id, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 50, unit: "kg", freight: 0, landed_cost: 500 });
    const { requestApproval } = require("../src/approvals");
    const { approval } = requestApproval(a.business.id, quote.id);

    const stateB = await call(base, "GET", "/api/state", { cookie: b.cookie });
    assert.equal(stateB.json.business.id, b.business.id);
    assert.equal(stateB.json.approvals.length, 0);

    const cross = await call(base, "POST", `/api/approvals/${approval.id}/decision`, { cookie: b.cookie, body: { decision: "approve" } });
    assert.equal(cross.status, 404);
    assert.equal(repo.getApproval(a.business.id, approval.id).status, "pending");

    const bad = await call(base, "POST", `/api/approvals/${approval.id}/decision`, { cookie: a.cookie, body: { decision: "maybe" } });
    assert.equal(bad.status, 400);

    const ok = await call(base, "POST", `/api/approvals/${approval.id}/decision`, { cookie: a.cookie, body: { decision: "approve" } });
    assert.deepEqual(ok.json, { approvalId: approval.id, status: "approved" });
    assert.equal(repo.getApproval(a.business.id, approval.id).decided_via, "button");

    const stateA = await call(base, "GET", "/api/state", { cookie: a.cookie });
    assert.equal(stateA.json.requirement.id, need.id);
    assert.equal(stateA.json.deals[0].quoteId, quote.id);
    assert.ok(stateA.json.audit.some((row) => row.type === "approval.decided"));

    const pdf = await call(base, "GET", "/api/orders/ord_nope/po.pdf", { cookie: a.cookie });
    assert.equal(pdf.status, 404);
  });
});

test("GET /api/state lists vendors in the get_shortlist order, with rank 1 = the vendor the agent names best", async () => {
  const registry = require("../src/tools/registry");
  await withApp(async (base) => {
    const { cookie, business } = await signUp(base, { name: "Rank Check", city: "Bengaluru", language: "en-IN" });
    const need = repo.createRequirement(business.id, { item: "basmati rice", quantity: 200, unit: "kg", max_price: 90, city: "Bengaluru" });
    // Found in this order; all score 78, so only the tie-break decides (e2e r2 row 13).
    for (const [name, price, rating, count] of [["Arthace Ariez Global Private Limited", 80, 4, 25], ["Pansari Industries", 68, 3.7, 443], ["JMD Enterprises", 79, 4.4, 34], ["BS Foods", 60, 4, 208]]) {
      repo.createVendor(business.id, { requirement_id: need.id, source: "indiamart", name, listed_price: price, listed_unit: "Kg", rating, rating_count: count, score: 78 });
    }
    const state = await call(base, "GET", "/api/state", { cookie });
    assert.equal(state.status, 200);
    assert.deepEqual(state.json.vendors.map((v) => v.name), ["BS Foods", "Pansari Industries", "JMD Enterprises", "Arthace Ariez Global Private Limited"]);
    assert.deepEqual(state.json.vendors.map((v) => v.rank), [1, 2, 3, 4]);

    const session = repo.createSession(business.id, { kind: "owner", channel: "own-rankcheck", status: "active" });
    const shortlist = await registry.callTool({ businessId: business.id, sessionId: session.id, agentId: null, actor: "agent", toolScope: "owner" }, "get_shortlist", { limit: 4 });
    assert.deepEqual(shortlist.vendors.map((v) => v.vendorId), state.json.vendors.map((v) => v.id), "panel order = spoken order");
    assert.deepEqual(shortlist.vendors.map((v) => v.rank), state.json.vendors.map((v) => v.rank));
  });
});

test("voice token renewal names the channel; a call the server no longer holds answers 409 CALL_ENDED and opens nothing", async () => {
  await withApp(async (base) => {
    const { cookie, business } = await signUp(base);
    const noCall = await call(base, "POST", "/api/voice/token", { cookie, body: { channel: "own-gone" } });
    assert.equal(noCall.status, 409);
    assert.equal(noCall.json.code, "CALL_ENDED");
    assert.equal(noCall.json.message, "The call ended. Start a new call to continue.");
    assert.equal(repo.listSessions(business.id, { kind: "owner" }).length, 0, "renewal never starts a call");

    const first = await call(base, "POST", "/api/voice/token", { cookie, body: {} });
    assert.equal(first.status, 200);
    const renewed = await call(base, "POST", "/api/voice/token", { cookie, body: { channel: first.json.channel } });
    assert.equal(renewed.status, 200);
    assert.equal(renewed.json.channel, first.json.channel);
    assert.equal(renewed.json.uid, first.json.uid);
    assert.match(renewed.json.token, /^007/);

    const stale = await call(base, "POST", "/api/voice/token", { cookie, body: { channel: "own-someone-else" } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "CALL_ENDED");

    await call(base, "POST", "/api/voice/stop", { cookie, body: {} });
    const afterStop = await call(base, "POST", "/api/voice/token", { cookie, body: { channel: first.json.channel } });
    assert.equal(afterStop.status, 409, "the ended call cannot be renewed");
  });
});

test("telegram link code returns the bot deep link", async () => {
  await withApp(async (base) => {
    const { cookie } = await signUp(base);
    const out = await call(base, "POST", "/api/telegram/link-code", { cookie, body: {} });
    assert.equal(out.status, 200);
    assert.match(out.json.code, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(out.json.deepLink, `https://t.me/sahaymitra_bot?start=${out.json.code}`);
  });
});

test("vendor join page is public, but its token needs a live one-time code", async () => {
  await withApp(async (base) => {
    const page = await fetch(`${base}/vendor/whatever`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /automated assistant/);
    const token = await call(base, "GET", "/api/vendor/not-a-code/token");
    assert.equal(token.status, 404);
    const joined = await call(base, "POST", "/api/vendor/not-a-code/joined", { body: {} });
    assert.equal(joined.status, 404);
  });
});

test("bad JSON and unknown API routes answer with {code, message}", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "BAD_JSON");
    const { cookie } = await signUp(base);
    const missing = await call(base, "GET", "/api/nothing-here", { cookie });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, "NOT_FOUND");
  });
});
