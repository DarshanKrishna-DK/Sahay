"use strict";

// End to end, with every network boundary faked (Agora REST, Telegram Bot API, IndiaMART, Groq):
// the owner's own supplier is shortlisted first, start_negotiation invites them on Telegram, they
// join the page and negotiate with the agent, the quote goes through the owner's yes to an order,
// and only then does the supplier get a Telegram confirmation.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FAKE } = require("./_env");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sahay-supplier-"));
Object.assign(process.env, {
  DB_FILE: path.join(TMP, "sahay.db"), // purchase order PDFs are written beside it
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  GROQ_API_KEY: FAKE.GROQ_API_KEY,
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
});

const assert = require("node:assert/strict");
const { test, after } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const store = require("../src/db/suppliers");
const suppliers = require("../src/suppliers");
const telegram = require("../src/notify/telegram");
const session = require("../src/negotiation/session");
const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const jobs = require("../src/jobs");
const events = require("../src/events");
const approvals = require("../src/approvals");
const orders = require("../src/orders");
const { splitUtf8 } = require("../src/agora/agent");

session.configureTiming({ pollMs: 5, closingGraceMs: 5, msPerChar: 0, minLineMs: 1, humanJoinMs: 5000, humanTurnStallMs: 5000, maxMs: 8000 });

