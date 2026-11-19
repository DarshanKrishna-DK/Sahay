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
const approvals = require("../src/approvals");
const session = require("../src/negotiation/session");
const { rankVendors } = require("../src/procurement/scoring");

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
  assert.equal(out.say, "इंडियामार्ट पर basmati rice के विक्रेता खोजना शुरू कर दिया है, मिलते ही बताऊँगी।");

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

/* ------------------------------------------- E2E 2026-11-19 regressions --- */

test("save_requirement stores canonical units and cities from Hindi, Kannada and English speech", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  const hi = await registry.callTool(ctx, "save_requirement", { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "बेंगलुरु", max_price_per_unit: 90 });
  assert.equal(hi.requirement.unit, "kg");
  assert.equal(hi.requirement.city, "Bengaluru");
  assert.equal(hi.requirement.item, "बासमती चावल", "the item is kept as the owner said it");
  assert.equal(hi.say, "ठीक है, 200 किलो बासमती चावल लिख लिया, Bengaluru के लिए।");

  const kn = await registry.callTool(ownerCtx(businessId), "save_requirement", { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", quantity: 200, unit: "ಕಿಲೋ", city: "ಬೆಂಗಳೂರು" });
  assert.deepEqual([kn.requirement.unit, kn.requirement.city], ["kg", "Bengaluru"]);
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
  assert.match(asked.say, /^Order from Lakshmi Traders: 50 kg of basmati rice at 62 rupees per kg\./);

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
  assert.match(asked.say, /^Order from Lakshmi Traders: .* Total 3250 rupees\./);
  assert.match(repo.getApproval(businessId, asked.approvalId).readback, /कुल 3250 रुपये/);
});

test("money defaults never pick between several: confirm_approval and create_order refuse with the choices", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGD" });
  fakeAgora(t, () => ({ json: { contents: [{ role: "user", content: "हाँ", metadata: { source: "asr" }, timestamp: Date.now() + 1000 }] } }));

  // nothing waiting
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  await expectToolError(registry.callTool(ctx, "create_order", {}), "NOT_APPROVED");

  const a = seedQuote(businessId);
  const b = seedQuote(businessId);
  const first = await registry.callTool(ctx, "request_approval", { quoteId: a.quote.id });
  // one pending: create_order hands it to the gate, which refuses (not approved yet)
  await expectToolError(registry.callTool(ctx, "create_order", {}), "NOT_APPROVED");
  const second = await registry.callTool(ctx, "request_approval", { quoteId: b.quote.id });

  await assert.rejects(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), (err) => {
    assert.equal(err.code, "AMBIGUOUS");
    assert.equal(err.say, "2 विकल्प हैं: Lakshmi Traders 3250 रुपये, Lakshmi Traders 3250 रुपये; कौन सा?");
    return true;
  });
  assert.equal(repo.listApprovals(businessId, { status: "pending" }).length, 2, "nothing decided on an ambiguous default");

  approvals.confirmApproval(businessId, first.approvalId, { decision: "approve", via: "button" });
  approvals.confirmApproval(businessId, second.approvalId, { decision: "approve", via: "button" });
  await expectToolError(registry.callTool(ctx, "create_order", {}), "AMBIGUOUS");
  assert.equal(repo.listOrders(businessId).length, 0, "no order from an ambiguous default");

  // with the id it goes through the gate as before
  const order = await registry.callTool(ctx, "create_order", { approvalId: first.approvalId });
  assert.match(order.poNumber, /^SAHAY\//);
  // now exactly one approved remains: the default takes it, through the same gate
  const next = await registry.callTool(ctx, "create_order", {});
  assert.notEqual(next.orderId, order.orderId);
  assert.equal(repo.getApproval(businessId, second.approvalId).status, "consumed");

  // two orders await a link: the payment default refuses to choose
  await assert.rejects(
    registry.callTool(ctx, "create_payment_link", {}),
    (err) => err.code === "AMBIGUOUS" && err.say.includes(order.poNumber) && err.say.includes(next.poNumber),
  );
});

test("create_payment_link with no id uses the one order awaiting payment, through the approval gate", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  await expectToolError(registry.callTool(ctx, "create_payment_link", {}), "NO_ORDER");
  const { quote } = seedQuote(businessId);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "button" });
  const order = await registry.callTool(ctx, "create_order", {});
  stubFetch(t, async () => new Response(JSON.stringify({ id: "plink_default", short_url: "https://rzp.io/i/default" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const link = await registry.callTool(ctx, "create_payment_link", {});
  assert.equal(link.orderId, order.orderId);
  assert.equal(link.url, "https://rzp.io/i/default");
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
  assert.match(en.say, /^Order from Lakshmi Traders: 50 kg of basmati rice at 62 rupees per kg\./);
  assert.doesNotMatch(en.say, /\p{Script=Devanagari}/u);
  assert.match(repo.getApproval(businessId, en.approvalId).readback, /बासमती चावल/, "the stored readback keeps the owner's words");

  // An item no rule can name in English is not read out in a foreign script.
  const shirts = await registry.callTool(ctx, "save_requirement", { item: "कॉटन टीशर्ट्स", quantity: 500, unit: "pieces", city: "Bengaluru", reply_language: "en-IN" });
  assert.doesNotMatch(shirts.say, /\p{Script=Devanagari}/u);
  assert.match(shirts.say, /^Noted: 500 .* of the requested item for Bengaluru\.$/);
  const kn = await registry.callTool(ctx, "save_requirement", { quantity: 400, reply_language: "kn-IN" });
  assert.doesNotMatch(kn.say, /\p{Script=Devanagari}/u);
});
