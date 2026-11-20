"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
  // Override the developer's demo delay from .env (loadEnvFile never overwrites a set key).
  FOLLOWUP_DELAY_SECONDS: "",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const followups = require("../src/followups");
const telegram = require("../src/notify/telegram");
const repo = require("../src/db/repo");
const events = require("../src/events");
const approvals = require("../src/approvals");
const orders = require("../src/orders");

const HOUR = 60 * 60 * 1000;

function fakeTelegram(t) {
  const sent = [];
  telegram.setFetch(async (url, init) => {
    const method = String(url).split("/").pop();
    sent.push({ method, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  });
  t.after(() => telegram.setFetch(null));
  return sent;
}

/** A real order through the approval gate: 50 kg rice at 62/kg + 150 freight, 3 days lead time. */
async function seedOrder({ language = "hi-IN", leadTime = 3, simulated = false } = {}) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Kirana", city: "Bengaluru", language });
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: simulated ? "simulated" : "human" });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: vendor.id, negotiation_id: negotiation.id,
    unit_price: 62, unit: "kg", lead_time_days: leadTime, freight: 150, landed_cost: 3250,
  });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  const order = await orders.createOrder(businessId, approval.id);
  return { businessId, order };
}

test("scheduleForOrder creates payment_due (+24 h) and delivery_check (+lead time) with native-script messages, once", async () => {
  const { businessId, order } = await seedOrder({ language: "hi-IN", leadTime: 3 });
  const now = Date.parse("2026-11-19T10:00:00Z");
  const rows = followups.scheduleForOrder(businessId, order.id, { now });
  assert.equal(rows.length, 2);
  const [pay, delivery] = rows;
  assert.equal(pay.kind, "payment_due");
  assert.equal(pay.due_at, new Date(now + 24 * HOUR).toISOString());
  assert.equal(pay.message, `भुगतान बाकी है: ऑर्डर ${order.po_number}, 3250 रुपये।`);
  assert.equal(delivery.kind, "delivery_check");
  assert.equal(delivery.due_at, new Date(now + 3 * 24 * HOUR).toISOString());
  assert.equal(followups.scheduleForOrder(businessId, order.id, { now }).length, 0, "idempotent");
});

test("no delivery check is invented when the vendor gave no lead time", async () => {
  const { businessId, order } = await seedOrder({ leadTime: null });
  const rows = followups.scheduleForOrder(businessId, order.id);
  assert.deepEqual(rows.map((r) => r.kind), ["payment_due"]);
});

test("tick fires what is due: followup.fired event + Telegram to the linked chat; later rows wait", async (t) => {
  const sent = fakeTelegram(t);
  const { businessId, order } = await seedOrder({ language: "en-IN" });
  repo.setTelegramLink(businessId, "321");
  const now = Date.now();
  followups.scheduleForOrder(businessId, order.id, { now });
  const fired = [];
  const stop = events.subscribe(businessId, (e) => e.type === "followup.fired" && fired.push(e.data));

  // tick() counts every business's rows (other tests schedule at fixed dates), so check this order only.
  await followups.tick({ now: now + HOUR });
  assert.equal(fired.filter((d) => d.orderId === order.id).length, 0, "nothing due yet");
  await followups.tick({ now: now + 25 * HOUR });
  stop();
  const mine = fired.filter((d) => d.orderId === order.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, "payment_due");
  assert.equal(mine[0].message, `Payment is due: order ${order.po_number}, 3250 rupees.`);
  assert.ok(sent.some((s) => s.method === "sendMessage" && s.body.chat_id === "321" && s.body.text === mine[0].message));
  const rows = repo.listFollowups(businessId, { order_id: order.id });
  assert.equal(rows.find((r) => r.kind === "payment_due").status, "fired");
  assert.equal(rows.find((r) => r.kind === "delivery_check").status, "scheduled");
});

test("a follow-up whose order is already settled is cancelled, not fired", async () => {
  const { businessId, order } = await seedOrder();
  const now = Date.now();
  followups.scheduleForOrder(businessId, order.id, { now });
  orders.advanceOrder(businessId, order.id, "cancelled");
  await followups.tick({ now: now + 10 * 24 * HOUR });
  const rows = repo.listFollowups(businessId, { order_id: order.id });
  assert.ok(rows.every((r) => r.status === "cancelled"), JSON.stringify(rows.map((r) => r.status)));
});

test("order.created schedules follow-ups and sends the confirmed order with its PO PDF; payment.link sends the link", async (t) => {
  const sent = fakeTelegram(t);
  const { businessId, order } = await seedOrder({ language: "en-IN" });
  repo.setTelegramLink(businessId, "654");
  await followups.onEvent({ businessId, type: "order.created", data: { orderId: order.id, poNumber: order.po_number, vendor: "Lakshmi Traders", amount: 3250 } });
  assert.equal(repo.listFollowups(businessId, { order_id: order.id }).length, 2);
  assert.equal(sent[0].method, "sendMessage");
  assert.equal(sent[0].body.text, `Order confirmed: ${order.po_number}, Lakshmi Traders, 3250 rupees. The purchase order is attached.`);
  assert.equal(sent[1].method, "sendDocument");

  await followups.onEvent({ businessId, type: "payment.link", data: { orderId: order.id, poNumber: order.po_number, url: "https://rzp.io/i/abc" } });
  assert.equal(sent[2].body.text, `Payment link (Razorpay test mode) for order ${order.po_number}: https://rzp.io/i/abc`);
});

