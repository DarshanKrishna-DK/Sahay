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
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const session = require("../src/negotiation/session");
const vendorAgent = require("../src/negotiation/vendor-agent");
const registry = require("../src/tools/registry");
const { ToolError } = require("../src/tools/errors");
const agent = require("../src/agora/agent");
const auth = require("../src/auth");
const repo = require("../src/db/repo");
const events = require("../src/events");
const jobs = require("../src/jobs");

session.configureTiming({ pollMs: 5, stallMs: 40, closingGraceMs: 5, msPerChar: 0, minLineMs: 1, humanJoinMs: 5000, maxMs: 5000 });

const realFetch = globalThis.fetch;

/** Fake Agora REST. history() answers from `historyFor(agentId)`. */
function fakeAgora(t, { historyFor = () => [] } = {}) {
  const calls = [];
  let n = 0;
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/join")) {
      n += 1;
      return new Response(JSON.stringify({ agent_id: `${body.properties.labels.role}-${n}`, status: "RUNNING" }), { status: 200 });
    }
    const history = /\/agents\/([^/]+)\/history$/.exec(url);
    if (history) return new Response(JSON.stringify({ contents: historyFor(history[1]) }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return calls;
}

/** Fake Groq for quote extraction. */
function fakeGroq(t, fields) {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/api\.groq\.com\//);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) }, finish_reason: "stop" }] }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
}

/** 100 kg basmati, owner max 70/kg; a listed vendor at 65/kg. */
function seed({ language = "hi-IN", listedPrice = 65, maxPrice = 70 } = {}) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Kirana", city: "Bengaluru", language });
  const requirement = repo.createRequirement(businessId, { item: "basmati rice", quantity: 100, unit: "kg", city: "Bengaluru", max_price: maxPrice });
  const vendor = repo.createVendor(businessId, {
    requirement_id: requirement.id,
    source: "indiamart",
    name: "Lakshmi Traders",
    listed_price: listedPrice,
    listed_unit: listedPrice == null ? null : "kg",
  });
  return { businessId, requirement, vendor };
}

async function until(predicate, ms = 3000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/* -------------------------------------------------------------- refusals --- */

test("a simulated vendor needs a real listed price to be based on; no price is invented", async () => {
  const { businessId, requirement, vendor } = seed({ listedPrice: null });
  await assert.rejects(
    session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" }),
    (err) => err instanceof ToolError && err.code === "NO_LISTED_PRICE" && /लिस्टिंग/.test(err.say),
  );
});

test("without an owner maximum or a listed price there is no ceiling, so the agent must ask", async () => {
  const { businessId, requirement, vendor } = seed({ listedPrice: null, maxPrice: null });
  await assert.rejects(
    session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "human", language: "en-IN" }),
    (err) => err.code === "MAX_PRICE_NEEDED" && err.say === "Before I negotiate, what is the most you will pay per unit?",
  );
});

test("a vendor of another business is not found", async () => {
  const a = seed();
  const b = seed();
  await assert.rejects(
    session.startNegotiation({ businessId: b.businessId, requirementId: b.requirement.id, vendorId: a.vendor.id, counterpart: "simulated", language: "hi-IN" }),
    (err) => err.code === "NOT_FOUND",
  );
});

/* ------------------------------------------------- simulated, fallback loop --- */

