// Sahay home (UI v5), the logic without the DOM: the call state, the figure's state, the controls,
// the recovery notes, the conversation turns, the "Needs you" rows and today's numbers, all from
// plain inputs (the call object, store rows). No imports and no DOM, so node:test loads it as is
// (test/home-model.test.js). Functions return i18n keys + vars; home.js turns them into words.
// Rule: nothing here invents a number. A value exists only when it came from the server.

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

/** A transcript timestamp (ms, s, ISO, or SQLite "YYYY-MM-DD HH:MM:SS" in UTC) -> Date | null. */
export function parseTime(ts) {
  if (ts === null || ts === undefined || ts === "") return null;
  if (typeof ts === "number") { const d = new Date(ts < 1e12 ? ts * 1000 : ts); return Number.isNaN(d.getTime()) ? null : d; }
  let s = String(ts).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const ISSUED = new Set(["issued", "part_paid", "paid"]);
/**
 * Today's four tiles (Orders, Bills, Money in, Low stock), real numbers only. A source that has not
 * loaded gives null (the tile shows a skeleton), never a made-up zero.
 * input: { now, orders: [{createdAt}], ordersReady, invoices: [{status, issuedAt, createdAt}] | null,
 *   receipts: [{amount, createdAt}] | null, items: [{low}] | null }
 */
export function todayStats({ now = new Date(), orders = [], ordersReady = true, invoices = null, receipts = null, items = null }) {
  const today = (ts) => sameDay(parseTime(ts), now);
  return [
    { id: "orders", key: "home.stat.orders", kind: "count", tone: "plain", icon: "receipt", route: "#/buy",
      value: ordersReady ? orders.filter((o) => today(o.createdAt)).length : null },
    { id: "bills", key: "home.stat.bills", kind: "count", tone: "plain", icon: "doc", route: "#/sell",
      value: invoices ? invoices.filter((i) => ISSUED.has(i.status) && today(i.issuedAt || i.createdAt)).length : null },
    { id: "received", key: "home.stat.received", kind: "money", tone: "good", icon: "moneyIn", route: "#/money",
      value: receipts ? receipts.filter((r) => today(r.createdAt)).reduce((s, r) => s + (Number(r.amount) || 0), 0) : null },
    { id: "low", key: "home.stat.low", kind: "count", tone: "warn", icon: "alert", route: "#/stock",
      value: items ? items.filter((i) => i && i.low === true).length : null },
  ];
}

/** The language of a turn for its meta line: the turn's own code ("hi-IN") or its script. -> "en" | "hi" | "kn" */
export function turnLang(turn) {
  const code = String((turn && turn.language) || "").slice(0, 2).toLowerCase();
  if (code === "hi" || code === "kn" || code === "en") return code;
  const text = String((turn && turn.text) || "");
  if (/[ಀ-೿]/u.test(text)) return "kn";
  if (/[ऀ-ॿ]/u.test(text)) return "hi";
  return "en";
}

/* ------------------------------------------------------------------- v5 home -- */

/**
 * The agent sprite's state (public/art/agent-<state>.png: idle | listening | thinking | speaking |
 * waiting | trouble) from orbView(). Connecting is "thinking"; a safer route, no internet, a voice
 * error or a dropped call is "trouble". `waitingYes` > 0 shows "waiting" while nobody is talking.
 */
export function boxState(view, waitingYes = 0) {
  if (!view) return "idle";
  if (view.visual === "error" || view.state === "safer") return "trouble";
  if (view.visual === "speaking") return "speaking";
  if (view.visual === "thinking") return "thinking";
  if (view.visual === "listening") return view.state === "muted" ? (waitingYes > 0 ? "waiting" : "idle") : "listening";
  if (view.visual === "connecting" || view.visual === "working") return waitingYes > 0 && view.visual === "working" ? "waiting" : "thinking";
  return waitingYes > 0 ? "waiting" : "idle";
}

/**
 * The short state word shown next to the figure. A call state wins (it answers the owner now);
 * then a decision waiting; then real work (activity.js nowLine, shown as its own sentence).
 * input: { view: orbView(), nowKey, waitingYes } -> { key, now: bool, tone: "calm"|"live"|"warn"|"bad" }
 */
const STATE_WORD = {
  listening: "home.state.listening", yourTurn: "home.state.yourTurn", thinking: "home.state.thinking", speaking: "home.state.speaking",
  muted: "home.state.muted", waiting: "home.state.joining", mic: "home.state.mic", connecting: "home.state.connecting",
  safer: "home.state.safer", reconnecting: "home.state.reconnecting", ending: "home.state.ending",
  offline: "home.state.offline", blocked: "home.state.trouble", micBlocked: "home.state.micBlocked", error: "home.state.trouble",
  dropped: "home.state.dropped", ended: "home.state.ended",
};
export function stateWord({ view, nowKey, waitingYes = 0 }) {
  const st = view && view.state;
  if (STATE_WORD[st]) return { key: STATE_WORD[st], now: false, tone: view.tone || "calm" };
  if (waitingYes > 0) return { key: "home.state.waitingYes", now: false, tone: "warn" };
  // "Waiting for your yes" comes only from the Needs-you rows (waitingYes), never from the store's
  // own approvals line, so the state word and the Needs you card always agree.
  if (nowKey && nowKey !== "now.idle" && nowKey !== "now.waitingYes") return { key: nowKey, now: true, tone: "live" };
  return { key: "home.state.ready", now: false, tone: "calm" };
}

/** "Good morning" before noon, "Good afternoon" before 5 pm, else "Good evening" (local time). */
export function greetingKey(date = new Date()) {
  const hr = date.getHours();
  return hr < 12 ? "home.greet.morning" : hr < 17 ? "home.greet.afternoon" : "home.greet.evening";
}

/**
 * The conversation panel shows only during a call, or just after one (for `keepMs`), or when the
 * owner typed in this session; otherwise Home has no conversation at all.
 */
export function showConversation({ live, turns = 0, endedAt = null, typed = false, now = Date.now(), keepMs = 10 * 60 * 1000 }) {
  if (live) return true;
  if (!turns) return false;
  if (typed) return true;
  return Boolean(endedAt) && now - endedAt < keepMs;
}
