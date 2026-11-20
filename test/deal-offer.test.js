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

const assert = require("node:assert/strict");
const { test } = require("node:test");

const dealOffer = require("../src/agora/deal-offer");
const registry = require("../src/tools/registry");
const { ToolError } = require("../src/tools/errors");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const db = require("../src/db");
const watch = require("../src/agora/confirm-watch");

const OFFER_HI = "क्या इस डील को मंज़ूरी के लिए पढ़ूँ?";
const QUESTIONS = [OFFER_HI, "Shall I read this deal out for your approval?"];

/* ------------------------------------------------------------ the module --- */

const asr = (content, turn) => ({ role: "user", content, metadata: { source: "asr" }, turn_id: turn });
const llm = (content, turn) => ({ role: "assistant", content, metadata: { source: "llm" }, turn_id: turn });

test("an offer is remembered per business and agent, and only for the window", () => {
  const t0 = Date.parse("2026-11-20T10:00:00Z");
  dealOffer.record("biz_a", "AG1", { quoteId: "quo_1", requirementId: "req_1" }, t0);
  assert.deepEqual(dealOffer.current("biz_a", "AG1", t0 + 1000), { quoteId: "quo_1", requirementId: "req_1", at: t0 });
  assert.equal(dealOffer.current("biz_a", "AG2", t0 + 1000), null, "another call's agent never inherits it");
  assert.equal(dealOffer.current("biz_b", "AG1", t0 + 1000), null, "another business never inherits it");
  assert.equal(dealOffer.current("biz_a", "AG1", t0 + dealOffer.settings.windowMs + 1), null, "older than the window: gone");
  assert.equal(dealOffer.current("biz_a", "AG1", t0 + 1000), null, "an expired offer is forgotten, not revived");

  dealOffer.record("biz_a", "AG1", { quoteId: "quo_2", requirementId: "req_1" }, t0);
  dealOffer.clear("biz_a", "AG1");
  assert.equal(dealOffer.current("biz_a", "AG1", t0), null);
  assert.equal(dealOffer.current("biz_a", null, t0), null, "no agent, no offer");
});

test("answerToOffer: the owner's first and latest spoken turn right after the offer line", () => {
  const offer = llm(`सबसे अच्छा सौदा Lakshmi Traders: 62 रुपये प्रति किलो, कुल 3250 रुपये। ${OFFER_HI}`, 2);
  assert.deepEqual(dealOffer.answerToOffer([asr("डील बताओ", 1), offer, asr("हाँ", 3)], QUESTIONS), { text: "हाँ", turnId: 3, index: 2 });
  // The model may say the question without the full stop, in another case, or in English.
  assert.equal(dealOffer.answerToOffer([llm("Best deal ... shall I read this deal out for your approval", 1), asr("yes", 2)], QUESTIONS).text, "yes");
  // A tool call the model made after the yes (its confirm_approval) comes after the answer: fine.
  const after = [offer, asr("हाँ", 3), { role: "assistant", tool_calls: [{ id: "c1", name: "sahay__confirm_approval" }] }];
  assert.equal(dealOffer.answerToOffer(after, QUESTIONS).text, "हाँ");

  const code = (contents) => {
    try {
      dealOffer.answerToOffer(contents, QUESTIONS);
      return "ok";
    } catch (err) {
      return err.code;
    }
  };
  assert.equal(code([offer]), "NO_ANSWER_YET", "/history may lag: no owner turn after the offer yet");
  assert.equal(code([asr("हाँ", 1)]), "NOT_OFFERED", "no offer line at all");
  assert.equal(code([offer, llm("और कुछ?", 3), asr("हाँ", 4)]), "NOT_OFFERED", "something else was said after the offer");
  assert.equal(code([offer, asr("शायद", 3), asr("हाँ", 4)]), "NOT_FIRST_ANSWER", "the yes came after a maybe");
  assert.equal(code([offer, { role: "assistant", tool_calls: [{ id: "c1", name: "sahay__get_job_status" }] }, asr("हाँ", 4)]), "NOT_OFFERED", "a tool ran in between");
  assert.equal(code([offer, { role: "user", content: "हाँ", metadata: { source: "message" }, turn_id: 3 }]), "NO_ANSWER_YET", "a typed yes is not a spoken answer");
  assert.equal(code([offer, { role: "user", content: "हाँ", metadata: { source: "message" }, turn_id: 3 }, asr("हाँ", 4)]), "NOT_OFFERED", "typed in between");
  assert.equal(code([offer, { role: "assistant", content: "अभी कोई मंज़ूरी बाकी नहीं है।", metadata: { source: "command" }, turn_id: 3 }, asr("हाँ", 4)]), "NOT_OFFERED", "a server line after the offer");
  assert.equal(code("not an array"), "NOT_OFFERED");
});

/* ------------------------------------------------------- through the tools --- */

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

function ownerCtx(businessId, agentId) {
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: session.id, agentId, actor: "agent", toolScope: "owner" };
}

