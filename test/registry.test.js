"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  GROQ_API_KEY: FAKE.GROQ_API_KEY,
  RAZORPAY_KEY_ID: FAKE.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: FAKE.RAZORPAY_KEY_SECRET,
});

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

/** The server's outcome line is followed, in the same /speak piece, by its hand-back question; the model says nothing. */
const outcomeSpoken = (line, out) => Object.values(require("../src/agora/outcome").HAND_BACK).some((hand) => line === `${out.outcome} ${hand}`);
const registry = require("../src/tools/registry");
const { ToolError } = require("../src/tools/errors");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const events = require("../src/events");
const jobs = require("../src/jobs");
const approvals = require("../src/approvals");
const session = require("../src/negotiation/session");
const { rankVendors } = require("../src/procurement/scoring");
const { scriptProblems } = require("../src/agora/script");

const recordedPage = fs.readFileSync(path.join(__dirname, "fixtures", "indiamart-bengaluru-basmati-rice.html"), "utf8");
const realFetch = globalThis.fetch;

/** Replace the global fetch (IndiaMART, Razorpay) for one test. */
function stubFetch(t, handler) {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push(String(url));
    return handler(String(url), init);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return requested;
}

/**
 * Razorpay's Orders API at the network boundary (POST /v1/orders, GET /v1/orders?receipt=), answering
 * in the shapes of the Razorpay docs. Any other call fails the test: payment links are gone.
 */
function stubRazorpayOrders(t) {
  let made = 0;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  return stubFetch(t, async (url, init) => {
    if (/^https:\/\/api\.razorpay\.com\/v1\/orders\?receipt=ord_/.test(url) && (init.method ?? "GET") === "GET") return json({ entity: "collection", count: 0, items: [] });
    if (url === "https://api.razorpay.com/v1/orders" && init.method === "POST") {
      const body = JSON.parse(init.body);
      made += 1;
      return json({ id: `order_Reg${String(made).padStart(8, "0")}`, entity: "order", amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created" });
    }
    throw new Error(`unexpected network call: ${url}`);
  });
}

function fakeAgora(t, handler) {
  agent.setFetch(async (url, init) => {
    const out = await handler(url, init);
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  });
  t.after(() => agent.setFetch(null));
}

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

function ownerCtx(businessId, { agentId = null } = {}) {
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: session.id, agentId, actor: "agent", toolScope: "owner" };
}

/** A complete deal: 50 kg basmati at 62/kg, freight 150, landed 3250, 3 days. */
function seedQuote(businessId, { counterpart = "human" } = {}) {
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru", max_price: 70 });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders", listed_price: 65, listed_unit: "kg" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id,
    vendor_id: vendor.id,
    negotiation_id: negotiation.id,
    unit_price: 62,
    unit: "kg",
    lead_time_days: 3,
    freight: 150,
    landed_cost: 3250,
    quoted_sentence: "62 rupaye kilo, bhada 150",
  });
  return { need, vendor, quote };
}

