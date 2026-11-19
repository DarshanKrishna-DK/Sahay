"use strict";

// Teaching Sahay by conversation (plan Task B2): rules are taught by voice, kept only on a spoken
// yes that answers the server's own read-back (or the ✓ button), and narrow what Sahay does in code.
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
  NEGOTIATION_MODE: "loop",
});

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
const rules = require("../src/agent/rules");
const profile = require("../src/agent/profile");
const policy = require("../src/agent/policy");
const { rankVendors } = require("../src/procurement/scoring");
const { scriptProblems } = require("../src/agora/script");

session.configureTiming({ pollMs: 5, stallMs: 40, turnStallMs: 40, closingGraceMs: 5, msPerChar: 0, minLineMs: 1, humanJoinMs: 5000, maxMs: 5000 });

/**
 * A fake live call at the Agora REST boundary (as in registry.test.js): /speak lines show up in
 * /history as server lines, `call.owner(words)` is the owner speaking, `call.typed(words)` typing.
 * /join answers an agent id per role, so negotiations can run against it too.
 */
function fakeCall(t) {
  const call = { spoken: [], speakBodies: [], items: [], turn: 0, joins: 0 };
  call.owner = (content) => call.items.push({ role: "user", content, metadata: { source: "asr" }, turn_id: ++call.turn });
  call.typed = (content) => call.items.push({ role: "user", content, metadata: { source: "rtm" }, turn_id: ++call.turn });
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    let json = {};
    if (url.endsWith("/join")) {
      call.joins += 1;
      json = { agent_id: `${body.properties.labels?.role ?? "agent"}-${call.joins}`, status: "RUNNING" };
    } else if (/\/speak$/.test(url)) {
      call.speakBodies.push(body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
    } else if (/\/history$/.test(url)) {
      json = { contents: call.items.slice() };
    }
    return new Response(JSON.stringify(json), { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return call;
}

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

function ownerCtx(businessId, { agentId = null } = {}) {
  const s = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: s.id, agentId, actor: "agent", toolScope: "owner" };
}

function seedNeed(businessId, { item = "चावल", maxPrice = null, quantity = 200, sessionId } = {}) {
  return repo.createRequirement(businessId, { item, quantity, unit: "kg", city: "Bengaluru", max_price: maxPrice, session_id: sessionId });
}

function seedVendor(businessId, need, { name = "BS Foods", listedPrice = 60, score = 0.8 } = {}) {
  return repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name, listed_price: listedPrice, listed_unit: "kg", score });
}

function keep(businessId, kind, params) {
  const rule = rules.propose(businessId, { kind, params, source: "owner_said" });
  return rules.decide(businessId, rule.id, "keep", { via: "button" });
}

