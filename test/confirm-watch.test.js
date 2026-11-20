"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  // No Razorpay keys: an issued bill reports its pay link as not made, nothing reaches Razorpay.
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const watch = require("../src/agora/confirm-watch");
const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const db = require("../src/db");
const events = require("../src/events");
const items = require("../src/stock/items");
const invoices = require("../src/sell/invoices");
const { ToolError } = require("../src/tools/errors");

const AGENT = "AG-W";
/** The short question a model may still add after a read-back (the tool now returns an empty say). */
const BILL_QUESTION = require("../src/tools/sell").PHRASES.invoice_question["hi-IN"]();
const DEAL_QUESTION = registry.phrase("approval_question", "hi-IN");

/** An unregistered shop (plain bills) with basmati on sale, and a live owner session. */
function shop() {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Annapurna Kirana", city: "Bengaluru", language: "hi-IN" });
  items.upsert(businessId, { name: "बासमती चावल", unit: "kg", sale_price: 90 });
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: AGENT, status: "active" });
  return { businessId, ctx: { businessId, sessionId: session.id, agentId: AGENT, actor: "agent", toolScope: "owner" } };
}

/** A live call at the Agora boundary: /speak lines enter /history as server lines; owner(words) is an ASR turn. */
function fakeCall(t) {
  const call = { spoken: [], items: [], turn: 0, historyReads: 0 };
  call.owner = (content, source = "asr") => call.items.push({ role: "user", content, metadata: { source }, turn_id: ++call.turn });
  call.model = (content) => call.items.push({ role: "assistant", content, metadata: { source: "llm" }, turn_id: ++call.turn });
  /** The model calls a tool: as live (agora-findings.md), its call and result items enter /history when it returns. */
  call.tool = async (ctx, name, args) => {
    const id = `call_${call.turn}_${name}`;
    const out = await registry.callTool(ctx, name, args);
    call.items.push({ role: "assistant", tool_calls: [{ id, name: `sahay__${name}`, arguments: JSON.stringify(args) }] });
    call.items.push({ role: "tool", tool_call_id: id, content: JSON.stringify(out) });
    return out;
  };
  agent.setFetch(async (url, init) => {
    let json;
    if (/\/speak$/.test(url)) {
      const body = JSON.parse(init.body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
      json = { agent_id: AGENT };
    } else if (/\/history$/.test(url)) {
      call.historyReads += 1;
      json = { contents: call.items.slice() };
    } else throw new Error(`unexpected Agora call ${url}`);
    return new Response(JSON.stringify(json), { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return call;
}

/** Watch this business's call with a fake clock; ticks are driven by the test, never by a timer. */
function watching(t, { businessId, ctx }, { callTool } = {}) {
  let now = Date.now();
  watch.configure({
    live: (id) => (id === businessId ? { agentId: ctx.agentId, sessionId: ctx.sessionId, language: "hi-IN" } : null),
    pollMs: 9 * 60 * 1000,
    graceMs: 6000,
    callTool: callTool ?? ((c, name, args) => registry.callTool(c, name, args)),
  });
  watch.watch(businessId);
  t.after(() => watch.unwatch(businessId));
  return {
    tick: () => watch.tick(businessId, () => now),
    advance: (ms) => {
      now += ms;
    },
  };
}

/** The bill of the E2E run, drafted and read out by the server. */
async function billReadOut(ctx, call) {
  call.owner("रमेश ट्रेडर्स को 60 किलो बासमती चावल 90 रुपये किलो");
  await registry.callTool(ctx, "draft_invoice", { customer: "रमेश ट्रेडर्स", lines: [{ item: "बासमती चावल", quantity: 60, unit: "किलो", rate: 90 }] });
  const asked = await registry.callTool(ctx, "request_invoice_approval", {});
  assert.equal(asked.readbackSpoken, true);
  return asked;
}

const watchdogRows = (businessId) =>
  db.prepare("SELECT detail FROM audit_log WHERE business_id = ? AND type = 'confirm.watchdog' ORDER BY id").all(businessId).map((r) => JSON.parse(r.detail));

test("E2E full run bug 5c: the owner says हाँ to the bill and the model calls nothing; after the grace the server issues it through the same gate and says so", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);

  assert.equal(await clock.tick(), "waiting", "no answer yet");
  call.owner("हां, ठीक है।");
  assert.equal(await clock.tick(), "grace", "the model gets its chance first");
  clock.advance(3000);
  assert.equal(await clock.tick(), "grace");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending", "nothing decided during the grace");

  clock.advance(3100);
  assert.equal(await clock.tick(), "acted");
  const bill = invoices.get(businessId, asked.invoiceId);
  assert.equal(bill.status, "issued");
  assert.equal(bill.number, `INV/${require("../src/sell/gst").financialYear()}/0001`);
  const decided = db.prepare("SELECT detail FROM audit_log WHERE business_id = ? AND type = 'invoice.decided'").get(businessId);
  assert.equal(JSON.parse(decided.detail).evidenceUtterance, "हां, ठीक है।", "the owner's own words, read from the call, are the evidence");
  assert.match(call.spoken.at(-1), /^बिल INV\/.*\/0001 बन गया/, "the server, not the model, says the bill is made");
  assert.deepEqual(watchdogRows(businessId).map((r) => [r.kind, r.tool, r.answer, r.ok]), [["invoice", "confirm_invoice", "affirmative", true]]);
  assert.equal(await clock.tick(), "idle", "nothing waits any more: polling stops");
});

test("E2E full run bug 7b: a spoken yes to a payment read-back is written down by the server when the model only says 'लिख लिया'", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  await billReadOut(ctx, call);
  call.owner("हाँ");
  await registry.callTool(ctx, "confirm_invoice", { decision: "approve" }); // the model did this one

  call.owner("रमेश ट्रेडर्स ने 2000 रुपये नकद दिए");
  const asked = await registry.callTool(ctx, "record_payment", { customer: "रमेश ट्रेडर्स", amount: 2000, mode: "cash", owner_words: "रमेश ट्रेडर्स ने 2000 रुपये नकद दिए" });
  assert.equal(asked.status, "awaiting_answer");
  const clock = watching(t, shopRow);
  call.owner("हाँ");
  assert.equal(await clock.tick(), "grace");
  clock.advance(6100);
  assert.equal(await clock.tick(), "acted");
  const receipts = db.prepare("SELECT amount_paise, recorded_via, evidence_utterance FROM receipts WHERE business_id = ?").all(businessId);
  assert.deepEqual(receipts.map((r) => ({ ...r })), [{ amount_paise: 200000, recorded_via: "voice", evidence_utterance: "हाँ" }]);
  assert.match(call.spoken.at(-1), /^लिख लिया: रमेश ट्रेडर्स से 2 हज़ार रुपये। अब उनके 3 हज़ार 400 रुपये बाकी हैं। और कुछ बताइए\?$/);
});

test("the model's own confirm call stands: the watchdog does not act again, even when the gate refused it", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  call.owner("हाँ");
  assert.equal(await clock.tick(), "grace");
  // The model calls the right tool with the wrong decision: the gate refuses (the owner said yes).
  await assert.rejects(registry.callTool(ctx, "confirm_invoice", { decision: "reject" }), (err) => err.code === "NOT_NEGATIVE");
  clock.advance(7000);
  assert.equal(await clock.tick(), "model");
  assert.equal(await clock.tick(), "waiting", "acted on once per answer");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending");
  assert.deepEqual(watchdogRows(businessId), []);
});

test("a maybe, a question or a typed yes is never acted on", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  for (const [words, source] of [["शायद, सोचता हूँ", "asr"], ["कितना हुआ?", "asr"], ["हाँ", "message"]]) {
    call.owner(words, source);
    assert.equal(await clock.tick(), "waiting", words);
    clock.advance(10_000);
    assert.equal(await clock.tick(), "waiting", words);
  }
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending");
  assert.deepEqual(watchdogRows(businessId), []);
});