test("a failing Telegram send becomes an error event, never a crash", async (t) => {
  telegram.setFetch(async () => new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 }));
  t.after(() => telegram.setFetch(null));
  const { businessId, order } = await seedOrder();
  repo.setTelegramLink(businessId, "1");
  const errors = [];
  const stop = events.subscribe(businessId, (e) => e.type === "error" && errors.push(e.data));
  const now = Date.now();
  followups.scheduleForOrder(businessId, order.id, { now });
  await followups.tick({ now: now + 25 * HOUR });
  stop();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].scope, "telegram");
});

test("review #10: every follow-up and Telegram message about a simulated vendor's order says so", async (t) => {
  const sent = fakeTelegram(t);
  for (const [language, label] of [["en-IN", "(simulated vendor)"], ["hi-IN", "(सिम्युलेटेड विक्रेता)"], ["kn-IN", "(ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)"]]) {
    const { businessId, order } = await seedOrder({ language, simulated: true });
    assert.equal(order.simulated, true);
    repo.setTelegramLink(businessId, `chat-${language}`);
    const rows = followups.scheduleForOrder(businessId, order.id);
    assert.deepEqual(rows.map((r) => r.kind), ["payment_due", "delivery_check"]);
    for (const row of rows) assert.ok(row.message.includes(label), `${language} ${row.kind}: ${row.message}`);

    // The label comes from the order itself, not from what the event claims.
    await followups.onEvent({ businessId, type: "order.created", data: { orderId: order.id, poNumber: order.po_number, vendor: "Lakshmi Traders", amount: 3100, simulated: false } });
    await followups.onEvent({ businessId, type: "payment.link", data: { orderId: order.id, poNumber: order.po_number, url: "https://rzp.io/i/sim" } });
    const texts = sent.filter((s) => s.body.chat_id === `chat-${language}` && s.method === "sendMessage").map((s) => s.body.text);
    assert.equal(texts.length, 2);
    for (const text of texts) assert.ok(text.includes(label), `${language}: ${text}`);
  }
  // A real vendor's order carries no such label.
  const real = await seedOrder({ language: "en-IN" });
  assert.ok(followups.scheduleForOrder(real.businessId, real.order.id).every((row) => !/simulated/.test(row.message)));
});

test("e2e r3: a follow-up fires at its due time (its own timer), not on the next 30 s tick", async (t) => {
  const { businessId, order } = await seedOrder({ language: "en-IN", leadTime: null });
  const stop = followups.start({ intervalMs: 60 * 60 * 1000 }); // the ticker cannot be what fires it
  t.after(stop);
  const due = Date.now() + 250;
  const [row] = followups.scheduleForOrder(businessId, order.id, { now: due - 24 * HOUR });
  followups.arm([row]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const fired = repo.listFollowups(businessId, { order_id: order.id })[0];
  assert.equal(fired.status, "fired");
  const lateMs = Date.parse(fired.fired_at) - Date.parse(fired.due_at);
  assert.ok(lateMs >= 0 && lateMs < 400, `fired ${lateMs} ms after due`);
  assert.ok(followups.DEMO_TICK_MS <= 5000, "the demo ticker runs at least every 5 s");
});

test("a verified payment (order.paid) cancels the order's payment reminder at once and tells the owner; other follow-ups stay", async (t) => {
  const sent = fakeTelegram(t);
  const { businessId, order } = await seedOrder({ language: "hi-IN", simulated: true });
  repo.setTelegramLink(businessId, "777");
  followups.scheduleForOrder(businessId, order.id);
  await followups.onEvent({ businessId, type: "order.paid", data: { orderId: order.id } });
  const rows = repo.listFollowups(businessId, { order_id: order.id });
  assert.equal(rows.find((r) => r.kind === "payment_due").status, "cancelled");
  assert.equal(rows.find((r) => r.kind === "delivery_check").status, "scheduled");
  assert.equal(sent.at(-1).body.text, `भुगतान मिल गया (Razorpay टेस्ट मोड): ऑर्डर ${order.po_number} (सिम्युलेटेड विक्रेता), 3250 रुपये।`);
  assert.equal(followups.cancelPaymentDue(businessId, order.id), 0, "nothing left to cancel");
  // another business cannot cancel this one's reminders
  const other = await seedOrder();
  followups.scheduleForOrder(other.businessId, other.order.id);
  assert.equal(followups.cancelPaymentDue(businessId, other.order.id), 0);
  assert.equal(repo.listFollowups(other.businessId, { order_id: other.order.id }).find((r) => r.kind === "payment_due").status, "scheduled");
});

test("E2E regress bug 2: a demo delay never puts the payment reminder on top of the order's own spoken result", async () => {
  const { businessId, order } = await seedOrder({ language: "en-IN", leadTime: 1 });
  const now = Date.now();
  const rows = followups.scheduleForOrder(businessId, order.id, { now, demoSeconds: 5 });
  const due = Object.fromEntries(rows.map((r) => [r.kind, Date.parse(r.due_at) - now]));
  assert.equal(due.payment_due, followups.MIN_DEMO_DELAY_SECONDS * 1000, "a short demo delay is raised to the minimum");
  assert.equal(due.delivery_check, 2 * followups.MIN_DEMO_DELAY_SECONDS * 1000);
  assert.ok(followups.MIN_DEMO_DELAY_SECONDS >= 30);

  const other = await seedOrder({ language: "en-IN", leadTime: null });
  const [late] = followups.scheduleForOrder(other.businessId, other.order.id, { now, demoSeconds: 90 });
  assert.equal(Date.parse(late.due_at) - now, 90 * 1000, "a longer demo delay is kept as set");
});
