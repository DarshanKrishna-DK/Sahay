"use strict";

const { FAKE } = require("./_env");

// Opt-in mode: two Agora agents hear each other; the negotiator prices every turn through tools.
Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  GROQ_API_KEY: FAKE.GROQ_API_KEY,
  NEGOTIATION_MODE: "agents",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const session = require("../src/negotiation/session");
const vendorAgent = require("../src/negotiation/vendor-agent");
const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const auth = require("../src/auth");
const repo = require("../src/db/repo");
const events = require("../src/events");
const jobs = require("../src/jobs");

const FAST = { pollMs: 5, stallMs: 40, turnStallMs: 40, closingGraceMs: 5, msPerChar: 0, minLineMs: 1, humanJoinMs: 5000, humanTurnStallMs: 5000, maxMs: 5000 };
session.configureTiming(FAST);

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

/** Fake Groq. `fields` is returned as the model's JSON, or `fields` is an Error to fail the call. */
function fakeGroq(t, fields) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.groq\.com\//);
    seen.push(JSON.parse(init.body));
    if (fields instanceof Error) return new Response(JSON.stringify({ error: { message: fields.message } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) }, finish_reason: "stop" }] }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return seen;
}

function noModel(t) {
  globalThis.fetch = async (url) => {
    throw new Error(`unexpected model call: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
}

function seed({ language = "hi-IN", listedPrice = 60, maxPrice = 90 } = {}) {
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

async function until(predicate, ms = 20000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let turnId = 0;
const said = (history, role, content) =>
  history.push({ role, content, metadata: { source: role === "user" ? "asr" : "llm" }, timestamp: Date.now(), turn_id: ++turnId });

/** Start a simulated agents-mode run and return the negotiator's tool ctx once the model was told to begin. */
async function startSimulated(t, { history = [], seedOpts } = {}) {
  const calls = fakeAgora(t, { historyFor: (id) => (id.startsWith("negotiator") ? history : []) });
  const { businessId, requirement, vendor } = seed(seedOpts);
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" });
  await until(() => calls.some((c) => c.url.endsWith("/think")));
  const negSession = repo.listSessions(businessId, { kind: "negotiation" })[0];
  const ctx = { businessId, sessionId: negSession.id, agentId: negSession.agent_id, actor: "agent", toolScope: "negotiation" };
  return { calls, businessId, requirement, vendor, started, ctx, history };
}

/* ------------------------------------------------------ simulated, agents --- */

test("simulated agents that cannot hear each other fall back to the loop and record an honest, labelled quote", async (t) => {
  noModel(t);
  const { calls, businessId, requirement, started } = await startSimulated(t);
  await jobs.whenSettled(started.jobId);

  const job = repo.getJob(businessId, started.jobId);
  assert.equal(job.status, "done", job.error);
  assert.ok(job.progress.some((p) => /could not hear each other; switching to the server-driven negotiation/.test(p.message)));

  // First the two listening agents, each hearing the other; then two fresh loop agents hearing nobody.
  const joins = calls.filter((c) => c.url.endsWith("/join")).map((c) => c.body.properties);
  assert.equal(joins.length, 4);
  assert.deepEqual(joins[0].remote_rtc_uids, [String(session.UIDS.vendor)]);
  assert.deepEqual(joins[1].remote_rtc_uids, [String(session.UIDS.negotiator)]);
  assert.equal(joins[0].channel, joins[1].channel);
  assert.deepEqual(joins[0].llm.mcp_servers[0].allowed_tools, ["get_negotiation_brief", "record_vendor_offer"]);
  assert.equal(joins[1].llm.mcp_servers, undefined, "the simulated vendor has no tools");
  assert.equal(joins[1].tts.params.voiceId, vendorAgent.VENDOR_VOICE_ID);
  assert.match(joins[1].llm.system_messages[0].content, /SIMULATED vendor/);
  for (const p of joins.slice(2)) assert.deepEqual(p.remote_rtc_uids, [String(session.UIDS.nobody)]);
  assert.equal(calls.filter((c) => c.url.endsWith("/leave")).length, 4, "all four agents stopped");
  const bearer = joins[0].llm.mcp_servers[0].headers.Authorization.slice(7);
  assert.equal(repo.getSession(businessId, auth.verifySession(bearer, { scope: "mcp" }).sessionId).status, "ended");

  const speaks = calls.filter((c) => c.url.endsWith("/speak"));
  assert.match(speaks[0].body.text, /स्वचालित सहायक/);
  assert.equal(speaks[0].body.interruptable, false);
  assert.equal(speaks.filter((s) => s.body.text.includes("स्वचालित सहायक")).length, 1, "disclosure spoken once, not again after the fallback");

  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.outcome.mode, "loop");
  const [quote] = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quote.unit_price, 55);
  assert.equal(quote.simulated, true);
});

test("a per-turn stall after the first vendor turn hands over to the loop at the same round and offer (E2E r2: 4 m 53 s gap)", async (t) => {
  noModel(t);
  session.configureTiming({ stallMs: 10000, turnStallMs: 60 });
  t.after(() => session.configureTiming(FAST));
  const { calls, businessId, requirement, started, ctx, history } = await startSimulated(t);

  const brief = await registry.callTool(ctx, "get_negotiation_brief", {});
  const counter = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 65, vendor_sentence: "65 रुपये प्रति किलो लगेगा।" });
  assert.equal(counter.action, "counter");
  assert.equal(counter.price, 51);
  // The turns reach /history together (so a slow test machine cannot stall before round 1 is in)...
  said(history, "assistant", brief.say);
  said(history, "user", "65 रुपये प्रति किलो लगेगा।");
  said(history, "assistant", counter.say);
  // ...and then nobody speaks again.
  await jobs.whenSettled(started.jobId);

  const job = repo.getJob(businessId, started.jobId);
  assert.equal(job.status, "done", job.error);
  const handover = job.progress.find((p) => /The agents went quiet \(no new turn for \d+ s after round 2\); switching to the server-driven negotiation from round 2\./.test(p.message));
  assert.ok(handover, "the handover is a progress line");
  assert.deepEqual(handover.data.lastHeard.negotiator.map((i) => i.text), ["65 रुपये प्रति किलो लगेगा।", counter.say], "what each agent last heard is kept for diagnosis");
  assert.deepEqual(handover.data.lastHeard.vendor, []);
  assert.equal(calls.filter((c) => c.url.endsWith("/leave")).length, 4, "the listening agents were stopped before the loop spoke");

  const neg = repo.getNegotiation(businessId, started.negotiationId);
  const priced = neg.transcript.filter((turn) => turn.offer != null).map((turn) => `${turn.speaker}:${turn.offer}`);
  assert.deepEqual(priced, ["agent:51", "vendor:61", "agent:52", "vendor:57", "agent:55", "vendor:55", "agent:55"], "continues with the round-2 ask, not from the anchor");
  assert.equal(neg.transcript.filter((turn) => turn.text === brief.say).length, 1, "the opening is not repeated");
  assert.equal(repo.listQuotes(businessId, { requirement_id: requirement.id })[0].unit_price, 55);

  // A late tool call from the stopped negotiator would change nothing (the runtime is gone by now).
  await assert.rejects(registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 40 }), (err) => err.code === "NEGOTIATION_NOT_RUNNING");
});

test("simulated vendor: an early 'final', a misheard price and a repeated tool call cannot burn rounds or end the deal", async (t) => {
  noModel(t);
  session.configureTiming({ stallMs: 5000, turnStallMs: 5000 });
  t.after(() => session.configureTiming(FAST));
  const { businessId, requirement, started, ctx, history } = await startSimulated(t);
  const record = (args) => registry.callTool(ctx, "record_vendor_offer", args);

  await registry.callTool(ctx, "get_negotiation_brief", {});
  // E2E r2: the vendor model called its round-1 ask final; it is not believed, the buyer counters.
  said(history, "user", "65 रुपये, यह मेरा आख़िरी भाव है।");
  const r1 = await record({ price_per_unit: 65, is_final: true, vendor_sentence: "65 रुपये, यह मेरा आख़िरी भाव है।" });
  assert.deepEqual([r1.action, r1.price, r1.round], ["counter", 51, 1]);
  // The same sentence recorded twice is the same turn: same answer, no round spent.
  const again = await record({ price_per_unit: 65, is_final: true, vendor_sentence: "65 रुपये, यह मेरा आख़िरी भाव है।" });
  assert.deepEqual(again, r1);

  // "इकसठ" heard as 13: never a price this simulated vendor could say, so ask again, no round spent.
  const misheard = await record({ price_per_unit: 13, vendor_sentence: "तेरह रुपये" });
  assert.equal(misheard.action, "clarify");
  assert.equal(misheard.say, "माफ़ कीजिए, भाव साफ़ सुनाई नहीं दिया; प्रति किलो का भाव फिर से बताइए।");

  said(history, "user", "61 रुपये प्रति किलो।");
  const r2 = await record({ price_per_unit: 61, vendor_sentence: "61 रुपये प्रति किलो।" });
  assert.deepEqual([r2.action, r2.price, r2.round], ["counter", 52, 2]);
  said(history, "user", "57 रुपये प्रति किलो।");
  const r3 = await record({ price_per_unit: 57, vendor_sentence: "57 रुपये प्रति किलो।" });
  assert.deepEqual([r3.action, r3.price, r3.round], ["counter", 55, 3]);
  said(history, "user", "ठीक है, पचपन रुपये किलो में दे देंगे।");
  const accept = await record({ price_per_unit: 55, vendor_sentence: "ok 55" });
  assert.deepEqual([accept.action, accept.price, accept.round], ["accept", 55, 4]);
  // review #3: the negotiator never accepts a rate for the owner; it promises to confirm with them.
  assert.equal(accept.say, "ठीक है, 55 रुपये प्रति किलो पर मैं मालिक से पक्का करके ऑर्डर भेजूँगी, धन्यवाद।");
  assert.doesNotMatch(accept.say, /बात पक्की|मंज़ूर/);
  said(history, "assistant", accept.say);
  await jobs.whenSettled(started.jobId);

  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.outcome.mode, "agents");
  const [quote] = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quote.unit_price, 55, "the price agreed in code, though the vendor said it in words");
  assert.equal(quote.quoted_sentence, "ठीक है, पचपन रुपये किलो में दे देंगे।", "the vendor's own heard words, not the model's copy");
  assert.equal(quote.confidence, 1);

  const progress = repo.getJob(businessId, started.jobId).progress.map((p) => p.message);
  assert.ok(progress.includes("Round 1: simulated vendor asks 65 per kg; Sahay offers 51."));
  assert.ok(progress.includes("Round 4: simulated vendor asks 55 per kg; Sahay agrees at 55, pending the owner's approval."));
  assert.ok(progress.some((m) => /heard 13 per kg, which the simulated vendor never offered/.test(m)));
});

test("simulated vendor: the cross-check refuses a deal at a price the simulation never offered", async () => {
  const rt = {
    state: "agreed",
    agreedPrice: 58,
    reservation: 90,
    counterpart: "simulated",
    requirement: { unit: "kg", max_price: 90 },
    vendorSchedule: [65, 61, 57, 55, 54],
    moves: [{ action: "counter", price: 51 }],
    turns: [{ speaker: "vendor", text: "58 रुपये" }],
    terms: {},
  };
  assert.deepEqual(await session.extractQuote(rt, "agents"), { rejected: "price_not_offered_by_simulated_vendor", agreed: 58 });
  assert.equal((await session.extractQuote({ ...rt, agreedPrice: 57 }, "agents")).unit_price, 57, "a scheduled ask passes");
  assert.equal((await session.extractQuote({ ...rt, agreedPrice: 51 }, "agents")).unit_price, 51, "an accepted buyer counter passes");
  assert.deepEqual(await session.extractQuote({ ...rt, agreedPrice: 95, vendorSchedule: [95] }, "agents"), { rejected: "above_reservation" });
});

/* -------------------------------------------- human, agents mode with tools --- */

async function humanRun(t, { terms }) {
  const history = [];
  const calls = fakeAgora(t, { historyFor: () => history });
  const modelCalls = fakeGroq(t, terms);
  const { businessId, requirement, vendor } = seed({ language: "hi-IN", listedPrice: 65, maxPrice: 70 });
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "human", language: "hi-IN" });
  assert.match(started.joinUrl, /^https:\/\/sahay\.test\/vendor\/[A-Za-z0-9_-]+$/);
  const code = started.joinUrl.split("/").pop();

  assert.equal(await session.humanJoined(code), false, "no one has taken the link's token yet");
  const info = session.humanJoinInfo(code);
  assert.equal(info.uid, session.UIDS.human);
  assert.match(info.token, /^007/);
  assert.match(info.disclosure, /स्वचालित सहायक/);
  assert.equal(session.humanJoinInfo("wrong-code"), null);
  // review #9: the token is issued once per code; only the page that took it can renew it.
  assert.equal(typeof info.renewKey, "string");
  assert.equal(session.humanJoinInfo(code), null, "a second visitor with the same link gets nothing");
  assert.equal(session.humanJoinInfo(code, { renewKey: "guess" }), null);
  const renewed = session.humanJoinInfo(code, { renewKey: info.renewKey });
  assert.match(renewed.token, /^007/);
  assert.equal(renewed.renewKey, undefined, "the renew key is handed out once");

  await until(() => repo.listSessions(businessId, { kind: "negotiation" })[0]?.agent_id);
  const negSession = repo.listSessions(businessId, { kind: "negotiation" })[0];
  const ctx = { businessId, sessionId: negSession.id, agentId: negSession.agent_id, actor: "agent", toolScope: "negotiation" };

  assert.equal(await session.humanJoined(code), true);
  assert.ok(calls.some((c) => c.url.endsWith("/think")), "negotiator told to begin");

  const brief = await registry.callTool(ctx, "get_negotiation_brief", {});
  // E2E r4: the item is said in Devanagari (registry.spokenItem). The city is still Latin: see session.js brief (not changed here).
  assert.equal(brief.say, "हमें 100 किलो बासमती चावल चाहिए, बेंगलुरु में डिलीवरी; आपका सबसे अच्छा भाव प्रति किलो क्या होगा?");
  said(history, "assistant", brief.say);
  said(history, "user", "भाई 64 रुपये किलो लगेगा");

  const clarify = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 1500, unit: "bag" });
  assert.equal(clarify.action, "clarify");
  assert.equal(clarify.say, "कृपया प्रति किलो का भाव बताइए।");

  const counter = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 64, unit: "kg" });
  assert.equal(counter.action, "counter");
  assert.ok(counter.price < 64 && counter.price <= 65);
  // The counter is one of several phrasings (Track POLISH), always with the code's price and in Devanagari.
  assert.ok(counter.say.includes(`${counter.price} रुपये प्रति किलो`), counter.say);
  assert.ok(require("../src/agora/script").isNativeScript(counter.say, "hi-IN"), counter.say);
  said(history, "assistant", counter.say);
  said(history, "user", "ठीक है, पचपन रुपये किलो दे दूँगा, तीन दिन में डिलीवरी");

  const accept = await registry.callTool(ctx, "record_vendor_offer", { price_per_unit: 55, vendor_sentence: "ठीक है, 55 रुपये किलो दे दूँगा" });
  assert.equal(accept.action, "accept");
  assert.equal(accept.price, 55);
  history.push({ role: "assistant", content: accept.say, metadata: { source: "llm" }, timestamp: Date.now() + 1, turn_id: ++turnId });

  const jobId = repo.listJobs(businessId, { kind: "negotiation" })[0].id;
  await jobs.whenSettled(jobId);
  return { businessId, requirement, started, jobId, modelCalls };
}

test("human run: the price comes from code even when the model reads the words differently; terms come from the model", async (t) => {
  const { businessId, requirement, started, jobId, modelCalls } = await humanRun(t, {
    terms: { unit_price: 45, freight: 500, lead_time_days: 3, moq: null, payment_terms: null },
  });
  assert.equal(repo.getJob(businessId, jobId).status, "done");
  const neg = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.simulated, false);
  assert.ok(neg.transcript.some((turn) => turn.speaker === "agent" && turn.offer != null), "agent turns carry the offer computed in code");
  const [quote] = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quote.unit_price, 55, "not the model's 45");
  assert.equal(quote.simulated, false);
  assert.equal(quote.quoted_sentence, "ठीक है, पचपन रुपये किलो दे दूँगा, तीन दिन में डिलीवरी", "the heard vendor line before the accept");
  assert.equal(quote.freight, 500);
  assert.equal(quote.lead_time_days, 3);
  assert.equal(modelCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(modelCalls[0].messages[0]), /final price/i, "the model is not asked for a price");
});

test("human run: a failed terms read does not lose the agreed deal", async (t) => {
  const { businessId, requirement, started, jobId } = await humanRun(t, { terms: new Error("model unavailable") });
  assert.equal(repo.getNegotiation(businessId, started.negotiationId).status, "agreed");
  const [quote] = repo.listQuotes(businessId, { requirement_id: requirement.id });
  assert.equal(quote.unit_price, 55);
  assert.equal(quote.freight, null);
  assert.ok(repo.getJob(businessId, jobId).progress.some((p) => /optional terms could not be read/.test(p.message)));
});

test("review #9: an expired join link neither issues nor renews a token, and does not start the negotiator", async (t) => {
  const calls = fakeAgora(t);
  const { businessId, requirement, vendor } = seed({ language: "en-IN", listedPrice: 65, maxPrice: 70 });
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "human", language: "en-IN" });
  const code = started.joinUrl.split("/").pop();
  const info = session.humanJoinInfo(code);
  assert.ok(info.renewKey);

  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000; // the link lives 15 minutes
  try {
    assert.equal(session.humanJoinInfo(code, { renewKey: info.renewKey }), null);
    assert.equal(await session.humanJoined(code), false);
  } finally {
    Date.now = realNow;
  }
  assert.ok(!calls.some((c) => c.url.endsWith("/think")), "the negotiator was not told to begin");
  jobs.cancelJob(businessId, started.jobId);
  await jobs.whenSettled(started.jobId);
});
