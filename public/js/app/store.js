// One store for the app: GET /api/state snapshot + the SSE reducer + GET /api/agent.
// Snapshot rows are snake_case (src/db/schema.sql); event payloads are camelCase
// (docs/build/architecture.md). Both are accepted. Ported from the old console reducer.

import * as api from "../api.js";
import { connectEvents } from "../events.js";
import { pick, num, parseMaybeJson, asArray } from "./dom.js";

export const state = {
  boot: "loading", // loading | auth | welcome | ready | error
  bootError: null,
  config: { accessCodeRequired: false },
  business: null,
  account: null,      // { id, phone, phone_verified } once signed in (ACC); null for a device-only shop
  accounts: "unknown", // unknown | ready | missing (the server has no /api/auth routes yet)
  stream: "connecting",
  requirement: null,
  requirements: [],
  jobs: new Map(),
  vendors: new Map(),
  negotiations: new Map(),
  quotes: new Map(),
  approvals: new Map(),
  orders: new Map(),
  followups: new Map(),
  audit: new Map(),
  voiceServer: null,
  telegramLinked: false,
  agent: { status: "idle", profile: null, rules: new Map(), memories: new Map(), error: null },
  serverErrors: [],
};

/* -------------------------------------------------------------- pub/sub -- */

const subs = new Set();
const dirty = new Set();
let frame = 0;

/** subscribe(fn) -> unsubscribe. fn(state, parts: Set<string>) after each batch of changes. */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function touch(...parts) {
  for (const p of parts) dirty.add(p);
  if (!frame) frame = requestAnimationFrame(flush);
}
function flush() {
  frame = 0;
  const parts = new Set(dirty);
  dirty.clear();
  for (const fn of subs) {
    try { fn(state, parts); } catch (err) { console.error("render failed", err); }
  }
}

/* ---------------------------------------------------------- normalisers -- */

const bool = (v) => v === true || v === 1 || v === "1";

function normRequirement(d) {
  const r = d && d.requirement && typeof d.requirement === "object" ? d.requirement : d;
  if (!r || typeof r !== "object") return null;
  return {
    id: pick(r, "requirementId", "id"),
    item: pick(r, "item"),
    quantity: num(pick(r, "quantity")),
    unit: pick(r, "unit"),
    city: pick(r, "city"),
    targetPrice: num(pick(r, "target_price", "targetPrice")),
    maxPrice: num(pick(r, "max_price", "maxPrice", "max_price_per_unit")),
    deliveryBy: pick(r, "delivery_by", "deliveryBy"),
    status: pick(r, "status"),
    createdAt: pick(r, "created_at", "createdAt"),
  };
}

function normJob(d) {
  const j = d && d.job && typeof d.job === "object" ? d.job : d;
  const input = parseMaybeJson(pick(j, "input"));
  const progress = parseMaybeJson(pick(j, "progress"));
  const entries = Array.isArray(progress) ? progress.filter((e) => e && typeof e === "object") : [];
  let last = entries.length ? entries[entries.length - 1] : null;
  if (typeof pick(j, "message") === "string") last = { message: j.message, data: j.data && typeof j.data === "object" ? j.data : null };
  if (progress && typeof progress === "object" && !Array.isArray(progress) && typeof progress.message === "string") {
    const { message, data, ...rest } = progress;
    last = { message, data: { ...rest, ...(data && typeof data === "object" ? data : {}) } };
  }
  const inp = input && typeof input === "object" ? input : {};
  return {
    id: pick(j, "jobId", "job_id", "id"),
    kind: pick(j, "kind"),
    status: pick(j, "status"),
    progressMessage: last && typeof last.message === "string" ? last.message : undefined,
    progressData: last && last.data && typeof last.data === "object" ? last.data : undefined,
    error: pick(j, "error"),
    createdAt: pick(j, "created_at", "createdAt"),
    updatedAt: pick(j, "updated_at", "updatedAt"),
    requirementId: pick(j, "requirement_id") ?? pick(inp, "requirementId"),
    vendorId: pick(inp, "vendorId"),
    negotiationId: pick(inp, "negotiationId"),
    counterpart: pick(inp, "counterpart"),
  };
}

