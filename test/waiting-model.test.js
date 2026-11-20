"use strict";

/**
 * public/js/app/waiting-model.js: the one "Waiting for your yes" state machine behind every Yes card
 * (purchase, bill, reorder, rule). UX v3 D6-D8: cards open by themselves only when the server has
 * spoken the read-back; Saving after a tap or the server's own decided event; Done only from
 * order.created / invoice.issued / stock.reorder_decided / rule.decided; Not done yet after 45 s;
 * a refusal keeps the server's say. The module has no DOM, so it is imported directly.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// The browser module is ESM in a CommonJS package: import its source as a data: URL (it has no imports).
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "waiting-model.js"), "utf8");
const MODEL = `data:text/javascript;base64,${Buffer.from(SOURCE).toString("base64")}`;
const load = () => import(MODEL);

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const buy = (id, createdAt = "2026-11-20T10:00:00Z") => ({ key: `approval:${id}`, kind: "buy", id: String(id), createdAt });
const bill = (id, createdAt = "2026-11-20T09:00:00Z") => ({ key: `invoice:${id}`, kind: "bill", id: String(id), createdAt });
const reorder = (id, createdAt = "2026-11-20T08:00:00Z") => ({ key: `reorder:${id}`, kind: "reorder", id: String(id), createdAt, itemId: "it1" });
const rule = (id, createdAt = "2026-11-20T07:00:00Z") => ({ key: `rule:${id}`, kind: "rule", id: String(id), createdAt });

test("a new pending decision waits and is counted, but does not open by itself", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1)]);
  assert.equal(m.card("approval:1").phase, "waiting");
  assert.equal(m.count(), 1);
  assert.deepEqual(m.takeSignals(), [], "no auto-open without a spoken event (D7)");
});

test("each kind opens only on its own spoken event, also when the event comes before the store has the item", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1), bill(2), reorder(3), rule(4)]);
  m.event({ type: "approval.spoken", data: { approvalId: 1 } });
  m.event({ type: "invoice.spoken", data: { approvalId: 99, invoiceId: 2 } });
  m.event({ type: "stock.reorder_spoken", data: { proposalId: 3, itemId: "it1" } });
  m.event({ type: "rule.spoken", data: { ruleId: 4 } });
  assert.deepEqual(m.takeSignals().map((s) => s.key), ["approval:1", "invoice:2", "reorder:3", "rule:4"]);
  // Spoken first, item later (the bill store reloads 450 ms after the event).
  m.event({ type: "invoice.spoken", data: { invoiceId: 7 } });
  assert.deepEqual(m.takeSignals(), []);
  m.sync([buy(1), bill(2), reorder(3), rule(4), bill(7)]);
  assert.deepEqual(m.takeSignals().map((s) => s.key), ["invoice:7"]);
  // Other events never open a card.
  m.event({ type: "approval.requested", data: { approvalId: 8 } });
  m.sync([buy(8)]);
  assert.deepEqual(m.takeSignals(), []);
});

test("the card being spoken now leads; then buy and bill oldest first, then reorder, then rule", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([rule(4), reorder(3), bill(2, "2026-11-20T09:00:00Z"), buy(1, "2026-11-20T10:00:00Z")]);
  assert.deepEqual(m.list().map((c) => c.key), ["invoice:2", "approval:1", "reorder:3", "rule:4"]);
  m.event({ type: "rule.spoken", data: { ruleId: 4 } });
  assert.deepEqual(m.list().map((c) => c.key), ["rule:4", "invoice:2", "approval:1", "reorder:3"]);
});

test("buy: tap Yes -> Saving -> Done only when order.created arrives, with the PO number", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1)]);
  assert.equal(m.tap("approval:1", true), "approve");
  assert.equal(m.card("approval:1").phase, "saving");
  assert.equal(m.card("approval:1").busy, "yes");
  assert.equal(m.count(), 0, "a saving card no longer asks for the yes");
  assert.equal(m.tap("approval:1", true), null, "no second tap while saving");
  // The approval leaves the pending list (approval.decided): still saving, not done.
  m.event({ type: "approval.decided", data: { approvalId: 1, status: "approved", via: "button" } });
  m.sync([]);
  assert.equal(m.card("approval:1").phase, "saving");
  m.event({ type: "order.created", data: { orderId: 11, approvalId: 1, poNumber: "SAHAY/2026/0001" } });
  const c = m.card("approval:1");
  assert.equal(c.phase, "done");
  assert.equal(c.result.number, "SAHAY/2026/0001");
  assert.equal(c.result.orderId, "11");
});

test("a spoken yes moves the card through the server's decided event, never the agent's words", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1)]);
  m.event({ type: "agent.said", data: { text: "Order placed!" } });
  assert.equal(m.card("approval:1").phase, "waiting");
  m.event({ type: "approval.decided", data: { approvalId: 1, status: "approved", via: "voice" } });
  assert.equal(m.card("approval:1").phase, "saving");
});

test("Not done yet after 45 s of saving; a late done event still completes it", async () => {
  const { createWaitingModel, SAVE_TIMEOUT_MS } = await load();
  assert.equal(SAVE_TIMEOUT_MS, 45000);
  const c = clock();
  const m = createWaitingModel({ now: c.now });
  m.sync([buy(1)]);
  m.tap("approval:1", true);
  c.advance(44_999);
  assert.equal(m.tick(), false);
  assert.equal(m.card("approval:1").phase, "saving");
  c.advance(1);
  assert.equal(m.tick(), true);
  assert.equal(m.card("approval:1").phase, "notDone");
  m.event({ type: "order.created", data: { approvalId: 1, poNumber: "PO-9" } });
  assert.equal(m.card("approval:1").phase, "done");
});

test("bill: Done only on invoice.issued; a no is recorded as declined; a server withdrawal leaves quietly", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([bill(2), bill(3)]);
  assert.equal(m.tap("invoice:2", true), "approve");
  m.event({ type: "invoice.decided", data: { approvalId: 5, invoiceId: 2, status: "approved", via: "button" } });
  assert.equal(m.card("invoice:2").phase, "saving");
  m.event({ type: "invoice.issued", data: { invoice: { id: 2, number: "INV/26/0007" }, problems: [] } });
  assert.equal(m.card("invoice:2").phase, "done");
  assert.equal(m.card("invoice:2").result.number, "INV/26/0007");
  assert.equal(m.tap("invoice:3", false), "reject");
  m.event({ type: "invoice.decided", data: { invoiceId: 3, status: "rejected", via: "button" } });
  assert.equal(m.card("invoice:3").phase, "declined");
  m.sync([bill(4)]);
  m.event({ type: "invoice.decided", data: { invoiceId: 4, status: "rejected", reason: "superseded" } });
  assert.equal(m.card("invoice:4"), null);
});

test("bill refused for missing shop details shows the fix and keeps Yes / No; the fix clears", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([bill(2)]);
  m.tap("invoice:2", true);
  m.tapFailed("invoice:2", { status: 409, code: "GSTIN_REQUIRED", say: "पहले दुकान का GSTIN जोड़िए।" });
  const c = m.card("invoice:2");
  assert.equal(c.phase, "waiting");
  assert.equal(c.fix, "GSTIN_REQUIRED");
  assert.equal(c.say, "पहले दुकान का GSTIN जोड़िए।");
  m.clearFix("invoice:2");
  assert.equal(m.card("invoice:2").fix, null);
});

test("refusals: already answered -> gone with the server's say; other errors keep the say and let the owner try again", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1), rule(4), reorder(3)]);
  m.tap("approval:1", true);
  m.tapFailed("approval:1", { status: 409, code: "ALREADY_DECIDED", say: "इसका जवाब पहले ही हो चुका है।" });
  assert.equal(m.card("approval:1").phase, "gone");
  assert.equal(m.card("approval:1").say, "इसका जवाब पहले ही हो चुका है।");
  m.tap("rule:4", true);
  m.tapFailed("rule:4", { status: 0, code: "NETWORK" });
  assert.equal(m.card("rule:4").phase, "error");
  assert.equal(m.count(), 2, "an error card still needs the owner");
  assert.equal(m.tap("rule:4", true), "keep", "Yes works again after an error");
  m.tap("reorder:3", false);
  m.tapFailed("reorder:3", { status: 409, code: "PROPOSAL_DECIDED", say: "already" });
  assert.equal(m.card("reorder:3").phase, "gone");
});

test("a failure after the server already recorded the yes is Not done yet, not a retry", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1)]);
  m.tap("approval:1", true);
  m.event({ type: "approval.decided", data: { approvalId: 1, status: "approved" } });
  m.tapFailed("approval:1", { status: 502, code: "ORDER_FAILED", say: "ऑर्डर नहीं बन पाया।" });
  assert.equal(m.card("approval:1").phase, "notDone");
  assert.equal(m.card("approval:1").say, "ऑर्डर नहीं बन पाया।");
});

test("reorder: yes is done on stock.reorder_decided accepted, and shows the search once job.started names its need", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([reorder(3), reorder(5)]);
  assert.equal(m.tap("reorder:3", true), "yes");
  m.event({ type: "stock.reorder_decided", data: { proposalId: 3, itemId: "it1", status: "accepted", requirementId: 40 } });
  const c = m.card("reorder:3");
  assert.equal(c.phase, "done");
  assert.equal(c.result.searching, false);
  m.event({ type: "job.started", data: { jobId: 1, kind: "sourcing", requirementId: 40 } });
  assert.equal(m.card("reorder:3").result.searching, true);
  assert.equal(m.tap("reorder:5", false), "no");
  m.event({ type: "stock.reorder_decided", data: { proposalId: 5, status: "declined" } });
  assert.equal(m.card("reorder:5").phase, "declined");
});

test("rule: keep / forget words; done on rule.decided active, declined on off", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([rule(4), rule(6)]);
  assert.equal(m.tap("rule:4", true), "keep");
  m.event({ type: "rule.decided", data: { rule: { id: 4, status: "active" }, via: "button" } });
  assert.equal(m.card("rule:4").phase, "done");
  assert.equal(m.tap("rule:6", false), "forget");
  m.event({ type: "rule.decided", data: { rule: { id: 6, status: "off" }, via: "button" } });
  assert.equal(m.card("rule:6").phase, "declined");
});

test("answered in another tab: a waiting card that leaves the pending list goes; settled cards expire; dismiss closes them", async () => {
  const { createWaitingModel, SETTLED_TTL_MS } = await load();
  const c = clock();
  const m = createWaitingModel({ now: c.now });
  m.sync([buy(1), bill(2)]);
  m.sync([bill(2)]);
  assert.equal(m.card("approval:1"), null);
  m.tap("invoice:2", false);
  m.event({ type: "invoice.decided", data: { invoiceId: 2, status: "rejected" } });
  m.dismiss("invoice:2");
  assert.equal(m.card("invoice:2"), null);
  m.sync([buy(9)]);
  m.dismiss("approval:9");
  assert.ok(m.card("approval:9"), "a waiting card cannot be dismissed (Later only hides it)");
  m.tap("approval:9", true);
  m.event({ type: "order.created", data: { approvalId: 9, poNumber: "P" } });
  c.advance(SETTLED_TTL_MS);
  assert.equal(m.tick(), true);
  assert.equal(m.card("approval:9"), null);
});

test("snapshot resolve completes a saving card whose event was missed while the stream was closed", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([buy(1)]);
  m.tap("approval:1", true);
  m.sync([]);
  m.resolve("approval:1", { number: "PO-1", orderId: "3" });
  assert.equal(m.card("approval:1").phase, "done");
  m.sync([buy(2)]);
  m.resolve("approval:2", { number: "X" });
  assert.equal(m.card("approval:2").phase, "waiting", "resolve never skips the owner's yes");
});

test("voice-only reorder (no proposal id) cannot be tapped", async () => {
  const { createWaitingModel } = await load();
  const m = createWaitingModel();
  m.sync([{ key: "reorder:item-it1", kind: "reorder", id: "item-it1", voiceOnly: true }]);
  assert.equal(m.tap("reorder:item-it1", true), null);
});

test("typed yes is recognised in English, Hinglish, Hindi and Kannada and never longer phrases", async () => {
  const { isTypedYes } = await load();
  for (const s of ["yes", "Haan", "haan ji", "हाँ", "हां जी", "ठीक है", "ಹೌದು", "ok buy it", "yes."]) assert.equal(isTypedYes(s), true, s);
  for (const s of ["", "no", "नहीं", "ಬೇಡ", "what is the price", "yes I want to know about the delivery dates first"]) assert.equal(isTypedYes(s), false, s);
});

test("placement per size (spec 6.3)", async () => {
  const { placeFor } = await load();
  assert.equal(placeFor({ width: 360, height: 780 }), "sheet");
  assert.equal(placeFor({ width: 430, height: 932 }), "sheet");
  assert.equal(placeFor({ width: 844, height: 390 }), "landDrawer");
  assert.equal(placeFor({ width: 768, height: 1024 }), "tabletSheet");
  assert.equal(placeFor({ width: 1024, height: 768 }), "drawer");
  assert.equal(placeFor({ width: 1280, height: 720 }), "column");
  assert.equal(placeFor({ width: 1920, height: 1080 }), "column");
  // The shell's layout wins: its size class, and whether the agent column is shown at all.
  assert.equal(placeFor({ width: 1440, height: 900, size: "laptop", columnShown: false }), "drawer");
  assert.equal(placeFor({ width: 1440, height: 900, size: "laptop", columnShown: true }), "column");
  assert.equal(placeFor({ width: 844, height: 390, size: "phoneLand" }), "landDrawer");
  assert.equal(placeFor({ width: 390, height: 844, size: "phone" }), "sheet");
});

test("keys and read-aloud keys match the server's speak keys (reorder reads its item)", async () => {
  const { keyOf, parseKey, speakKeyOf, DECISION } = await load();
  assert.equal(keyOf("buy", 1), "approval:1");
  assert.equal(keyOf("bill", "a"), "invoice:a");
  assert.deepEqual(parseKey("reorder:12"), { kind: "reorder", id: "12" });
  assert.equal(parseKey("order:1"), null);
  assert.equal(speakKeyOf("reorder", "12", "it9"), "item:it9");
  assert.equal(speakKeyOf("rule", "4"), "rule:4");
  assert.deepEqual(DECISION.reorder, ["yes", "no"]);
  assert.deepEqual(DECISION.rule, ["keep", "forget"]);
});

test("tray and Yes card words exist in English, Hindi and Kannada, in native script, with the same placeholders", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "waiting-strings.js"), "utf8");
  const { WT_STRINGS } = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
  const keys = Object.keys(WT_STRINGS);
  assert.ok(keys.length > 40);
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    const [en, hi, kn] = WT_STRINGS[k];
    assert.ok(k.startsWith("wt."), k);
    assert.ok(en && hi && kn, `${k} has three languages`);
    assert.match(hi, /[ऀ-ॿ]/, `${k} Hindi in Devanagari`);
    assert.match(kn, /[ಀ-೿]/, `${k} Kannada in Kannada script`);
    assert.doesNotMatch((hi + kn).replace(/\{\w+\}/g, ""), /[a-z]{3,}/i, `${k}: no romanised words in hi / kn`);
    assert.equal(holes(hi), holes(en), `${k} hi placeholders`);
    assert.equal(holes(kn), holes(en), `${k} kn placeholders`);
  }
  for (const kind of ["buy", "bill", "reorder", "rule"]) {
    for (const p of ["wt.kind.", "wt.title.", "wt.yesLong.", "wt.noLong.", "wt.saving.", "wt.done.", "wt.declined."]) assert.ok(WT_STRINGS[p + kind], p + kind);
  }
});
