"use strict";

/**
 * Live call 2026-11-20 18:54-18:58 IST (biz_78a4…, audit rows 1550-1603) and the stuck approval
 * apr_7f87… (requested 02:07Z, Yes tapped 18:58 -> APPROVAL_STALE):
 * (a) two parallel save_requirement calls saved "rice" AND "tomatoes" and searched both;
 * (b) the search ended and nobody offered the owner a choice of seller;
 * (c) a stale approval stayed in Needs-you and the button said only "the deal changed";
 * (d)/(e) the Buy screen needs one board read and a way to pick a seller.
 */

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
  SAHAY_ACCESS_CODE: "",
  NEGOTIATION_MODE: "loop",
});

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const events = require("../src/events");
const limits = require("../src/limits");
const agent = require("../src/agora/agent");
const narrator = require("../src/agora/narrator");
const registry = require("../src/tools/registry");
const approvals = require("../src/approvals");
const jobs = require("../src/jobs");
const session = require("../src/negotiation/session");
const toolCalls = require("../src/tools/calls");
const { bytes, SPEAK_MAX_BYTES } = require("../src/agora/speech-fit");
const { scriptProblems } = require("../src/agora/script");

beforeEach(() => {
  limits.reset();
  toolCalls.reset();
});

const recordedPage = fs.readFileSync(path.join(__dirname, "fixtures", "indiamart-bengaluru-basmati-rice.html"), "utf8");
const realFetch = globalThis.fetch;