function normVendor(v) {
  return {
    id: pick(v, "vendorId", "vendor_id", "id"),
    requirementId: pick(v, "requirement_id", "requirementId"),
    name: pick(v, "name"),
    city: pick(v, "city"),
    itemTitle: pick(v, "item_title", "itemTitle"),
    listedPrice: num(pick(v, "listed_price", "listedPrice")),
    listedUnit: pick(v, "listed_unit", "listedUnit"),
    listedPriceText: pick(v, "listed_price_text", "listedPriceText"),
    rating: num(pick(v, "rating")),
    sourceUrl: pick(v, "source_url", "sourceUrl"),
    rank: num(pick(v, "rank")),
    source: pick(v, "source"),
    kind: pick(v, "kind"),
    simulated: pick(v, "kind") === "simulated" || pick(v, "source") === "simulated" ? true : undefined,
    createdAt: pick(v, "created_at", "createdAt"),
  };
}

function speakerOf(d) {
  const s = String(pick(d, "speaker") || "").toLowerCase();
  return s === "agent" || s === "vendor" ? s : s || "unknown";
}

function normTurn(t, fallbackTs) {
  const ts = pick(t, "ts") ?? fallbackTs ?? null;
  const speaker = speakerOf(t);
  const text = pick(t, "text");
  const round = num(pick(t, "round"));
  return {
    key: `${round ?? ""}|${speaker}|${typeof text === "string" ? text : ""}`,
    ts,
    speaker,
    text: typeof text === "string" ? text : "",
    offer: num(pick(t, "offer")),
    unit: pick(t, "unit"),
    round,
  };
}

function normNegotiationRow(r) {
  return {
    id: pick(r, "id"),
    requirementId: pick(r, "requirement_id"),
    vendorId: pick(r, "vendor_id"),
    counterpart: pick(r, "counterpart"),
    status: pick(r, "status"),
    outcome: parseMaybeJson(pick(r, "outcome")),
    createdAt: pick(r, "created_at"),
    endedAt: pick(r, "ended_at"),
    turns: asArray(parseMaybeJson(pick(r, "transcript"))).map((t) => normTurn(t)),
  };
}

function normQuote(q) {
  return {
    id: pick(q, "quoteId", "quote_id", "id"),
    requirementId: pick(q, "requirement_id", "requirementId"),
    vendorId: pick(q, "vendorId", "vendor_id"),
    vendorName: pick(q, "vendorName", "vendor_name"),
    negotiationId: pick(q, "negotiationId", "negotiation_id"),
    unitPrice: num(pick(q, "unit_price", "unitPrice")),
    unit: pick(q, "unit"),
    quantity: num(pick(q, "quantity")),
    leadTimeDays: num(pick(q, "lead_time_days", "leadTimeDays")),
    freight: num(pick(q, "freight")),
    landedCost: num(pick(q, "landed_cost", "landedCost")),
    simulated: q && "simulated" in q ? bool(q.simulated) : undefined,
    rank: num(pick(q, "rank")),
    createdAt: pick(q, "created_at", "createdAt"),
  };
}

function normApproval(a) {
  return {
    id: pick(a, "approvalId", "approval_id", "id"),
    quoteId: pick(a, "quoteId", "quote_id"),
    status: pick(a, "status"),
    readback: pick(a, "readback"),
    totalAmount: num(pick(a, "total_amount", "totalAmount")),
    requestedAt: pick(a, "requested_at", "requestedAt"),
    decidedAt: pick(a, "decided_at", "decidedAt"),
    decidedVia: pick(a, "decided_via", "decidedVia", "via"),
    simulated: a && "simulated" in a ? bool(a.simulated) : undefined,
  };
}

function normOrder(o) {
  return {
    id: pick(o, "orderId", "order_id", "id"),
    quoteId: pick(o, "quote_id", "quoteId"),
    approvalId: pick(o, "approval_id", "approvalId"),
    poNumber: pick(o, "po_number", "poNumber"),
    status: pick(o, "status"),
    amount: num(pick(o, "amount")),
    vendorName: pick(o, "vendor", "vendorName"),
    item: pick(o, "item"),
    quantity: num(pick(o, "quantity")),
    unit: pick(o, "unit"),
    pdfUrl: pick(o, "pdfUrl"),
    paymentUrl: pick(o, "payment_link_url", "paymentLinkUrl"),
    simulated: o && "simulated" in o ? bool(o.simulated) : undefined,
    createdAt: pick(o, "created_at", "createdAt"),
  };
}