test("simulated run: agents that cannot hear each other fall back to the server loop and record an honest, labelled quote", async (t) => {
  const calls = fakeAgora(t); // /history never shows a vendor turn -> stall -> loop
  const { businessId, requirement, vendor } = seed({ language: "hi-IN" });
  const seen = [];
  const stop = events.subscribe(businessId, (e) => seen.push(e));

  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" });
  assert.match(started.jobId, /^job_/);
  assert.equal(started.joinUrl, undefined);
  await jobs.whenSettled(started.jobId);
  stop();

  const job = repo.getJob(businessId, started.jobId);
  assert.equal(job.status, "done", job.error);
  assert.ok(job.progress.some((p) => /switching to the server-driven negotiation/.test(p.message)));

  // Both agents joined in the negotiation channel, each listening to the other.
  const joins = calls.filter((c) => c.url.endsWith("/join"));
  assert.equal(joins.length, 2);
  const [negotiator, simulated] = joins.map((c) => c.body.properties);
  assert.deepEqual(negotiator.remote_rtc_uids, [String(session.UIDS.vendor)]);
  assert.deepEqual(simulated.remote_rtc_uids, [String(session.UIDS.negotiator)]);
  assert.equal(negotiator.channel, simulated.channel);
  assert.deepEqual(negotiator.llm.mcp_servers[0].allowed_tools, ["get_negotiation_brief", "record_vendor_offer"]);
  assert.equal(simulated.llm.mcp_servers, undefined, "the simulated vendor has no tools");
  assert.equal(simulated.tts.params.voiceId, vendorAgent.VENDOR_VOICE_ID);
  assert.notEqual(simulated.tts.params.voiceId, negotiator.tts.params.voiceId);
  assert.match(simulated.llm.system_messages[0].content, /SIMULATED vendor/);
  const bearer = negotiator.llm.mcp_servers[0].headers.Authorization.slice(7);
  const negSession = repo.getSession(businessId, auth.verifySession(bearer, { scope: "mcp" }).sessionId);
  assert.equal(negSession.kind, "negotiation");
  assert.equal(negSession.status, "ended");

  // Disclosure first, not interruptable; the simulated vendor introduces itself as simulated.
  const speaks = calls.filter((c) => c.url.endsWith("/speak"));
  assert.match(speaks[0].body.text, /स्वचालित सहायक/);
  assert.equal(speaks[0].body.interruptable, false);
  assert.ok(speaks.some((s) => s.body.text.includes("सिम्युलेटेड विक्रेता")));
  assert.equal(speaks.filter((s) => s.body.text.includes("स्वचालित सहायक")).length, 1, "disclosure spoken once, not again after the fallback");
  assert.ok(calls.filter((c) => c.url.endsWith("/leave")).length === 2, "both agents stopped");

  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.simulated, true);
  assert.ok(neg.transcript.length >= 6);
  assert.ok(neg.transcript.every((turn) => turn.simulated === true), "every stored turn is labelled simulated");

  const quotes = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quotes.length, 1);
  const quote = quotes[0];
  assert.equal(quote.simulated, true);
  assert.equal(quote.unit, "kg");
  assert.ok(quote.unit_price <= 65, "never above the reservation (min of owner max 70 and listed 65)");
  assert.ok(quote.unit_price >= vendorAgent.vendorPolicy(65).floor, "never below the simulated floor");
  assert.equal(quote.freight, null, "no freight figure is invented");
  assert.equal(quote.landed_cost, null);
  assert.ok(neg.transcript.some((turn) => turn.speaker === "vendor" && turn.text === quote.quoted_sentence));

  const turnEvents = seen.filter((e) => e.type === "negotiation.turn");
  assert.ok(turnEvents.some((e) => e.actor === "vendor" && e.data.speaker === "vendor"));
  assert.ok(turnEvents.every((e) => e.data.simulated === true));
  const ended = seen.find((e) => e.type === "negotiation.ended");
  assert.equal(ended.data.status, "agreed");
  assert.equal(ended.data.outcome.unitPrice, quote.unit_price);
  assert.equal(ended.data.outcome.mode, "loop");
  assert.ok(seen.some((e) => e.type === "quote.recorded"));

  // The quote passes the approval gate's consistency checks.
  const { requestApproval } = require("../src/approvals");
  const { approval } = requestApproval(businessId, quote.id);
  assert.match(approval.readback, /सिम्युलेटेड वेंडर/);
});

/* -------------------------------------------- human, agents mode with tools --- */

async function humanRun(t, { extracted }) {
  const history = [];
  const calls = fakeAgora(t, { historyFor: () => history });
  fakeGroq(t, extracted);
  const { businessId, requirement, vendor } = seed({ language: "hi-IN" });
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "human", language: "hi-IN" });
  assert.match(started.joinUrl, /^https:\/\/sahay\.test\/vendor\/[A-Za-z0-9_-]+$/);
  const code = started.joinUrl.split("/").pop();

  const info = session.humanJoinInfo(code);
  assert.equal(info.uid, session.UIDS.human);
  assert.match(info.token, /^007/);
  assert.match(info.disclosure, /स्वचालित सहायक/);
  assert.equal(session.humanJoinInfo("wrong-code"), null);

  await until(() => repo.listSessions(businessId, { kind: "negotiation" })[0]?.agent_id);
  const negSession = repo.listSessions(businessId, { kind: "negotiation" })[0];
  const ctx = { businessId, sessionId: negSession.id, agentId: negSession.agent_id, actor: "agent", toolScope: "negotiation" };

  assert.equal(await session.humanJoined(code), true);
  assert.ok(calls.some((c) => c.url.endsWith("/think")), "negotiator told to begin");

  const brief = await registry.callTool(ctx, "get_negotiation_brief", {});
  assert.equal(brief.say, "हमें 100 किलो basmati rice चाहिए, Bengaluru में डिलीवरी; आपका सबसे अच्छा भाव प्रति किलो क्या होगा?");
  history.push({ role: "assistant", content: brief.say, metadata: { source: "llm" }, timestamp: Date.now(), turn_id: 1 });
  history.push({ role: "user", content: "भाई 64 रुपये किलो लगेगा", metadata: { source: "asr" }, timestamp: Date.now(), turn_id: 2 });

  const clarify = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 1500, unit: "bag" });
  assert.equal(clarify.action, "clarify");
  assert.equal(clarify.say, "कृपया प्रति किलो का भाव बताइए।");

  const counter = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 64, unit: "kg" });
  assert.equal(counter.action, "counter");
  assert.ok(counter.price < 64 && counter.price <= 65);
  assert.equal(counter.say, `हम ${counter.price} रुपये प्रति किलो दे सकते हैं, क्या इस पर बात बनेगी?`);
  history.push({ role: "assistant", content: counter.say, metadata: { source: "llm" }, timestamp: Date.now(), turn_id: 3 });
  history.push({ role: "user", content: "ठीक है, 55 रुपये किलो दे दूँगा", metadata: { source: "asr" }, timestamp: Date.now(), turn_id: 4 });

  const accept = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 55, vendor_sentence: "ठीक है, 55 रुपये किलो दे दूँगा" });
  assert.equal(accept.action, "accept");
  assert.equal(accept.price, 55);
  history.push({ role: "assistant", content: accept.say, metadata: { source: "llm" }, timestamp: Date.now() + 1, turn_id: 5 });

  const jobId = repo.listJobs(businessId, { kind: "negotiation" })[0].id;
  await jobs.whenSettled(jobId);
  return { businessId, requirement, started, jobId };
}