test("a gate refusal is said aloud as 'अभी हुआ नहीं' with the gate's reason, never as done", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  await billReadOut(ctx, call);
  const tried = [];
  const clock = watching(t, shopRow, {
    callTool: async (c, name, args) => {
      tried.push([c.agentId, c.toolScope, name, args.decision]);
      throw new ToolError("READBACK_SUPERSEDED", "बीच में कुछ और पढ़ा गया था; बिल फिर से पढ़कर सुनाऊँ?", { status: 409 });
    },
  });
  call.owner("हाँ जी");
  await clock.tick();
  clock.advance(6100);
  assert.equal(await clock.tick(), "acted");
  assert.deepEqual(tried, [[AGENT, "owner", "confirm_invoice", "approve"]]);
  assert.equal(call.spoken.at(-1), "अभी हुआ नहीं। बीच में कुछ और पढ़ा गया था; बिल फिर से पढ़कर सुनाऊँ?");
  assert.deepEqual(watchdogRows(businessId).map((r) => [r.ok, r.code]), [[false, "READBACK_SUPERSEDED"]]);
});

test("a clear no goes to the same tool as a rejection; nothing runs without a live call", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  call.owner("नहीं, रहने दो");
  await clock.tick();
  clock.advance(6100);
  assert.equal(await clock.tick(), "acted");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "draft", "rejected: the bill stays a draft");

  watch.configure({ live: () => null });
  watch.watch(businessId);
  assert.equal(await watch.tick(businessId), "idle");
});