async function expectToolError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ToolError, `ToolError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code);
    assert.equal(typeof err.say, "string");
    assert.ok(err.say.length > 0);
    return true;
  });
}

/* ---------------------------------------------------------------- contract --- */

test("every tool has a JSON-schema input, a description and one scope; owner and negotiation sets are disjoint", () => {
  for (const tool of registry.TOOLS) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.description.length > 10, tool.name);
    assert.equal(typeof tool.handler, "function");
    assert.match(tool.name, /^[a-z_]{1,64}$/);
  }
  const owner = registry.toolNames("owner");
  assert.deepEqual(owner, [
    "get_business_profile", "save_requirement", "start_sourcing", "get_job_status", "get_shortlist", "start_negotiation",
    "get_ranked_deals", "request_approval", "confirm_approval", "create_order", "create_payment_link", "get_order_status",
    "teach_rule", "confirm_rule", "forget_rule", "get_my_agent",
    "set_opening_stock", "get_stock", "mark_order_delivered", "set_reorder_level", "confirm_reorder", "add_customer", "set_item", "draft_invoice", "request_invoice_approval", "confirm_invoice",
    "record_payment", "who_owes_me", "send_payment_reminder",
    "add_supplier", "list_suppliers", "get_business_facts",
  ]);
  assert.deepEqual(registry.toolNames("negotiation"), ["get_negotiation_brief", "record_vendor_offer"]);
});

test("callTool refuses unknown tools, tools of another scope, bad arguments and a ctx without a business", async () => {
  const businessId = seedBusiness();
  const ctx = ownerCtx(businessId);
  await expectToolError(registry.callTool(ctx, "drop_tables", {}), "UNKNOWN_TOOL");
  await expectToolError(registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 10 }), "UNKNOWN_TOOL");
  await expectToolError(registry.callTool({ ...ctx, toolScope: "negotiation" }, "create_order", { approvalId: "x" }), "UNKNOWN_TOOL");
  await expectToolError(registry.callTool(ctx, "save_requirement", { quantity: "lots" }), "INVALID_ARGUMENTS");
  await expectToolError(registry.callTool(ctx, "save_requirement", { item: "rice", businessId: "biz_other" }), "INVALID_ARGUMENTS");
  await expectToolError(registry.callTool({ toolScope: "owner" }, "get_business_profile", {}), "UNAUTHORIZED");
});

test("get_business_profile says the profile in the business script", async () => {
  const businessId = seedBusiness("kn-IN");
  const out = await registry.callTool(ownerCtx(businessId), "get_business_profile", {});
  assert.equal(out.business.id, businessId);
  assert.equal(out.say, "ಇದು Asha Kirana ಅವರ ಖಾತೆ, ನಗರ ಬೆಂಗಳೂರು.");
});

/* ------------------------------------------------------------- requirement --- */

test("save_requirement records what is known, lists what is missing, and updates on a second call", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const seen = [];
  const stop = events.subscribe(businessId, (e) => seen.push(e.type));

  const first = await registry.callTool(ctx, "save_requirement", { item: "बासमती चावल" });
  assert.deepEqual(first.missing, ["quantity", "unit", "city"]);
  assert.equal(first.say, "बासमती चावल लिख लिया; बताइए, कितनी मात्रा, किस इकाई में, किस शहर में डिलीवरी?");

  const second = await registry.callTool(ctx, "save_requirement", { requirementId: first.requirementId, quantity: 200, unit: "kg", city: "Bengaluru", max_price_per_unit: 95 });
  assert.equal(second.requirementId, first.requirementId);
  assert.deepEqual(second.missing, []);
  assert.equal(second.requirement.max_price, 95);
  assert.equal(second.requirement.session_id, ctx.sessionId);
  assert.equal(second.say, "ठीक है, 200 किलो बासमती चावल लिख लिया, बेंगलुरु के लिए।");
  stop();
  assert.deepEqual(seen, ["requirement.saved", "requirement.saved"]);
});

test("a requirement of another business is invisible (tenant from ctx only)", async () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const saved = await registry.callTool(ownerCtx(a), "save_requirement", { item: "sugar", quantity: 10, unit: "kg", city: "Mysuru" });
  await expectToolError(registry.callTool(ownerCtx(b), "get_shortlist", { requirementId: saved.requirementId }), "NOT_FOUND");
  await expectToolError(registry.callTool(ownerCtx(b), "start_sourcing", { requirementId: saved.requirementId }), "NOT_FOUND");
  await expectToolError(registry.callTool(ownerCtx(b), "save_requirement", { requirementId: saved.requirementId, quantity: 5 }), "NOT_FOUND");
});

/* ----------------------------------------------------------------- sourcing --- */

test("start_sourcing returns a job id in under a second; the job stores scored real listings and emits vendor.found", async (t) => {
  const requested = stubFetch(t, async (url) => {
    if (url.startsWith("https://dir.indiamart.com/bengaluru/basmati-rice.html")) {
      const res = new Response(recordedPage, { status: 200 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }
    return new Response("not found", { status: 404 });
  });
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const saved = await registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 100, unit: "kg", city: "Bengaluru" });
  const found = [];
  const stop = events.subscribe(businessId, (e) => e.type === "vendor.found" && found.push(e.data));

  const started = Date.now();
  const out = await registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId });
  assert.ok(Date.now() - started < 1000);
  assert.match(out.jobId, /^job_/);
  assert.equal(out.say, "इंडियामार्ट पर बासमती चावल के विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगी।", "E2E r4: no Latin item inside Hindi");

  const again = await registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId });
  assert.equal(again.jobId, out.jobId, "a second start while running returns the same job");

  await jobs.whenSettled(out.jobId);
  stop();
  const job = repo.getJob(businessId, out.jobId);
  assert.equal(job.status, "done", job.error);
  assert.ok(job.result.count > 0);
  assert.equal(found.length, job.result.count);
  assert.ok(requested.length <= 2, `${requested.length} IndiaMART fetches`);
  const vendors = repo.listVendors(businessId, { requirement_id: saved.requirementId });
  for (const v of vendors) {
    assert.equal(v.source, "indiamart");
    assert.equal(v.kind, "listed");
    assert.equal(typeof v.score, "number");
    assert.ok(v.score_breakdown && typeof v.score_breakdown.price === "number");
  }

  const status = await registry.callTool(ctx, "get_job_status", { jobId: out.jobId });
  assert.equal(status.status, "done");
  assert.match(status.say, new RegExp(`^खोज पूरी हुई, ${job.result.count} विक्रेता मिले`));

  const shortlist = await registry.callTool(ctx, "get_shortlist", { requirementId: saved.requirementId, limit: 3 });
  const ranked = rankVendors(vendors, repo.getRequirement(businessId, saved.requirementId));
  assert.equal(shortlist.vendors.length, Math.min(3, vendors.length));
  assert.deepEqual(shortlist.vendors.map((v) => v.vendorId), ranked.slice(0, 3).map((v) => v.id), "best first, ties by comparable price");
  assert.deepEqual(shortlist.vendors.map((v) => v.rank), [1, 2, 3].slice(0, shortlist.vendors.length));
  const firstComparable = ranked.find((v) => v.listed_unit === "kg" && v.listed_price != null);
  assert.ok(firstComparable, "the recorded page has per-kg listings");
  assert.ok(shortlist.say.startsWith(`${vendors.length} विक्रेता मिले, `), shortlist.say);
  assert.ok(shortlist.say.includes(`सबसे अच्छे ${firstComparable.name}`), "the say reads out a vendor with a comparable price");

  // without any id: the latest requirement of this call
  const byDefault = await registry.callTool(ctx, "get_shortlist", { limit: 3 });
  assert.deepEqual(byDefault.vendors, shortlist.vendors);
});

test("sourcing that finds no category fails honestly, with the reason on the job", async (t) => {
  stubFetch(t, async () => new Response("not found", { status: 404 }));
  const { clearSlugCache } = require("../src/discovery/slug");
  clearSlugCache();
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const saved = await registry.callTool(ctx, "save_requirement", { item: "zzqx widget", quantity: 5, unit: "piece", city: "Bengaluru" });
  const out = await registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId });
  await jobs.whenSettled(out.jobId);
  const job = repo.getJob(businessId, out.jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /IndiaMART/);
  assert.equal(repo.listVendors(businessId, { requirement_id: saved.requirementId }).length, 0, "no vendor invented");
  const status = await registry.callTool(ctx, "get_job_status", { jobId: out.jobId });
  assert.equal(status.say, "That job could not be completed.");
});

test("start_sourcing refuses a requirement without quantity or unit", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const saved = await registry.callTool(ctx, "save_requirement", { item: "jaggery" });
  await expectToolError(registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId }), "REQUIREMENT_INCOMPLETE");
});

/* ------------------------------------------------- deals, approval, order --- */

test("get_ranked_deals ranks stored quotes and speaks the best landed cost", async () => {
  const businessId = seedBusiness("hi-IN");
  const { need } = seedQuote(businessId);
  const out = await registry.callTool(ownerCtx(businessId), "get_ranked_deals", { requirementId: need.id });
  assert.equal(out.deals.length, 1);
  assert.equal(out.deals[0].landedCost, 3250);
  assert.equal(out.deals[0].rank, 1);
  assert.equal(out.approvalCanFollow, true);
  assert.equal(out.say, "सबसे अच्छा सौदा Lakshmi Traders: 62 रुपये प्रति किलो, कुल 3250 रुपये। क्या इस डील को मंज़ूरी के लिए पढ़ूँ?");
});

test("get_ranked_deals asks about approval only when request_approval would put up that same deal", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const a = seedQuote(businessId);
  repo.createQuote(businessId, { requirement_id: a.need.id, vendor_id: a.quote.vendor_id, unit_price: 62, unit: "kg", freight: 150, landed_cost: 3250 });
  const tied = await registry.callTool(ctx, "get_ranked_deals", { requirementId: a.need.id });
  assert.equal(tied.approvalCanFollow, false, "a tie is named by request_approval, not offered");
  assert.doesNotMatch(tied.say, /approval\?$/);

  const solo = seedBusiness("en-IN");
  const { quote, need } = seedQuote(solo);
  const asked = await registry.callTool(ownerCtx(solo), "request_approval", { quoteId: quote.id });
  approvals.confirmApproval(solo, asked.approvalId, { decision: "approve", via: "button" });
  await registry.callTool(ownerCtx(solo), "create_order", {});
  const ordered = await registry.callTool(ownerCtx(solo), "get_ranked_deals", { requirementId: need.id });
  assert.equal(ordered.approvalCanFollow, false, "an ordered deal is not offered again");
  assert.doesNotMatch(ordered.say, /approval\?$/);
});

test("create_order is refused without an approved approval (the gate, negative)", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const { quote } = seedQuote(businessId);
  const { approvalId } = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  await expectToolError(registry.callTool(ctx, "create_order", { approvalId }), "NOT_APPROVED");
  await expectToolError(registry.callTool(ctx, "create_order", { approvalId: "apr_doesnotexist" }), "APPROVAL_NOT_FOUND");
  assert.equal(repo.listOrders(businessId).length, 0);
});

/**
 * A fake live call at the Agora REST boundary: /speak lines are kept and show up in /history
 * as server lines (source "command", one item per request, in turn order), and the test says
 * what the owner answers with `call.owner(words)`.
 */
function fakeCall(t, { failSpeak = false } = {}) {
  const call = { spoken: [], speakBodies: [], historyReads: 0, items: [], turn: 0 };
  call.owner = (content) => call.items.push({ role: "user", content, metadata: { source: "asr" }, turn_id: ++call.turn });
  fakeAgora(t, (url, init) => {
    if (/\/speak$/.test(url)) {
      if (failSpeak) return { status: 503, json: { reason: "busy" } };
      const body = JSON.parse(init.body);
      call.speakBodies.push(body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
      return { json: { agent_id: "AG" } };
    }
    if (/\/history$/.test(url)) {
      call.historyReads += 1;
      return { json: { contents: call.items.slice() } };
    }
    throw new Error(`unexpected Agora call ${url}`);
  });
  return call;
}

test("in a call, request_approval speaks the read-back itself (APPEND, not interruptable) and the model only asks", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGV" });
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);

  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  assert.equal(asked.say, "", "the read-back carries its own question; the model says nothing");
  assert.equal(asked.readbackSpoken, true);
  assert.equal(asked.readback, undefined, "the model gets no figures to re-read");
  // The stored read-back keeps the owner's words ("basmati rice"); the spoken one names the item in Devanagari (E2E r4).
  assert.equal(call.spoken.join(" "), repo.getApproval(businessId, asked.approvalId).readback.replace("basmati rice", "बासमती चावल"));
  assert.match(call.spoken.join(" "), /कुल 3250 रुपये/);
  for (const body of call.speakBodies) assert.equal(body.interruptable, false);
  assert.equal(call.speakBodies[0].priority, "APPEND");
  assert.deepEqual(repo.listApprovalReadbacks(businessId).map((r) => [r.approval_id, r.agent_id]), [[asked.approvalId, "AGV"]]);

  // Asked again in another language: not read again (E2E r4), unless the owner asks to hear it.
  assert.equal((await registry.callTool(ctx, "request_approval", { quoteId: quote.id, reply_language: "en-IN" })).say, "Shall I place the order?");
  assert.equal(call.spoken.length, 1);
  assert.equal((await registry.callTool(ctx, "request_approval", { quoteId: quote.id, reply_language: "en-IN", repeat: true })).say, "", "read out again: the server asks");
  assert.match(call.spoken.at(-1), /^Lakshmi Traders: .* Total 3250 rupees/, "spoken again, in the owner's language");
});

test("confirm_approval by voice approves on a clear yes to the read-back the server spoke, and never on anything else", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGV" });
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });

  call.owner("शायद, सोचता हूँ");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NOT_AFFIRMATIVE");
  call.owner("हा हा");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "NOT_AFFIRMATIVE");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending", "a maybe or a laugh leaves it pending");

  // The model claims "approve" without any agent: refused.
  await expectToolError(registry.callTool({ ...ctx, agentId: null }, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NO_VOICE_EVIDENCE");
  // Another call's agent never spoke this read-back.
  await expectToolError(registry.callTool({ ...ctx, agentId: "AGX" }, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "READBACK_NOT_SPOKEN");

  // Security review r2 #3: the owner's first answer after the read-back was a maybe, so a later yes
  // does not approve these figures; the server reads the deal out again and asks once more.
  call.owner("हाँ जी, कर दो");
  const spokenBefore = call.spoken.length;
  const again = await registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" });
  assert.deepEqual([again.status, again.readAgain, again.refused, again.say], ["pending", true, "NOT_AFFIRMATIVE", ""]);
  assert.equal(call.spoken.length, spokenBefore + 1, "the read-back, spoken by the server again");
  assert.equal(call.spoken.at(-1), repo.listApprovalReadbacks(businessId, { approval_id: asked.approvalId, agent_id: "AGV" })[0].spoken_text, "the same words as the first read-back");
  assert.equal(repo.listApprovalReadbacks(businessId, { approval_id: asked.approvalId, agent_id: "AGV" }).length, 2);
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");

  call.owner("हाँ जी, कर दो");
  const ok = await registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" });
  assert.equal(ok.status, "approved");
  // E2E full run bug 3a: the spoken yes places the order at once, like the Yes card, and the
  // server itself says the approval and the PO number; the model only hands back.
  assert.match(ok.orderId, /^ord_/);
  assert.equal(ok.outcome, `आपकी मंज़ूरी दर्ज हो गई। ऑर्डर बन गया, खरीद आदेश नंबर ${ok.poNumber}।`);
  assert.equal(ok.outcomeSpoken, true);
  assert.ok(outcomeSpoken(call.spoken.at(-1), ok), call.spoken.at(-1));
  assert.equal(call.speakBodies.at(-1).interruptable, false);
  assert.equal(ok.say, "");
  assert.equal(repo.listOrders(businessId).length, 1);
  const row = repo.getApproval(businessId, asked.approvalId);
  assert.equal(row.decided_via, "voice");
  assert.equal(row.evidence_utterance, "हाँ जी, कर दो");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "ALREADY_DECIDED");
});

test("review #2: a yes said before the read-back, or with no read-back spoken, does not count", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGO" });
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);
  call.owner("yes");
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  const readsBefore = call.historyReads;
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NO_ANSWER_YET");
  // The first read is shared with the reply-language read (src/agora/language.js, agent.withHistorySnapshot).
  assert.equal(call.historyReads - readsBefore, 3, "the answer may lag in /history, so it is looked for again before refusing");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");

  // An approval put up without a call (no agent): its read-back was never spoken, so no yes counts.
  const quiet = seedBusiness("en-IN");
  const quietQuote = seedQuote(quiet).quote;
  const offCall = await registry.callTool(ownerCtx(quiet), "request_approval", { quoteId: quietQuote.id });
  assert.match(offCall.say, /^Lakshmi Traders: /, "without a call the read-back is the model's to say");
  call.owner("yes");
  await expectToolError(registry.callTool(ownerCtx(quiet, { agentId: "AGO" }), "confirm_approval", { decision: "approve" }), "READBACK_NOT_SPOKEN");
});

test("when the server cannot speak the read-back the approval waits for the button, and a spoken yes cannot approve it", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGF" });
  const { quote } = seedQuote(businessId);
  fakeCall(t, { failSpeak: true });
  await expectToolError(registry.callTool(ctx, "request_approval", { quoteId: quote.id }), "READBACK_NOT_SPOKEN");
  const [pending] = repo.listApprovals(businessId, { status: "pending" });
  assert.ok(pending, "the approval is still on screen for the button");
  assert.deepEqual(repo.listApprovalReadbacks(businessId), []);
  approvals.confirmApproval(businessId, pending.id, { decision: "approve", via: "button" });
  assert.equal(repo.getApproval(businessId, pending.id).status, "approved");
});

test("approved deal -> create_order -> create_payment_link (Razorpay test, faked at the network)", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGP" });
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  call.owner("yes, go ahead");
  const order = await registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" });
  assert.match(order.orderId, /^ord_/);
  assert.match(order.poNumber, /^SAHAY\/\d{4}\/[0-9A-F]{4,}-0001$/, "per-business code and sequence (E2E r4)");
  assert.equal(order.outcome, `Your approval is recorded. The order is placed, purchase order number ${order.poNumber}.`);
  // A create_order after the spoken yes names the order already placed; the same approval never orders twice.
  const again = await registry.callTool(ctx, "create_order", {});
  assert.deepEqual([again.orderId, again.alreadyPlaced], [order.orderId, true]);
  assert.equal(again.say, `The order is placed, purchase order number ${order.poNumber}.`);
  await expectToolError(registry.callTool(ctx, "create_order", { approvalId: asked.approvalId }), "APPROVAL_CONSUMED");
  assert.equal(repo.listOrders(businessId).length, 1);

  const before = await registry.callTool(ctx, "get_order_status", {});
  assert.equal(before.say, `Order ${order.poNumber} is confirmed; payment is pending and no payment link has been made yet.`);
  assert.deepEqual(before.orders[0].payment, { status: "pending", linkExists: false, url: null });

  const razorpay = stubRazorpayOrders(t);
  const link = await registry.callTool(ctx, "create_payment_link", { orderId: order.orderId });
  assert.match(link.url, /^https:\/\/sahay\.test\/pay\/[A-Za-z0-9_-]{22}$/);
  assert.equal(link.testMode, true);
  assert.equal(link.say, `The test-mode payment link for order ${order.poNumber} is ready and on the screen.`);
  assert.ok(razorpay.includes("https://api.razorpay.com/v1/orders"), "a Razorpay order, not a payment link");
  assert.ok(!razorpay.some((url) => url.includes("payment_links")));

  const status = await registry.callTool(ctx, "get_order_status", {});
  assert.equal(status.orders.length, 1);
  assert.equal(status.say, `Order ${order.poNumber} is confirmed; payment is pending and the payment link is ready.`);

  // Checkout's success handler, verified with the key secret: the order is paid.
  const payments = require("../src/orders/payments");
  const token = link.url.split("/pay/")[1];
  const { razorpayOrderId } = payments.checkoutForToken(token);
  const paymentId = "pay_RegistryPay0001";
  const signature = require("node:crypto").createHmac("sha256", FAKE.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest("hex");
  payments.verifyCheckoutPayment(token, { razorpay_payment_id: paymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: signature });
  const paid = await registry.callTool(ctx, "get_order_status", {});
  assert.equal(paid.say, `Order ${order.poNumber} is paid.`);
  assert.equal(paid.orders[0].payment.status, "paid");
  await expectToolError(registry.callTool(ctx, "create_payment_link", {}), "ORDER_ALREADY_PAID");
});

test("create_payment_link is refused for an order that does not exist for this business", async () => {
  const businessId = seedBusiness("en-IN");
  await expectToolError(registry.callTool(ownerCtx(businessId), "create_payment_link", { orderId: "ord_nope" }), "ORDER_NOT_FOUND");
});

test("validateArgs covers required, enum, numbers and patterns", () => {
  const schema = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string", enum: ["x", "y"] }, n: { type: "number", exclusiveMinimum: 0 }, d: { type: "string", pattern: "^\\d{4}$" } } };
  assert.equal(registry.validateArgs(schema, { a: "x" }), null);
  assert.match(registry.validateArgs(schema, {}), /a is required/);
  assert.match(registry.validateArgs(schema, { a: "z" }), /one of/);
  assert.match(registry.validateArgs(schema, { a: "x", n: 0 }), /above 0/);
  assert.match(registry.validateArgs(schema, { a: "x", d: "12" }), /format/);
  assert.match(registry.validateArgs(schema, { a: "x", extra: 1 }), /Unknown argument/);
});

/* ------------------------------------------- E2E 2026-11-19 regressions --- */

test("save_requirement stores canonical units and cities from Hindi, Kannada and English speech", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const hi = await registry.callTool(ctx, "save_requirement", { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "बेंगलुरु", max_price_per_unit: 90 });
  assert.equal(hi.requirement.unit, "kg");
  assert.equal(hi.requirement.city, "Bengaluru");
  assert.equal(hi.requirement.item, "बासमती चावल", "the item is kept as the owner said it");
  assert.equal(hi.say, "ठीक है, 200 किलो बासमती चावल लिख लिया, बेंगलुरु के लिए।");

  const kn = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", quantity: 200, unit: "ಕಿಲೋ", city: "ಬೆಂಗಳೂರು", reply_language: "kn-IN" });
  assert.deepEqual([kn.requirement.unit, kn.requirement.city], ["kg", "Bengaluru"]);
  assert.match(kn.say, /ಬೆಂಗಳೂರಿಗೆ/, "the city is said in Kannada script and case, never \"Bengaluruಗೆ\" or \"ಬೆಂಗಳೂರಿನಿಗೆ\"");
  assert.doesNotMatch(kn.say, /\p{Script=Latin}/u);
  const en = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "cotton t-shirts", quantity: 500, unit: "pieces", city: "Bangalore" });
  assert.deepEqual([en.requirement.unit, en.requirement.city], ["piece", "Bengaluru"]);
  const mixed = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "कॉटन टीशर्ट", quantity: 500, unit: "पीस", city: "Bengaluru" });
  assert.equal(mixed.requirement.unit, "piece");
});

test("save_requirement asks about a unit it does not know and saves nothing (never guesses)", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  await assert.rejects(registry.callTool(ctx, "save_requirement", { item: "चावल", quantity: 3, unit: "गाड़ी" }), (err) => {
    assert.equal(err.code, "UNKNOWN_UNIT");
    assert.match(err.say, /^"गाड़ी" इकाई मुझे समझ नहीं आई/);
    return true;
  });
  assert.equal(repo.listRequirements(businessId).length, 0);
});

test("save_requirement without an id or item fills in the requirement saved earlier in this call", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const first = await registry.callTool(ctx, "save_requirement", { item: "sugar" });
  const second = await registry.callTool(ctx, "save_requirement", { quantity: 50, unit: "kgs", city: "mysore" });
  assert.equal(second.requirementId, first.requirementId);
  assert.deepEqual([second.requirement.quantity, second.requirement.unit, second.requirement.city], [50, "kg", "Mysuru"]);
  // a fresh call has nothing to fill in
  await expectToolError(registry.callTool(ownerCtx(businessId), "save_requirement", { quantity: 5 }), "INVALID");
});

test("reply_language switches the say language; the business language is the fallback", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const en = await registry.callTool(ctx, "save_requirement", { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "बेंगलुरु", reply_language: "en-IN" });
  assert.equal(en.say, "Noted: 200 kilograms of basmati rice for Bengaluru.", "an English sentence gets an English item name");
  const kn = await registry.callTool(ctx, "get_shortlist", { reply_language: "kn-IN" });
  assert.equal(kn.say, "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಇನ್ನೂ ಶುರುವಾಗಿಲ್ಲ; ಶುರು ಮಾಡಲೇ?", "no search yet: offer to start, never 'none found' (E2E r2)");
  const hi = await registry.callTool(ctx, "get_shortlist", {});
  assert.equal(hi.say, "विक्रेताओं की खोज अभी शुरू नहीं हुई है; शुरू करूँ?");
  // errors follow it too
  await assert.rejects(
    registry.callTool(ctx, "save_requirement", { unit: "handful", reply_language: "en-IN" }),
    (err) => err.code === "UNKNOWN_UNIT" && /^I did not understand the unit "handful"/.test(err.say),
  );
  await expectToolError(registry.callTool(ctx, "get_shortlist", { reply_language: "fr-FR" }), "INVALID_ARGUMENTS");

  // after sourcing, the IndiaMART category names the item in English
  const job = repo.createJob(businessId, { kind: "sourcing", requirement_id: en.requirementId });
  repo.transitionJob(businessId, job.id, "queued", "running");
  repo.transitionJob(businessId, job.id, "running", "done", { result: { category: "Basmati Rice", count: 0 } });
  const again = await registry.callTool(ctx, "save_requirement", { max_price_per_unit: 90, reply_language: "en-IN" });
  assert.equal(again.say, "Noted: 200 kilograms of Basmati Rice for Bengaluru.");

  for (const tool of registry.toolsFor("owner")) {
    assert.deepEqual(tool.inputSchema.properties.reply_language?.enum, ["hi-IN", "kn-IN", "en-IN"], tool.name);
  }
});

/** 200 kg, max 90/kg; vendors as the QA run saw them: a per-bag listing scored highest. */
function seedVendors(businessId, sessionId, { units = ["Bag", "Kg", "Kg"] } = {}) {
  const need = repo.createRequirement(businessId, { item: "बासमती चावल", quantity: 200, unit: "kg", city: "Bengaluru", max_price: 90, session_id: sessionId });
  const make = (name, price, unit, score) => repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name, listed_price: price, listed_unit: unit, score });
  const vendors = [make("3comma Labs", 25000, units[0], 80), make("Babu Trading Co.", 100, units[1], 75), make("BS Foods", 60, units[2], 70)];
  return { need, vendors };
}

function captureNegotiationStart(t) {
  const calls = [];
  const real = session.startNegotiation;
  session.startNegotiation = async (args) => {
    calls.push(args);
    return { jobId: "job_fake", negotiationId: "neg_fake" };
  };
  t.after(() => {
    session.startNegotiation = real;
  });
  return calls;
}

test("start_negotiation with no ids negotiates with the best-ranked vendor that has a comparable price", async (t) => {
  const calls = captureNegotiationStart(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const { need, vendors } = seedVendors(businessId, ctx.sessionId);

  const out = await registry.callTool(ctx, "start_negotiation", {});
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].requirementId, calls[0].vendorId, calls[0].counterpart], [need.id, vendors[1].id, "simulated"]);
  assert.equal(out.vendorRank, 2);
  assert.match(out.say, /^Babu Trading Co\. की लिस्टिंग के भाव पर बने सिम्युलेटेड विक्रेता से/);

  // vendorRank picks by place in the shortlist; the per-bag #1 cannot back a simulated vendor
  await assert.rejects(registry.callTool(ctx, "start_negotiation", { vendorRank: 1 }), (err) => {
    assert.equal(err.code, "NO_LISTED_PRICE");
    assert.equal(err.say, "3comma Labs की लिस्टिंग में प्रति किलो भाव नहीं है; नंबर 2, Babu Trading Co., का भाव है, उनसे मोल-भाव करूँ?");
    return true;
  });
  await registry.callTool(ctx, "start_negotiation", { vendorRank: 3, reply_language: "en-IN" });
  assert.equal(calls.at(-1).vendorId, vendors[2].id);
  assert.equal(calls.at(-1).language, "hi-IN", "the negotiation runs in the business language");
  assert.equal(calls.at(-1).sayLanguage, "en-IN");
  await assert.rejects(registry.callTool(ctx, "start_negotiation", { vendorRank: 9 }), (err) => err.code === "NOT_FOUND" && err.say === "सूची में केवल 3 विक्रेता हैं।");
  await expectToolError(registry.callTool(ctx, "start_negotiation", { vendorId: "ven_garbled" }), "NOT_FOUND");
  assert.equal(calls.length, 2, "no negotiation started on a refusal");
});

test("start_negotiation with no comparable listing refuses and offers a real vendor by link", async (t) => {
  const calls = captureNegotiationStart(t);
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const { vendors } = seedVendors(businessId, ctx.sessionId, { units: ["Bag", "Bag", "Box"] });
  await assert.rejects(registry.callTool(ctx, "start_negotiation", {}), (err) => {
    assert.equal(err.code, "NO_LISTED_PRICE");
    assert.equal(err.say, "No vendor lists a price per kilogram, so I cannot base a simulated vendor on one; shall I invite a real vendor by link?");
    return true;
  });
  assert.equal(calls.length, 0);
  await registry.callTool(ctx, "start_negotiation", { counterpart: "human" });
  assert.equal(calls[0].vendorId, vendors[0].id, "a human vendor needs no listed price: the best-ranked one");
});

test("start_negotiation with no requirement asks what to buy", async () => {
  const businessId = seedBusiness("hi-IN");
  await assert.rejects(
    registry.callTool(ownerCtx(businessId), "start_negotiation", {}),
    (err) => err.code === "NO_REQUIREMENT" && err.say === "पहले बताइए, क्या खरीदना है?",
  );
});

test("request_approval with no id takes the best deal; a tie for best is named, not picked", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const { need, quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", {});
  assert.equal(asked.quoteId, quote.id);
  assert.match(asked.say, /^Lakshmi Traders: 50 kg of basmati rice at 62 rupees per kg,/);

  const other = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Ganesh Stores", listed_price: 64, listed_unit: "kg" });
  const neg = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: other.id, counterpart: "human" });
  repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: other.id, negotiation_id: neg.id, unit_price: 62, unit: "kg", lead_time_days: 3, freight: 150, landed_cost: 3250, quoted_sentence: "62",
  });
  await assert.rejects(registry.callTool(ctx, "request_approval", { requirementId: need.id }), (err) => {
    assert.equal(err.code, "AMBIGUOUS");
    assert.match(err.say, /^There are 2 choices: (Lakshmi Traders|Ganesh Stores) at 3250 rupees, (Lakshmi Traders|Ganesh Stores) at 3250 rupees\. Which one\?$/);
    return true;
  });
});

test("request_approval's readback follows reply_language; the stored readback stays in the business language", async () => {
  const businessId = seedBusiness("hi-IN");
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ownerCtx(businessId), "request_approval", { quoteId: quote.id, reply_language: "en-IN" });
  assert.match(asked.say, /^Lakshmi Traders: .* Total 3250 rupees/);
  assert.match(repo.getApproval(businessId, asked.approvalId).readback, /कुल 3250 रुपये/);
});

test("money defaults never pick between several; one deal waits at a time, so a spoken yes is about the deal just read", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGD" });
  const call = fakeCall(t);

  // nothing waiting
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  await expectToolError(registry.callTool(ctx, "create_order", {}), "NOT_APPROVED");

  const a = seedQuote(businessId);
  const b = seedQuote(businessId);
  const first = await registry.callTool(ctx, "request_approval", { quoteId: a.quote.id });
  // one pending: create_order hands it to the gate, which refuses (not approved yet)
  await expectToolError(registry.callTool(ctx, "create_order", {}), "NOT_APPROVED");
  const second = await registry.callTool(ctx, "request_approval", { quoteId: b.quote.id });
  assert.equal(repo.getApproval(businessId, first.approvalId).status, "rejected", "putting up B withdrew A");
  assert.deepEqual(repo.listApprovals(businessId, { status: "pending" }).map((x) => x.id), [second.approvalId]);

  call.owner("हाँ");
  const yes = await registry.callTool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(yes.approvalId, second.approvalId, "the yes approves the deal that was read out last");
  assert.equal(repo.getApproval(businessId, first.approvalId).status, "rejected");
  assert.equal(repo.getApproval(businessId, second.approvalId).status, "consumed", "the spoken yes placed its order");

  // Two deals approved on the cards and not ordered yet: the default never picks between them.
  const third = await registry.callTool(ctx, "request_approval", { quoteId: a.quote.id });
  approvals.confirmApproval(businessId, third.approvalId, { decision: "approve", via: "button" });
  const c = seedQuote(businessId);
  const fourth = await registry.callTool(ctx, "request_approval", { quoteId: c.quote.id });
  approvals.confirmApproval(businessId, fourth.approvalId, { decision: "approve", via: "button" });
  await expectToolError(registry.callTool(ctx, "create_order", {}), "AMBIGUOUS");
  assert.equal(repo.listOrders(businessId).length, 1, "no order from an ambiguous default");

  // with the id it goes through the gate as before
  const order = await registry.callTool(ctx, "create_order", { approvalId: third.approvalId });
  assert.match(order.poNumber, /^SAHAY\//);
  // now exactly one approved remains: the default takes it, through the same gate
  const next = await registry.callTool(ctx, "create_order", {});
  assert.notEqual(next.orderId, order.orderId);
  assert.equal(repo.getApproval(businessId, fourth.approvalId).status, "consumed");

  // two confirmed orders: the payment default is the most recent one (e2e r3 bug 2)
  stubRazorpayOrders(t);
  const link = await registry.callTool(ctx, "create_payment_link", {});
  assert.equal(link.orderId, next.orderId);
});

test("create_payment_link with no id uses the one order awaiting payment, through the approval gate", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  await expectToolError(registry.callTool(ctx, "create_payment_link", {}), "NO_ORDER");
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "button" });
  const order = await registry.callTool(ctx, "create_order", {});

  // e2e r3 bug 2: a new requirement saved afterwards, in a fresh call, must not hide the order.
  const fresh = ownerCtx(businessId); // a new session row: a fresh call
  await registry.callTool(fresh, "save_requirement", { item: "toor dal", quantity: 20, unit: "kg", city: "Mysuru" });
  const status = await registry.callTool(fresh, "get_order_status", {});
  assert.equal(status.orders.at(-1).orderId, order.orderId);
  assert.match(status.say, /payment is pending/);

  stubRazorpayOrders(t);
  const link = await registry.callTool(fresh, "create_payment_link", {});
  assert.equal(link.orderId, order.orderId);
  assert.match(link.url, /^https:\/\/sahay\.test\/pay\//);
  const again = await registry.callTool(fresh, "create_payment_link", {});
  assert.equal(again.url, link.url);
  assert.equal(again.existing, true);

  // only a cancelled order left: said plainly, nothing is made
  require("../src/orders").advanceOrder(businessId, order.orderId, "cancelled");
  await expectToolError(registry.callTool(fresh, "create_payment_link", {}), "NO_PAYABLE_ORDER");
});

test("get_job_status with no id reports the running or latest job, and says so when there is none", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const none = await registry.callTool(ctx, "get_job_status", {});
  assert.equal(none.status, "none");
  assert.equal(none.say, "No search or negotiation has been started yet.");
});

/* ------------------------------------------- E2E round 2 regressions --- */

const narrator = require("../src/agora/narrator");

function restoreNarrator() {
  narrator.configure({
    speak: (agentId, text) => agent.speak(agentId, text, { priority: "APPEND", interruptable: true }),
    status: (agentId, text) => agent.updateCallStatus(agentId, text),
    minGapMs: 5000,
    vendorDebounceMs: 2500,
    holdMs: 6000,
  });
}

const SEARCH_RUNNING = {
  "hi-IN": "विक्रेताओं की खोज अभी चल रही है, मिलते ही बताऊँगी।",
  "kn-IN": "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಇನ್ನೂ ನಡೆಯುತ್ತಿದೆ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.",
  "en-IN": "The vendor search is still running; I will tell you as soon as I find vendors.",
};

test("E2E r2 bug 4: while sourcing runs, no tool says that no vendor was found", async (t) => {
  const started = captureNegotiationStart(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const need = repo.createRequirement(businessId, { item: "बासमती चावल", quantity: 200, unit: "kg", city: "Bengaluru", max_price: 90, session_id: ctx.sessionId });

  // Nothing started yet: offer to start; do not claim a result.
  assert.equal((await registry.callTool(ctx, "get_shortlist", {})).say, "विक्रेताओं की खोज अभी शुरू नहीं हुई है; शुरू करूँ?");
  assert.equal((await registry.callTool(ctx, "get_shortlist", { reply_language: "en-IN" })).say, "The vendor search has not started yet; shall I start it?");

  const job = repo.createJob(businessId, { kind: "sourcing", requirement_id: need.id });
  repo.transitionJob(businessId, job.id, "queued", "running");
  for (const [language, say] of Object.entries(SEARCH_RUNNING)) {
    assert.equal((await registry.callTool(ctx, "get_shortlist", { reply_language: language })).say, say, `get_shortlist ${language}`);
    assert.equal((await registry.callTool(ctx, "get_job_status", { reply_language: language })).say, say, `get_job_status ${language}: no "0 vendors so far"`);
    await assert.rejects(registry.callTool(ctx, "start_negotiation", { reply_language: language }), (err) => {
      assert.equal(err.code, "SOURCING_RUNNING");
      assert.equal(err.say, say);
      return true;
    });
  }
  assert.equal(started.length, 0);

  // Only a finished search may say that it found nobody.
  repo.transitionJob(businessId, job.id, "running", "failed", { error: "IndiaMART returned no listings." });
  assert.equal((await registry.callTool(ctx, "get_shortlist", {})).say, "खोज में कोई विक्रेता नहीं मिला।");
  assert.equal((await registry.callTool(ctx, "get_shortlist", { reply_language: "en-IN" })).say, "The search found no vendors.");
});

test("E2E r2 bug 4: while a negotiation runs, deals and approval say it is running, not 'no quotes'", async () => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 200, unit: "kg", city: "Bengaluru", max_price: 90, session_id: ctx.sessionId });
  const job = repo.createJob(businessId, { kind: "negotiation", requirement_id: need.id });
  repo.transitionJob(businessId, job.id, "queued", "running");
  const running = "The negotiation is still going on; I will tell you the result as soon as it is in.";
  assert.equal((await registry.callTool(ctx, "get_ranked_deals", {})).say, running);
  await assert.rejects(registry.callTool(ctx, "request_approval", {}), (err) => err.code === "NEGOTIATION_RUNNING" && err.say === running);
  repo.transitionJob(businessId, job.id, "running", "done", { result: { status: "walked_away", outcome: { agreed: false, vendorName: "BS Foods", simulated: true, unit: "kg" } } });
  assert.equal((await registry.callTool(ctx, "get_ranked_deals", {})).say, "There are no quotes yet.");
});

test("E2E r2 bug 2: get_job_status tells how a finished negotiation ended, and start_negotiation runs again after it", async (t) => {
  const started = captureNegotiationStart(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const { need } = seedVendors(businessId, ctx.sessionId);
  const job = repo.createJob(businessId, { kind: "negotiation", requirement_id: need.id });
  repo.transitionJob(businessId, job.id, "queued", "running");
  repo.transitionJob(businessId, job.id, "running", "done", {
    result: { negotiationId: "neg_w", status: "walked_away", outcome: { agreed: false, state: "walked_away", vendorName: "BS Foods", simulated: true, unit: "kg" } },
  });
  const hi = await registry.callTool(ctx, "get_job_status", {});
  assert.equal(hi.say, "BS Foods (सिम्युलेटेड विक्रेता) से मोल-भाव ख़त्म हुआ, सौदा नहीं बना।");
  const en = await registry.callTool(ctx, "get_job_status", { reply_language: "en-IN" });
  assert.equal(en.say, "The negotiation with BS Foods (simulated vendor) has ended without a deal.");

  // The owner asks again: the tool starts a new negotiation (the model must call it, not answer from memory).
  const again = await registry.callTool(ctx, "start_negotiation", {});
  assert.equal(started.length, 1);
  assert.match(again.say, /सिम्युलेटेड विक्रेता से मोल-भाव शुरू कर दिया है/);

  const agreedJob = repo.createJob(businessId, { kind: "negotiation", requirement_id: need.id });
  repo.transitionJob(businessId, agreedJob.id, "queued", "running");
  repo.transitionJob(businessId, agreedJob.id, "running", "done", {
    result: { negotiationId: "neg_a", status: "agreed", outcome: { agreed: true, vendorName: "Babu Trading Co.", simulated: true, unitPrice: 88.5, unit: "kg" } },
  });
  const done = await registry.callTool(ctx, "get_job_status", { jobId: agreedJob.id, reply_language: "en-IN" });
  assert.equal(done.say, "The negotiation with Babu Trading Co. (simulated vendor) is done at 88.5 rupees per kilogram.");
});

test("E2E r2 bug 3: once get_job_status has said the search result, the narrator does not say it again", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const spoken = [];
  narrator.configure({ speak: async (_a, text) => spoken.push(text), status: async () => {}, minGapMs: 5, vendorDebounceMs: 20, holdMs: 150 });
  t.after(restoreNarrator);
  const state = narrator.attach(businessId, { agentId: "AGDUP", sessionId: ctx.sessionId, language: "hi-IN" });
  state.lastSpokeAt = 0;
  t.after(() => narrator.detach(businessId));

  const need = repo.createRequirement(businessId, { item: "बासमती चावल", quantity: 200, unit: "kg", city: "Bengaluru", session_id: ctx.sessionId });
  const job = repo.createJob(businessId, { kind: "sourcing", requirement_id: need.id });
  repo.transitionJob(businessId, job.id, "queued", "running");
  narrator.suppress(businessId, "job.started");
  narrator.onEvent({ businessId, type: "job.started", data: { jobId: job.id, kind: "sourcing" } });
  const result = { requirementId: need.id, unit: "kg", count: 10, shortlist: [{ name: "BS Foods", comparablePrice: 60 }] };
  repo.transitionJob(businessId, job.id, "running", "done", { result });
  narrator.onEvent({ businessId, type: "job.done", data: { jobId: job.id, kind: "sourcing", result } });

  const status = await registry.callTool(ctx, "get_job_status", {});
  assert.equal(status.say, "खोज पूरी हुई, 10 विक्रेता मिले।");
  await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(spoken, [], "one 'search done' line, not two");
});

test("E2E r2 bug 3: get_shortlist after a finished search also stands in for the narrated result", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const spoken = [];
  narrator.configure({ speak: async (_a, text) => spoken.push(text), status: async () => {}, minGapMs: 5, holdMs: 150 });
  t.after(restoreNarrator);
  const state = narrator.attach(businessId, { agentId: "AGDUP2", sessionId: ctx.sessionId, language: "hi-IN" });
  state.lastSpokeAt = 0;
  t.after(() => narrator.detach(businessId));
  const { need } = seedVendors(businessId, ctx.sessionId);
  const job = repo.createJob(businessId, { kind: "sourcing", requirement_id: need.id });
  repo.transitionJob(businessId, job.id, "queued", "running");
  narrator.onEvent({ businessId, type: "job.started", data: { jobId: job.id, kind: "sourcing" } });
  const result = { requirementId: need.id, unit: "kg", count: 3, shortlist: [{ name: "Babu Trading Co.", comparablePrice: 100 }] };
  repo.transitionJob(businessId, job.id, "running", "done", { result });
  narrator.onEvent({ businessId, type: "job.done", data: { jobId: job.id, kind: "sourcing", result } });
  await registry.callTool(ctx, "get_shortlist", {});
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(!spoken.some((s) => s.startsWith("खोज पूरी हुई")), `narrated: ${JSON.stringify(spoken)}`);
});

test("E2E r2 bug 5: English and Kannada say lines never carry the Devanagari item name", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const { need, quote } = seedQuote(businessId);
  repo.updateRequirement(businessId, need.id, { item: "बासमती चावल" });
  const en = await registry.callTool(ctx, "request_approval", { quoteId: quote.id, reply_language: "en-IN" });
  assert.match(en.say, /^Lakshmi Traders: 50 kg of basmati rice at 62 rupees per kg,/);
  assert.doesNotMatch(en.say, /\p{Script=Devanagari}/u);
  assert.match(repo.getApproval(businessId, en.approvalId).readback, /बासमती चावल/, "the stored readback keeps the owner's words");

  // An item no rule can name in English is not read out in a foreign script.
  const shirts = await registry.callTool(ctx, "save_requirement", { item: "कॉटन टीशर्ट्स", quantity: 500, unit: "pieces", city: "Bengaluru", reply_language: "en-IN" });
  assert.doesNotMatch(shirts.say, /\p{Script=Devanagari}/u);
  assert.match(shirts.say, /^Noted: 500 .* of the requested item for Bengaluru\.$/);
  const kn = await registry.callTool(ctx, "save_requirement", { quantity: 400, reply_language: "kn-IN" });
  assert.doesNotMatch(kn.say, /\p{Script=Devanagari}/u);
});

/* --------------------------------------------- security review r1 #1, #10 --- */

test("review #1: vendor searches share a global cap; a full cap is refused politely and the slot comes back when the search ends", async (t) => {
  const limits = require("../src/limits");
  limits.reset();
  t.after(() => limits.reset());
  stubFetch(t, async () => new Response("not found", { status: 404 }));
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const saved = await registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 100, unit: "kg", city: "Bengaluru" });

  const held = [];
  for (let release = limits.tryAcquire("sourcing"); release; release = limits.tryAcquire("sourcing")) held.push(release);
  await assert.rejects(registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId }), (err) => {
    assert.equal(err.code, "BUSY");
    assert.equal(err.say, "A lot of people are using Sahay right now; please try again in a little while.");
    return true;
  });
  await assert.rejects(registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId, reply_language: "hi-IN" }), (err) => err.say === "अभी बहुत लोग इस्तेमाल कर रहे हैं, थोड़ी देर बाद कोशिश कीजिए।");
  assert.deepEqual(repo.listJobs(businessId), [], "no job was started");

  held.pop()();
  const out = await registry.callTool(ctx, "start_sourcing", { requirementId: saved.requirementId });
  await jobs.whenSettled(out.jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(repo.getJob(businessId, out.jobId).status, "failed", "IndiaMART answered 404: the search fails honestly");
  assert.equal(limits.usage().sourcing.inUse, held.length, "the failed search gave its slot back");
  for (const release of held) release();
});

test("review #10: the spoken 'order placed' line names a simulated vendor as such", async () => {
  for (const [language, expected] of [
    ["en-IN", /^The order is placed with a simulated vendor, purchase order number SAHAY\//],
    ["hi-IN", /^ऑर्डर बन गया \(सिम्युलेटेड विक्रेता\), खरीद आदेश नंबर SAHAY\//],
    ["kn-IN", /^ಆರ್ಡರ್ ಆಗಿದೆ \(ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್\), ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ SAHAY\//],
  ]) {
    const businessId = seedBusiness(language);
    const ctx = ownerCtx(businessId);
    const { quote } = seedQuote(businessId, { counterpart: "simulated" });
    const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
    approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "button" });
    const order = await registry.callTool(ctx, "create_order", {});
    assert.match(order.say, expected, language);
  }
  // The narrator's line for an order placed outside a tool call carries the label too.
  assert.equal(narrator.LINES.order_created["en-IN"]({ po: "SAHAY/2026/0001", sim: true }), "The order is placed (simulated vendor), purchase order SAHAY/2026/0001.");
  assert.equal(narrator.LINES.order_created["hi-IN"]({ po: "SAHAY/2026/0001", sim: false }), "ऑर्डर बन गया, खरीद आदेश नंबर SAHAY/2026/0001।");
});

test("request_approval holds narration before the server speaks the read-back, so nothing comes between it and the answer", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGH" });
  const { quote } = seedQuote(businessId);
  const order = [];
  t.mock.method(narrator, "holdForApproval", (id, approvalId) => order.push(["hold", id, approvalId]));
  t.mock.method(agent, "speak", async () => order.push(["speak"]));
  const out = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  assert.deepEqual(order, [["hold", businessId, out.approvalId], ["speak"]]);
});

/* ------------------------------------------------------------- E2E round 4 --- */

test("E2E r4 bug 2: asking again for a deal already read out in this call does not read it again; the yes goes to confirm_approval", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGR" });
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);

  const asked = await registry.callTool(ctx, "request_approval", {});
  assert.equal(call.spoken.length, 1);

  // Called again before the owner answered: no second read-back, the short question only.
  const early = await registry.callTool(ctx, "request_approval", {});
  assert.equal(early.status, "awaiting_answer");
  assert.equal(early.approvalId, asked.approvalId);
  assert.equal(early.say, "क्या मैं ऑर्डर कर दूँ?");
  assert.equal(early.next, "confirm_approval");
  assert.match(early.hint, /confirm_approval/);
  assert.equal(call.spoken.length, 1, "the read-back is not spoken twice");

  // The owner says yes; the model wrongly asks again: still no read-back, and it is told to confirm.
  call.owner("हाँ");
  const again = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  assert.equal(again.status, "awaiting_answer");
  assert.equal(again.ownerReply, "affirmative");
  assert.match(again.hint, /confirm_approval with decision approve/);
  assert.equal(again.say, "ठीक है, दर्ज कर रही हूँ।");
  assert.equal(call.spoken.length, 1);
  assert.equal(repo.listApprovalReadbacks(businessId).length, 1, "one approval.spoken row, not three");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending", "asking never approves: only confirm_approval does");

  // confirm_approval with no id takes the one approval waiting, and the gate accepts the yes.
  const ok = await registry.callTool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(ok.status, "approved");
  assert.equal(repo.getApproval(businessId, asked.approvalId).evidence_utterance, "हाँ");
});

test("E2E r4 bug 2: the owner asking to hear the deal again (repeat) reads it again; a no is pointed to confirm_approval reject", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGP" });
  seedQuote(businessId);
  const call = fakeCall(t);
  await registry.callTool(ctx, "request_approval", {});
  call.owner("can you read it again");
  const repeated = await registry.callTool(ctx, "request_approval", { repeat: true });
  assert.equal(call.spoken.length, 2, "read out again on request");
  assert.equal(repeated.say, "");
  assert.equal(repo.listApprovalReadbacks(businessId).length, 2);

  call.owner("no");
  const no = await registry.callTool(ctx, "request_approval", {});
  assert.equal(no.ownerReply, "negative");
  assert.match(no.hint, /confirm_approval with decision reject/);
  assert.equal(call.spoken.length, 2);
});

test("E2E r4 bug 2: a yes said before the read-back still does not count after a repeated request", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGB" });
  seedQuote(businessId);
  const call = fakeCall(t);
  call.owner("yes");
  await registry.callTool(ctx, "request_approval", {});
  const again = await registry.callTool(ctx, "request_approval", {});
  assert.equal(again.status, "awaiting_answer");
  assert.equal(again.ownerReply, undefined, "no answer since the read-back");
  assert.equal(again.say, "Shall I place the order?");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "NO_ANSWER_YET");
});

function stubIndiaMart(t) {
  return stubFetch(t, async (url) => {
    if (url.startsWith("https://dir.indiamart.com/bengaluru/basmati-rice.html")) {
      const res = new Response(recordedPage, { status: 200 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }
    return new Response("not found", { status: 404 });
  });
}

test("E2E r4 bug 3: in a call, a complete requirement starts the vendor search itself, said in Kannada with the city in Kannada", async (t) => {
  stubIndiaMart(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGK" });
  const call = fakeCall(t);
  call.owner("ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು, ಬೆಂಗಳೂರಿಗೆ ಡೆಲಿವರಿ ಬೇಕು.");

  const out = await registry.callTool(ctx, "save_requirement", { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", quantity: 200, unit: "ಕಿಲೋ", city: "ಬೆಂಗಳೂರು", reply_language: "kn-IN" });
  assert.deepEqual(out.missing, []);
  assert.equal(out.sourcingStarted, true);
  assert.match(out.jobId, /^job_/);
  assert.equal(out.say, "ಸರಿ, 200 ಕೆಜಿ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ, ಬೆಂಗಳೂರಿಗೆ; ಇಂಡಿಯಾಮಾರ್ಟ್‌ನಲ್ಲಿ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಶುರು ಮಾಡಿದ್ದೇನೆ, ಸಿಕ್ಕ ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ.");
  assert.deepEqual(scriptProblems(out.say, "kn-IN"), { latin: [], foreign: false });
  await jobs.whenSettled(out.jobId);
  assert.equal(repo.getJob(businessId, out.jobId).status, "done");

  // Adding a detail later does not search again; an explicit start_sourcing still can.
  call.owner("ಗರಿಷ್ಠ ತೊಂಬತ್ತು ರೂಪಾಯಿ");
  const later = await registry.callTool(ctx, "save_requirement", { max_price_per_unit: 90, reply_language: "kn-IN" });
  assert.equal(later.sourcingStarted, false);
  assert.equal(repo.listJobs(businessId, { kind: "sourcing" }).length, 1);
});

test("E2E r4 bug 3: a requirement still missing a field, or saved outside a call, does not start a search", async (t) => {
  const requested = stubIndiaMart(t);
  const businessId = seedBusiness("hi-IN");
  const call = fakeCall(t);
  call.owner("मुझे दो सौ किलो बासमती चावल चाहिए");
  const partial = await registry.callTool(ownerCtx(businessId, { agentId: "AGM" }), "save_requirement", { item: "बासमती चावल", quantity: 200, unit: "किलो" });
  assert.deepEqual(partial.missing, ["city"]);
  assert.equal(partial.sourcingStarted, false);
  const offCall = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "Bengaluru" });
  assert.equal(offCall.sourcingStarted, false);
  assert.deepEqual(repo.listJobs(businessId), []);
  assert.deepEqual(requested, []);
});

test("E2E r4 bug 4: a fragment 'मुझे पांच' does not become '5 kg basmati rice'; nothing is saved and the owner is asked again", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGF" });
  const call = fakeCall(t);
  call.owner("मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में");
  call.owner("मुझे पांच");
  // The model's own copy of the words is not trusted over the call history.
  const out = await registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 5, unit: "kg", city: "Bengaluru", owner_words: "मुझे पांच किलो बासमती चावल" });
  assert.equal(out.saved, false);
  assert.equal(out.requirementId, null);
  assert.deepEqual(out.missing, ["quantity", "unit"]);
  assert.equal(out.say, "माफ़ कीजिए, पूरी बात सुनाई नहीं दी; बताइए, कितनी मात्रा, किस इकाई में?");
  assert.deepEqual(repo.listRequirements(businessId), []);
  assert.equal(call.historyReads, 2, "the call history is read again once in case the turn lagged");

  // Without a call, the owner's words the model passes are checked instead.
  const off = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "basmati rice", quantity: 5, unit: "kg", owner_words: "मुझे पांच", reply_language: "en-IN" });
  assert.equal(off.saved, false);
  assert.equal(off.say, "Sorry, I did not catch all of that; please tell me again which item, how much, in which unit.");
  const ok = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "basmati rice", quantity: 5, unit: "kg", owner_words: "five kilos of basmati rice" });
  assert.equal(ok.saved, true);
});

test("final-2 E: in type mode a typed need (history source message) is saved; a typed yes still cannot approve", async (t) => {
  stubIndiaMart(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  const call = fakeCall(t);
  call.typed = (content) => call.items.push({ role: "user", content, metadata: { source: "message" }, turn_id: ++call.turn });
  call.typed("मुझे 50 किलो चीनी चाहिए, बेंगलुरु में");
  const out = await registry.callTool(ctx, "save_requirement", { item: "चीनी", quantity: 50, unit: "किलो", city: "बेंगलुरु", owner_words: "मुझे 50 किलो चीनी चाहिए, बेंगलुरु में" });
  assert.equal(out.saved, true);
  assert.deepEqual(out.missing, []);
  assert.equal(repo.getRequirement(businessId, out.requirementId).quantity, 50);
  await jobs.whenSettled(out.jobId);

  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  call.typed("हाँ");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "TYPED_ANSWER");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");
});

test("final-2 D: the same need said again within minutes is the same need, not a duplicate; a different or ordered need is new", async (t) => {
  stubIndiaMart(t);
  const businessId = seedBusiness("hi-IN");
  const call = fakeCall(t);
  call.owner("मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में, नब्बे रुपये तक");
  const args = { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "बेंगलुरु", max_price_per_unit: 90 };
  const first = await registry.callTool(ownerCtx(businessId, { agentId: "AGD1" }), "save_requirement", args);
  await jobs.whenSettled(first.jobId);
  // A new call, the same request: no second need and no second search.
  const again = await registry.callTool(ownerCtx(businessId, { agentId: "AGD2" }), "save_requirement", { ...args, item: " बासमती  चावल " });
  assert.equal(again.requirementId, first.requirementId);
  assert.equal(again.sourcingStarted, false);
  assert.equal(repo.listRequirements(businessId).length, 1);
  assert.equal(repo.listJobs(businessId, { kind: "sourcing" }).length, 1);

  call.owner("मुझे तीन सौ किलो बासमती चावल चाहिए, बेंगलुरु में");
  const more = await registry.callTool(ownerCtx(businessId, { agentId: "AGD3" }), "save_requirement", { ...args, quantity: 300 });
  assert.notEqual(more.requirementId, first.requirementId, "a different quantity is a new need");
  await jobs.whenSettled(more.jobId);
});

test("E2E r4 bug 5: every hi/kn say template of the registry is in its own script (names, PO numbers, digits and Razorpay aside)", () => {
  const { PHRASES, SAY_WORDS } = registry;
  const { SAY } = require("../src/tools/errors");
  const sample = {
    "hi-IN": { city: "बेंगलुरु", unit: "किलो", item: "बासमती चावल", status: "पक्का", payment: "भुगतान बाकी है", missing: "कितनी मात्रा", list: "BS Foods 11000 रुपये" },
    "kn-IN": { city: "ಬೆಂಗಳೂರು", unit: "ಕೆಜಿ", item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", status: "ಖಚಿತ", payment: "ಪಾವತಿ ಬಾಕಿ ಇದೆ", missing: "ಎಷ್ಟು ಪ್ರಮಾಣ", list: "BS Foods 11000 ರೂಪಾಯಿ" },
  };
  const names = { name: "Asha Kirana", vendor: "BS Foods", alt: "Lakshmi Traders", po: "SAHAY/2026/AB12-0001" };
  const allow = Object.values(names);
  for (const language of ["hi-IN", "kn-IN"]) {
    const base = { ...names, ...sample[language], quantity: "200", count: 4, comparable: 3, price: "55", rank: 2, total: "11000", landed: "11000", goods: "11000", amount: "11000", n: 2, more: true, national: true, sim: true };
    for (const [key, byLanguage] of Object.entries(PHRASES)) {
      const bare = { ...base, sim: false, city: null, landed: null, more: false, national: false };
      for (const vars of key === "requirement_missing" ? [base, bare, { ...bare, item: null }] : [base, bare]) {
        const text = byLanguage[language](vars);
        assert.deepEqual(scriptProblems(text, language, { allow }), { latin: [], foreign: false }, `${key} ${language}: "${text}"`);
      }
    }
    for (const [group, words] of Object.entries(SAY_WORDS)) {
      for (const [key, byLanguage] of Object.entries(words)) {
        assert.deepEqual(scriptProblems(byLanguage[language], language), { latin: [], foreign: false }, `${group}.${key} ${language}`);
      }
    }
    for (const [key, byLanguage] of Object.entries(SAY)) {
      assert.deepEqual(scriptProblems(byLanguage[language], language), { latin: [], foreign: false }, `errors.${key} ${language}: "${byLanguage[language]}"`);
    }
  }
});

test("E2E r4 bug 5: a Latin or Kannada item is said in Devanagari inside Hindi, from the trade-word table", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const latin = await registry.callTool(ctx, "save_requirement", { item: "basmati rice", quantity: 5, unit: "kg", city: "Bengaluru" });
  assert.equal(latin.say, "ठीक है, 5 किलो बासमती चावल लिख लिया, बेंगलुरु के लिए।");
  const unknown = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "premium widgets", quantity: 5, unit: "pieces", city: "Bengaluru" });
  assert.deepEqual(scriptProblems(unknown.say, "hi-IN"), { latin: [], foreign: false }, unknown.say);
});

test("E2E regress bug 5: create_payment_link takes the purchase order number as said or typed, in orderId or po_number, and never asks which order", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "button" });
  const order = await registry.callTool(ctx, "create_order", {});
  const po = order.poNumber;
  stubRazorpayOrders(t);

  // The model passed the PO number where the id goes (the E2E failure), with odd spacing.
  const byOrderId = await registry.callTool(ctx, "create_payment_link", { orderId: po.replace(/\//g, " / ") });
  assert.equal(byOrderId.orderId, order.orderId);
  // In Devanagari digits, through po_number.
  const deva = po.replace(/[0-9]/g, (d) => "०१२३४५६७८९"[d]);
  assert.equal((await registry.callTool(ctx, "create_payment_link", { po_number: deva })).orderId, order.orderId);
  // Only the tail the owner read off the screen.
  assert.equal((await registry.callTool(ctx, "create_payment_link", { po_number: po.split("/").at(-1) })).orderId, order.orderId);

  // A number that is not this business's: said plainly, naming the order that waits for payment.
  await assert.rejects(registry.callTool(ctx, "create_payment_link", { po_number: "SAHAY/2026/0000-0999" }), (err) => {
    assert.equal(err.code, "ORDER_NOT_FOUND");
    assert.match(err.say, new RegExp(`भुगतान के लिए बाकी ऑर्डर ${po.replace(/[/]/g, "\/")} है`));
    return true;
  });
  const tool = registry.toolsFor("owner").find((x) => x.name === "create_payment_link");
  assert.match(tool.description, /Never ask which order/);
  assert.ok(tool.inputSchema.properties.po_number);
});

test("in a call a slow tool answers before Agora's MCP timeout: the model gets a 'still working' say, the work goes on and its own say is spoken when it ends", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = { businessId, sessionId: null, agentId: "AGSLOW", actor: "agent", toolScope: "owner" };
  require("../src/agora/language").configure({ history: async () => [] });
  t.after(() => require("../src/agora/language").configure(null));
  const spoken = [];
  require("../src/agora/outcome").configure({ speak: async (agentId, text) => spoken.push({ agentId, text }) });
  t.after(() => require("../src/agora/outcome").configure({ speak: null }));
  registry.configureToolTiming({ deadlineMs: 30 });
  t.after(() => registry.configureToolTiming({ deadlineMs: 8000 }));
  const tool = registry.TOOLS.find((x) => x.name === "get_business_profile");
  let finish;
  t.mock.method(tool, "handler", () => new Promise((resolve) => (finish = resolve)));
  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(line));

  const out = await registry.callTool(ctx, "get_business_profile", { reply_language: "en-IN" });
  assert.equal(out.pending, true);
  assert.equal(out.say, registry.STILL_WORKING["en-IN"]);
  assert.match(out.hint, /never claim a result/);
  assert.equal(require("../src/tools/calls").inFlight(businessId, ["get_business_profile"]), true, "still running for the watchdogs");
  finish({ say: "Asha Kirana is in Bengaluru." });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken, [{ agentId: "AGSLOW", text: "Asha Kirana is in Bengaluru." }]);
  assert.equal(require("../src/tools/calls").inFlight(businessId, ["get_business_profile"]), false);
  assert.ok(warned.some((l) => /still running after 30 ms/.test(l)));

  // A late failure is spoken too, as its own say.
  t.mock.method(tool, "handler", () => new Promise((_, reject) => setTimeout(() => reject(new Error("boom")), 60)));
  const late = await registry.callTool(ctx, "get_business_profile", { reply_language: "en-IN" });
  assert.equal(late.pending, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(spoken.at(-1).text, "Something went wrong and I could not do that just now.");

  // Off a call there is no deadline: the caller waits for the result.
  t.mock.method(tool, "handler", () => new Promise((resolve) => setTimeout(() => resolve({ say: "done" }), 60)));
  const offCall = await registry.callTool({ ...ctx, agentId: null }, "get_business_profile", {});
  assert.equal(offCall.say, "done");
});

test("a thrown error with no spoken line still reaches the model with one", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const tool = registry.TOOLS.find((x) => x.name === "get_business_profile");
  t.mock.method(tool, "handler", async () => {
    throw new ToolError("SOMETHING", "");
  });
  await assert.rejects(registry.callTool({ businessId, toolScope: "owner", agentId: null }, "get_business_profile", {}), (err) => err.say === "कुछ गड़बड़ हो गई, मैं यह काम अभी नहीं कर पाई।");
});
