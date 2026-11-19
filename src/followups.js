"use strict";

/**
 * Follow-ups after an order: rows in `followups`, fired by a ticker.
 *
 * When an order is created (event order.created, whatever path created it):
 *   - payment_due: 24 hours later, unless the order is paid or closed by then;
 *   - delivery_check: when the quoted lead time is up (only if the vendor stated one).
 * A due row is marked fired, emitted as followup.fired (the narrator speaks it in
 * the active owner call, or at the start of the next one) and sent to the owner's
 * linked Telegram chat. The owner also gets the confirmed order with its PO PDF and
 * the payment link on Telegram.
 *
 * Demo: config.followups.delaySeconds (env FOLLOWUP_DELAY_SECONDS, read in
 * src/config.js) makes payment_due fire that many seconds after the order and
 * delivery_check twice that, instead of the real intervals. A demo delay is never shorter than
 * MIN_DEMO_DELAY_SECONDS, so the reminder cannot land on top of the order's own spoken result
 * (E2E regress bug 2); in a call the narrator also waits for a quiet moment to say it.
 *
 * Timing: every row scheduled while the server runs gets its own timer at its due
 * time, so it fires on time (e2e r3: a 30 s ticker fired one 20 s late). The ticker
 * remains for rows due across a restart; it runs every DEMO_TICK_MS in demo mode.
 * A verified payment (event order.paid) cancels the order's payment_due at once.
 */

const { config } = require("./config");
const repo = require("./db/repo");
const events = require("./events");
const telegram = require("./notify/telegram");
const { langKey } = require("./tools/errors");

const TICK_MS = 30000;
const DEMO_TICK_MS = 2000;
/** Timers further out than this are left to the ticker (setTimeout caps at about 24.8 days). */
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;
const PAYMENT_DUE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PDF_WAIT_MS = 15000;
const MIN_DEMO_DELAY_SECONDS = 30;

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));
const SIM = { "hi-IN": " (सिम्युलेटेड विक्रेता)", "kn-IN": " (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)", "en-IN": " (simulated vendor)" };

