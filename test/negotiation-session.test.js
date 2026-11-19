"use strict";

// Default mode: a simulated vendor is met by the deterministic server-driven loop.
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
  NEGOTIATION_MODE: "loop", // pinned so a developer .env cannot change what this file tests
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const session = require("../src/negotiation/session");
const vendorAgent = require("../src/negotiation/vendor-agent");
const registry = require("../src/tools/registry");
const { ToolError } = require("../src/tools/errors");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const events = require("../src/events");
const jobs = require("../src/jobs");
const { loadConfig, ConfigError } = require("../src/config");

session.configureTiming({ pollMs: 5, stallMs: 40, turnStallMs: 40, closingGraceMs: 5, msPerChar: 0, minLineMs: 1, humanJoinMs: 5000, maxMs: 5000 });

const realFetch = globalThis.fetch;

/** Fake Agora REST: records every call; /join answers an agent id per role. */
function fakeAgora(t) {
  const calls = [];
  let n = 0;
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/join")) {
      n += 1;
      return new Response(JSON.stringify({ agent_id: `${body.properties.labels.role}-${n}`, status: "RUNNING" }), { status: 200 });
    }
    if (/\/history$/.test(url)) return new Response(JSON.stringify({ contents: [] }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return calls;
}

/** No model may be called in loop mode: any outbound fetch fails the test. */
function noModel(t) {
  globalThis.fetch = async (url) => {
    throw new Error(`unexpected fetch in loop mode: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
}

function seed({ language = "hi-IN", listedPrice = 60, maxPrice = 90, quantity = 200 } = {}) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Ganesh Traders", city: "Bengaluru", language });
  const requirement = repo.createRequirement(businessId, { item: "बासमती चावल", quantity, unit: "kg", city: "Bengaluru", max_price: maxPrice });
  const vendor = repo.createVendor(businessId, {
    requirement_id: requirement.id,
    source: "indiamart",
    name: "BS Foods",
    listed_price: listedPrice,
    listed_unit: listedPrice == null ? null : "kg",
  });
  return { businessId, requirement, vendor };
}

async function runSimulated(t, opts) {
  const calls = fakeAgora(t);
  noModel(t);
  const { businessId, requirement, vendor } = seed(opts);
  const seen = [];
  const stop = events.subscribe(businessId, (e) => seen.push(e));
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: opts?.language ?? "hi-IN" });
  await jobs.whenSettled(started.jobId);
  stop();
  const job = repo.getJob(businessId, started.jobId);
  assert.equal(job.status, "done", job.error);
  const neg = repo.getNegotiation(businessId, started.negotiationId);
  const quotes = repo.listQuotes(businessId, { requirement_id: requirement.id });
  return { calls, seen, job, neg, quotes, businessId, requirement, vendor, started };
}

const offers = (neg) => neg.transcript.filter((t) => t.offer != null).map((t) => `${t.speaker}:${t.offer}`);

/* ----------------------------------------------------------------- config --- */

test("config: a simulated negotiation defaults to the deterministic loop; agents mode is opt-in; a typo fails loudly", () => {
  assert.equal(loadConfig({}).negotiation.mode, "loop");
  assert.equal(loadConfig({ NEGOTIATION_MODE: "agents" }).negotiation.mode, "agents");
  assert.equal(loadConfig({ NEGOTIATION_MODE: " Agents " }).negotiation.mode, "agents");
  assert.equal(loadConfig({ NEGOTIATION_MODE: "loop" }).negotiation.mode, "loop");
  assert.throws(() => loadConfig({ NEGOTIATION_MODE: "agent" }), (err) => err instanceof ConfigError && err.code === "INVALID_NEGOTIATION_MODE");
});

/* -------------------------------------------------------------- refusals --- */

test("a simulated vendor needs a real listed price to be based on; no price is invented", async () => {
  const { businessId, requirement, vendor } = seed({ listedPrice: null });
  await assert.rejects(
    session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" }),
    (err) => err instanceof ToolError && err.code === "NO_LISTED_PRICE" && /लिस्टिंग/.test(err.say),
  );
});

test("refusals are said in the owner's reply language while the negotiation keeps the business language", async () => {
  const { businessId, requirement, vendor } = seed({ listedPrice: null, language: "hi-IN" });
  await assert.rejects(
    session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN", sayLanguage: "en-IN" }),
    (err) => err.code === "NO_LISTED_PRICE" && err.say === "This vendor's listing has no price in that unit; please pick another vendor.",
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

/* ------------------------------------------------------ the default loop --- */

test("regression (E2E r2 BLOCKER): BS Foods listed 60/kg, owner max 90, 200 kg agrees at 55 in round 4, voiced by two agents", async (t) => {
  const { calls, seen, job, neg, quotes, businessId } = await runSimulated(t, { listedPrice: 60, maxPrice: 90 });

  // Two agents with different Murf voices, both listening to nobody: they only say what /speak sends.
  const joins = calls.filter((c) => c.url.endsWith("/join")).map((c) => c.body.properties);
  assert.equal(joins.length, 2);
  for (const p of joins) assert.deepEqual(p.remote_rtc_uids, [String(session.UIDS.nobody)]);
  assert.equal(joins[0].llm.mcp_servers, undefined, "loop mode: the negotiator has no tools, the server decides every price");
  assert.equal(joins[1].tts.params.voiceId, vendorAgent.VENDOR_VOICE_ID);
  assert.notEqual(joins[0].tts.params.voiceId, joins[1].tts.params.voiceId);
  assert.equal(calls.filter((c) => c.url.endsWith("/leave")).length, 2, "both agents stopped");

  // Disclosure first, then the simulated vendor says it is simulated.
  const speaks = calls.filter((c) => c.url.endsWith("/speak")).map((c) => c.body.text);
  assert.match(speaks[0], /स्वचालित सहायक/);
  assert.match(speaks[1], /सिम्युलेटेड विक्रेता/);
  assert.equal(speaks.filter((s) => s.includes("स्वचालित सहायक")).length, 1);

  // The price trace: whole rupees, the buyer never counters above an ask.
  assert.deepEqual(offers(neg), ["vendor:65", "agent:51", "vendor:61", "agent:52", "vendor:57", "agent:55", "vendor:55", "agent:55"]);
  assert.equal(neg.status, "agreed");
  assert.equal(neg.outcome.mode, "loop");
  assert.equal(neg.outcome.rounds, 4);
  assert.equal(neg.outcome.reason, null);
  assert.ok(neg.transcript.every((turn) => turn.simulated === true), "every stored turn is labelled simulated");
  assert.ok(!neg.transcript.some((turn) => /आख़िरी भाव/.test(turn.text)), "no price before the last scheduled one is called final");

  assert.equal(quotes.length, 1);
  const [quote] = quotes;
  assert.equal(quote.unit_price, 55);
  assert.ok(quote.unit_price <= 90);
  assert.equal(quote.simulated, true);
  assert.equal(quote.unit, "kg");
  assert.equal(quote.quoted_sentence, "ठीक है, 55 रुपये प्रति किलो में दे देंगे।", "the vendor line that produced the accept");
  assert.equal(quote.freight, null, "no freight figure is invented");
  assert.equal(quote.confidence, 1);

  // Jobs panel: one progress line per round, with the numbers.
  const rounds = job.progress.filter((p) => /^Round \d/.test(p.message)).map((p) => p.message);
  assert.deepEqual(rounds, [
    "Round 1: simulated vendor asks 65 per kg; Sahay offers 51.",
    "Round 2: simulated vendor asks 61 per kg; Sahay offers 52.",
    "Round 3: simulated vendor asks 57 per kg; Sahay offers 55.",
    "Round 4: simulated vendor asks 55 per kg; Sahay agrees at 55, pending the owner's approval.",
  ]);
  assert.match(job.progress[0].message, /BS Foods \(simulated vendor\): server-driven turns/);
  assert.ok(seen.filter((e) => e.type === "job.progress").length >= 5, "progress is emitted as events, not only stored");
  assert.equal(seen.find((e) => e.type === "negotiation.ended").data.outcome.unitPrice, 55);

  // The quote passes the approval gate's consistency checks.
  const { requestApproval } = require("../src/approvals");
  const { approval } = requestApproval(businessId, quote.id);
  assert.match(approval.readback, /सिम्युलेटेड वेंडर/);
});

test("loop, listed 60 and no owner max: the listing is the ceiling and the deal lands at 55", async (t) => {
  const { neg, quotes } = await runSimulated(t, { listedPrice: 60, maxPrice: null });
  assert.equal(neg.status, "agreed");
  assert.equal(quotes[0].unit_price, 55);
  assert.ok(quotes[0].unit_price <= 60);
});

test("loop, listed 100 and owner max 90 (under the listing, at the vendor floor): agreed at 90 within five rounds", async (t) => {
  const { neg, quotes } = await runSimulated(t, { listedPrice: 100, maxPrice: 90 });
  assert.equal(neg.status, "agreed");
  assert.equal(quotes[0].unit_price, 90);
  assert.ok(neg.outcome.rounds <= session.MAX_ROUNDS);
});

test("loop, owner max below the simulated vendor's floor: an honest walk-away, then the same vendor can be tried again", async (t) => {
  const first = await runSimulated(t, { listedPrice: 100, maxPrice: 80 });
  assert.equal(first.neg.status, "walked_away");
  assert.equal(first.neg.outcome.reason, "walked_away:final_ask_above_reservation");
  assert.equal(first.quotes.length, 0);
  assert.ok(first.neg.transcript.some((turn) => turn.speaker === "vendor" && turn.offer === 90 && /आख़िरी भाव/.test(turn.text)), "only the floor is called final");
  assert.ok(first.job.progress.some((p) => /^Round 5: .*Sahay walks away \(final_ask_above_reservation\)\.$/.test(p.message)));

  // E2E r2: "negotiate again" after a walk-away must not be refused as busy.
  const again = await session.startNegotiation({ businessId: first.businessId, requirementId: first.requirement.id, vendorId: first.vendor.id, counterpart: "simulated", language: "hi-IN" });
  assert.notEqual(again.negotiationId, first.started.negotiationId);
  await jobs.whenSettled(again.jobId);
  assert.equal(repo.getNegotiation(first.businessId, again.negotiationId).status, "walked_away");
});

test("the negotiation is released before it is announced, so a start on hearing the outcome is not refused", async (t) => {
  fakeAgora(t);
  noModel(t);
  const { businessId, requirement, vendor } = seed({ listedPrice: 100, maxPrice: 80 });
  const restarts = [];
  const stop = events.subscribe(businessId, (e) => {
    if (e.type !== "negotiation.ended") return;
    restarts.push(session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" }));
  });
  const first = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" });
  await jobs.whenSettled(first.jobId);
  stop();
  assert.equal(restarts.length, 1);
  const second = await restarts[0];
  await jobs.whenSettled(second.jobId);
  assert.equal(repo.getJob(businessId, second.jobId).status, "done");
});

test("regression (E2E 2026-11-19): a requirement stored as किलो negotiates against a per-Kg IndiaMART listing", async (t) => {
  fakeAgora(t);
  noModel(t);
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Sri Lakshmi Stores", city: "Bengaluru", language: "hi-IN" });
  const requirement = repo.createRequirement(businessId, { item: "बासमती चावल", quantity: 200, unit: "किलो", city: "बेंगलुरु", max_price: 110 });
  const vendor = repo.createVendor(businessId, { requirement_id: requirement.id, source: "indiamart", name: "Babu Trading Co.", listed_price: 100, listed_unit: "Kg" });
  const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" });
  await jobs.whenSettled(started.jobId);
  const quote = repo.listQuotes(businessId, { requirement_id: requirement.id })[0];
  assert.ok(quote, "a quote is recorded");
  assert.equal(quote.simulated, true);
  assert.ok(quote.unit_price <= 110);
});

test("negotiation tools refuse a ctx with no running negotiation, and a still-running negotiation blocks a second one", async (t) => {
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

/* ------------------------------------------- security review r1 #3 and #1 --- */

const limits = require("../src/limits");

test("review #3: in every language the negotiator's closing line only promises to confirm with the owner", async (t) => {
  fakeAgora(t);
  noModel(t);
  const expected = {
    "en-IN": /^I will confirm 55 rupees per kilogram with the owner and send the order\. Thank you\.$/,
    "kn-IN": /^ಸರಿ, ಒಂದು .+ಗೆ 55 ರೂಪಾಯಿ ಬೆಲೆಯನ್ನು ಮಾಲೀಕರ ಜೊತೆ ಖಚಿತಪಡಿಸಿ ಆರ್ಡರ್ ಕಳುಹಿಸುತ್ತೇನೆ, ಧನ್ಯವಾದ\.$/,
    "hi-IN": /^ठीक है, 55 रुपये प्रति किलो पर मैं मालिक से पक्का करके ऑर्डर भेजूँगी, धन्यवाद।$/,
  };
  for (const [language, line] of Object.entries(expected)) {
    const { businessId, requirement, vendor } = seed({ language });
    const started = await session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language });
    await jobs.whenSettled(started.jobId);
    const agentLines = repo.getNegotiation(businessId, started.negotiationId).transcript.filter((turn) => turn.speaker === "agent").map((turn) => turn.text);
    assert.match(agentLines.at(-1), line, language);
    assert.doesNotMatch(agentLines.join(" "), /Agreed at|बात पक्की|ಒಪ್ಪಿಗೆ;/, language);
  }
});

test("review #1: negotiations share a global cap; a full cap is refused politely and the slot comes back when the job ends", async (t) => {
  fakeAgora(t);
  noModel(t);
  limits.reset();
  t.after(() => limits.reset());
  const { businessId, requirement, vendor } = seed();
  const start = () => session.startNegotiation({ businessId, requirementId: requirement.id, vendorId: vendor.id, counterpart: "simulated", language: "hi-IN" });

  const held = [];
  for (let release = limits.tryAcquire("negotiation"); release; release = limits.tryAcquire("negotiation")) held.push(release);
  await assert.rejects(start(), (err) => {
    assert.ok(err instanceof ToolError);
    assert.equal(err.code, "BUSY");
    assert.equal(err.say, "अभी बहुत लोग इस्तेमाल कर रहे हैं, थोड़ी देर बाद कोशिश कीजिए।");
    return true;
  });
  assert.deepEqual(repo.listNegotiations(businessId), [], "nothing was started");
  assert.deepEqual(repo.listJobs(businessId), []);

  for (const release of held) release();
  const started = await start();
  assert.equal(limits.usage().negotiation.inUse, 1);
  await jobs.whenSettled(started.jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(limits.usage().negotiation.inUse, 0, "the slot is given back when the negotiation ends");

  // A job cancelled before it ran still gives its slot back.
  const cancelled = await start();
  jobs.cancelJob(businessId, cancelled.jobId);
  await jobs.whenSettled(cancelled.jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(limits.usage().negotiation.inUse, 0);
});