test("start(): a read-back spoken in a live call starts the watch; the end of the call stops it", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  watch.configure({ live: (id) => (id === businessId ? { agentId: AGENT, sessionId: ctx.sessionId, language: "hi-IN" } : null), pollMs: 9 * 60 * 1000 });
  watch.start();
  t.after(() => watch.stop());
  assert.equal(await watch.tick(businessId), "idle", "nothing watched before a read-back");
  await billReadOut(ctx, call);
  assert.equal(await watch.tick(businessId), "waiting", "invoice.spoken started the watch");
  events.emit(businessId, "session.ended", { sessionId: ctx.sessionId, kind: "owner" }, { sessionId: ctx.sessionId, actor: "owner" });
  assert.equal(await watch.tick(businessId), "idle");
});

test("latestWaiting: the answer goes to the question read out last; a read-back older than maxAgeMs is left alone", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  await billReadOut(ctx, call);
  const first = watch.latestWaiting(businessId, AGENT);
  assert.equal(first.kind, "invoice");
  assert.equal(watch.latestWaiting(businessId, "AG-OTHER"), null, "another call's agent never heard it");
  assert.equal(watch.latestWaiting(businessId, AGENT, Date.now() + watch.settings.maxAgeMs + 1000), null);
});

test("a late model call after the server acted is told it is done, not 'there is no bill'; a call in flight holds the server back", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  call.owner("हाँ");
  await clock.tick();
  clock.advance(6100);

  // The model's confirm_invoice is running right now: the server waits for it.
  const end = require("../src/tools/calls").begin(businessId, "confirm_invoice", { answer: false });
  assert.equal(await clock.tick(), "waiting");
  end();

  assert.equal(await clock.tick(), "acted");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "issued");
  const spokenBefore = call.spoken.length;
  const late = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.deepEqual([late.alreadyDone, late.by, late.say], [true, "server", "और कुछ बताइए?"]);
  assert.equal(call.spoken.length, spokenBefore, "nothing said twice");
  // Another tool's refusal is untouched.
  await assert.rejects(registry.callTool(ctx, "record_payment", { decision: "confirm" }), (err) => err.code === "NO_PENDING_PAYMENT");
});

/* ---------------------------------------------- security review r2 #3, #9 --- */

const toolCalls = require("../src/tools/calls");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drive the watchdog past the grace and report what it ended up doing. */
async function settle(clock) {
  const first = await clock.tick();
  clock.advance(7000);
  return [first, await clock.tick()];
}

test("r2 #3: the watchdog never acts when any other tool started after the read-back", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  await pause(5);
  toolCalls.begin(businessId, "get_stock")(); // the model ran something else after the bill was read out
  call.owner("हाँ");
  const [, last] = await settle(clock);
  assert.notEqual(last, "acted");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending");
  assert.deepEqual(watchdogRows(businessId), []);
});

test("r2 #3: the watchdog acts only on the owner's first answer, and never after another model question", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  call.owner("एक मिनट");
  call.owner("हाँ");
  // The first answer was not a yes: the later yes never issues the bill; the server has it read out again (live check 129a071).
  const readback = call.spoken.at(-1);
  assert.deepEqual(await settle(clock), ["grace", "read_again"]);
  assert.equal(call.spoken.at(-1), readback, "the same bill, read out again");

  const other = shop();
  const call2 = fakeCall(t);
  const asked2 = await billReadOut(other.ctx, call2);
  const clock2 = watching(t, other);
  call2.items.push({ role: "assistant", content: "क्या मैं स्टॉक भी देख लूँ?", metadata: { source: "llm" }, turn_id: ++call2.turn });
  call2.owner("हाँ");
  assert.deepEqual(await settle(clock2), ["grace", "read_again"], "a yes after another question is never taken for the bill's; it is only read out again");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending");
  assert.equal(invoices.get(other.businessId, asked2.invoiceId).status, "pending");
  assert.deepEqual([...watchdogRows(businessId), ...watchdogRows(other.businessId)].map((r) => [r.action, r.ok]), [["read_again", true], ["read_again", true]]);
});