/** A simulated vendor's complete deal: 50 kg basmati at 62/kg, freight 150, landed 3250. */
function seedQuote(businessId) {
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru", max_price: 70 });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders", listed_price: 65, listed_unit: "kg" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
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

/**
 * A live call at the Agora REST boundary, in the /history shape seen live (agora-findings.md
 * section 10): /speak lines are server lines (source "command"); the model's own lines are
 * source "llm"; a tool's call and result items are appended when the tool returns.
 */
function fakeCall(t) {
  const call = { spoken: [], items: [], turn: 0, nextCall: 0 };
  call.owner = (content) => call.items.push(asr(content, ++call.turn));
  call.model = (content) => call.items.push(llm(content, ++call.turn));
  /** The model calls a tool: its call and result items enter /history when it returns. */
  call.tool = async (ctx, name, args) => {
    const id = `call_${++call.nextCall}`;
    const done = (content) => {
      call.items.push({ role: "assistant", tool_calls: [{ id, name: `sahay__${name}`, arguments: JSON.stringify(args) }] });
      call.items.push({ role: "tool", tool_call_id: id, content });
    };
    try {
      const out = await registry.callTool(ctx, name, args);
      done(JSON.stringify(out));
      return out;
    } catch (err) {
      done(JSON.stringify({ error: err.code }));
      throw err;
    }
  };
  agent.setFetch(async (url, init) => {
    let json;
    if (/\/speak$/.test(url)) {
      const body = JSON.parse(init.body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
      json = { agent_id: "AG" };
    } else if (/\/history$/.test(url)) json = { contents: call.items.slice() };
    else throw new Error(`unexpected Agora call ${url}`);
    return new Response(JSON.stringify(json), { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return call;
}

async function expectToolError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ToolError, `ToolError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code);
    return true;
  });
}

/** get_ranked_deals as the model runs it, then the model says its `say` (ending in the offer question). */
async function dealsOffered(ctx, call) {
  call.owner("सबसे अच्छी डील बताओ");
  const deals = await call.tool(ctx, "get_ranked_deals", {});
  assert.equal(deals.approvalCanFollow, true);
  assert.ok(deals.say.endsWith(OFFER_HI), deals.say);
  call.model(deals.say);
  return deals;
}

const approvalRows = (businessId) => db.prepare("SELECT type FROM audit_log WHERE business_id = ? AND type LIKE 'approval.%' ORDER BY id").all(businessId).map((r) => r.type);

test("live check stall: a yes to 'read this deal out?' that reaches confirm_approval starts the read-back; nothing is approved until the yes after it", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, "AG-OFFER");
  const { quote } = seedQuote(businessId);
  const call = fakeCall(t);
  await dealsOffered(ctx, call);

  call.owner("हाँ");
  const asked = await call.tool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(asked.status, "pending");
  assert.equal(asked.readbackSpoken, true);
  assert.equal(asked.quoteId, quote.id, "the very deal that was offered");
  assert.equal(asked.say, "", "the read-back carries its own question; the model says nothing");
  assert.match(asked.hint, /Nothing is approved/);
  // The server spoke the read-back and recorded it, exactly as request_approval does.
  assert.match(call.spoken.join(" "), /Lakshmi Traders.*कुल 3250 रुपये/);
  const readbacks = repo.listApprovalReadbacks(businessId, { approval_id: asked.approvalId, agent_id: "AG-OFFER" });
  assert.equal(readbacks.length, 1);
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending", "the yes to the offer approves nothing");
  assert.equal(repo.listOrders(businessId).length, 0);
  assert.ok(!approvalRows(businessId).includes("approval.decided"));

  // The model says the short question; the owner's next spoken yes approves through the normal gate.
  call.model(asked.say);
  call.owner("हाँ जी");
  const ok = await call.tool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(ok.status, "approved");
  assert.equal(ok.evidenceUtterance, "हाँ जी");
  assert.match(ok.orderId, /^ord_/);
  assert.ok(ok.poNumber, "a purchase order number");
  assert.equal(repo.listOrders(businessId).length, 1);
  assert.equal(repo.getApproval(businessId, asked.approvalId).evidence_utterance, "हाँ जी");
});

test("a no, a maybe or a muddled answer to the offer starts nothing", async (t) => {
  for (const words of ["नहीं", "शायद", "हाँ पर कल?"]) {
    const businessId = seedBusiness("hi-IN");
    const ctx = ownerCtx(businessId, `AG-NO-${words.length}`);
    seedQuote(businessId);
    const call = fakeCall(t);
    await dealsOffered(ctx, call);
    call.owner(words);
    const spokenBefore = call.spoken.length;
    await expectToolError(call.tool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
    assert.equal(call.spoken.length, spokenBefore, `${words}: nothing read out`);
    assert.equal(repo.listApprovals(businessId).length, 0, `${words}: no approval put up`);
  }
});

test("a reject decision to the offer, or a yes to something said after it, starts nothing", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, "AG-REJ");
  seedQuote(businessId);
  const call = fakeCall(t);
  await dealsOffered(ctx, call);
  call.owner("हाँ");
  await expectToolError(call.tool(ctx, "confirm_approval", { decision: "reject" }), "NO_PENDING_APPROVAL");
  call.model("क्या आप किसी और चीज़ की मदद चाहती हैं?");
  call.owner("हाँ");
  await expectToolError(call.tool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  assert.equal(repo.listApprovals(businessId).length, 0);
});

test("an offer older than the window: NO_PENDING_APPROVAL as before", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, "AG-OLD");
  seedQuote(businessId);
  const call = fakeCall(t);
  await dealsOffered(ctx, call);
  const offer = dealOffer.current(businessId, "AG-OLD");
  assert.ok(offer, "get_ranked_deals recorded the offer");
  dealOffer.record(businessId, "AG-OLD", { quoteId: offer.quoteId, requirementId: offer.requirementId }, Date.now() - dealOffer.settings.windowMs - 1000);
  call.owner("हाँ");
  await expectToolError(call.tool(ctx, "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  assert.equal(repo.listApprovals(businessId).length, 0);
});

test("an offer made in another call, or with no offer recorded, starts nothing", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const first = ownerCtx(businessId, "AG-FIRST");
  seedQuote(businessId);
  const call = fakeCall(t);
  await dealsOffered(first, call);
  call.owner("हाँ");
  await expectToolError(call.tool(ownerCtx(businessId, "AG-SECOND"), "confirm_approval", { decision: "approve" }), "NO_PENDING_APPROVAL");
  assert.equal(repo.listApprovals(businessId).length, 0);
});

test("get_ranked_deals with nothing to offer forgets an earlier offer of this call", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ctx = ownerCtx(businessId, "AG-TIE");
  const { need, quote } = seedQuote(businessId);
  fakeCall(t);
  await registry.callTool(ctx, "get_ranked_deals", {});
  assert.ok(dealOffer.current(businessId, "AG-TIE"));
  repo.createQuote(businessId, { requirement_id: need.id, vendor_id: quote.vendor_id, unit_price: 62, unit: "kg", freight: 150, landed_cost: 3250 });
  const tied = await registry.callTool(ctx, "get_ranked_deals", {});
  assert.equal(tied.approvalCanFollow, false);
  assert.equal(dealOffer.current(businessId, "AG-TIE"), null);
});

test("the model's own route still works: a yes to the offer -> request_approval -> the yes after the read-back approves", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, "AG-MODEL");
  seedQuote(businessId);
  const call = fakeCall(t);
  await dealsOffered(ctx, call);
  call.owner("हाँ");
  const asked = await call.tool(ctx, "request_approval", {});
  assert.equal(asked.readbackSpoken, true);
  call.model(asked.say);
  call.owner("हाँ");
  const ok = await call.tool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(ok.status, "approved");
  assert.match(ok.orderId, /^ord_/);
});

test("the watchdog never takes the yes to the offer for an approval, and still acts on the yes after the read-back", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const ctx = ownerCtx(businessId, "AG-WATCH");
  seedQuote(businessId);
  const call = fakeCall(t);
  let now = Date.now();
  watch.configure({
    live: (id) => (id === businessId ? { agentId: ctx.agentId, sessionId: ctx.sessionId, language: "hi-IN" } : null),
    pollMs: 9 * 60 * 1000,
    graceMs: 6000,
    callTool: (c, name, args) => registry.callTool(c, name, args),
  });
  t.after(() => watch.unwatch(businessId));
  const tick = () => watch.tick(businessId, () => now);

  await dealsOffered(ctx, call);
  call.owner("हाँ");
  watch.watch(businessId);
  assert.equal(await tick(), "idle", "nothing was read out: the offer's yes waits on no read-back");
  assert.equal(repo.listApprovals(businessId).length, 0);

  // The model sends that yes to confirm_approval: the server reads the deal out instead.
  const asked = await call.tool(ctx, "confirm_approval", { decision: "approve" });
  assert.equal(asked.readbackSpoken, true);
  watch.watch(businessId);
  assert.equal(await tick(), "waiting", "the yes before the read-back does not answer it");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "pending");

  // The model says the question, the owner says yes, and the model calls nothing: the confirm_approval
  // call that started the read-back must not count as the model answering it.
  call.model(asked.say);
  call.owner("हाँ जी");
  assert.equal(await tick(), "grace");
  now += 6100;
  assert.equal(await tick(), "acted");
  assert.equal(repo.getApproval(businessId, asked.approvalId).status, "consumed", "approved, and the order placed on it");
  assert.equal(repo.getApproval(businessId, asked.approvalId).evidence_utterance, "हाँ जी");
  assert.equal(repo.listOrders(businessId).length, 1);
});
