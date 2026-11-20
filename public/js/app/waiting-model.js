// The "Waiting for your yes" state machine (UX v3 D6-D8), with no DOM and no imports, so node:test
// can drive it (test/waiting-model.test.js). waiting.js feeds it the pending decisions from the
// stores, the live server events and the owner's taps, and renders what view() returns.
//
// One card per decision, whatever its kind:
//   buy     purchase approval   key "approval:<approvalId>"  POST /api/approvals/:id/decision
//   bill    bill to issue       key "invoice:<invoiceId>"    POST /api/invoices/:id/decision
//   reorder buy-more proposal   key "reorder:<proposalId>"   POST /api/stock/reorders/:id/decision
//   rule    suggested rule      key "rule:<ruleId>"          POST /api/agent/rules/:id/decision
//
// Phases (D8: only server events move a card forward; the agent's words never do):
//   waiting  the owner's yes is needed (Yes / No live)
//   error    the tap failed; the server's `say` is shown, Yes / No live again
//   saving   after a tap, or after the server's own "decided" event for a voice answer
//   done     only on order.created / invoice.issued / stock.reorder_decided(accepted) / rule.decided(active)
//   declined the server recorded the owner's no
//   notDone  saving for 45 s with no done event ("not done yet, check <area>")
//   gone     the server says it was already answered (409) or no longer exists
// Auto-open (D7) is a signal raised only by the server's *.spoken events.

export const SAVE_TIMEOUT_MS = 45000;
/** Done, declined and gone cards leave by themselves after this long (the owner can close them sooner). */
export const SETTLED_TTL_MS = 120000;

export const KINDS = Object.freeze(["buy", "bill", "reorder", "rule"]);
export const AREA = Object.freeze({ buy: "buy", bill: "sell", reorder: "stock", rule: "me" });
const PREFIX = { buy: "approval", bill: "invoice", reorder: "reorder", rule: "rule" };
const KIND_OF = { approval: "buy", invoice: "bill", reorder: "reorder", rule: "rule" };
/** D6 order after the card being spoken now: money first (buy and bill together, oldest first), then reorder, then rule. */
const RANK = { buy: 0, bill: 0, reorder: 1, rule: 2 };

/** Server codes meaning "this was already answered or no longer exists": the card closes, no retry. */
export const GONE_CODES = Object.freeze([
  "ALREADY_DECIDED", "PROPOSAL_DECIDED", "NO_PENDING_APPROVAL", "RULE_ALREADY_DECIDED", "ALREADY_ORDERED",
  "NO_PROPOSAL", "APPROVAL_NOT_FOUND", "INVOICE_NOT_FOUND", "RULE_NOT_FOUND", "INVOICE_ALREADY_ISSUED",
]);
/** A bill refused because the shop's GST details are missing: the card shows the shop fix. */
export const FIX_CODES = Object.freeze(["GSTIN_REQUIRED", "STATE_REQUIRED"]);

/** Wire decision words per kind: [yes, no]. */
export const DECISION = Object.freeze({
  buy: ["approve", "reject"], bill: ["approve", "reject"], reorder: ["yes", "no"], rule: ["keep", "forget"],
});

export function keyOf(kind, id) {
  if (!PREFIX[kind] || id === null || id === undefined || id === "") return null;
  return `${PREFIX[kind]}:${id}`;
}

export function parseKey(key) {
  const m = /^([a-z]+):(.+)$/.exec(String(key || ""));
  if (!m || !KIND_OF[m[1]]) return null;
  return { kind: KIND_OF[m[1]], id: m[2] };
}

/** The read-aloud key the server knows (src/agent/speak.js): reorder cards are read through their item. */
export function speakKeyOf(kind, id, itemId) {
  if (kind === "buy") return `approval:${id}`;
  if (kind === "bill") return `invoice:${id}`;
  if (kind === "rule") return `rule:${id}`;
  if (kind === "reorder") return itemId ? `item:${itemId}` : null;
  return null;
}

/** D6 order: the card being spoken now, then buy + bill oldest first, then reorder, then rule. */
export function orderItems(items, speakingKey = null) {
  return [...items].sort((a, b) => {
    if (speakingKey) {
      if (a.key === speakingKey && b.key !== speakingKey) return -1;
      if (b.key === speakingKey && a.key !== speakingKey) return 1;
    }
    const r = (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9);
    if (r) return r;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.key).localeCompare(String(b.key));
  });
}

/**
 * Where the tray and an auto-opened card live (spec section 6.3):
 *   sheet        phone portrait: bottom sheet over the dock
 *   landDrawer   phone landscape: right drawer 55 % wide
 *   tabletSheet  600-1023: bottom sheet centred, max 560
 *   drawer       1024-1279: right drawer 400, light scrim
 *   column       1280+: inside the agent column, no scrim
 */
export function placeFor({ width, height }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (h > 0 && h <= 500 && w >= 568 && w < 1024) return "landDrawer";
  if (w < 600) return "sheet";
  if (w < 1024) return "tabletSheet";
  if (w < 1280) return "drawer";
  return "column";
}