test("r2 #3: the live one-yes flow still works: the model's short question, then हाँ, is acted on after the grace", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  call.items.push({ role: "assistant", content: BILL_QUESTION, metadata: { source: "llm" }, turn_id: ++call.turn });
  call.owner("हाँ");
  assert.deepEqual(await settle(clock), ["grace", "acted"]);
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "issued");
});

test("echo: an owner turn that repeats the agent's own line, or a bare 'ठीक है' within 1.5 s of the agent's speech, is not acted on", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const asked = await billReadOut(ctx, call);
  const clock = watching(t, shopRow);
  const end = 1_000_000;
  call.items.push({ role: "assistant", content: BILL_QUESTION, metadata: { source: "llm" }, turn_id: ++call.turn, speech_start_ms: end - 2000, speech_end_ms: end });
  call.items.push({ role: "user", content: "ठीक है", metadata: { source: "asr" }, turn_id: ++call.turn, speech_start_ms: end + 600, speech_end_ms: end + 1200 });
  assert.deepEqual(await settle(clock), ["waiting", "waiting"], "possible speaker echo");
  assert.equal(invoices.get(businessId, asked.invoiceId).status, "pending");

  // Same words, said 2 s after the agent stopped: the owner's own answer.
  const later = shop();
  const call2 = fakeCall(t);
  const asked2 = await billReadOut(later.ctx, call2);
  const clock2 = watching(t, later);
  call2.items.push({ role: "assistant", content: BILL_QUESTION, metadata: { source: "llm" }, turn_id: ++call2.turn, speech_start_ms: end - 2000, speech_end_ms: end });
  call2.items.push({ role: "user", content: "ठीक है", metadata: { source: "asr" }, turn_id: ++call2.turn, speech_start_ms: end + 2000, speech_end_ms: end + 2600 });
  assert.deepEqual(await settle(clock2), ["grace", "acted"]);

  // A real yes right after the question is never taken for an echo.
  const quick = shop();
  const call3 = fakeCall(t);
  const asked3 = await billReadOut(quick.ctx, call3);
  const clock3 = watching(t, quick);
  call3.items.push({ role: "assistant", content: BILL_QUESTION, metadata: { source: "llm" }, turn_id: ++call3.turn, speech_start_ms: end - 2000, speech_end_ms: end });
  call3.items.push({ role: "user", content: "हाँ", metadata: { source: "asr" }, turn_id: ++call3.turn, speech_start_ms: end + 400, speech_end_ms: end + 700 });
  assert.deepEqual(await settle(clock3), ["grace", "acted"]);

  // The agent's own question heard back as the owner's words.
  const echo = shop();
  const call4 = fakeCall(t);
  const asked4 = await billReadOut(echo.ctx, call4);
  const clock4 = watching(t, echo);
  call4.items.push({ role: "assistant", content: BILL_QUESTION, metadata: { source: "llm" }, turn_id: ++call4.turn });
  call4.owner("बिल बनाऊँ हाँ या ना");
  assert.deepEqual(await settle(clock4), ["waiting", "waiting"]);
});

test("r2 #9: the watchdog's audit row names the deal, so a simulated vendor's deal is labelled 'simulated vendor'", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  const call = fakeCall(t);
  const need = repo.createRequirement(businessId, { item: "चावल", quantity: 50, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "simulated", name: "BS Foods" });
  const neg = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
  const quote = repo.createQuote(businessId, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 62, unit: "kg", freight: 0, landed_cost: 3100, lead_time_days: 2 });
  assert.equal(repo.getQuote(businessId, quote.id).simulated, true);
  const asked = await registry.callTool(ctx, "request_approval", { quoteId: quote.id });
  const clock = watching(t, shopRow, { callTool: async () => ({ ok: true }) });
  call.owner("हाँ");
  assert.deepEqual(await settle(clock), ["grace", "acted"]);
  const [row] = watchdogRows(businessId);
  assert.equal(row.kind, "approval");
  assert.equal(row.approvalId, asked.approvalId);
  assert.equal(row.simulated, true);
  assert.equal(row.vendorLabel, "simulated vendor");
});