function normFollowup(f) {
  return {
    id: pick(f, "followupId", "id"),
    orderId: pick(f, "orderId", "order_id"),
    kind: pick(f, "kind"),
    status: pick(f, "status"),
    message: pick(f, "message"),
    dueAt: pick(f, "due_at", "dueAt"),
    firedAt: pick(f, "fired_at", "firedAt"),
  };
}

function merge(map, rec) {
  if (rec.id === undefined || rec.id === null) return null;
  const key = String(rec.id);
  const prev = map.get(key) || {};
  const next = { ...prev };
  for (const [k, v] of Object.entries(rec)) if (v !== undefined && v !== null) next[k] = v;
  map.set(key, next);
  return next;
}

function ensureNegotiation(nid, d) {
  const key = String(nid);
  let n = state.negotiations.get(key);
  if (!n) {
    n = { id: key, turns: [], status: null, outcome: null, vendorId: null, counterpart: null, endedAt: null };
    state.negotiations.set(key, n);
  }
  n.vendorId = n.vendorId ?? pick(d, "vendorId", "vendor_id") ?? null;
  n.counterpart = n.counterpart ?? pick(d, "counterpart") ?? null;
  return n;
}

function clearRequirementScoped() {
  state.vendors.clear();
  state.negotiations.clear();
  state.quotes.clear();
}

/* -------------------------------------------------------------- reducer -- */

let resyncTimer = 0;
function scheduleResync() {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => { if (state.boot === "ready") resync(); }, 700);
}

const eventListeners = new Set();
const reducers = new Set();
const snapshotListeners = new Set();
/**
 * Extra reducers for other screen modules (store-sell.js): fn(evt, { live }) runs for every
 * event, replayed or live, after the built-in reducer. Call touch(part) from inside to re-render.
 */
export function registerReducer(fn) { reducers.add(fn); return () => reducers.delete(fn); }
/** fn(snapshot) after every GET /api/state (boot, reconnect, resync): the moment to refetch your own data. */
export function registerSnapshot(fn) { snapshotListeners.add(fn); return () => snapshotListeners.delete(fn); }
/** Raw live events for components that react to moments (vendor bubble pop-ins, ended calls). */
export function onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); }