test("human run (agents mode): tools give every price, the transcript backs the quote, quote recorded", async (t) => {
  const { businessId, requirement, started, jobId } = await humanRun(t, {
    extracted: { unit_price: 55, unit: "kg", quoted_sentence: "ठीक है, 55 रुपये किलो दे दूँगा", confidence: 0.9, freight: null, lead_time_days: null, moq: null, payment_terms: null },
  });
  assert.equal(repo.getJob(businessId, jobId).status, "done");
  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.simulated, false);
  assert.ok(neg.transcript.some((turn) => turn.speaker === "vendor" && turn.text.includes("64")));
  assert.ok(neg.transcript.some((turn) => turn.speaker === "agent" && turn.offer != null), "agent turns carry the offer computed in code");
  const [quote] = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quote.unit_price, 55);
  assert.equal(quote.simulated, false);
  assert.equal(quote.confidence, 0.9);
});

test("human run: an extracted price that differs from the price agreed in code is not recorded", async (t) => {
  const { businessId, requirement, started } = await humanRun(t, {
    extracted: { unit_price: 45, unit: "kg", quoted_sentence: "ठीक है, 55 रुपये किलो दे दूँगा", confidence: 0.9 },
  });
  assert.equal(repo.listQuotes(businessId, { requirement_id: requirement.id }).length, 0);
  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "no_deal");
  assert.equal(neg.outcome.reason, "price_differs_from_agreed");
});

test("human run: a quoted sentence the vendor never said is not recorded", async (t) => {
  const { businessId, requirement, started } = await humanRun(t, {
    extracted: { unit_price: 55, unit: "kg", quoted_sentence: "मैं 55 में फ्री डिलीवरी दूँगा", confidence: 0.9 },
  });
  assert.equal(repo.listQuotes(businessId, { requirement_id: requirement.id }).length, 0);
  assert.equal(repo.getNegotiation(businessId, started.negotiationId).outcome.reason, "quoted_sentence_not_in_transcript");
});

test("negotiation tools refuse a ctx with no running negotiation, and one negotiation runs per business", async (t) => {
  fakeAgora(t);
  const { businessId, requirement, vendor } = seed();
  const s = repo.createSession(businessId, { kind: "negotiation", channel: "neg-x", status: "active" });
  await assert.rejects(registry.callTool({ businessId, sessionId: s.id, toolScope: "negotiation" }, "get_negotiation_brief", {}), (err) => err.code === "NEGOTIATION_NOT_RUNNING");

  const first = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "human", language: "en-IN" });
  await assert.rejects(
    session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "en-IN" }),
    (err) => err.code === "NEGOTIATION_BUSY",
  );
  const listen = session.listenerToken(businessId, first.negotiationId);
  assert.equal(listen.uid, session.UIDS.listener);
  assert.equal(session.listenerToken("biz_other", first.negotiationId), null);
  await session.stopAll();
  assert.equal(repo.getJob(businessId, first.jobId).status, "cancelled");
});

test("saidByVendor matches vendor words only, ignoring punctuation and spacing", () => {
  const turns = [
    { speaker: "agent", text: "हम 55 रुपये देंगे" },
    { speaker: "vendor", text: "ठीक है,  55 रुपये किलो दे दूँगा।" },
  ];
  assert.equal(session.saidByVendor("ठीक है, 55 रुपये किलो दे दूँगा", turns), true);
  assert.equal(session.saidByVendor("हम 55 रुपये देंगे", turns), false, "the agent's words are not the vendor's");
  assert.equal(session.saidByVendor("55", turns), false, "too short to prove anything");
});

test("vendor prompt carries the computed schedule and floor, and forbids other numbers", () => {
  const policy = vendorAgent.vendorPolicy(65);
  const schedule = vendorAgent.askSchedule(policy, 5);
  assert.equal(schedule[0], policy.anchor);
  assert.ok(schedule.every((p, i) => i === 0 || p <= schedule[i - 1]));
  const prompt = vendorAgent.vendorPrompt({ language: "hi-IN", item: "rice", quantity: 100, unit: "kg", unitSpoken: "किलो", schedule, floor: policy.floor });
  assert.match(prompt, /SIMULATED vendor/);
  assert.ok(prompt.includes(`${policy.floor}`));
  assert.match(prompt, /Never mention any other number/);
  assert.match(vendorAgent.introText("kn-IN"), /ಸಿಮ್ಯುಲೇಟೆಡ್/);
});
