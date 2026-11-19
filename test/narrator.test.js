"use strict";

// Test settings. Every fake key comes from test/_env.js (FAKE), loaded first by npm test.
Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const narrator = require("../src/agora/narrator");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const events = require("../src/events");
const { isNativeScript, scriptProblems } = require("../src/agora/script");

const DEFAULTS = { minGapMs: 5000, vendorDebounceMs: 2500, holdMs: 6000, approvalHoldMs: 60000, queueLimit: 3 };

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

/** A live narrator for one business with a recording speak; restored after the test. */
function liveNarrator(t, { language = "hi-IN", ...timing } = {}) {
  const businessId = seedBusiness(language);
  const spoken = [];
  narrator.configure({ speak: async (_agentId, text) => spoken.push({ text, at: Date.now() }), status: async () => {}, minGapMs: 5, holdMs: 0, ...timing });
  const state = narrator.attach(businessId, { agentId: "AG1", sessionId: null, language });
  state.lastSpokeAt = 0;
  t.after(() => {
    narrator.detach(businessId);
    narrator.configure({
      speak: (agentId, text) => agent.speak(agentId, text, { priority: "APPEND", interruptable: true }),
      status: (agentId, text) => agent.updateCallStatus(agentId, text),
      ...DEFAULTS,
    });
  });
  return { businessId, spoken, state };
}

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ follow-ups (r3 #3) --- */

test("E2E r3 bug 3: followup.fired in a live call is spoken from its order, in the owner's current language", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "hi-IN" });
  const order = { id: "ord_1", po_number: "SAHAY/2026/0001", amount: 11000, simulated: true };
  t.mock.method(repo, "getOrder", (biz, id) => (biz === businessId && id === "ord_1" ? order : null));
  narrator.useLanguage(businessId, "kn-IN"); // the owner switched to Kannada mid-call
  narrator.onEvent({
    businessId,
    type: "followup.fired",
    // The stored message is in the business language (Hindi); it must not be prefixed and spoken in Kannada.
    data: { followupId: "fu_1", orderId: "ord_1", kind: "payment_due", message: "भुगतान बाकी है: ऑर्डर SAHAY/2026/0001, 11000 रुपये।" },
  });
  await until(() => spoken.length >= 1);
  assert.equal(spoken[0].text, "ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: ಆರ್ಡರ್ SAHAY/2026/0001 (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್) ಪಾವತಿ ಬಾಕಿ ಇದೆ, 11000 ರೂಪಾಯಿ.");
  assert.ok(isNativeScript(spoken[0].text, "kn-IN"), "no Devanagari or Latin in the Kannada line");
});

test("followup.fired: delivery check in Hindi, and an unknown order gets a plain line, never another language's message", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "hi-IN" });
  t.mock.method(repo, "getOrder", (_biz, id) => (id === "ord_2" ? { id, po_number: "SAHAY/2026/0002", amount: 500, simulated: 0 } : null));
  narrator.onEvent({ businessId, type: "followup.fired", data: { followupId: "fu_2", orderId: "ord_2", kind: "delivery_check", message: "x" } });
  await until(() => spoken.length >= 1);
  narrator.onEvent({ businessId, type: "followup.fired", data: { followupId: "fu_3", orderId: "ord_gone", kind: "payment_due", message: "Payment is due: order X" } });
  await until(() => spoken.length >= 2);
  assert.deepEqual(spoken.map((s) => s.text), [
    "याद दिला दूँ: ऑर्डर SAHAY/2026/0002 की डिलीवरी का समय हो गया है, क्या माल पहुँच गया?",
    "एक रिमाइंडर स्क्रीन पर है।",
  ]);
});

test("follow-ups that fired between calls are said at the start of the next call, worded from the order", async (t) => {
  const businessId = seedBusiness("en-IN");
  const ended = repo.createSession(businessId, { kind: "owner", channel: "own-prev", status: "active" });
  repo.updateSession(businessId, ended.id, { status: "ended", ended_at: new Date(Date.now() - 60000).toISOString() });
  t.mock.method(repo, "listFollowups", () => [{ id: "fu_9", kind: "payment_due", order_id: "ord_9", status: "fired", fired_at: new Date().toISOString(), message: "भुगतान बाकी है" }]);
  t.mock.method(repo, "getOrder", () => ({ id: "ord_9", po_number: "SAHAY/2026/0009", amount: 2500.5, simulated: false }));
  const spoken = [];
  narrator.configure({ speak: async (_a, text) => spoken.push(text), minGapMs: 5 });
  t.after(() => {
    narrator.detach(businessId);
    narrator.configure({ speak: (agentId, text) => agent.speak(agentId, text, { priority: "APPEND", interruptable: true }), ...DEFAULTS });
  });
  const current = repo.createSession(businessId, { kind: "owner", channel: "own-now", status: "active" });
  narrator.attach(businessId, { agentId: "AG9", sessionId: current.id, language: "en-IN" });
  await until(() => spoken.length >= 1, 7000);
  assert.equal(spoken[0], "A reminder: payment for order SAHAY/2026/0009 is due, 2500.5 rupees.");
});