async function expectToolError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ToolError, `ToolError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code);
    assert.ok(typeof err.say === "string" && err.say.length > 0);
    return true;
  });
}

async function negotiate(businessId, need, vendor, language = "hi-IN") {
  const started = await session.startNegotiation({ businessId, requirementId: need.id, vendorId: vendor.id, counterpart: "simulated", language });
  await jobs.whenSettled(started.jobId);
  return { started, neg: repo.getNegotiation(businessId, started.negotiationId), job: repo.getJob(businessId, started.jobId) };
}

/* -------------------------------------------------------------- ceiling --- */

test("a max_price rule of 80 under an owner max of 90: the stricter 80 is the ceiling and the say names the rule", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("hi-IN");
  keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  const ctx = ownerCtx(businessId);
  const need = seedNeed(businessId, { item: "चावल", maxPrice: 90, sessionId: ctx.sessionId });
  seedVendor(businessId, need, { listedPrice: 100 });

  const out = await registry.callTool(ctx, "start_negotiation", {});
  assert.deepEqual(out.ceiling, { price: 80, unit: "kg", byRule: true, ownerMax: 90 });
  assert.match(out.say, /नियम/);
  assert.match(out.say, /80/);
  assert.match(out.say, /90/, "Sahay says the owner's 90 gave way to the rule");
  assert.deepEqual(scriptProblems(out.say, "hi-IN", { allow: ["BS Foods"] }), { latin: [], foreign: false }, out.say);
  await jobs.whenSettled(out.jobId);

  // Listed 100, owner max 90 used to agree at the vendor's floor of 90; under the rule it walks away.
  const neg = repo.getNegotiation(businessId, out.negotiationId);
  assert.equal(neg.status, "walked_away");
  assert.equal(repo.listQuotes(businessId).length, 0, "no quote above the rule's ceiling");
  assert.ok(call.joins >= 2);
});

test("final-2 D: the rule ceiling is on record (job input, negotiation outcome, audit) and every offer and the quote stay under it", async (t) => {
  fakeCall(t);
  const businessId = seedBusiness("hi-IN");
  const rule = keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  const need = seedNeed(businessId, { item: "चावल", maxPrice: 90 });
  // Listed 95: the simulated vendor asks above 80 in every early round.
  const vendor = seedVendor(businessId, need, { listedPrice: 95 });
  const { started, neg, job } = await negotiate(businessId, need, vendor);
  const ceiling = { price: 80, unit: "kg", byRule: true, ownerMax: 90, ruleId: rule.id };
  const begun = repo.listAudit(businessId, { type: "job.started" }).find((row) => row.detail.jobId === job.id);
  assert.deepEqual(begun.detail.input.ceiling, ceiling, "the job.started audit row (in /api/state) says which ceiling applied");
  assert.deepEqual(neg.outcome.ceiling, ceiling, "so does the negotiation's outcome");
  assert.deepEqual(started.ceiling, { price: 80, unit: "kg", byRule: true, ownerMax: 90 });
  const ended = repo.listAudit(businessId, { type: "negotiation.ended" }).at(-1);
  assert.deepEqual(ended.detail.outcome.ceiling, ceiling);
  const asks = neg.transcript.filter((turn) => turn.speaker === "vendor" && turn.offer != null).map((turn) => turn.offer);
  assert.ok(asks.some((ask) => ask > 80), `the vendor asked above the rule (${asks})`);
  const offers = neg.transcript.filter((turn) => turn.speaker === "agent" && turn.offer != null).map((turn) => turn.offer);
  assert.ok(offers.length > 0);
  for (const offer of offers) assert.ok(offer <= 80, `offer ${offer} is above the rule's 80`);
  for (const quote of repo.listQuotes(businessId)) assert.ok(quote.unit_price <= 80);
});

test("a max_price rule of 80 with no owner max: 80 is the ceiling; an owner max under the rule stays", async (t) => {
  fakeCall(t);
  const businessId = seedBusiness("en-IN");
  keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  const need = seedNeed(businessId, { item: "basmati rice", maxPrice: null });
  const vendor = seedVendor(businessId, need, { listedPrice: 100 });
  const { started } = await negotiate(businessId, need, vendor, "en-IN");
  assert.deepEqual(started.ceiling, { price: 80, unit: "kg", byRule: true, ownerMax: null });

  const lower = seedNeed(businessId, { item: "rice", maxPrice: 70 });
  const lowVendor = seedVendor(businessId, lower, { listedPrice: 100 });
  const second = await negotiate(businessId, lower, lowVendor, "en-IN");
  assert.deepEqual(second.started.ceiling, { price: 70, unit: "kg", byRule: false, ownerMax: 70 }, "the rule never raises a stricter owner max");

  const sugar = seedNeed(businessId, { item: "sugar", maxPrice: null });
  const sugarVendor = seedVendor(businessId, sugar, { listedPrice: 60 });
  const third = await negotiate(businessId, sugar, sugarVendor, "en-IN");
  assert.equal(third.started.ceiling.byRule, false, "a rice rule does not touch sugar");
});

