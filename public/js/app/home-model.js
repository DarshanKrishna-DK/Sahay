// Sahay home, the logic without the DOM: which orb state, which controls, which recovery notes,
// which conversation turns and which "now doing" trackers the screen shows, all from plain
// inputs (the call object, store counts). No imports and no DOM, so node:test loads it as is
// (test/home-model.test.js). Every function returns i18n keys + vars; talk.js turns them into words.
// Rule: nothing here invents a number. A tracker exists only when its value came from the server.

/** Owner states the orb can show (visual = the orb's look; state = the words under it). */
export const ORB_VISUALS = ["idle", "connecting", "listening", "thinking", "speaking", "working", "error"];

const BLOCKED = new Set(["network_blocked", "proxy_unavailable"]);
const MIC = new Set(["mic_denied", "mic_busy", "mic_missing"]);
const CONNECTED = new Set(["waiting", "live", "reconnecting"]);
const STARTING = new Set(["mic", "connecting"]);

export const isConnected = (status) => CONNECTED.has(status);

/**
 * orbView({ status, agentState, mode, route, error, ended, online, working, muted })
 * -> { state, visual, tone: "calm"|"live"|"warn"|"bad", key, icon }
 * `state` is one of: idle, first, mic, connecting, safer, waiting, listening, yourTurn, thinking,
 * speaking, muted, working, reconnecting, ending, error, blocked, micBlocked, dropped, ended, offline.
 */
export function orbView(c) {
  const s = c.status;
  const online = c.online !== false;
  const v = (state, visual, tone, key, icon) => ({ state, visual, tone, key, icon });
  if (!online && !CONNECTED.has(s) && !STARTING.has(s)) return v("offline", "error", "bad", "home.orb.offline", "wifiOff");
  if (s === "error") {
    const code = c.error && c.error.code;
    if (BLOCKED.has(code)) return v("blocked", "error", "bad", "home.orb.blocked", "ban");
    if (MIC.has(code)) return v("micBlocked", "error", "bad", "home.orb.micBlocked", "micOff");
    return v("error", "error", "bad", "home.orb.failed", "alert");
  }
  if (s === "mic") return v("mic", "connecting", "warn", "talk.mic", "mic");
  if (s === "connecting") return c.route === "proxy"
    ? v("safer", "connecting", "warn", "talk.saferRoute", "shield")
    : v("connecting", "connecting", "calm", "talk.connecting", "globe");
  if (s === "waiting") return v("waiting", "connecting", "calm", "talk.waiting", "globe");
  if (s === "reconnecting") return v("reconnecting", "connecting", "warn", "home.orb.reconnecting", "clock");
  if (s === "ending") return v("ending", "connecting", "calm", "talk.ending", "phoneOff");
  if (s === "live") {
    const a = c.agentState;
    if (a === "thinking") return v("thinking", "thinking", "live", "talk.thinking", "spark");
    if (a === "speaking") return v("speaking", "speaking", "live", "talk.speaking", "speaker");
    if (c.mode !== "text" && c.muted) return v("muted", "listening", "warn", "home.orb.muted", "micOff");
    if (a === "listening" && c.mode !== "text") return v("listening", "listening", "live", "talk.listening", "ear");
    return v("yourTurn", "listening", "live", c.mode === "text" ? "home.orb.typeTurn" : "talk.yourTurn", c.mode === "text" ? "keyboard" : "mic");
  }
  // idle
  if (c.ended) {
    const k = endedKind(c.ended.reason);
    if (k === "offline") return v("dropped", "error", "bad", "home.orb.dropped", "wifiOff");
    if (k === "dropped" || k === "stuck") return v("dropped", "error", "bad", "home.orb.dropped", "phoneOff");
    return v("ended", "idle", "calm", "home.orb.ended", "phoneOff");
  }
  if (c.working) return v("working", "working", "live", "talk.working", "spark");
  if (c.first) return v("first", "idle", "calm", "home.orb.first", "mic");
  return v("idle", "idle", "calm", "talk.tap", "mic");
}