const YES_WORDS = new Set([
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "haan", "han", "haa", "ha", "haanji", "ji", "theek", "thik", "accha", "achha",
  "हाँ", "हां", "हा", "हाँजी", "जी", "ठीक", "अच्छा", "ಹೌದು", "ಹೂಂ", "ಸರಿ", "ಓಕೆ", "howdu", "houdu", "sari",
]);

/** A typed short yes ("haan", "हाँ जी", "ಹೌದು", "yes buy it"): it never counts as the owner's yes (rule 3). */
export function isTypedYes(text) {
  const words = String(text || "").toLowerCase().replace(/[.,!?।"'“”‘’]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return YES_WORDS.has(words[0]);
}

const LIVE = new Set(["waiting", "error"]);
const SETTLED = new Set(["done", "declined", "gone"]);

export function createWaitingModel({ now = () => Date.now(), timeoutMs = SAVE_TIMEOUT_MS, settledTtlMs = SETTLED_TTL_MS } = {}) {
  /** key -> card */
  const cards = new Map();
  /** keys the server has spoken whose item we do not hold yet (the store loads it a moment later) */
  const spokenEarly = new Map();
  let speaking = null;
  let signals = [];

  function card(key) { return cards.get(key) || null; }

  function setPhase(c, phase, extra = {}) {
    c.phase = phase;
    c.since = now();
    Object.assign(c, extra);
    if (phase !== "saving") c.busy = null;
  }

  function open(key, reason) {
    signals.push({ type: "open", key, reason });
  }

  /**
   * The current pending decisions, from the stores: [{ key, kind, id, createdAt, ...data }].
   * New items join as waiting; items that left the pending lists while waiting were answered
   * elsewhere and leave; saving and settled cards stay until their own event or timeout.
   */
  function sync(items) {
    const seen = new Set();
    for (const it of items || []) {
      if (!it || !it.key) continue;
      seen.add(it.key);
      let c = cards.get(it.key);
      if (!c) {
        c = { key: it.key, kind: it.kind, id: String(it.id), phase: "waiting", since: now(), busy: null, say: null, fix: null, result: null, decidedSeen: false, spokenAt: null };
        cards.set(it.key, c);
      }
      c.data = it;
      c.createdAt = it.createdAt || c.createdAt || null;
      if (spokenEarly.has(it.key)) {
        c.spokenAt = spokenEarly.get(it.key);
        spokenEarly.delete(it.key);
        if (LIVE.has(c.phase)) open(it.key, "spoken");
      }
    }
    for (const [key, c] of cards) {
      if (seen.has(key)) continue;
      if (LIVE.has(c.phase)) cards.delete(key);
    }
    if (speaking && !cards.has(speaking)) speaking = null;
  }

  function spoken(key, ts) {
    speaking = key;
    const c = cards.get(key);
    if (!c) { spokenEarly.set(key, ts || null); return; }
    c.spokenAt = ts || new Date(now()).toISOString();
    if (LIVE.has(c.phase)) open(key, "spoken");
  }

  function decided(key, yes, { reason } = {}) {
    const c = cards.get(key);
    if (!c) return;
    c.decidedSeen = true;
    if (yes) {
      if (c.phase !== "done") setPhase(c, "saving", { busy: "yes", say: null });
    } else if (reason) {
      // Withdrawn by the server (a newer deal or bill replaced it): nothing to show.
      cards.delete(key);
    } else if (c.phase !== "done") {
      setPhase(c, "declined", { say: null });
    }
    if (speaking === key) speaking = null;
  }

  function done(key, result) {
    const c = cards.get(key);
    if (!c || c.phase === "done") return;
    c.decidedSeen = true;
    setPhase(c, "done", { result: { ...(c.result || {}), ...(result || {}) }, say: null });
    if (speaking === key) speaking = null;
  }

  const str = (v) => (v === undefined || v === null || v === "" ? null : String(v));

  /** A live server event { type, data, ts }. */
  function event(evt) {
    if (!evt || typeof evt !== "object") return;
    const d = evt.data && typeof evt.data === "object" ? evt.data : {};
    const ts = evt.ts || null;
    switch (evt.type) {
      case "approval.spoken": { const id = str(d.approvalId); if (id) spoken(`approval:${id}`, d.spokenAt || ts); break; }
      case "invoice.spoken": { const id = str(d.invoiceId); if (id) spoken(`invoice:${id}`, d.spokenAt || ts); break; }
      case "stock.reorder_spoken": { const id = str(d.proposalId); if (id) spoken(`reorder:${id}`, ts); break; }
      case "rule.spoken": { const id = str(d.ruleId); if (id) spoken(`rule:${id}`, ts); break; }
      case "approval.decided": {
        const id = str(d.approvalId ?? d.approval_id ?? d.id);
        if (id) decided(`approval:${id}`, d.status === "approved" || d.status === "consumed", { reason: d.reason });
        break;
      }
      case "order.created": {
        const aid = str(d.approvalId ?? d.approval_id);
        if (aid) done(`approval:${aid}`, { number: str(d.poNumber ?? d.po_number), orderId: str(d.orderId ?? d.order_id ?? d.id) });
        break;
      }
      case "invoice.decided": {
        const id = str(d.invoiceId ?? d.invoice_id);
        if (id) decided(`invoice:${id}`, d.status === "approved" || d.status === "consumed", { reason: d.reason });
        break;
      }
      case "invoice.issued": {
        const inv = d.invoice && typeof d.invoice === "object" ? d.invoice : d;
        const id = str(inv.id ?? inv.invoiceId ?? d.invoiceId);
        if (id) done(`invoice:${id}`, { number: str(inv.number), invoiceId: id, problems: Array.isArray(d.problems) && d.problems.length ? d.problems.length : 0 });
        break;
      }
      case "stock.reorder_decided": {
        const id = str(d.proposalId);
        if (!id) break;
        const key = `reorder:${id}`;
        if (d.status === "accepted") done(key, { requirementId: str(d.requirementId), searching: false });
        else decided(key, false);
        break;
      }
      case "job.started": {
        const kind = d.kind ?? (d.job && d.job.kind);
        const rid = str(d.requirementId ?? d.requirement_id ?? (d.job && (d.job.requirement_id ?? d.job.requirementId)) ?? (d.input && d.input.requirementId));
        if (kind !== "sourcing" || !rid) break;
        for (const c of cards.values()) {
          if (c.kind === "reorder" && c.phase === "done" && c.result && c.result.requirementId === rid) c.result.searching = true;
        }
        break;
      }
      case "rule.decided": {
        const r = d.rule && typeof d.rule === "object" ? d.rule : null;
        const id = str(r && r.id);
        if (!id) break;
        const key = `rule:${id}`;
        if (r.status === "active") done(key, { kept: true });
        else if (r.status === "off") decided(key, false, { reason: d.reason });
        break;
      }
      default:
        break;
    }
  }

  /** The owner pressed Yes (true) or No (false). Returns the wire decision word, or null if the card cannot take it. */
  function tap(key, yes) {
    const c = cards.get(key);
    if (!c || !LIVE.has(c.phase)) return null;
    if (c.data && c.data.voiceOnly) return null;
    setPhase(c, "saving", { busy: yes ? "yes" : "no", say: null, fix: null });
    return DECISION[c.kind][yes ? 0 : 1];
  }

  /** The decision request failed: err { status, code, say }. */
  function tapFailed(key, err = {}) {
    const c = cards.get(key);
    if (!c || c.phase !== "saving") return;
    const say = err.say || null;
    if (GONE_CODES.includes(err.code) || (err.status === 409 && !err.code)) { setPhase(c, "gone", { say }); return; }
    if (c.decidedSeen) { setPhase(c, "notDone", { say }); return; }
    if (FIX_CODES.includes(err.code)) { setPhase(c, "waiting", { fix: err.code, say }); return; }
    setPhase(c, "error", { say, code: err.code || null, status: err.status ?? null });
  }

  /** A snapshot shows the outcome a missed event would have carried (the order exists): same as that event. */
  function resolve(key, result) {
    const c = cards.get(key);
    if (c && (c.phase === "saving" || c.phase === "notDone")) done(key, result);
  }

  /** The shop details were saved: a bill card waiting on the shop fix returns to plain Yes / No. */
  function clearFix(key) {
    const c = cards.get(key);
    if (c && c.fix) { c.fix = null; c.say = null; }
  }

  function dismiss(key) {
    const c = cards.get(key);
    if (c && !LIVE.has(c.phase) && c.phase !== "saving") cards.delete(key);
  }

  /** Timers: saving -> notDone after 45 s; settled cards leave after their TTL. Returns true if anything changed. */
  function tick() {
    const t = now();
    let changed = false;
    for (const [key, c] of cards) {
      if (c.phase === "saving" && t - c.since >= timeoutMs) { setPhase(c, "notDone"); changed = true; }
      else if (SETTLED.has(c.phase) && t - c.since >= settledTtlMs) { cards.delete(key); changed = true; }
    }
    return changed;
  }

  function list() {
    return orderItems([...cards.values()].map((c) => ({ ...c, kind: c.kind, createdAt: c.createdAt })), speaking);
  }

  /** Decisions that still need the owner (the badge). */
  function count() {
    let n = 0;
    for (const c of cards.values()) if (LIVE.has(c.phase)) n += 1;
    return n;
  }

  function takeSignals() { const s = signals; signals = []; return s; }

  return {
    sync, event, tap, tapFailed, resolve, clearFix, dismiss, tick, list, count, card, takeSignals,
    speaking: () => speaking,
    hasTimers: () => [...cards.values()].some((c) => c.phase === "saving" || SETTLED.has(c.phase)),
  };
}