test("a max_price rule per kg applies to a requirement in quintals at the same rate", () => {
  const businessId = seedBusiness("en-IN");
  keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  const need = repo.createRequirement(businessId, { item: "rice", quantity: 2, unit: "quintal", city: "Bengaluru" });
  assert.deepEqual(policy.priceLimit(businessId, need), { price: 8000, unit: "quintal", byRule: true, ownerMax: null, ruleId: rules.active(businessId)[0].id });
  const bags = repo.createRequirement(businessId, { item: "rice", quantity: 2, unit: "bag", city: "Bengaluru" });
  assert.equal(policy.priceLimit(businessId, bags).byRule, false, "no exact relation between a bag and a kg: the rule cannot be applied");
});

/* -------------------------------------------------------------- vendors --- */

test("avoid_vendor removes that vendor from get_shortlist and from start_negotiation's default", async (t) => {
  fakeCall(t);
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId);
  const need = seedNeed(businessId, { item: "rice", sessionId: ctx.sessionId });
  const bad = seedVendor(businessId, need, { name: "Ravi Traders", listedPrice: 55, score: 0.9 });
  const good = seedVendor(businessId, need, { name: "BS Foods", listedPrice: 60, score: 0.7 });
  keep(businessId, "avoid_vendor", { name: "ravi traders" });

  const list = await registry.callTool(ctx, "get_shortlist", {});
  assert.deepEqual(list.vendors.map((v) => v.vendorId), [good.id]);
  assert.doesNotMatch(list.say, /Ravi/);

  const out = await registry.callTool(ctx, "start_negotiation", {});
  assert.equal(out.vendorId, good.id);
  await jobs.whenSettled(out.jobId);
  await expectToolError(registry.callTool(ctx, "start_negotiation", { vendorId: bad.id }), "VENDOR_AVOIDED");
});

test("prefer_vendor wins a score tie, and only a tie", () => {
  const businessId = seedBusiness("en-IN");
  const need = seedNeed(businessId, { item: "rice" });
  const a = seedVendor(businessId, need, { name: "Anand Stores", listedPrice: 60, score: 0.8 });
  const b = seedVendor(businessId, need, { name: "Zeal Foods", listedPrice: 60, score: 0.8 });
  const c = seedVendor(businessId, need, { name: "Best Mills", listedPrice: 60, score: 0.95 });
  const all = repo.listVendors(businessId, { requirement_id: need.id });
  assert.deepEqual(rankVendors(all, need).map((v) => v.id), [c.id, a.id, b.id]);
  keep(businessId, "prefer_vendor", { name: "Zeal Foods" });
  assert.deepEqual(policy.rankedVendors(businessId, need).map((v) => v.id), [c.id, b.id, a.id], "Zeal beats its tie, not a better score");
});

/* --------------------------------------------------------- bargain style --- */

test("bargain style gentle / balanced / tough sets beta 1 / 2 / 3 within the same ceiling", async (t) => {
  fakeCall(t);
  const seen = {};
  for (const style of ["gentle", "balanced", "tough"]) {
    const businessId = seedBusiness("en-IN");
    profile.update(businessId, { bargain_style: style });
    assert.equal(policy.beta(businessId), { gentle: 1, balanced: 2, tough: 3 }[style]);
    const need = seedNeed(businessId, { item: "rice", maxPrice: 90 });
    const vendor = seedVendor(businessId, need, { listedPrice: 60 });
    const { started, job } = await negotiate(businessId, need, vendor, "en-IN");
    assert.equal(started.ceiling.price, 90);
    seen[style] = job.progress.find((p) => /^Round 2:/.test(p.message))?.message;
  }
  const offer = (line) => Number(/Sahay (?:offers|agrees at) ([\d.]+)/.exec(line)[1]);
  assert.ok(offer(seen.gentle) > offer(seen.balanced) && offer(seen.balanced) > offer(seen.tough), JSON.stringify(seen));

  // An active bargain_style rule wins over the profile.
  const businessId = seedBusiness("en-IN");
  profile.update(businessId, { bargain_style: "gentle" });
  keep(businessId, "bargain_style", { style: "tough" });
  assert.equal(policy.beta(businessId), 3);
});

