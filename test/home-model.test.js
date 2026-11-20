"use strict";

/**
 * public/js/app/home-model.js: Sahay home's states without the DOM. The orb never ends a call
 * (End is its own control, D12), typing never mutes (D16), recovery shows the honest line for a
 * blocked network or a dropped call (F8), "your work is running" only while jobs run, and the
 * "now doing" trackers carry only numbers the server sent. Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/home-model.js"))}`);

const idle = { status: "idle", agentState: null, mode: "voice", route: null, error: null, ended: null, online: true, muted: false };

test("orb: every call stage has its own state, label key and one of the seven looks", async () => {
  const { orbView, ORB_VISUALS } = await load();
  const cases = [
    [{ ...idle }, "idle", "idle"],
    [{ ...idle, first: true }, "first", "idle"],
    [{ ...idle, working: true }, "working", "working"],
    [{ ...idle, status: "mic" }, "mic", "connecting"],
    [{ ...idle, status: "connecting" }, "connecting", "connecting"],
    [{ ...idle, status: "connecting", route: "proxy" }, "safer", "connecting"],
    [{ ...idle, status: "waiting" }, "waiting", "connecting"],
    [{ ...idle, status: "live", agentState: "listening" }, "listening", "listening"],
    [{ ...idle, status: "live", agentState: "thinking" }, "thinking", "thinking"],
    [{ ...idle, status: "live", agentState: "speaking" }, "speaking", "speaking"],
    [{ ...idle, status: "live", agentState: "listening", muted: true }, "muted", "listening"],
    [{ ...idle, status: "live", agentState: "listening", mode: "text" }, "yourTurn", "listening"],
    [{ ...idle, status: "reconnecting" }, "reconnecting", "connecting"],
    [{ ...idle, status: "ending" }, "ending", "connecting"],
    [{ ...idle, status: "error", error: { code: "network_blocked" } }, "blocked", "error"],
    [{ ...idle, status: "error", error: { code: "proxy_unavailable" } }, "blocked", "error"],
    [{ ...idle, status: "error", error: { code: "mic_denied" } }, "micBlocked", "error"],
    [{ ...idle, status: "error", error: { code: "SESSION_FAILED" } }, "error", "error"],
    [{ ...idle, ended: { reason: "dropped" } }, "dropped", "error"],
    [{ ...idle, ended: { reason: "stuck" } }, "dropped", "error"],
    [{ ...idle, ended: { reason: "The call reached its time limit. Start a new call to continue." } }, "ended", "idle"],
    [{ ...idle, online: false }, "offline", "error"],
  ];
  for (const [input, state, visual] of cases) {
    const v = orbView(input);
    assert.equal(v.state, state, JSON.stringify(input));
    assert.equal(v.visual, visual, state);
    assert.ok(ORB_VISUALS.includes(v.visual));
    assert.ok(v.key && v.icon, `${state} has words and an icon (never colour alone)`);
  }
  // A live call stays live through a network blip (voice.js reconnects); offline wins only when idle.
  assert.equal(orbView({ ...idle, status: "live", agentState: "listening", online: false }).state, "listening");
  // Thinking beats "your turn" even in a typed session; speaking likewise.
  assert.equal(orbView({ ...idle, status: "live", agentState: "thinking", mode: "text" }).state, "thinking");
});

test("call strip: End is a separate control, never the orb's job; mute only during a call", async () => {
  const { callStrip } = await load();
  const base = { ...idle, textSupported: true };
  let s = callStrip(base);
  assert.equal(s.primary.action, "start");
  assert.equal(s.end, null);
  assert.equal(s.mute, null);
  assert.equal(s.keyboard, true);

  s = callStrip({ ...base, status: "connecting" });
  assert.equal(s.end.key, "home.cancel", "a starting call can be cancelled");
  assert.equal(s.primary, null);

  s = callStrip({ ...base, status: "live", agentState: "listening" });
  assert.equal(s.end.key, "home.end");
  assert.equal(s.mute.action, "mute");
  assert.equal(s.keyboard, true, "typing stays open during a voice call (D16)");
  assert.equal(s.primary, null);

  s = callStrip({ ...base, status: "live", muted: true });
  assert.equal(s.mute.action, "unmute");

  s = callStrip({ ...base, status: "live", mode: "text", micless: true });
  assert.equal(s.mute.action, "openMic", "a typed session offers to talk too");

  s = callStrip({ ...base, status: "live", autoplay: true });
  assert.equal(s.primary.action, "hear", "blocked audio: tap to hear takes the primary spot");

  s = callStrip({ ...base, status: "error", error: { code: "network_blocked" } });
  assert.equal(s.primary.action, "retry");
  s = callStrip({ ...base, ended: { reason: "dropped" } });
  assert.equal(s.primary.action, "retry");
  assert.equal(s.primary.key, "home.callAgain");
  s = callStrip({ ...base, status: "error", error: { code: "x", retry: false } });
  assert.equal(s.primary, null, "an error that says not to retry offers no retry");
  assert.equal(callStrip({ ...base, textSupported: false }).keyboard, false);
});

test("recovery: blocked network, dropped call, offline, other call; work-running only with jobs", async () => {
  const { recoveryNotes } = await load();
  let n = recoveryNotes({ ...idle, status: "error", error: { code: "network_blocked" }, jobsRunning: 0 });
  assert.equal(n[0].kind, "blocked");
  assert.deepEqual(n[0].actions, ["retry", "tray"], "the button path stays usable (F7)");
  assert.equal(n[0].sub, "call.network_blocked");
  assert.ok(!n.some((x) => x.kind === "working"));

  n = recoveryNotes({ ...idle, ended: { reason: "dropped" }, jobsRunning: 2 });
  assert.equal(n[0].kind, "dropped");
  assert.deepEqual(n[0].actions, ["retry"]);
  assert.ok(n.some((x) => x.kind === "working"), "jobs running: say the work goes on");

  n = recoveryNotes({ ...idle, ended: { reason: "offline" }, online: false, jobsRunning: 0 });
  assert.equal(n[0].kind, "offline");
  assert.deepEqual(n.find((x) => x.kind === "dropped").actions, [], "no retry while offline");

  n = recoveryNotes({ ...idle, ended: { reason: "The call reached its time limit. Start a new call to continue." } });
  assert.equal(n[0].kind, "ended");
  assert.equal(n[0].sub, "home.endedLimit");

  n = recoveryNotes({ ...idle, voiceServerActive: true });
  assert.equal(n[0].kind, "otherCall");
  assert.deepEqual(n[0].actions, ["endOther"]);

  n = recoveryNotes({ ...idle, status: "error", error: { code: "mic_denied" } });
  assert.deepEqual(n[0].actions, ["retry", "type"], "no microphone: typing still works");

  n = recoveryNotes({ ...idle, status: "live", issues: [{ source: "mic" }, { source: "mic" }, { source: "zzz" }] });
  assert.deepEqual(n.map((x) => x.key), ["home.issue.mic", "home.issue.other"]);
  assert.deepEqual(recoveryNotes({ ...idle }), [], "a calm idle home has no notes");
});

test("conversation: disclosure pinned first, last three shown, earlier folded", async () => {
  const { conversationView } = await load();
  const turns = [
    { role: "agent", text: "Hi, this is Sahay, an automated assistant." },
    { role: "owner", text: "a" }, { role: "agent", text: "b" }, { role: "owner", text: "c", via: "text" },
    { role: "agent", text: "d" }, { role: "owner", text: "  " }, { role: "system", text: "x" },
  ];
  const v = conversationView(turns, { disclosure: "written" });
  assert.deepEqual(v.pinned, { text: "Hi, this is Sahay, an automated assistant.", spoken: true });
  assert.equal(v.older, 1);
  assert.deepEqual(v.shown.map((x) => x.text), ["b", "c", "d"]);
  assert.deepEqual(conversationView(turns, { showEarlier: true }).shown.map((x) => x.text), ["a", "b", "c", "d"]);
  assert.deepEqual(conversationView(turns, { keep: 2 }).shown.map((x) => x.text), ["c", "d"], "phones keep two turns");
  assert.equal(conversationView(turns, { keep: 2 }).older, 2);
  const empty = conversationView([], { disclosure: "written" });
  assert.deepEqual(empty.pinned, { text: "written", spoken: false });
  assert.equal(empty.count, 0);
});

test("typed yes is recognised in three languages (and never approves)", async () => {
  const { isTypedYes } = await load();
  for (const y of ["yes", "Haan", "हाँ", "हां।", "जी हाँ", "ठीक है", "ಹೌದು", "ಸರಿ!", " ok "]) assert.ok(isTypedYes(y), y);
  for (const n of ["yes buy 200 kg", "नहीं", "no", "", "हाँ लेकिन कम दाम"]) assert.ok(!isTypedYes(n), n);
});

test("trackers come only from real values; at most four; need drops first", async () => {
  const { hudTrackers, liveBargain, bestQuote } = await load();
  assert.deepEqual(hudTrackers({ requirement: null, sellers: null, bargain: null, best: null, waitingYes: 0 }), []);
  assert.deepEqual(hudTrackers({ requirement: { item: "rice", quantity: null, maxPrice: null }, sellers: 0, waitingYes: 0 }), [], "no invented zeros");
  const all = hudTrackers({
    requirement: { quantity: 200, unit: "kg", maxPrice: 100 }, sellers: 10,
    bargain: { offer: 96, round: 2, unit: "kg", simulated: true }, waitingYes: 1,
  });
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((x) => x.id), ["cap", "sellers", "bargain", "yes"]);
  assert.equal(all.find((x) => x.id === "bargain").sim, true, "simulated vendor flagged on the tracker");

  const negs = [
    { endedAt: "x", vendorId: 1, turns: [{ offer: 90, round: 3 }] },
    { endedAt: null, vendorId: 2, turns: [{ offer: 110, round: 1, unit: "kg" }, { offer: null }, { offer: 101, round: 2, unit: "kg" }] },
  ];
  assert.deepEqual(liveBargain(negs), { vendorId: 2, round: 2, offer: 101, unit: "kg" });
  assert.equal(liveBargain([{ endedAt: null, turns: [] }]), null);
  assert.deepEqual(bestQuote([{ requirementId: 1, unitPrice: 101, unit: "kg", vendorId: 2 }, { requirementId: 1, unitPrice: 96, vendorId: 3, simulated: true }, { requirementId: 9, unitPrice: 5 }], 1),
    { price: 96, unit: null, vendorId: 3, simulated: true });
});

test("today stats: real counts for today only; a source not loaded is null, never zero", async () => {
  const { todayStats, inr } = await load();
  const now = new Date(2026, 10, 20, 15, 0, 0);
  const iso = (d) => d.toISOString();
  const todayIso = iso(new Date(2026, 10, 20, 10, 0, 0));
  const yesterday = iso(new Date(2026, 10, 19, 10, 0, 0));
  const s = todayStats({
    now,
    orders: [{ createdAt: todayIso }, { createdAt: yesterday }, { createdAt: todayIso }],
    invoices: [{ status: "issued", issuedAt: todayIso }, { status: "pending", createdAt: todayIso }, { status: "paid", issuedAt: yesterday }],
    receipts: [{ amount: 1200, createdAt: todayIso }, { amount: 50.5, createdAt: todayIso }, { amount: 999, createdAt: yesterday }],
    items: [{ low: true }, { low: false }, { low: true }],
  });
  assert.deepEqual(s.map((x) => [x.id, x.value]), [["orders", 2], ["bills", 1], ["received", 1250.5], ["low", 2]]);
  assert.deepEqual(s.map((x) => x.tone), ["plain", "plain", "lime", "amber"]);
  const empty = todayStats({ now, orders: [], invoices: null, receipts: null, items: null });
  assert.deepEqual(empty.map((x) => x.value), [0, null, null, null], "orders known (0), the rest not loaded");
  assert.equal(todayStats({ now, ordersReady: false }).find((x) => x.id === "orders").value, null);
  assert.equal(inr(185000), "₹1,85,000");
  assert.equal(inr(55.5), "₹55.5");
  assert.equal(inr(null), "");
});

test("status line, state pill, turn language, time parsing and the call clock", async () => {
  const { statusLine, pillKey, turnLang, parseTime, clock, orbView } = await load();
  assert.deepEqual(statusLine({ orbState: "idle", nowKey: "now.idle", live: false }), { key: "home.status.ready", now: false, talk: true });
  assert.equal(statusLine({ orbState: "listening", nowKey: "now.searching", live: true }).key, "now.searching", "real work wins");
  assert.equal(statusLine({ orbState: "listening", nowKey: "now.idle", live: true }).key, "home.status.live");
  assert.equal(statusLine({ orbState: "blocked", nowKey: "now.idle", live: false }).key, "home.status.trouble");
  assert.equal(statusLine({ orbState: "offline", nowKey: "now.idle", live: false }).key, "home.status.offline");
  assert.equal(statusLine({ orbState: "safer", nowKey: "now.idle", live: false }).key, "home.status.connecting");
  assert.equal(pillKey("listening"), "home.pill.listening");
  assert.equal(pillKey("first"), "home.pill.ready");
  assert.equal(pillKey("nonsense"), "home.pill.ready");
  assert.equal(turnLang({ language: "hi-IN", text: "x" }), "hi");
  assert.equal(turnLang({ text: "ನನಗೆ ಅಕ್ಕಿ ಬೇಕು" }), "kn");
  assert.equal(turnLang({ text: "मुझे चावल चाहिए" }), "hi");
  assert.equal(turnLang({ text: "rice please" }), "en");
  assert.equal(parseTime("2026-11-20 10:00:00").toISOString(), "2026-11-20T10:00:00.000Z", "SQLite time is UTC");
  assert.equal(parseTime(1763632800).getTime(), 1763632800000, "seconds");
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("nope"), null);
  assert.equal(clock(65000), "01:05");
  assert.equal(clock(3723000), "1:02:03");
  // Every orb state has a pill word (checked against the strings file below).
  const strings = read("public/js/app/home-strings.js");
  const states = ["idle", "first", "mic", "connecting", "safer", "waiting", "listening", "yourTurn", "thinking", "speaking", "muted", "working", "reconnecting", "ending", "error", "blocked", "micBlocked", "dropped", "ended", "offline"];
  for (const st of states) assert.ok(strings.includes(`"${pillKey(st)}": [`), `${st} -> ${pillKey(st)}`);
  for (const L of ["en", "hi", "kn"]) assert.ok(strings.includes(`"home.lang.${L}": [`));
  assert.ok(orbView({ status: "idle", online: true }).key);
});

test("D16: switching to typing never mutes the microphone (call.js)", () => {
  const src = read("public/js/app/call.js");
  const body = src.slice(src.indexOf("export function setMode"), src.indexOf("export async function sendText"));
  assert.ok(body.length > 0);
  assert.doesNotMatch(body, /setMuted\(\s*mode === "text"\s*\)/, "typing mode does not mute");
  assert.doesNotMatch(body, /setMuted\(true\)/);
});

test("home strings exist in all three languages, native script", () => {
  const src = read("public/js/app/home-strings.js");
  const used = new Set();
  for (const f of ["public/js/app/home-model.js", "public/js/app/talk.js", "public/js/app/composer.js", "public/js/app/call-dock.js", "public/js/app/hud.js", "public/js/app/home-strings.js"]) {
    for (const m of read(f).matchAll(/"((?:home|hud)\.[A-Za-z0-9.]+)"/g)) used.add(m[1]);
  }
  for (const k of used) {
    if (k.endsWith(".")) continue;
    const row = new RegExp(`"${k.replace(/\./g, "\\.")}": \\[\\s*"[^"]+",\\s*"([^"]+)",\\s*"([^"]+)"`);
    const m = row.exec(src);
    assert.ok(m, `${k} is defined with three languages`);
    assert.match(m[1], /[ऀ-ॿ]/u, `${k} Hindi in Devanagari`);
    assert.match(m[2], /[ಀ-೿]/u, `${k} Kannada in Kannada script`);
  }
});