export function applyEvent(evt, { live = true } = {}) {
  const { type } = evt;
  const d = evt.data && typeof evt.data === "object" ? evt.data : {};
  switch (type) {
    case "requirement.saved": {
      const r = normRequirement(d);
      if (!r) break;
      if (r.status === "dismissed") {
        // The owner removed this need: it leaves every list. If it was the current one, the
        // server's snapshot names the next current need (live only; a replay is followed by it).
        state.requirements = state.requirements.filter((x) => String(x.id) !== String(r.id));
        if (state.requirement && String(state.requirement.id) === String(r.id)) {
          state.requirement = null;
          if (live) resync();
        }
        touch("work");
        break;
      }
      const prev = state.requirement;
      if (prev && live && String(prev.id) !== String(r.id)) clearRequirementScoped();
      state.requirement = { ...(prev && String(prev.id) === String(r.id) ? prev : {}), ...r };
      const i = state.requirements.findIndex((x) => String(x.id) === String(r.id));
      if (i === -1) state.requirements.push(r); else state.requirements[i] = r;
      touch("work");
      break;
    }
    case "job.started": case "job.progress": case "job.done": case "job.failed": case "job.cancelled": {
      const j = normJob(d);
      j.status = { "job.done": "done", "job.failed": "failed", "job.cancelled": "cancelled" }[type] || "running";
      if (type === "job.started") j.createdAt = j.createdAt || evt.ts;
      if (type === "job.failed") j.error = j.error || pick(d, "message");
      j.updatedAt = evt.ts || j.updatedAt;
      merge(state.jobs, j);
      if (live && type === "job.done" && j.kind === "sourcing") scheduleResync();
      touch("work");
      break;
    }
    case "vendor.found": {
      const v = d.vendor && typeof d.vendor === "object" ? d.vendor : null;
      if (v) merge(state.vendors, { ...normVendor(v), requirementId: pick(v, "requirement_id") ?? pick(d, "requirementId") });
      touch("work");
      break;
    }
    case "negotiation.turn": {
      const nid = pick(d, "negotiationId");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      const turn = normTurn(d, evt.ts);
      if (!n.turns.some((x) => x.key === turn.key)) n.turns.push(turn);
      if (!n.status) n.status = "open";
      touch("work");
      break;
    }
    case "negotiation.ended": {
      const nid = pick(d, "negotiationId");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      n.status = pick(d, "status") || "ended";
      n.outcome = parseMaybeJson(pick(d, "outcome")) ?? n.outcome;
      n.endedAt = n.endedAt || evt.ts || new Date().toISOString();
      touch("work");
      break;
    }
    case "quote.recorded":
      merge(state.quotes, normQuote(d));
      if (live) scheduleResync();
      touch("work");
      break;
    case "approval.requested": case "approval.decided": {
      const a = normApproval(d);
      if (type === "approval.requested") { a.status = a.status || "pending"; a.requestedAt = a.requestedAt || evt.ts; }
      if (type === "approval.decided") a.decidedAt = a.decidedAt || evt.ts;
      merge(state.approvals, a);
      touch("approvals", "work");
      break;
    }
    case "order.created": {
      const o = normOrder(d);
      o.createdAt = o.createdAt || evt.ts;
      merge(state.orders, o);
      if (live) scheduleResync();
      touch("orders", "work");
      break;
    }
    case "order.status": {
      const oid = pick(d, "orderId");
      if (oid !== undefined) merge(state.orders, { id: oid, status: pick(d, "to") });
      touch("orders", "work");
      break;
    }
    case "payment.link": {
      const oid = pick(d, "orderId");
      if (oid !== undefined) merge(state.orders, { id: oid, paymentUrl: pick(d, "url") });
      touch("orders", "work");
      break;
    }
    case "followup.fired": {
      const f = normFollowup(d);
      f.status = "fired";
      f.firedAt = f.firedAt || evt.ts;
      if (f.id !== undefined) merge(state.followups, f);
      if (live) scheduleResync();
      touch("orders", "work");
      break;
    }
    case "telegram.linked":
      state.telegramLinked = true;
      touch("orders");
      break;
    case "session.started": case "session.ended":
      if (pick(d, "kind") === "owner") {
        state.voiceServer = type === "session.started" ? { channel: pick(d, "channel"), active: true } : null;
        touch("call");
      }
      break;
    case "rule.suggested": case "rule.decided": {
      const r = d.rule && typeof d.rule === "object" ? d.rule : null;
      if (r && r.id !== undefined) state.agent.rules.set(String(r.id), r);
      touch("agent");
      break;
    }
    case "memory.updated": {
      const m = d.memory && typeof d.memory === "object" ? d.memory : null;
      if (m && m.id !== undefined) state.agent.memories.set(String(m.id), m);
      touch("agent");
      break;
    }
    case "profile.updated":
      if (d.profile && typeof d.profile === "object") state.agent.profile = d.profile;
      touch("agent", "lang");
      break;
    case "error":
      if (live) {
        state.serverErrors = [{ ts: evt.ts, code: pick(d, "code"), message: pick(d, "message") || "" }, ...state.serverErrors].slice(0, 3);
        touch("banner");
      }
      break;
    default:
      break;
  }

  for (const fn of reducers) { try { fn(evt, { live }); } catch (err) { console.error("reducer failed", err); } }

  const key = evt.id !== null && evt.id !== undefined ? String(evt.id) : `local-${state.audit.size}-${type}`;
  if (!state.audit.has(key)) {
    state.audit.set(key, { id: key, ts: evt.ts, actor: evt.actor || "system", type, data: d });
    touch("history");
  }
  if (live) for (const fn of eventListeners) { try { fn(evt); } catch (err) { console.error(err); } }
}

function resetData() {
  state.requirement = null;
  state.requirements = [];
  for (const k of ["jobs", "vendors", "negotiations", "quotes", "approvals", "orders", "followups", "audit"]) state[k].clear();
}