/* -------------------------------------------------------------- teaching --- */

test("teach_rule: the server speaks the rule sentence itself (APPEND, not interruptable), records it and asks", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  const seen = [];
  const stop = events.subscribe(businessId, (e) => seen.push(e));
  const out = await registry.callTool(ctx, "teach_rule", { kind: "max_price", item: "चावल", unit: "किलो", price: 80 });
  stop();
  const rule = rules.get(businessId, out.ruleId);
  assert.equal(rule.status, "suggested");
  assert.equal(rule.source, "owner_said");
  assert.deepEqual(call.spoken, [rule.sentence["hi-IN"]]);
  assert.equal(call.speakBodies[0].priority, "APPEND");
  assert.equal(call.speakBodies[0].interruptable, false);
  assert.equal(out.say, "यह नियम रख लूँ?");
  assert.equal(out.readbackSpoken, true);
  assert.deepEqual(repo.listRuleReadbacks(businessId).map((r) => [r.rule_id, r.agent_id]), [[rule.id, "AGT"]]);
  assert.deepEqual(seen.map((e) => e.type), ["rule.suggested", "rule.spoken"]);
  assert.deepEqual(seen[1].data, { ruleId: rule.id });

  await expectToolError(registry.callTool(ctx, "teach_rule", { kind: "max_price", item: "चावल", unit: "kg", price: -1 }), "INVALID_ARGUMENTS");
  await expectToolError(registry.callTool(ctx, "teach_rule", { kind: "max_price", item: "चावल", unit: "kg" }), "INVALID_RULE");
});

test("confirm_rule keeps the rule on a spoken yes after the read-back; a yes before it, or typed, never does", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  call.owner("हाँ");
  const out = await registry.callTool(ctx, "teach_rule", { kind: "avoid_vendor", name: "Ravi Traders" });
  await expectToolError(registry.callTool(ctx, "confirm_rule", { decision: "keep" }), "NO_ANSWER_YET");
  call.typed("हाँ");
  await expectToolError(registry.callTool(ctx, "confirm_rule", { decision: "keep" }), "NO_ANSWER_YET");
  assert.equal(rules.get(businessId, out.ruleId).status, "suggested", "a typed yes never keeps a rule");

  // Another call's agent never spoke it.
  call.owner("हाँ जी");
  await expectToolError(registry.callTool({ ...ctx, agentId: "AGX" }, "confirm_rule", { decision: "keep" }), "NO_SPOKEN_RULE");
  await expectToolError(registry.callTool({ ...ctx, agentId: null }, "confirm_rule", { decision: "keep" }), "NO_VOICE_EVIDENCE");

  const kept = await registry.callTool(ctx, "confirm_rule", { decision: "keep" });
  assert.equal(kept.status, "active");
  assert.equal(kept.ruleId, out.ruleId);
  assert.equal(kept.say, "ठीक है, यह नियम याद रखूँगी।");
  assert.equal(rules.get(businessId, out.ruleId).status, "active");
});

test("confirm_rule: a maybe is not a yes; a no forgets the suggestion", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  const out = await registry.callTool(ctx, "teach_rule", { kind: "bargain_style", style: "tough" });
  call.owner("maybe later");
  await expectToolError(registry.callTool(ctx, "confirm_rule", { decision: "keep" }), "NOT_AFFIRMATIVE");
  call.owner("no");
  const forgot = await registry.callTool(ctx, "confirm_rule", { decision: "forget" });
  assert.equal(forgot.status, "off");
  assert.equal(rules.get(businessId, out.ruleId).status, "off");
});