const TEXT = {
  payment_due: {
    "hi-IN": (v) => `भुगतान बाकी है: ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""}, ${v.amount} रुपये।`,
    "kn-IN": (v) => `ಪಾವತಿ ಬಾಕಿ ಇದೆ: ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""}, ${v.amount} ರೂಪಾಯಿ.`,
    "en-IN": (v) => `Payment is due: order ${v.po}${v.sim ? SIM["en-IN"] : ""}, ${v.amount} rupees.`,
  },
  delivery_check: {
    "hi-IN": (v) => `ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""} की डिलीवरी का समय हो गया है, क्या माल पहुँच गया?`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""} ಡೆಲಿವರಿ ಸಮಯ ಬಂದಿದೆ, ಸರಕು ತಲುಪಿದೆಯೇ?`,
    "en-IN": (v) => `Order ${v.po}${v.sim ? SIM["en-IN"] : ""} is due for delivery; has it arrived?`,
  },
  order_confirmed: {
    "hi-IN": (v) => `ऑर्डर पक्का: ${v.po}, ${v.vendor}${v.sim ? SIM["hi-IN"] : ""}, ${v.amount} रुपये। खरीद आदेश साथ में है।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ಖಚಿತ: ${v.po}, ${v.vendor}${v.sim ? SIM["kn-IN"] : ""}, ${v.amount} ರೂಪಾಯಿ. ಖರೀದಿ ಆದೇಶ ಜೊತೆಗಿದೆ.`,
    "en-IN": (v) => `Order confirmed: ${v.po}, ${v.vendor}${v.sim ? SIM["en-IN"] : ""}, ${v.amount} rupees. The purchase order is attached.`,
  },
  payment_link: {
    "hi-IN": (v) => `भुगतान लिंक (Razorpay टेस्ट मोड), ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""}: ${v.url}`,
    "kn-IN": (v) => `ಪಾವತಿ ಲಿಂಕ್ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್), ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""}: ${v.url}`,
    "en-IN": (v) => `Payment link (Razorpay test mode) for order ${v.po}${v.sim ? SIM["en-IN"] : ""}: ${v.url}`,
  },
  payment_received: {
    "hi-IN": (v) => `भुगतान मिल गया (Razorpay टेस्ट मोड): ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""}, ${v.amount} रुपये।`,
    "kn-IN": (v) => `ಪಾವತಿ ಬಂದಿದೆ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್): ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""}, ${v.amount} ರೂಪಾಯಿ.`,
    "en-IN": (v) => `Payment received (Razorpay test mode): order ${v.po}${v.sim ? SIM["en-IN"] : ""}, ${v.amount} rupees.`,
  },
};

const text = (key, language, vars) => TEXT[key][langKey(language)](vars);
const languageOf = (businessId) => langKey(repo.getBusiness(businessId)?.language);

/** Seconds from config, or null for the real intervals. */
function demoDelaySeconds() {
  const value = config.followups?.delaySeconds;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Statuses after which a follow-up has nothing left to ask. */
const SETTLED_FOR = {
  payment_due: new Set(["paid", "cancelled", "closed", "delivered"]),
  delivery_check: new Set(["delivered", "cancelled", "closed"]),
};

/**
 * Create the follow-up rows for a new order. Idempotent per order.
 * @returns {object[]} the rows created
 */
function scheduleForOrder(businessId, orderId, { now = Date.now(), demoSeconds = demoDelaySeconds() } = {}) {
  if (repo.listFollowups(businessId, { order_id: orderId }).length) return [];
  const order = repo.getOrder(businessId, orderId);
  if (!order) return [];
  const quote = repo.getQuote(businessId, order.quote_id);
  const language = languageOf(businessId);
  const demo = demoSeconds ? Math.max(demoSeconds, MIN_DEMO_DELAY_SECONDS) : null;
  const rows = [];

  rows.push(
    repo.createFollowup(businessId, {
      order_id: order.id,
      kind: "payment_due",
      due_at: new Date(now + (demo ? demo * 1000 : PAYMENT_DUE_MS)).toISOString(),
      message: text("payment_due", language, { po: order.po_number, amount: money(order.amount), sim: Boolean(order.simulated) }),
    }),
  );
  if (quote?.lead_time_days != null) {
    rows.push(
      repo.createFollowup(businessId, {
        order_id: order.id,
        kind: "delivery_check",
        due_at: new Date(now + (demo ? 2 * demo * 1000 : quote.lead_time_days * DAY_MS)).toISOString(),
        message: text("delivery_check", language, { po: order.po_number, sim: Boolean(order.simulated) }),
      }),
    );
  }
  return rows;
}

async function notify(businessId, message, options) {
  try {
    return await telegram.sendToOwner(businessId, message, options);
  } catch (err) {
    events.emit(businessId, "error", { code: err.code ?? "TELEGRAM_FAILED", message: err.message, scope: "telegram" }, { actor: "system" });
    return { sent: false, reason: "error" };
  }
}

/** Fire every due follow-up once. Returns the number fired. */
async function tick({ now = Date.now() } = {}) {
  let fired = 0;
  for (const row of repo.system.listDueFollowups(new Date(now).toISOString())) {
    const order = row.order_id ? repo.getOrder(row.business_id, row.order_id) : null;
    if (order && SETTLED_FOR[row.kind]?.has(order.status)) {
      repo.settleFollowup(row.business_id, row.id, "cancelled");
      continue;
    }
    if (!repo.settleFollowup(row.business_id, row.id, "fired")) continue; // another tick got it
    fired += 1;
    events.emit(
      row.business_id,
      "followup.fired",
      { followupId: row.id, orderId: row.order_id, kind: row.kind, message: row.message, due_at: row.due_at },
      { actor: "system" },
    );
    if (row.message) await notify(row.business_id, row.message);
  }
  return fired;
}

/** Wait for createOrder to store the PO PDF path (it is written right after the event). */
async function pdfPathOf(businessId, orderId, waitMs = PDF_WAIT_MS) {
  const until = Date.now() + waitMs;
  for (;;) {
    const order = repo.getOrder(businessId, orderId);
    if (order?.pdf_path) return order.pdf_path;
    if (Date.now() >= until) return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Cancel the order's scheduled payment reminder once a verified payment is in. Returns how many. */
function cancelPaymentDue(businessId, orderId) {
  let cancelled = 0;
  for (const row of repo.listFollowups(businessId, { order_id: orderId, status: "scheduled" })) {
    if (row.kind === "payment_due" && repo.settleFollowup(businessId, row.id, "cancelled")) cancelled += 1;
  }
  return cancelled;
}

/** The running scheduler (start), so new rows get a timer at their due time. */
let scheduler = null;

/** Give follow-up rows a timer at their due time (no-op unless start() is running). */
const arm = (rows) => scheduler?.arm(rows);

async function onEvent(event) {
  const d = event.data ?? {};
  if (event.type === "order.created" && d.orderId) {
    arm(scheduleForOrder(event.businessId, d.orderId));
    const language = languageOf(event.businessId);
    // The order row, not the event, says whether the vendor is simulated.
    const sim = repo.isSimulated(event.businessId, { orderId: d.orderId });
    const message = text("order_confirmed", language, { po: d.poNumber, vendor: d.vendor ?? "", sim, amount: money(d.amount) });
    const documentPath = await pdfPathOf(event.businessId, d.orderId);
    await notify(event.businessId, message, documentPath ? { documentPath } : {});
  } else if (event.type === "payment.link" && d.url) {
    const language = languageOf(event.businessId);
    const sim = repo.isSimulated(event.businessId, { orderId: d.orderId });
    await notify(event.businessId, text("payment_link", language, { po: d.poNumber ?? "", url: d.url, sim }));
  } else if (event.type === "order.paid" && d.orderId) {
    cancelPaymentDue(event.businessId, d.orderId);
    const order = repo.getOrder(event.businessId, d.orderId);
    if (!order) return;
    const language = languageOf(event.businessId);
    await notify(event.businessId, text("payment_received", language, { po: order.po_number, amount: money(order.amount), sim: Boolean(order.simulated) }));
  }
}

/**
 * Start listening for orders, the per-row timers and the ticker. Returns stop().
 * @param {{intervalMs?: number, timerSlackMs?: number}} [options]
 */
function start({ intervalMs = demoDelaySeconds() ? DEMO_TICK_MS : TICK_MS, timerSlackMs = 50 } = {}) {
  const unsubscribe = events.subscribeAll(onEvent);
  const timers = new Set();
  let running = false;
  let again = false;

  // One tick at a time; a timer that lands during a tick makes it run once more right after.
  async function runTick() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await tick();
      } while (again);
    } catch (err) {
      console.error(`[followups] tick failed: ${err.message}`);
    } finally {
      running = false;
    }
  }

  function arm(rows) {
    for (const row of rows ?? []) {
      const wait = Date.parse(row.due_at) - Date.now();
      if (!Number.isFinite(wait) || wait > MAX_TIMER_MS) continue;
      const timer = setTimeout(() => {
        timers.delete(timer);
        runTick();
      }, Math.max(0, wait) + timerSlackMs);
      timer.unref?.();
      timers.add(timer);
    }
  }

  const interval = setInterval(runTick, intervalMs);
  interval.unref?.();
  const own = { arm };
  scheduler = own;
  return () => {
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (scheduler === own) scheduler = null;
    unsubscribe();
  };
}

module.exports = { start, tick, arm, scheduleForOrder, cancelPaymentDue, onEvent, TEXT, TICK_MS, DEMO_TICK_MS, MIN_DEMO_DELAY_SECONDS };