/* ------- live check 129a071 (2026-11-20 02:07 UTC): a maybe, then a clear yes the model never answered --- */

/** The live check's deal: a simulated vendor, freight and delivery time not quoted, so the read-back takes two /speak pieces. */
function liveDeal(businessId) {
  const need = repo.createRequirement(businessId, { item: "बासमती चावल", quantity: 200, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "simulated", name: "Srinidhi Foods" });
  const neg = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
  return repo.createQuote(businessId, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 101, unit: "kg", freight: null, landed_cost: null, lead_time_days: null });
}

/** The live call up to the read-back: the owner's yes to the offer, then request_approval as the model ran it. */
async function liveReadBack(ctx, call) {
  call.owner("सबसे अच्छी डील बताओ");
  call.owner("हाँ");
  const asked = await call.tool(ctx, "request_approval", { reply_language: "hi-IN" });
  assert.equal(asked.readbackSpoken, true);
  assert.equal(call.spoken.length, 1, "the deal read-back is ONE /speak request (live check 129a071: two pieces stalled Murf)");
  assert.ok(call.spoken[0].endsWith("क्या मैं यह ऑर्डर पक्का करूँ?"), call.spoken[0]);
  assert.equal(asked.say, "", "the model says nothing on top of the read-back");
  return asked;
}

const watchdogActions = (businessId) => watchdogRows(businessId).map((r) => [r.kind, r.tool, r.answer, r.ok, r.action]);

test("live check 129a071: read-back, the owner's maybe, no agent reply, then हाँ: the server reads the deal out again (approves nothing); the yes after that places the order", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  liveDeal(businessId);
  const call = fakeCall(t);
  const asked = await liveReadBack(ctx, call);
  const clock = watching(t, shopRow);

  // Live history after the read-back: command, command, request_approval call, its result, then only owner turns.
  call.owner("शायद थोड़ा सोचने दीजिए।");
  assert.equal(await clock.tick(), "waiting", "a maybe is not an answer");
  clock.advance(25_000);
  assert.equal(await clock.tick(), "waiting");

  call.owner("हाँ, ठीक है।");
  assert.equal(await clock.tick(), "grace", "the model gets its chance first");
  clock.advance(6100);
  assert.equal(await clock.tick(), "read_again");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending", "a yes after a maybe never approves");
  assert.equal(repo.listOrders(businessId).length, 0);
  assert.deepEqual(call.spoken.slice(1), call.spoken.slice(0, 1), "the same read-back, spoken again by the server");
  assert.deepEqual(watchdogActions(businessId), [["approval", "confirm_approval", "affirmative", true, "read_again"]]);

  // The same yes is never read out for twice.
  clock.advance(10_000);
  assert.equal(await clock.tick(), "waiting");
  assert.equal(call.spoken.length, 2);

  // The owner's yes right after the fresh read-back answers it.
  call.owner("हाँ, ठीक है।");
  assert.equal(await clock.tick(), "grace");
  clock.advance(6100);
  assert.equal(await clock.tick(), "acted");
  const approval = repo.getApproval(businessId, asked.approvalId);
  assert.equal(approval.status, "consumed", "approved, and the order placed on it");
  assert.equal(approval.evidence_utterance, "हाँ, ठीक है।");
  assert.equal(repo.listOrders(businessId).length, 1);
  assert.deepEqual(watchdogActions(businessId).at(-1), ["approval", "confirm_approval", "affirmative", true, "decided"]);
});

test("live check 129a071: the model acknowledges the maybe, the owner says हाँ and the model calls nothing: read out again, not approved", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  liveDeal(businessId);
  const call = fakeCall(t);
  const asked = await liveReadBack(ctx, call);
  call.model(DEAL_QUESTION);
  const clock = watching(t, shopRow);
  call.owner("शायद थोड़ा सोचने दीजिए।");
  call.model("कोई जल्दी नहीं, आराम से सोचिए।");
  call.owner("हाँ, ठीक है।");
  assert.deepEqual(await settle(clock), ["grace", "read_again"]);
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");
  assert.equal(call.spoken.length, 2, "read out again");
  assert.deepEqual(watchdogActions(businessId), [["approval", "confirm_approval", "affirmative", true, "read_again"]]);
});

