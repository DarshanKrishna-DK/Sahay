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
  GROQ_API_KEY: "test-groq-key",
  RAZORPAY_KEY_ID: "rzp_test_registry",
  RAZORPAY_KEY_SECRET: "test-razorpay-secret",
});

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const registry = require("../src/tools/registry");
const { ToolError } = require("../src/tools/errors");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const events = require("../src/events");
const jobs = require("../src/jobs");

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
  assert.equal(out.say, "ಇದು Asha Kirana ಅವರ ಖಾತೆ, ನಗರ Bengaluru.");
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
  assert.equal(second.say, "ठीक है, 200 किलो बासमती चावल लिख लिया, Bengaluru के लिए।");
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
  assert.equal(out.say, "इंडियामार्ट पर basmati rice के विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगा।");

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
  assert.equal(shortlist.vendors.length, Math.min(3, vendors.length));
  assert.equal(shortlist.vendors[0].vendorId, vendors[0].id, "best score first");
  assert.ok(shortlist.say.startsWith(`${vendors.length} विक्रेता हैं; सबसे ऊपर ${vendors[0].name}`));
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
  assert.equal(out.say, "सबसे अच्छा सौदा Lakshmi Traders: 62 रुपये प्रति किलो, कुल 3250 रुपये।");
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

test("confirm_approval by voice needs the owner's own clear yes from /history, newer than the question", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGV" });
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  assert.equal(asked.say, asked.readback);
  assert.match(asked.readback, /3250 रुपये/);

  let lastUser = { content: "शायद, सोचता हूँ", ts: Date.now() + 1000 };
  fakeAgora(t, (url) => {
    assert.match(url, /\/agents\/AGV\/history$/);
    return {
      json: {
        contents: [
          { role: "assistant", content: asked.readback, metadata: { source: "llm" }, timestamp: Date.now() },
          { role: "user", content: lastUser.content, metadata: { source: "asr" }, timestamp: lastUser.ts },
        ],
      },
    };
  });

  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NOT_AFFIRMATIVE");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending", "a maybe leaves it pending");

  // The model claims "approve" without any agent: refused.
  await expectToolError(registry.callTool({ ...ctx, agentId: null }, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NO_VOICE_EVIDENCE");

  lastUser = { content: "हाँ जी, कर दो", ts: Date.now() + 1000 };
  const ok = await registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" });
  assert.equal(ok.status, "approved");
  assert.equal(ok.say, "आपकी मंज़ूरी दर्ज हो गई।");
  const row = repo.getApproval(businessId, asked.approvalId);
  assert.equal(row.decided_via, "voice");
  assert.equal(row.evidence_utterance, "हाँ जी, कर दो");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "ALREADY_DECIDED");
});

test("an old yes (said before the approval was asked) does not count", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGO" });
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  fakeAgora(t, () => ({ json: { contents: [{ role: "user", content: "yes", metadata: { source: "asr" }, timestamp: Date.parse("2020-01-01T00:00:00Z") }] } }));
  await expectToolError(registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" }), "NO_VOICE_EVIDENCE");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");
});

test("approved deal -> create_order -> create_payment_link (Razorpay test, faked at the network)", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGP" });
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  fakeAgora(t, () => ({ json: { contents: [{ role: "user", content: "yes, go ahead", metadata: { source: "asr" }, timestamp: Date.now() + 1000 }] } }));
  await registry.callTool(ctx, "confirm_approval", { approvalId: asked.approvalId, decision: "approve" });

  const order = await registry.callTool(ctx, "create_order", { approvalId: asked.approvalId });
  assert.match(order.orderId, /^ord_/);
  assert.match(order.poNumber, /^SAHAY\/\d{4}\/\d{4}$/);
  assert.equal(order.say, `The order is placed, purchase order number ${order.poNumber}.`);
  await expectToolError(registry.callTool(ctx, "create_order", { approvalId: asked.approvalId }), "APPROVAL_CONSUMED");

  const razorpay = stubFetch(t, async (url, init) => {
    assert.match(url, /^https:\/\/api\.razorpay\.com\/v1\/payment_links/);
    assert.equal(JSON.parse(init.body).amount, 325000);
    return new Response(JSON.stringify({ id: "plink_test1", short_url: "https://rzp.io/i/test1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const link = await registry.callTool(ctx, "create_payment_link", { orderId: order.orderId });
  assert.equal(link.url, "https://rzp.io/i/test1");
  assert.equal(link.testMode, true);
  assert.equal(razorpay.length, 1);

  const status = await registry.callTool(ctx, "get_order_status", {});
  assert.equal(status.orders.length, 1);
  assert.equal(status.say, `Order ${order.poNumber} is confirmed.`);
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