/* ------------------------------------------------ approval hold (r3 item 5) --- */

test("E2E r3 item 5: nothing is narrated between the approval read-back and the owner's answer", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "hi-IN" });
  narrator.onEvent({ businessId, type: "approval.requested", data: { approvalId: "apr_1", status: "pending" } });
  assert.equal(narrator.isHeld(businessId), true);
  narrator.onEvent({ businessId, type: "job.failed", data: { jobId: "j1", kind: "negotiation" } });
  narrator.onEvent({ businessId, type: "approval.spoken", data: { approvalId: "apr_1" } });
  await sleep(60);
  assert.equal(spoken.length, 0, "held while the approval waits for the owner");

  // Another deal withdrawn by the system is not the answer being waited for.
  narrator.onEvent({ businessId, type: "approval.decided", data: { approvalId: "apr_0", status: "rejected", reason: "Another deal was put to the owner for approval." } });
  await sleep(30);
  assert.equal(spoken.length, 0);
  assert.equal(narrator.isHeld(businessId), true);

  narrator.onEvent({ businessId, type: "approval.decided", data: { approvalId: "apr_1", status: "approved", via: "voice" } });
  assert.equal(narrator.isHeld(businessId), false);
  await until(() => spoken.length >= 1);
  assert.equal(spoken[0].text, "मोल-भाव पूरा नहीं हो पाया, कारण स्क्रीन पर है।");
});

test("approval hold: a line already waiting on its timer is not spoken when the hold starts", async (t) => {
  const { businessId, spoken, state } = liveNarrator(t, { language: "en-IN", minGapMs: 80 });
  state.lastSpokeAt = Date.now(); // the next line waits about 80 ms on its timer
  narrator.onEvent({ businessId, type: "job.failed", data: { jobId: "j2", kind: "sourcing" } });
  narrator.holdForApproval(businessId); // request_approval, right before its /speak of the read-back
  await sleep(150);
  assert.equal(spoken.length, 0, "the timer fired inside the hold and re-armed");
  narrator.onEvent({ businessId, type: "approval.decided", data: { approvalId: "apr_x", status: "rejected", via: "voice" } });
  await until(() => spoken.length >= 1);
  assert.equal(spoken[0].text, "The vendor search could not be completed; the reason is on the screen.");
});

test("approval hold ends by itself after approvalHoldMs, and at once when request_approval fails", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "en-IN", approvalHoldMs: 120 });
  const started = Date.now();
  narrator.onEvent({ businessId, type: "approval.requested", data: { approvalId: "apr_t" } });
  narrator.onEvent({ businessId, type: "payment.link", data: { orderId: "o1" } });
  await until(() => spoken.length >= 1);
  assert.ok(spoken[0].at - started >= 115, `spoken ${spoken[0].at - started} ms after the hold began`);

  narrator.configure({ approvalHoldMs: 60000 });
  narrator.onEvent({ businessId, type: "approval.requested", data: { approvalId: "apr_u" } });
  narrator.onEvent({ businessId, type: "job.failed", data: { jobId: "j3", kind: "sourcing" } });
  await sleep(30);
  assert.equal(spoken.length, 1);
  narrator.onEvent({ businessId, type: "error", data: { code: "READBACK_NOT_SPOKEN", tool: "request_approval" } });
  await until(() => spoken.length >= 2);
});

test("approval hold follows the real event bus (approval.* events from any emitter)", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "en-IN" });
  const stop = narrator.start();
  t.after(stop);
  events.emit(businessId, "approval.requested", { approvalId: "apr_bus", status: "pending" });
  events.emit(businessId, "payment.link", { orderId: "o_bus" });
  await sleep(40);
  assert.equal(spoken.length, 0);
  events.emit(businessId, "approval.decided", { approvalId: "apr_bus", status: "approved" });
  await until(() => spoken.length >= 1);
});

/* ------------------------------------------------ native script (r3 #5) --- */

/** Placeholder values in the line's own script, so only the template's own words are checked. */
const SAMPLE = {
  "hi-IN": { count: 4, name: "BS Foods", vendor: "BS Foods", price: "55", unit: "किलो", po: "SAHAY/2026/0001", amount: "11000", sim: true, kind: "negotiation" },
  "kn-IN": { count: 4, name: "BS Foods", vendor: "BS Foods", price: "55", unit: "ಕಿಲೋ", po: "SAHAY/2026/0001", amount: "11000", sim: true, kind: "negotiation" },
};

test("E2E r3 bug 5: every hi/kn narrator template is in its own script (brand names, PO numbers and digits aside)", () => {
  for (const [key, byLanguage] of Object.entries(narrator.LINES)) {
    for (const language of ["hi-IN", "kn-IN"]) {
      const variants = [SAMPLE[language], { ...SAMPLE[language], sim: false, kind: "sourcing" }];
      if (key === "sourcing_done") variants.push({ ...SAMPLE[language], price: null }); // a shortlist with no comparable price
      for (const variant of variants) {
        const text = byLanguage[language](variant);
        const problems = scriptProblems(text, language, { allow: narrator.VERBATIM_VARS.map((k) => variant[k]) });
        assert.deepEqual(problems, { latin: [], foreign: false }, `${key} ${language}: "${text}"`);
      }
    }
  }
});