after(() => {
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;

/** IndiaMART is down and Groq refuses: neither may be needed for a deal with the owner's own supplier. */
function otherNetworkDown(t) {
  globalThis.fetch = async (url) => {
    if (/indiamart/.test(String(url))) throw new TypeError("fetch failed");
    if (/groq\.com/.test(String(url))) return new Response(JSON.stringify({ error: { message: "no model in tests" } }), { status: 400 });
    throw new Error(`unexpected network call: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
}

/** Fake Telegram Bot API. Set `calls.failChat` to make sends to that chat fail as Telegram does for a blocked bot. */
function fakeTelegram(t) {
  const calls = [];
  calls.failChat = null;
  telegram.setFetch(async (url, init) => {
    const method = String(url).split("/").pop();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, body });
    if (calls.failChat && String(body.chat_id) === calls.failChat) return new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), { status: 200 });
  });
  t.after(() => telegram.setFetch(null));
  return calls;
}

function fakeAgora(t, history) {
  const calls = [];
  let n = 0;
  agent.setFetch(async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/join")) {
      n += 1;
      return new Response(JSON.stringify({ agent_id: `${body.properties.labels.role}-${n}`, status: "RUNNING" }), { status: 200 });
    }
    if (/\/history$/.test(url)) return new Response(JSON.stringify({ contents: history }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return calls;
}

async function until(predicate, ms = 8000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let turnId = 0;
const said = (history, role, content) => history.push({ role, content, metadata: { source: role === "user" ? "asr" : "llm" }, timestamp: Date.now(), turn_id: ++turnId });

/** An owner (English) whose own Hindi-speaking supplier is linked on Telegram chat 777; the owner's notifier chat is 111. */
async function seed(t) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Kirana", owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language: "en-IN" });
  repo.setTelegramLink(businessId, "111");
  const { supplier, invite } = await suppliers.addSupplier(businessId, { name: "Ramesh Traders", items: ["rice"], language: "hi-IN" });
  await telegram.handleUpdate({ update_id: 1, message: { message_id: 1, text: `/start ${invite.code}`, chat: { id: 777, type: "private" } } });
  const owner = repo.createSession(businessId, { kind: "owner", channel: `own-${turnId}`, status: "active" });
  const ctx = { businessId, sessionId: owner.id, agentId: null, actor: "agent", toolScope: "owner" };
  return { businessId, supplier: store.getSupplier(businessId, supplier.id), ctx };
}

async function sourcedNeed(ctx) {
  const saved = repo.createRequirement(ctx.businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru", max_price: 70 });
  const { jobId } = await registry.callTool(ctx, "start_sourcing", { requirementId: saved.id });
  await jobs.whenSettled(jobId);
  return { need: saved, job: repo.getJob(ctx.businessId, jobId) };
}

test("own supplier: shortlisted first, invited on Telegram, negotiates live, and hears of the order only after the owner's yes", async (t) => {
  otherNetworkDown(t);
  const tg = fakeTelegram(t);
  const history = [];
  const agora = fakeAgora(t, history);
  const stop = suppliers.start();
  t.after(stop);
  const { businessId, supplier, ctx } = await seed(t);
  const turns = [];
  t.after(events.subscribe(businessId, (e) => e.type === "negotiation.turn" && turns.push(e.data)));

  // Sourcing: IndiaMART is unreachable, the own supplier is still a result, and the failure is said.
  const { need, job } = await sourcedNeed(ctx);
  assert.equal(job.status, "done", job.error ?? "");
  assert.ok(job.progress.some((p) => /Your own supplier Ramesh Traders sells this/.test(p.message)));
  assert.ok(job.progress.some((p) => /IndiaMART could not be searched/.test(p.message)));
  assert.deepEqual(job.result.ownSuppliers, ["Ramesh Traders"]);

  const shortlist = await registry.callTool(ctx, "get_shortlist", { requirementId: need.id, reply_language: "en-IN" });
  assert.equal(shortlist.vendors[0].ownSupplier, true);
  assert.equal(shortlist.vendors[0].real, true);
  assert.equal(shortlist.vendors[0].simulated, false);
  assert.equal(shortlist.say, "Your own supplier Ramesh Traders is first; I can reach them on Telegram.");

  // start_negotiation with no vendor named goes to the own supplier, as a real person, in their language.
  tg.length = 0;
  const started = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" });
  assert.equal(started.counterpart, "human");
  assert.equal(started.ownSupplier, true);
  assert.equal(started.invitedOn, "telegram");
  assert.equal(started.say, "I've sent Ramesh Traders a message on Telegram; I'll start as soon as they join.");
  const invite = tg.find((c) => c.body.chat_id === "777");
  assert.ok(invite, "the supplier's chat got the link");
  assert.match(invite.body.text, /^नमस्ते, मैं सहाय हूँ, Asha Kirana की ओर से बात करने वाली एक स्वचालित सहायक।/);
  assert.ok(invite.body.text.includes(started.joinUrl));
  assert.equal(invite.body.reply_markup.inline_keyboard[0][0].url, started.joinUrl);
  assert.ok(!agora.some((c) => c.url.endsWith("/join")), "no agent until the supplier is in the channel");

  // The supplier opens the page and joins.
  const code = started.joinUrl.split("/").pop();
  const info = session.humanJoinInfo(code);
  assert.equal(info.language, "hi-IN");
  assert.equal(info.vendorName, "Ramesh Traders");
  assert.match(info.disclosure, /स्वचालित सहायक/);
  assert.equal(session.humanCallState(code, { renewKey: "guess" }), null, "the state is only for the page that joined");
  assert.equal(await session.humanJoined(code), true);
  await until(() => agora.some((c) => c.url.endsWith("/think")));
  const join = agora.find((c) => c.url.endsWith("/join"));
  assert.equal(join.body.properties.labels.role, "negotiator");
  assert.match(agora.find((c) => c.url.endsWith("/speak")).body.text, /स्वचालित सहायक/, "disclosure first, in Hindi");
  assert.equal(session.humanCallState(code, { renewKey: info.renewKey }).status, "live");

  const negSession = repo.listSessions(businessId, { kind: "negotiation" })[0];
  const neg = { businessId, sessionId: negSession.id, agentId: negSession.agent_id, actor: "agent", toolScope: "negotiation" };
  const brief = await registry.callTool(neg, "get_negotiation_brief", {});
  said(history, "assistant", brief.say);
  said(history, "user", "भाई 64 रुपये किलो लगेगा");
  const counter = await registry.callTool(neg, "record_vendor_offer", { price_per_unit: 64, unit: "kg", vendor_sentence: "भाई 64 रुपये किलो लगेगा" });
  assert.equal(counter.action, "counter");
  assert.ok(counter.price <= 70, "never above the owner's max (no listed price: the owner's max is the ceiling)");
  said(history, "assistant", counter.say);
  said(history, "user", "ठीक है, 60 रुपये किलो दे दूँगा");
  const accept = await registry.callTool(neg, "record_vendor_offer", { price_per_unit: 60, vendor_sentence: "ठीक है, 60 रुपये किलो दे दूँगा" });
  assert.equal(accept.action, "accept");
  said(history, "assistant", accept.say);
  const negJob = repo.listJobs(businessId, { kind: "negotiation" })[0];
  await jobs.whenSettled(negJob.id);
  assert.equal(repo.getJob(businessId, negJob.id).status, "done", repo.getJob(businessId, negJob.id).error ?? "");

  // The owner's app saw every turn with the supplier's name and the real flag; the transcript is stored.
  const vendorTurn = turns.find((d) => d.speaker === "vendor");
  assert.equal(vendorTurn.vendorName, "Ramesh Traders");
  assert.equal(vendorTurn.name, "Ramesh Traders");
  assert.equal(vendorTurn.real, true);
  assert.equal(vendorTurn.simulated, false);
  assert.equal(vendorTurn.ownSupplier, true);
  const stored = repo.getNegotiation(businessId, started.negotiationId);
  assert.equal(stored.status, "agreed");
  assert.ok(stored.transcript.some((x) => x.speaker === "vendor" && x.name === "Ramesh Traders" && /60/.test(x.text)));
  assert.ok(stored.transcript.every((x) => !x.simulated));

  // The page still shows the ended call, with both sides, to the page that joined.
  const page = session.humanCallState(code, { renewKey: info.renewKey });
  assert.equal(page.status, "ended");
  assert.equal(page.agreed, true);
  assert.ok(page.turns.some((x) => x.speaker === "vendor") && page.turns.some((x) => x.speaker === "agent"));

  // The quote is real (not simulated) and needs the owner's yes before any order.
  const [quote] = repo.listQuotes(businessId, { requirement_id: need.id });
  assert.equal(quote.unit_price, 60);
  assert.equal(quote.simulated, false);
  const sentBefore = tg.filter((c) => c.body.chat_id === "777").length;
  const { approval } = approvals.requestApproval(businessId, quote.id);
  await assert.rejects(orders.createOrder(businessId, approval.id), /approv/i, "no order without the owner's yes");
  assert.equal(tg.filter((c) => c.body.chat_id === "777").length, sentBefore, "nothing sent to the supplier before the yes");

  approvals.recordReadbackSpoken(businessId, approval.id, { agentId: "AG-1", text: approval.readback });
  const answer = [
    ...splitUtf8(approval.readback).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 100 + i })),
    { role: "user", content: "yes go ahead", metadata: { source: "asr" }, turn_id: 200 },
  ];
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "voice", agentId: "AG-1", history: answer });
  const order = await orders.createOrder(businessId, approval.id);
  await until(() => tg.some((c) => c.body.chat_id === "777" && c.body.text.includes(order.po_number)));
  const confirmation = tg.find((c) => c.body.chat_id === "777" && c.body.text.includes(order.po_number));
  assert.match(confirmation.body.text, /^नमस्ते, मैं सहाय हूँ, Asha Kirana की ओर से बात करने वाली एक स्वचालित सहायक। Asha Kirana ने आपसे 50 किलो .+ का ऑर्डर पक्का किया है: 60 रुपये प्रति किलो, कुल /);
  assert.equal(supplier.telegram_chat_id, "777");
});

test("a supplier whose Telegram refuses the message: the negotiation is withdrawn and the owner hears why", async (t) => {
  otherNetworkDown(t);
  const tg = fakeTelegram(t);
  fakeAgora(t, []);
  const { ctx } = await seed(t);
  const { need } = await sourcedNeed(ctx);
  tg.failChat = "777"; // the supplier blocked the bot after linking
  await assert.rejects(registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" }), (err) => {
    assert.equal(err.code, "SUPPLIER_UNREACHABLE");
    assert.equal(err.say, "My Telegram message to Ramesh Traders did not go through, so I have not started; the reason is on the screen.");
    return true;
  });
  const negJob = repo.listJobs(ctx.businessId, { kind: "negotiation" })[0];
  await jobs.whenSettled(negJob.id);
  assert.equal(repo.getJob(ctx.businessId, negJob.id).status, "cancelled");
  // Nothing is left holding the business's one negotiation slot.
  tg.failChat = null;
  const again = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" });
  assert.equal(again.ownSupplier, true);
  jobs.cancelJob(ctx.businessId, again.jobId);
  await jobs.whenSettled(again.jobId);
});

test("a supplier who does not join in time: the job fails with VENDOR_DID_NOT_JOIN, no agent ever started, the owner is told", async (t) => {
  otherNetworkDown(t);
  const tg = fakeTelegram(t);
  const agora = fakeAgora(t, []);
  const stop = suppliers.start();
  t.after(stop);
  session.configureTiming({ humanJoinMs: 40 });
  t.after(() => session.configureTiming({ humanJoinMs: 5000 }));
  const { ctx } = await seed(t);
  const { need } = await sourcedNeed(ctx);
  const started = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" });
  await jobs.whenSettled(started.jobId);
  const job = repo.getJob(ctx.businessId, started.jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /Ramesh Traders did not open the Telegram link/);
  assert.ok(!agora.some((c) => c.url.endsWith("/join")), "no agent minutes spent");
  await until(() => tg.some((c) => c.body.chat_id === "111" && /did not open the link/.test(c.body.text)));
});

test("asking for a simulated vendor while the supplier has not joined withdraws the invitation first", async (t) => {
  otherNetworkDown(t);
  fakeTelegram(t);
  fakeAgora(t, []);
  const { ctx } = await seed(t);
  const { need } = await sourcedNeed(ctx);
  // A listing with a price, so a simulated vendor can be priced from it.
  repo.createVendor(ctx.businessId, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders", listed_price: 62, listed_unit: "kg", score: 0.5 });
  const human = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" });
  const simulated = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, counterpart: "simulated", reply_language: "en-IN" });
  assert.equal(repo.getJob(ctx.businessId, human.jobId).status, "cancelled");
  assert.equal(simulated.counterpart, "simulated");
  assert.equal(simulated.ownSupplier, false);
  assert.equal(simulated.vendorName, "Lakshmi Traders");
  jobs.cancelJob(ctx.businessId, simulated.jobId);
  await jobs.whenSettled(simulated.jobId);
});

test("the supplier pressing End stops the negotiation honestly, with no deal", async (t) => {
  otherNetworkDown(t);
  fakeTelegram(t);
  fakeAgora(t, []);
  const { ctx } = await seed(t);
  const { need } = await sourcedNeed(ctx);
  const started = await registry.callTool(ctx, "start_negotiation", { requirementId: need.id, reply_language: "en-IN" });
  const code = started.joinUrl.split("/").pop();
  const info = session.humanJoinInfo(code);
  assert.equal(session.humanLeft(code, { renewKey: "guess" }), false);
  await session.humanJoined(code);
  assert.equal(session.humanLeft(code, { renewKey: info.renewKey }), true);
  await jobs.whenSettled(started.jobId);
  assert.equal(repo.getNegotiation(ctx.businessId, started.negotiationId).status, "no_deal");
  assert.equal(repo.listQuotes(ctx.businessId, { requirement_id: need.id }).length, 0);
});