/** IndiaMART answered from the recorded Bengaluru basmati page; every other listing page is a 404. */
function stubIndiaMart(t) {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://dir.indiamart.com/")) return realFetch(url, init);
    requested.push(u);
    if (u.startsWith("https://dir.indiamart.com/bengaluru/basmati-rice.html")) {
      const res = new Response(recordedPage, { status: 200 });
      Object.defineProperty(res, "url", { value: u });
      return res;
    }
    return new Response("not found", { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return requested;
}

/** Agora at its REST boundary: /history holds `owner` turns; /join, /speak, /leave answer 200. */
function fakeAgora(t, owner = []) {
  const items = owner.map((content, i) => ({ role: "user", content, metadata: { source: "asr" }, turn_id: i + 1 }));
  const calls = [];
  agent.setFetch(async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    let json = {};
    if (/\/history$/.test(url)) json = { contents: items.slice() };
    else if (/\/join$/.test(url)) json = { agent_id: `AGJ${calls.length}`, create_ts: 1, status: "RUNNING" };
    else json = { agent_id: "AG" };
    return new Response(JSON.stringify(json), { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return calls;
}

function seedBusiness(language = "en-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

function callCtx(businessId, agentId = "AGCALL") {
  const s = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: s.id, agentId, actor: "agent", toolScope: "owner" };
}

const sourcingJobs = (businessId) => repo.listJobs(businessId).filter((j) => j.kind === "sourcing");

async function settleJobs(businessId) {
  for (const job of repo.listJobs(businessId)) await jobs.whenSettled?.(job.id);
}

/* ------------------------------------------------------- (a) one need --- */

test("(a) two save_requirement calls at once for two different items save one need and start one search; the other is refused, one item at a time", async (t) => {
  stubIndiaMart(t);
  fakeAgora(t, ["I need 200 kg basmati rice and 20 kg tomatoes in Bengaluru"]);
  const businessId = seedBusiness();
  const ctx = callCtx(businessId);
  const [rice, tomatoes] = await Promise.all([
    registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru", reply_language: "en-IN" }),
    registry.callTool(ctx, "save_requirement", { item: "tomatoes", quantity: 20, unit: "kg", city: "Bengaluru", reply_language: "en-IN" }),
  ]);
  assert.equal(rice.saved, true);
  assert.equal(rice.sourcingStarted, true);
  assert.equal(tomatoes.saved, false);
  assert.equal(tomatoes.oneAtATime, true);
  assert.equal(tomatoes.requirementId, rice.requirementId);
  assert.match(tomatoes.say, /one item at a time/);
  assert.match(tomatoes.hint, /Never save an item the owner did not name/);
  assert.equal(repo.listRequirements(businessId).length, 1);
  assert.equal(sourcingJobs(businessId).length, 1);
  await settleJobs(businessId);
});

test("(a) the same need saved twice at once, or said again shorter ('rice' after 'basmati rice'), is one need with one search", async (t) => {
  stubIndiaMart(t);
  fakeAgora(t, ["mujhe 200 kilo basmati rice chahiye Bengaluru mein, haan rice 200 kilo"]);
  const businessId = seedBusiness();
  const ctx = callCtx(businessId);
  const args = { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru", reply_language: "en-IN" };
  const [one, two] = await Promise.all([registry.callTool(ctx, "save_requirement", args), registry.callTool(ctx, "save_requirement", args)]);
  assert.equal(one.requirementId, two.requirementId);
  const shorter = await registry.callTool(ctx, "save_requirement", { ...args, item: "rice" });
  assert.equal(shorter.saved, true);
  assert.equal(shorter.requirementId, one.requirementId);
  const needs = repo.listRequirements(businessId);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].item, "basmati rice", "the fuller name is kept");
  assert.equal(sourcingJobs(businessId).length, 1);
  await settleJobs(businessId);
});

test("(a) the window is short and per call: after it, or off a call, a different item is a new need", async (t) => {
  stubIndiaMart(t);
  fakeAgora(t, ["200 kg basmati rice in Bengaluru, and 20 kg tomatoes"]);
  const businessId = seedBusiness();
  const ctx = callCtx(businessId);
  await registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru" });
  db.prepare("UPDATE requirements SET created_at = ? WHERE business_id = ?").run(new Date(Date.now() - registry.OVERLAP_WINDOW_MS - 1000).toISOString(), businessId);
  const later = await registry.callTool(ctx, "save_requirement", { item: "tomatoes", quantity: 20, unit: "kg", city: "Bengaluru" });
  assert.equal(later.saved, true);
  assert.equal(repo.listRequirements(businessId).length, 2);
  await settleJobs(businessId);
});

test("(a) the prompt says to save only items the owner named, one per call, never two calls in one turn", () => {
  const prompt = agent.systemPrompt({ name: "Asha Kirana", language: "en-IN" });
  assert.match(prompt, /Save only an item the owner named in their own words in this call/);
  assert.match(prompt, /never guess a second item/);
  assert.match(prompt, /never two save_requirement calls in one turn/);
});

/* ------------------------------------------- (b) the owner picks a seller --- */

const SHORTLIST = [
  { rank: 1, name: "Babu Trading Co.", comparablePrice: 100, ownSupplier: false, simulated: false },
  { rank: 2, name: "3comma Labs Private Limited", comparablePrice: null },
  { rank: 3, name: "Srinidhi Foods", comparablePrice: 120 },
  { rank: 4, name: "Mahammed Ismail Sait", comparablePrice: 99.5 },
  { rank: 5, name: "BS Foods", comparablePrice: 60 },
];

test("(b) the search result names three sellers Sahay can bargain with, by their shortlist number, and asks which one", () => {
  const en = narrator.sourcingDoneLine({ count: 10, unit: "kg", shortlist: SHORTLIST }, "en-IN");
  assert.equal(en, "Search done: 10 vendors. 1. Babu Trading Co., 100 rupees per kilogram; 3. Srinidhi Foods, 120 rupees per kilogram; 4. Mahammed Ismail Sait, 99.5 rupees per kilogram. Which one shall I bargain with, or shall I take the best one?");
  const own = narrator.sourcingDoneLine({ count: 2, unit: "kg", shortlist: [{ rank: 1, name: "Ramesh Traders", comparablePrice: null, ownSupplier: true }, { ...SHORTLIST[0], rank: 2 }] }, "en-IN");
  assert.match(own, /1\. Ramesh Traders \(your own supplier\); 2\. Babu Trading Co\./);
  const single = narrator.sourcingDoneLine({ count: 1, unit: "kg", shortlist: [SHORTLIST[0]] }, "en-IN");
  assert.match(single, /Shall I bargain with them\?$/);
  for (const language of ["hi-IN", "kn-IN"]) {
    const line = narrator.sourcingDoneLine({ count: 10, unit: "kg", shortlist: SHORTLIST }, language);
    const names = SHORTLIST.map((s) => s.name);
    assert.deepEqual(scriptProblems(line, language, { allow: names }), { latin: [], foreign: false }, line);
  }
  // Long names are shortened word by word: the line is always one /speak piece.
  const long = SHORTLIST.map((s) => ({ ...s, name: `${s.name} Wholesale Rice Pulses Grains Commission Agents And General Merchants Pvt Ltd` }));
  for (const language of ["hi-IN", "kn-IN", "en-IN"]) assert.ok(bytes(narrator.sourcingDoneLine({ count: 50, unit: "kg", shortlist: long }, language)) <= SPEAK_MAX_BYTES);
});

test("(b) a live call hears the choice when the search ends, and the model is told to start the one the owner picks", async (t) => {
  const businessId = seedBusiness();
  const spoken = [];
  const statuses = [];
  narrator.configure({ speak: async (_a, text) => spoken.push(text), status: async (_a, text) => statuses.push(text), holdMs: 0, minGapMs: 0, quietMs: 0 });
  t.after(() => narrator.detach(businessId));
  narrator.attach(businessId, { agentId: "AGN", sessionId: null, language: "en-IN" });
  narrator.onEvent({ businessId, type: "job.done", data: { jobId: "job_x", kind: "sourcing", result: { requirementId: "req_x", unit: "kg", count: 10, shortlist: SHORTLIST } } });
  for (let i = 0; i < 40 && !spoken.length; i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(spoken.some((l) => /Which one shall I bargain with/.test(l)), spoken.join(" | "));
  for (let i = 0; i < 40 && !statuses.length; i++) await new Promise((r) => setTimeout(r, 25));
  assert.match(statuses.join(" "), /call start_negotiation with vendorRank set to the number they chose/);
  assert.match(statuses.join(" "), /Never start a negotiation before the owner has answered/);
});

/* ----------------------------------------------- (c) stale approvals --- */

function seedDeal(businessId, { item = "basmati rice", unitPrice = 101 } = {}) {
  const need = repo.createRequirement(businessId, { item, quantity: 200, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Srinidhi Foods" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: unitPrice, unit: "kg", freight: 0, landed_cost: unitPrice * 200, simulated: true,
  });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  return { need, vendor, quote, approval };
}

test("(c) a waiting approval expires when its deal changed, when nobody asked for 6 hours, or when a newer need for the same item replaced it", () => {
  const changed = seedBusiness();
  const a = seedDeal(changed);
  assert.equal(approvals.staleReason(changed, repo.getApproval(changed, a.approval.id)), null, "a fresh deal stands");
  repo.updateRequirement(changed, a.need.id, { quantity: 150 }); // the deal the approval read out is not this one any more
  assert.equal(approvals.staleReason(changed, repo.getApproval(changed, a.approval.id)), "deal_changed");

  const old = seedBusiness();
  const b = seedDeal(old);
  assert.equal(approvals.staleReason(old, repo.getApproval(old, b.approval.id), Date.now() + approvals.APPROVAL_MAX_AGE_MS + 1000), "too_old");

  const replaced = seedBusiness();
  const c = seedDeal(replaced);
  repo.createRequirement(replaced, { item: "Basmati Rice", quantity: 100, unit: "kg" });
  assert.equal(approvals.staleReason(replaced, repo.getApproval(replaced, c.approval.id)), "superseded");
  const other = seedBusiness();
  const d = seedDeal(other);
  repo.createRequirement(other, { item: "tomatoes", quantity: 20, unit: "kg" });
  assert.equal(approvals.staleReason(other, repo.getApproval(other, d.approval.id)), null, "a need for another item does not replace it");

  const seen = [];
  const stop = events.subscribeAll((e) => e.type === "approval.decided" && seen.push(e.data));
  const count = approvals.expireStaleAll();
  stop();
  assert.ok(count >= 2);
  for (const [biz, id, reason] of [[changed, a.approval.id, "deal_changed"], [replaced, c.approval.id, "superseded"]]) {
    const row = repo.getApproval(biz, id);
    assert.equal(row.status, "rejected");
    assert.equal(row.decided_via, null, "withdrawn by the server, not the owner's no");
    assert.ok(seen.some((e) => e.approvalId === id && e.expired === reason && e.status === "rejected"));
  }
  assert.equal(repo.getApproval(other, d.approval.id).status, "pending");
  assert.equal(repo.listOrders(changed).length, 0, "expiry never orders");
});

test("(c) a yes to a stale approval is refused as APPROVAL_EXPIRED with a clear line, the approval leaves Needs-you, and asking again makes a fresh one", () => {
  const businessId = seedBusiness("hi-IN");
  const { need, quote, approval } = seedDeal(businessId);
  repo.updateRequirement(businessId, need.id, { quantity: 150 });
  assert.throws(() => approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" }), (err) => err.code === "APPROVAL_EXPIRED" && err.details.reason === "deal_changed");
  assert.equal(repo.getApproval(businessId, approval.id).status, "rejected");
  assert.equal(repo.listApprovals(businessId, { status: "pending" }).length, 0);
  // A second tap from a screen still showing it gets the same clear answer, never "already rejected".
  assert.throws(() => approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" }), (err) => err.code === "APPROVAL_EXPIRED");
  const { toToolError } = require("../src/tools/errors");
  assert.equal(toToolError(Object.assign(new Error("x"), { code: "APPROVAL_EXPIRED" }), "hi-IN").say, "यह सौदा पुराना हो गया है; मुझसे फिर से मोलभाव करने को कहिए।");
  assert.equal(toToolError(Object.assign(new Error("x"), { code: "APPROVAL_EXPIRED" }), "en-IN").status, 409);
  repo.updateRequirement(businessId, need.id, { quantity: 200 });
  const again = approvals.requestApproval(businessId, quote.id);
  assert.equal(again.created, true);
  assert.notEqual(again.approval.id, approval.id);

  // A stale one waiting for the same quote is replaced, never read out again.
  const old = seedBusiness();
  const s = seedDeal(old);
  db.prepare("UPDATE approvals SET requested_at = ? WHERE id = ?").run(new Date(Date.now() - approvals.APPROVAL_MAX_AGE_MS - 60000).toISOString(), s.approval.id);
  const fresh = approvals.requestApproval(old, s.quote.id);
  assert.equal(fresh.created, true);
  assert.equal(repo.getApproval(old, s.approval.id).status, "rejected");
});

/* --------------------------------------- (d)/(e) discovery board routes --- */

const { createApp } = require("../server");

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

async function call(base, method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null };
}

async function signUp(base, details) {
  const out = await call(base, "POST", "/api/session", { body: details });
  assert.equal(out.status, 200);
  return { cookie: out.res.headers.get("set-cookie").split(";")[0], business: out.json.business };
}

test("(d) GET /api/discovery: the latest need, its search, sellers best first with source, live offers, deals and the waiting approval; tenant from the cookie only", async () => {
  await withApp(async (base) => {
    const a = await signUp(base, { name: "Board A", city: "Bengaluru", language: "en-IN" });
    const b = await signUp(base, { name: "Board B", city: "Bengaluru", language: "en-IN" });
    const empty = await call(base, "GET", "/api/discovery", { cookie: a.cookie });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json, { requirement: null, search: null, sellers: [], negotiations: [], deals: [], bestQuote: null, pendingApproval: null });

    const need = repo.createRequirement(a.business.id, { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru" });
    const job = jobs.startJob(a.business.id, "sourcing", { requirementId: need.id }, async () => ({ requirementId: need.id, unit: "kg", count: 2, category: "Basmati Rice", scope: "city", sourceUrl: "https://dir.indiamart.com/bengaluru/basmati-rice.html" }), { requirementId: need.id });
    await jobs.whenSettled(job.jobId ?? job);
    const cheap = repo.createVendor(a.business.id, { requirement_id: need.id, source: "indiamart", name: "Babu Trading Co.", city: "Bengaluru", listed_price_text: "₹ 100/Kg", listed_price: 100, listed_unit: "Kg", rating: 4.2, rating_count: 31, score: 80, source_url: "https://www.indiamart.com/proddetail/x.html" });
    repo.createVendor(a.business.id, { requirement_id: need.id, source: "indiamart", name: "Bag Seller", listed_price_text: "₹ 25,000/Bag", listed_price: 25000, listed_unit: "Bag", score: 70 });
    const neg = repo.createNegotiation(a.business.id, { requirement_id: need.id, vendor_id: cheap.id, counterpart: "simulated" });
    repo.appendNegotiationTurn(a.business.id, neg.id, { speaker: "vendor", name: "Babu Trading Co. (simulated vendor)", text: "108 rupees per kilogram.", round: 1, ts: new Date().toISOString(), offer: 108, unit: "kg" });
    repo.appendNegotiationTurn(a.business.id, neg.id, { speaker: "agent", name: "Sahay", text: "Could you do 92?", round: 1, ts: new Date().toISOString(), offer: 92, unit: "kg" });
    const quote = repo.createQuote(a.business.id, { requirement_id: need.id, vendor_id: cheap.id, negotiation_id: neg.id, unit_price: 95, unit: "kg", freight: 0, landed_cost: 19000, simulated: true });
    const { approval } = approvals.requestApproval(a.business.id, quote.id);

    const board = (await call(base, "GET", "/api/discovery", { cookie: a.cookie })).json;
    assert.equal(board.requirement.id, need.id);
    assert.equal(board.search.status, "done");
    assert.equal(board.search.category, "Basmati Rice");
    assert.equal(board.sellers.length, 2);
    const [first] = board.sellers;
    assert.deepEqual(
      [first.rank, first.vendorId, first.name, first.city, first.source, first.sourceLabel, first.simulated, first.listedPriceText, first.listedUnit, first.comparablePrice, first.priceUnit, first.rating, first.ratingCount, first.score, first.sourceUrl, first.avoided],
      [1, cheap.id, "Babu Trading Co.", "Bengaluru", "indiamart", "IndiaMART", false, "₹ 100/Kg", "Kg", 100, "kg", 4.2, 31, 80, "https://www.indiamart.com/proddetail/x.html", false],
    );
    assert.equal(board.sellers[1].comparablePrice, null, "a per-bag price is never shown as per kg");
    const [n] = board.negotiations;
    assert.equal(n.vendorName, "Babu Trading Co.");
    assert.equal(n.simulated, true);
    assert.deepEqual(n.offers.map((o) => [o.speaker, o.price]), [["vendor", 108], ["sahay", 92]]);
    assert.equal(n.lastVendorOffer, 108);
    assert.equal(n.lastSahayOffer, 92);
    assert.equal(board.bestQuote.quoteId, quote.id);
    assert.equal(board.bestQuote.simulated, true);
    assert.equal(board.pendingApproval.approvalId, approval.id);

    // Another business's need is not found; the other business sees its own empty board.
    assert.equal((await call(base, "GET", `/api/discovery?requirementId=${need.id}`, { cookie: b.cookie })).status, 404);
    assert.equal((await call(base, "GET", "/api/discovery", { cookie: b.cookie })).json.requirement, null);
    assert.equal((await call(base, "GET", "/api/discovery")).status, 401);
  });
});

test("(e) POST /api/negotiations {vendorId}: starts the same start_negotiation path for the session's business only, with its guards; it never approves or orders", async (t) => {
  fakeAgora(t);
  agent.configureSpeechPacing({ msPerChar: 1, minLineMs: 5, maxWaitMs: 50 });
  session.configureTiming({ msPerChar: 1, minLineMs: 5, pollMs: 20 });
  t.after(() => session.stopAll());
  await withApp(async (base) => {
    const a = await signUp(base, { name: "Pick A", city: "Bengaluru", language: "en-IN" });
    const b = await signUp(base, { name: "Pick B", city: "Bengaluru", language: "en-IN" });
    const need = repo.createRequirement(a.business.id, { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru" });
    const priced = repo.createVendor(a.business.id, { requirement_id: need.id, source: "indiamart", name: "Babu Trading Co.", listed_price: 100, listed_unit: "Kg", score: 80 });
    const bags = repo.createVendor(a.business.id, { requirement_id: need.id, source: "indiamart", name: "Bag Seller", listed_price: 25000, listed_unit: "Bag", score: 70 });

    assert.equal((await call(base, "POST", "/api/negotiations", { cookie: a.cookie, body: {} })).status, 400);
    assert.equal((await call(base, "POST", "/api/negotiations", { cookie: a.cookie, body: { vendorId: priced.id, counterpart: "robot" } })).status, 400);
    const cross = await call(base, "POST", "/api/negotiations", { cookie: b.cookie, body: { vendorId: priced.id } });
    assert.equal(cross.status, 404, "another business's seller is not found");
    const noPrice = await call(base, "POST", "/api/negotiations", { cookie: a.cookie, body: { vendorId: bags.id } });
    assert.equal(noPrice.status, 409);
    assert.equal(noPrice.json.code, "NO_LISTED_PRICE");
    assert.ok(noPrice.json.say);

    const ok = await call(base, "POST", "/api/negotiations", { cookie: a.cookie, body: { vendorId: priced.id } });
    assert.equal(ok.status, 202, JSON.stringify(ok.json));
    assert.match(ok.json.jobId, /^job_/);
    assert.match(ok.json.negotiationId, /^neg_/);
    assert.equal(ok.json.vendorId, priced.id);
    assert.equal(ok.json.vendorRank, 1);
    assert.equal(ok.json.counterpart, "simulated");
    assert.equal(ok.json.simulated, true);
    assert.equal(ok.json.spoken, false, "no live call: nothing spoken");
    assert.match(ok.json.say, /simulated vendor/);
    await jobs.whenSettled(ok.json.jobId);
    assert.equal(repo.listApprovals(a.business.id).length, 0, "starting a negotiation never asks for or gives approval");
    assert.equal(repo.listOrders(a.business.id).length, 0);
    assert.equal(repo.getNegotiation(a.business.id, ok.json.negotiationId).counterpart, "simulated");
  });
});