test("the disclosure, fillers and failure lines the server sends are in each language's script", () => {
  for (const language of ["hi-IN", "kn-IN"]) {
    const name = "Shree Balaji Stores";
    assert.ok(isNativeScript(agent.disclosureText({ name, language }), language, { allow: [name] }));
    assert.ok(isNativeScript(agent.disclosureText({ language }), language));
    assert.ok(isNativeScript(agent.FILLER[language], language));
  }
});

test("a line that would carry stray Latin is logged with the offending words, not silently spoken", async (t) => {
  const { businessId, spoken } = liveNarrator(t, { language: "hi-IN" });
  const warned = [];
  t.mock.method(console, "warn", (msg) => warned.push(String(msg)));
  // An unknown unit is passed through as said ("bundles"): the guard names it.
  narrator.onEvent({
    businessId,
    type: "negotiation.ended",
    data: { negotiationId: "n1", outcome: { agreed: true, vendorName: "BS Foods", unitPrice: 55, unit: "bundles" } },
  });
  await until(() => spoken.length >= 1);
  assert.ok(warned.some((w) => w.includes("negotiation_agreed") && w.includes("bundles") && !w.includes("BS Foods")), warned.join("\n"));
});

test("final-2 B: while a read-back waits, the call status tells the model the next yes or no goes to confirm_approval; an order made by the tick is told too", async (t) => {
  const { businessId, state } = liveNarrator(t);
  const statuses = [];
  narrator.configure({ status: async (_agentId, text) => statuses.push(text) });
  narrator.onEvent({ businessId, type: "approval.spoken", data: { approvalId: "apr_s", quoteId: "quo_s" } });
  await state.statusChain;
  assert.match(statuses.at(-1), /waiting for the owner's answer/);
  assert.match(statuses.at(-1), /confirm_approval/);
  assert.doesNotMatch(statuses.at(-1), /request_approval with no/);

  narrator.onEvent({ businessId, type: "approval.decided", data: { approvalId: "apr_s", status: "approved", via: "button" } });
  narrator.onEvent({ businessId, type: "order.created", data: { orderId: "ord_s", poNumber: "SAHAY/2026/AB12-0001", simulated: true } });
  await state.statusChain;
  assert.doesNotMatch(statuses.at(-1), /waiting for the owner's answer/);
  assert.match(statuses.at(-1), /SAHAY\/2026\/AB12-0001/);
  assert.match(statuses.at(-1), /Do not call create_order/);
});

test("Track POLISH: a business hears its milestones in varied words, starting with the usual one, with the same figures, names and simulated label", async (t) => {
  const { businessId, spoken } = liveNarrator(t);
  const outcome = { agreed: true, unitPrice: 55, unit: "kg", vendorName: "BS Foods", simulated: true };
  for (let i = 0; i < 3; i++) narrator.onEvent({ businessId, type: "negotiation.ended", data: { negotiationId: `neg_v${i}`, simulated: true, outcome } });
  await until(() => spoken.length === 3, 3000);
  const texts = spoken.map((s) => s.text);
  assert.equal(texts[0], "BS Foods (सिम्युलेटेड विक्रेता) से मोल-भाव पूरा, 55 रुपये प्रति किलो पर बात बनी।", "the usual wording first");
  for (let i = 1; i < texts.length; i++) assert.notEqual(texts[i], texts[i - 1], "never the same words twice in a row");
  for (const text of texts) {
    assert.match(text, /BS Foods \(सिम्युलेटेड विक्रेता\)/);
    assert.match(text, /55 रुपये प्रति किलो/);
  }
});

test("Track POLISH: every extra wording is in its own script and carries exactly the figures of the usual one", () => {
  const vars = { count: 10, name: "BS Foods", vendor: "BS Foods", price: "55", unit: "किलो", sim: true, po: "SAHAY/2026/AB12-0001", amount: "11000", kind: "negotiation" };
  const varsFor = (language) => ({ ...vars, unit: language === "kn-IN" ? "ಕೆಜಿ" : language === "en-IN" ? "kilogram" : "किलो" });
  const numbers = (text) => (text.replace("SAHAY/2026/AB12-0001", "").match(/\d+/g) ?? []).sort();
  for (const [key, byLanguage] of Object.entries(narrator.VARIANTS)) {
    for (const [language, variants] of Object.entries(byLanguage)) {
      const usual = narrator.LINES[key][language](varsFor(language));
      for (const variant of variants) {
        const text = variant(varsFor(language));
        assert.deepEqual(numbers(text), numbers(usual), `${key} ${language}: ${text}`);
        if (/सिम्युलेटेड|ಸಿಮ್ಯುಲೇಟೆಡ್|simulated/.test(usual)) assert.match(text, /सिम्युलेटेड विक्रेता|ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್|simulated vendor/, `${key} ${language} keeps the label`);
        if (language !== "en-IN") assert.deepEqual(scriptProblems(text, language, { allow: ["BS Foods", "SAHAY/2026/AB12-0001"] }), { latin: [], foreign: false }, text);
      }
    }
  }
});