/**
 * The call strip under the orb. End is its own red control and never sits on the orb (D12).
 * -> { primary: { action, key, icon } | null, keyboard: bool, mute: { on, key, icon } | null, end: { key } | null }
 * primary actions: "start" (idle), "retry" (error / dropped), "hear" (browser blocked audio).
 */
export function callStrip(c) {
  const s = c.status;
  const out = { primary: null, keyboard: Boolean(c.textSupported), mute: null, end: null, endKey: null };
  if (c.autoplay && CONNECTED.has(s)) out.primary = { action: "hear", key: "talk.audioBlocked", icon: "speaker" };
  if (CONNECTED.has(s)) {
    if (c.mode === "text" && c.micless) out.mute = { on: false, key: "home.talkToo", icon: "mic", action: "openMic" };
    else out.mute = c.muted
      ? { on: false, key: "home.unmute", icon: "micOff", action: "unmute" }
      : { on: true, key: "home.mute", icon: "mic", action: "mute" };
    out.end = { key: "home.end" };
    return out;
  }
  if (STARTING.has(s)) { out.end = { key: "home.cancel" }; out.keyboard = false; return out; }
  if (s === "ending") { out.keyboard = false; return out; }
  if (s === "error" && c.error && c.error.retry === false) return out;
  out.primary = s === "error" || c.ended
    ? { action: "retry", key: s === "error" ? "retry" : "home.callAgain", icon: "refresh" }
    : { action: "start", key: "home.start", icon: "mic" };
  return out;
}

/**
 * Recovery notes for the home (F8). Each: { kind, tone, key, vars?, icon, actions: [..] }
 * actions: "retry" | "tray" | "type" | "endOther". "Your work is running" only while jobs run.
 * (Blocked audio is not a note: its "tap to hear" takes the call strip's primary spot.)
 */