test("the database refuses a voice keep with no read-back spoken (below the application code)", () => {
  const businessId = seedBusiness("en-IN");
  const rule = rules.propose(businessId, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  assert.throws(() => repo.transitionRule(businessId, rule.id, "suggested", "active", { decided_via: "voice" }), /spoken by the server/);
  assert.equal(rules.get(businessId, rule.id).status, "suggested");
});

test("forget_rule turns an active rule off by what it is about, with the owner's own words", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  const rice = keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  keep(businessId, "max_price", { item: "sugar", unit: "kg", price: 40 });
  call.owner("forget the rice rule");
  const out = await registry.callTool(ctx, "forget_rule", { kind: "max_price", item: "Rice" });
  assert.equal(out.ruleId, rice.id);
  assert.equal(out.status, "off");
  assert.deepEqual(rules.active(businessId).map((r) => r.params.item), ["sugar"]);
  await expectToolError(registry.callTool(ctx, "forget_rule", { kind: "avoid_vendor", name: "Nobody" }), "RULE_NOT_FOUND");
});

test("get_my_agent says the active rules in the owner's language", async () => {
  const businessId = seedBusiness("kn-IN");
  const ctx = ownerCtx(businessId);
  const empty = await registry.callTool(ctx, "get_my_agent", {});
  assert.deepEqual(empty.rules, []);
  assert.deepEqual(scriptProblems(empty.say, "kn-IN"), { latin: [], foreign: false }, empty.say);
  const rule = keep(businessId, "bargain_style", { style: "gentle" });
  const out = await registry.callTool(ctx, "get_my_agent", {});
  assert.equal(out.profile.bargain_style, "balanced");
  assert.deepEqual(out.rules.map((r) => r.id), [rule.id]);
  assert.ok(out.say.includes(rule.sentence["kn-IN"]), out.say);
});

/* ----------------------------------------------------- usual quantity --- */

test("usual_quantity fills a missing quantity only after the server read it out and the owner said yes", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("hi-IN");
  keep(businessId, "usual_quantity", { item: "चावल", quantity: 200, unit: "kg" });
  const ctx = ownerCtx(businessId, { agentId: "AGT" });

  call.owner("चावल चाहिए");
  const first = await registry.callTool(ctx, "save_requirement", { item: "चावल", owner_words: "चावल चाहिए" });
  assert.ok(first.missing.includes("quantity"));
  assert.deepEqual(first.usualQuantity, { quantity: 200, unit: "kg" });
  assert.equal(repo.getRequirement(businessId, first.requirementId).quantity, null, "nothing is filled yet");
  assert.match(call.spoken.at(-1), /200/, "the server itself asked about the usual quantity");

  // The model claims the yes before the owner said it: nothing is filled.
  await expectToolError(registry.callTool(ctx, "save_requirement", { use_usual_quantity: true }), "NO_ANSWER_YET");
  call.typed("हाँ");
  await expectToolError(registry.callTool(ctx, "save_requirement", { use_usual_quantity: true }), "NO_ANSWER_YET");
  assert.equal(repo.getRequirement(businessId, first.requirementId).quantity, null);

  call.owner("हाँ जी");
  const filled = await registry.callTool(ctx, "save_requirement", { use_usual_quantity: true });
  const need = repo.getRequirement(businessId, filled.requirementId);
  assert.equal(need.quantity, 200);
  assert.equal(need.unit, "kg");
});

/* ----------------------------------------------- the gate is untouched --- */