test("live check 129a071: when the model does call confirm_approval for the later yes, its own call re-reads; the server does not read it out a second time", async (t) => {
  const shopRow = shop();
  const { businessId, ctx } = shopRow;
  liveDeal(businessId);
  const call = fakeCall(t);
  const asked = await liveReadBack(ctx, call);
  const clock = watching(t, shopRow);
  call.owner("शायद थोड़ा सोचने दीजिए।");
  call.owner("हाँ, ठीक है।");
  assert.equal(await clock.tick(), "grace");
  const again = await call.tool(ctx, "confirm_approval", { decision: "approve" });
  assert.deepEqual([again.readAgain, again.refused], [true, "NOT_AFFIRMATIVE"]);
  clock.advance(6100);
  assert.equal(await clock.tick(), "waiting", "the read-back the model's call spoke has no answer yet");
  assert.equal(call.spoken.length, 2, "read out once more, by the model's call only");
  assert.deepEqual(watchdogRows(businessId), []);
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");
});

test("re-read guard: no re-read for a yes before the read-back, a later unclear or typed turn, a possible echo, or when another tool ran", async (t) => {
  // Only the offer's yes, before the read-back; after it a maybe, a question and a typed yes.
  const a = shop();
  liveDeal(a.businessId);
  const callA = fakeCall(t);
  await liveReadBack(a.ctx, callA);
  const clockA = watching(t, a);
  callA.owner("शायद");
  callA.owner("कितना हुआ?");
  callA.owner("हाँ", "message");
  assert.deepEqual(await settle(clockA), ["waiting", "waiting"]);
  assert.equal(callA.spoken.length, 1);

  // A bare "ठीक है" within 1.5 s of the agent's line may be its own voice heard back.
  const b = shop();
  liveDeal(b.businessId);
  const callB = fakeCall(t);
  const askedB = await liveReadBack(b.ctx, callB);
  const clockB = watching(t, b);
  callB.owner("शायद");
  const end = 2_000_000;
  callB.items.push({ role: "assistant", content: "कोई जल्दी नहीं।", metadata: { source: "llm" }, turn_id: ++callB.turn, speech_start_ms: end - 1500, speech_end_ms: end });
  callB.items.push({ role: "user", content: "ठीक है", metadata: { source: "asr" }, turn_id: ++callB.turn, speech_start_ms: end + 500, speech_end_ms: end + 900 });
  assert.deepEqual(await settle(clockB), ["waiting", "waiting"]);
  assert.equal(repo.getApproval(b.businessId, askedB.approvalId).status, "pending");

  // Another tool ran after the read-back: the owner's words may answer that; the server stays out.
  const c = shop();
  liveDeal(c.businessId);
  const callC = fakeCall(t);
  await liveReadBack(c.ctx, callC);
  const clockC = watching(t, c);
  callC.owner("शायद");
  await new Promise((resolve) => setTimeout(resolve, 5)); // live, a later tool starts well after the read-back's millisecond
  await callC.tool(c.ctx, "get_business_profile", {});
  callC.owner("हाँ");
  assert.deepEqual(await settle(clockC), ["waiting", "waiting"]);
  assert.equal(callC.spoken.length, 1);
  assert.deepEqual([...watchdogRows(a.businessId), ...watchdogRows(b.businessId), ...watchdogRows(c.businessId)], []);
});

test("diagnostic: an owner turn the agent leaves unanswered for 10 s is logged once, with the /history tail and no words", async (t) => {
  const shopRow = shop();
  const { ctx } = shopRow;
  liveDeal(shopRow.businessId);
  const call = fakeCall(t);
  await liveReadBack(ctx, call);
  const clock = watching(t, shopRow);
  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(String(line)));
  call.owner("शायद थोड़ा सोचने दीजिए।");
  await clock.tick();
  clock.advance(5000);
  await clock.tick();
  assert.deepEqual(warned, [], "not yet");
  clock.advance(6000);
  await clock.tick();
  clock.advance(6000);
  await clock.tick();
  assert.equal(warned.length, 1, warned.join("\n"));
  assert.match(warned[0], /^\[confirm-watch\] no agent reply 11 s after owner turn \d+; \/history tail: /);
  assert.match(warned[0], /assistant:command#\d+ assistant:-#- calls request_approval tool:-#- result user:asr#\d+$/);
  assert.doesNotMatch(warned[0], /शायद|Srinidhi|रुपये/, "no words of the owner or the deal in the log");
});