/** GET /api/state rebuilds everything; the snapshot is authoritative over the audit replay. */
export function applySnapshot(snap) {
  snap = snap && typeof snap === "object" ? snap : {};
  resetData();
  const audit = asArray(snap.audit).slice().sort((x, y) => (num(x.id) ?? 0) - (num(y.id) ?? 0));
  for (const row of audit) {
    applyEvent({ id: row.id, ts: row.ts, type: row.type, actor: row.actor, data: parseMaybeJson(row.data ?? row.detail) || {} }, { live: false });
  }
  if (snap.business && typeof snap.business === "object") state.business = snap.business;
  state.requirements = asArray(snap.requirements).map(normRequirement).filter(Boolean);
  state.requirement = snap.requirement ? normRequirement(snap.requirement) : null;
  state.jobs.clear();
  for (const j of asArray(snap.jobs)) merge(state.jobs, normJob(j));
  clearRequirementScoped();
  for (const v of asArray(snap.vendors)) merge(state.vendors, normVendor(v));
  for (const r of asArray(snap.negotiations)) {
    const n = normNegotiationRow(r);
    if (n.id !== undefined) state.negotiations.set(String(n.id), { ...n, id: String(n.id) });
  }
  for (const q of asArray(snap.quotes)) merge(state.quotes, normQuote(q));
  for (const q of asArray(snap.deals)) merge(state.quotes, normQuote(q));
  state.approvals.clear();
  for (const a of asArray(snap.approvals)) merge(state.approvals, normApproval(a));
  state.orders.clear();
  for (const o of asArray(snap.orders)) merge(state.orders, normOrder(o));
  state.followups.clear();
  for (const f of asArray(snap.followups)) merge(state.followups, normFollowup(f));
  state.voiceServer = snap.voice && typeof snap.voice === "object" ? snap.voice : null;
  state.telegramLinked = snap.telegramLinked === true;
  touch("work", "approvals", "orders", "history", "call", "business");
  for (const fn of snapshotListeners) { try { fn(snap); } catch (err) { console.error("snapshot listener failed", err); } }
}

/* ------------------------------------------------------------- queries -- */

export const pendingApprovals = () => [...state.approvals.values()].filter((a) => a.status === "pending")
  .sort((a, b) => String(a.requestedAt || "").localeCompare(String(b.requestedAt || "")));

export function vendorName(vendorId) {
  const v = vendorId !== undefined && vendorId !== null ? state.vendors.get(String(vendorId)) : null;
  return v ? v.name : null;
}

export function isSimulatedVendor(vendorId) {
  const v = vendorId !== undefined && vendorId !== null ? state.vendors.get(String(vendorId)) : null;
  return Boolean(v && (v.kind === "simulated" || v.source === "simulated"));
}

/** Everything the Yes card needs about one approval, from the approval, its quote/deal and the need. */
export function approvalView(a) {
  const q = a.quoteId !== undefined ? state.quotes.get(String(a.quoteId)) : null;
  const req = state.requirement;
  const quantity = (q && q.quantity) ?? (req ? req.quantity : null);
  return {
    approval: a,
    quote: q || null,
    vendor: (q && (q.vendorName || vendorName(q.vendorId))) || null,
    simulated: Boolean(a.simulated || (q && (q.simulated || isSimulatedVendor(q.vendorId)))),
    unitPrice: q ? q.unitPrice : null,
    unit: (q && q.unit) || (req && req.unit) || null,
    quantity,
    item: req ? req.item : null,
    total: a.totalAmount ?? (q ? q.landedCost : null),
    leadTimeDays: q ? q.leadTimeDays : null,
  };
}

/* ---------------------------------------------------------------- boot -- */

let events = null;
let booting = null;

export async function boot({ session } = {}) {
  if (booting) return booting;
  booting = (async () => {
    state.boot = "loading";
    state.bootError = null;
    touch("boot");
    try {
      let s = session;
      if (!s) {
        // Signed in with an account? (404 = this server has no accounts yet: device sessions only.)
        try {
          const me = await agentRequest("GET", "/api/auth/me");
          state.account = me.account || null;
          state.accounts = "ready";
          if (me.business) s = { business: me.business };
        } catch (err) {
          state.account = null;
          if (err.status === 404) state.accounts = "missing";
          else if (err.status === 401) state.accounts = "ready";
          else throw err;
        }
      }
      // Logged out on a server with accounts and no device-only shop on this device: go straight to
      // Log in / Sign up. POST /api/session without shop details would only answer 400 (and the
      // browser logs every 400 as a console error on each logged-out load, QA v7 #1).
      let deviceShop = false;
      try { deviceShop = localStorage.getItem("sahay-device-shop") === "1"; } catch { /* storage blocked */ }
      if (!s && state.accounts === "ready" && !state.account && !deviceShop) {
        try { state.config.accessCodeRequired = Boolean((await api.getConfig()).accessCodeRequired); } catch { /* the register answer reveals it */ }
        state.boot = "auth";
        state.stream = "closed";
        touch("boot");
        return;
      }
      if (!s) {
        try {
          s = await api.openSession();
          // A shop that lives only on this device (no account): remember it, so a later load still opens it.
          if (s && s.business && !state.account) { try { localStorage.setItem("sahay-device-shop", "1"); } catch { /* storage blocked */ } }
        } catch (err) {
          if (err.code === "BUSINESS_DETAILS_REQUIRED") {
            try { state.config.accessCodeRequired = Boolean((await api.getConfig()).accessCodeRequired); } catch { /* the server's ACCESS_CODE_REQUIRED answer reveals it */ }
            // No shop on this device: Sign up / Log in (or the old welcome when accounts are off).
            state.boot = state.accounts === "missing" ? "welcome" : "auth";
            state.stream = "closed";
            touch("boot");
            return;
          }
          throw err;
        }
      }
      state.business = (s && s.business) || null;
      applySnapshot(await api.getState());
      state.boot = "ready";
    } catch (err) {
      state.boot = "error";
      state.bootError = err;
    }
    if (state.boot === "ready") {
      loadAgent();
      if (!events) {
        state.stream = "connecting";
        events = connectEvents({
          onEvent: (evt) => applyEvent(evt),
          onStatus: (st, info) => {
            state.stream = st;
            touch("stream");
            if (st === "open" && info && info.resumed) resync();
          },
        });
      }
    }
    touch("boot", "business", "lang");
  })().finally(() => { booting = null; });
  return booting;
}