test("a rule can never reach create_order or confirm_approval", async (t) => {
  const call = fakeCall(t);
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, { agentId: "AGT" });
  keep(businessId, "max_price", { item: "rice", unit: "kg", price: 80 });
  await registry.callTool(ctx, "teach_rule", { kind: "prefer_vendor", name: "BS Foods" });
  call.owner("yes");
  await registry.callTool(ctx, "confirm_rule", { decision: "keep" });

  // Only rules exist: there is nothing to approve or order.
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  await expectToolError(registry.callTool(ctx, "create_order", {}), "NOT_APPROVED");
  assert.equal(repo.listOrders(businessId).length, 0);

  // A deal read out, then a rule read out: the owner's yes answers the rule, not the deal.
  const need = seedNeed(businessId, { item: "rice", quantity: 50, sessionId: ctx.sessionId });
  const vendor = seedVendor(businessId, need, { listedPrice: 65 });
  const neg = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "human" });
  const quote = repo.createQuote(businessId, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 62, unit: "kg", freight: 0, landed_cost: 3100 });
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  await registry.callTool(ctx, "teach_rule", { kind: "bargain_style", style: "tough" });
  call.owner("yes");
  await expectToolError(registry.callTool(ctx, "confirm_approval", { decision: "approve" }), "READBACK_SUPERSEDED");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");
  // And a deal read out after the rule: the yes answers the deal, never the rule.
  await registry.callTool(ctx, "request_approval", { quoteId: quote.id, repeat: true });
  call.owner("yes");
  await expectToolError(registry.callTool(ctx, "confirm_rule", { decision: "keep" }), "READBACK_SUPERSEDED");
  assert.equal(approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "voice", agentId: "AGT", history: call.items.slice() }).status, "approved");
});

/* ------------------------------------------------------------- the prompt --- */

test("the owner agent's prompt lists the active rules as structured data and explains teaching", () => {
  const businessId = seedBusiness("hi-IN");
  keep(businessId, "max_price", { item: "चावल", unit: "kg", price: 80 });
  keep(businessId, "avoid_vendor", { name: "Ravi Traders" });
  rules.propose(businessId, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" }); // only suggested
  const prompt = agent.systemPrompt(repo.getBusiness(businessId), { rules: rules.active(businessId) });
  assert.match(prompt, /teach_rule/);
  assert.match(prompt, /confirm_rule/);
  assert.match(prompt, /"kind":"max_price".*"price":80/);
  assert.match(prompt, /"kind":"avoid_vendor".*"name":"Ravi Traders"/);
  assert.doesNotMatch(prompt, /"style":"tough"/, "a suggestion is not a rule yet");
  assert.match(agent.systemPrompt(repo.getBusiness(businessId), { rules: [] }), /No rules yet/);
});

test("a rule kept during a call re-sends the agent's prompt with the rule, keeping its call status", async (t) => {
  const updates = [];
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.endsWith("/join")) return new Response(JSON.stringify({ agent_id: "AGP", status: "RUNNING" }), { status: 200 });
    if (url.endsWith("/update")) updates.push(body.properties.llm.system_messages);
    return new Response("{}", { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  const narrator = require("../src/agora/narrator");
  const businessId = seedBusiness("en-IN");
  const s = repo.createSession(businessId, { kind: "owner", channel: "own-rp1", status: "active" });
  const started = await agent.startOwnerAgent({ businessId, sessionId: s.id, channel: "own-rp1", agentUid: 1001, userUid: 1002 });
  await agent.updateCallStatus(started.agentId, "A vendor search is running now.");

  narrator.start();
  narrator.attach(businessId, { agentId: started.agentId, sessionId: s.id, language: "en-IN" });
  t.after(() => narrator.detach(businessId));
  keep(businessId, "avoid_vendor", { name: "Ravi Traders" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const last = updates.at(-1);
  assert.match(last[0].content, /"kind":"avoid_vendor","name":"Ravi Traders"/);
  assert.match(last[1].content, /A vendor search is running now\./, "the call status survives the prompt update");
  await assert.rejects(agent.refreshRules(started.agentId, seedBusiness("en-IN")), (err) => err.code === "AGENT_UNKNOWN", "another business cannot rewrite this call's prompt");
});

test("a reply_language rule fixes the language of every tool's say, whatever reply_language the model passes", async () => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId);
  keep(businessId, "reply_language", { language: "kn-IN" });
  const out = await registry.callTool(ctx, "get_my_agent", { reply_language: "en-IN" });
  assert.ok(out.say.includes(rules.active(businessId)[0].sentence["kn-IN"]), out.say);
});