export function recoveryNotes(c) {
  const out = [];
  const online = c.online !== false;
  const s = c.status;
  const jobs = c.jobsRunning > 0;
  if (!online) out.push({ kind: "offline", tone: "warn", key: "home.offlineTitle", sub: "home.offlineText", icon: "wifiOff", actions: [] });
  if (s === "error") {
    const code = c.error && c.error.code;
    if (BLOCKED.has(code)) {
      out.push({ kind: "blocked", tone: "bad", key: "home.blockedTitle", sub: `call.${code}`, icon: "ban", actions: ["retry", "tray"] });
    } else if (MIC.has(code)) {
      out.push({ kind: "mic", tone: "bad", key: "home.micTitle", sub: `call.${code}`, icon: "micOff", actions: ["retry", "type"] });
    } else {
      out.push({ kind: "failed", tone: "bad", key: "call.failed", sub: "home.failedText", icon: "alert", actions: c.error && c.error.retry === false ? ["tray"] : ["retry", "tray"] });
    }
  } else if (s === "idle" && c.ended) {
    const kind = endedKind(c.ended.reason);
    const dropped = kind === "dropped" || kind === "stuck" || kind === "offline";
    out.push({ kind: dropped ? "dropped" : "ended", tone: dropped ? "bad" : "calm", key: dropped ? "home.droppedTitle" : "home.endedTitle", sub: ENDED_SUB[kind], icon: kind === "offline" ? "wifiOff" : "phoneOff", actions: online ? ["retry"] : [] });
  }
  if (s === "reconnecting") out.push({ kind: "reconnecting", tone: "warn", key: "home.orb.reconnecting", sub: null, icon: "refresh", actions: [] });
  if ((s === "idle" || s === "error" || s === "reconnecting") && jobs) {
    out.push({ kind: "working", tone: "calm", key: "home.workRunning", sub: null, icon: "check", actions: [] });
  }
  if ((s === "idle" || s === "error") && c.voiceServerActive) {
    out.push({ kind: "otherCall", tone: "info", key: c.ended ? "talk.oldCall" : "talk.otherScreen", sub: null, icon: "info", actions: ["endOther"] });
  }
  if (CONNECTED.has(s)) {
    for (const i of c.issues || []) out.push({ kind: "issue", tone: "warn", key: ISSUE_KEYS[i.source] || "home.issue.other", sub: null, icon: "alert", actions: [] });
  }
  // One line per kind (two mic issues read as one).
  const seen = new Set();
  return out.filter((n) => { const k = `${n.kind}|${n.key}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Why a call ended without the owner pressing End: a code from call.js (dropped, expired, stuck,
 * offline) or the English note voice.js gives for a server-side end (time limit, Sahay left).
 */
export function endedKind(reason) {
  const r = String(reason || "");
  if (r === "offline") return "offline";
  if (r === "stuck") return "stuck";
  if (r === "dropped" || r === "expired") return "dropped";
  if (/time limit/i.test(r)) return "limit";
  return "ended";
}
const ENDED_SUB = { offline: "call.offline", stuck: "call.stuck", dropped: "home.droppedText", limit: "home.endedLimit", ended: "home.endedText" };

const ISSUE_KEYS = {
  mic: "home.issue.mic",
  audio: "home.issue.audio",
  token: "home.issue.token",
  agent: "home.issue.agent",
  message: "home.issue.message",
};

/**
 * The conversation: the disclosure pinned first (Sahay's first spoken line once the call has one,
 * else the written sentence), then the latest `keep` turns, older ones folded as "Earlier (n)".
 * -> { pinned: { text, spoken }, older: number, shown: turns[], count }
 */
export function conversationView(transcript, { disclosure = "", showEarlier = false, keep = 3 } = {}) {
  const turns = (Array.isArray(transcript) ? transcript : []).filter((x) => x && (x.role === "owner" || x.role === "agent") && String(x.text || "").trim());
  const first = turns.find((x) => x.role === "agent");
  const rest = turns.filter((x) => x !== first);
  const older = Math.max(0, rest.length - keep);
  return {
    pinned: first ? { text: first.text, spoken: true } : { text: disclosure, spoken: false },
    older,
    shown: showEarlier ? rest : rest.slice(-keep),
    count: turns.length,
  };
}

/** A typed yes in any of the three languages; typed yes never approves (CLAUDE.md rule 3). */
const YES = /^\s*(yes|yeah|yep|ok|okay|haan|haa|han|ha|ji|ji haan|theek hai|hau|houdu|sari|हाँ|हां|हा|जी|जी हाँ|जी हां|ठीक है|ಹೌದು|ಹೂಂ|ಸರಿ|ಆಯ್ತು)\s*[.!।]*\s*$/i;
export function isTypedYes(text) { return YES.test(String(text || "").normalize("NFC")); }

/** First visit: no conversation yet and nothing ever asked, bought or billed. */
export function isFirstVisit({ turns = 0, requirements = 0, orders = 0, hasRequirement = false } = {}) {
  return turns === 0 && requirements === 0 && orders === 0 && !hasRequirement;
}

/**
 * HUD trackers for the "now doing" line (Gather-style corner-bracket chips), from store data only.
 * input: { requirement: { item, quantity, unit, maxPrice } | null, sellers: number|null,
 *   bargain: { vendor, simulated, round, offer, unit } | null, best: { price, unit, vendor, simulated } | null,
 *   waitingYes: number, route: "proxy"|null, live: bool }
 * -> [{ id, icon, key, vars, tone, sim? }] at most 4, in reading order.
 */
export function hudTrackers(d) {
  const out = [];
  const r = d.requirement;
  if (r && Number.isFinite(r.quantity) && r.quantity > 0) {
    out.push({ id: "need", icon: "box", key: "hud.need", vars: { qty: r.quantity, unit: r.unit || "" }, tone: "calm" });
  }
  if (r && Number.isFinite(r.maxPrice) && r.maxPrice > 0) {
    out.push({ id: "cap", icon: "tag", key: "hud.cap", vars: { price: r.maxPrice, unit: r.unit || "" }, tone: "calm" });
  }
  if (Number.isFinite(d.sellers) && d.sellers > 0) {
    out.push({ id: "sellers", icon: "store", key: "hud.sellers", vars: { n: d.sellers }, tone: "calm" });
  }
  const b = d.bargain;
  if (b && Number.isFinite(b.offer) && b.offer > 0) {
    out.push({ id: "bargain", icon: "handshake", key: Number.isFinite(b.round) && b.round > 0 ? "hud.round" : "hud.offer", vars: { n: b.round, price: b.offer, unit: b.unit || "" }, tone: "live", sim: Boolean(b.simulated) });
  } else if (d.best && Number.isFinite(d.best.price) && d.best.price > 0) {
    out.push({ id: "best", icon: "check", key: "hud.best", vars: { price: d.best.price, unit: d.best.unit || "" }, tone: "done", sim: Boolean(d.best.simulated) });
  }
  if (d.waitingYes > 0) out.push({ id: "yes", icon: "bell", key: d.waitingYes > 1 ? "hud.yesMany" : "hud.yes", vars: { n: d.waitingYes }, tone: "needs" });
  // The need is the least news: drop it first when there are more than four.
  while (out.length > 4) out.splice(out.findIndex((x) => x.id === "need" || x.id === "cap"), 1);
  return out;
}

/**
 * The current bargain from negotiation rows: the open one (no endedAt), its last round with an offer.
 * negotiations: [{ endedAt, vendorId, turns: [{ offer, unit, round, speaker }] }]
 */
export function liveBargain(negotiations) {
  const open = (Array.isArray(negotiations) ? negotiations : []).filter((n) => n && !n.endedAt);
  for (const n of open.reverse()) {
    const turns = Array.isArray(n.turns) ? n.turns : [];
    const withOffer = turns.filter((t) => t && Number.isFinite(t.offer) && t.offer > 0);
    const last = withOffer[withOffer.length - 1];
    if (last) return { vendorId: n.vendorId ?? null, round: Number.isFinite(last.round) ? last.round : null, offer: last.offer, unit: last.unit || null };
  }
  return null;
}

/** Lowest landed / unit price among quotes for the requirement: { price, unit, vendorId, simulated } or null. */
export function bestQuote(quotes, requirementId) {
  let best = null;
  for (const q of Array.isArray(quotes) ? quotes : []) {
    if (!q || (requirementId && q.requirementId && String(q.requirementId) !== String(requirementId))) continue;
    const p = Number.isFinite(q.unitPrice) ? q.unitPrice : null;
    if (p === null || p <= 0) continue;
    if (!best || p < best.price) best = { price: p, unit: q.unit || null, vendorId: q.vendorId ?? null, simulated: q.simulated === true };
  }
  return best;
}

/**
 * Today tiles (idle home, no conversation yet): each value is a real number or the tile is left
 * out (a source not loaded yet is not a zero). 0 shows as 0.
 * input: { toCollect, toPay, low, billsWaiting } (number | null each) -> [{ id, key, value, kind, icon, route }]
 */
export function todayTiles(d) {
  const rows = [
    { id: "collect", key: "home.tile.collect", value: d.toCollect, kind: "money", icon: "moneyIn", route: "#/money" },
    { id: "pay", key: "home.tile.pay", value: d.toPay, kind: "money", icon: "rupee", route: "#/money" },
    { id: "low", key: "home.tile.low", value: d.low, kind: "count", icon: "jar", route: "#/stock" },
    { id: "bills", key: "home.tile.bills", value: d.billsWaiting, kind: "count", icon: "receipt", route: "#/sell" },
  ];
  return rows.filter((r) => Number.isFinite(r.value));
}

/** "₹20,200" / "₹55.5" in Indian grouping. */
export function inr(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const f = new Intl.NumberFormat("en-IN", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
  return `₹${f.format(n)}`;
}

/** Indian grouping without the rupee sign. */
export function grouped(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n) : "";
}