export async function resync() {
  try {
    applySnapshot(await api.getState());
  } catch (err) {
    state.serverErrors = [{ ts: Date.now(), code: err.code || "RESYNC", message: err.message }, ...state.serverErrors].slice(0, 3);
    touch("banner");
  }
}

export function retryEvents() { if (events) events.retryNow(); }

/* --------------------------------------------------------- agent (B1) -- */

/** Same-origin JSON request for the agent endpoints (Track B); 404 means "not on this server yet". */
export async function agentRequest(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new api.ApiError(0, "NETWORK", "Could not reach the Sahay server.");
  }
  let payload = null;
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    try { payload = await res.json(); } catch { payload = null; }
  }
  if (!res.ok) throw new api.ApiError(res.status, (payload && payload.code) || `HTTP_${res.status}`, (payload && payload.message) || `HTTP ${res.status}`, payload && payload.say);
  return payload || {};
}

export async function loadAgent() {
  const A = state.agent;
  A.status = "loading";
  A.error = null;
  touch("agent");
  try {
    const r = await agentRequest("GET", "/api/agent");
    A.profile = r.profile && typeof r.profile === "object" ? r.profile : null;
    A.rules = new Map(asArray(r.rules).filter((x) => x && x.id !== undefined).map((x) => [String(x.id), x]));
    A.memories = new Map(asArray(r.memories).filter((x) => x && x.id !== undefined).map((x) => [String(x.id), x]));
    A.status = "ready";
  } catch (err) {
    A.status = err.status === 404 ? "missing" : "error";
    A.error = err;
  }
  touch("agent", "lang");
}

export async function updateProfile(patchBody) {
  const r = await agentRequest("PUT", "/api/agent/profile", patchBody);
  if (r.profile) state.agent.profile = r.profile;
  touch("agent", "lang");
  return r.profile;
}

export async function decideRule(ruleId, decision) {
  const r = await agentRequest("POST", `/api/agent/rules/${encodeURIComponent(ruleId)}/decision`, { decision });
  if (r.rule && r.rule.id !== undefined) state.agent.rules.set(String(r.rule.id), r.rule);
  touch("agent");
  return r.rule;
}

/** The no (cross) button on an earlier need: POST /api/requirements/:id/dismiss. Throws ApiError (409 REQUIREMENT_BUSY / _ORDERED). */
export async function dismissRequirement(requirementId) {
  const r = await agentRequest("POST", `/api/requirements/${encodeURIComponent(requirementId)}/dismiss`, {});
  if (r.requirement) applyEvent({ type: "requirement.saved", data: r.requirement });
  return r.requirement;
}

/** Business language, overridden by the agent profile. */
export function ownerLanguage() {
  return (state.agent.profile && state.agent.profile.language) || (state.business && state.business.language) || null;
}

/** POST /api/auth/logout, then back to Log in with nothing of the shop left in memory. */
export async function logout() {
  await agentRequest("POST", "/api/auth/logout", {}).catch((err) => { if (err.status !== 204) throw err; });
  try { localStorage.setItem("sahay-had-account", "1"); } catch { /* storage blocked */ }
  location.replace(`${location.pathname}#/login`);
  location.reload();
}
