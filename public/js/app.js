// Sahay voice console: one state store, fed by REST (GET /api/state), SSE (/api/events)
// and the Agora call. Panels render only what the server or the call produced; every
// panel has a designed empty, loading and error state. All text goes in via textContent.

import * as api from "./api.js";
import { connectEvents } from "./events.js";
import { VoiceCall, NegotiationListener, preloadSdks, scriptOf, withSystemLines, formatTimings } from "./voice.js";

/* ===================================================================== helpers */

const $ = (id) => document.getElementById(id);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = String(v);
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}
/** replaceChildren that skips null/false children (DOM replaceChildren would print "null"). */
function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

const ICONS = {
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  list: ["M9 6h11M9 12h11M9 18h11", "M4 6h.01M4 12h.01M4 18h.01"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  store: ["M3 9l1.5-5h15L21 9", "M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z", "M5 13v8h14v-8"],
  handshake: ["M11 17l-1.5 1.5a2 2 0 0 1-2.8-2.8L10 12.4", "M13 7l2-2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L14 18", "M3 11l4-4 3 1 3-2", "M14 18l-3-3"],
  check: ["M20 6L9 17l-5-5"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M9 12l2 2 4-4"],
  scale: ["M12 3v18M5 7h14", "M5 7l-3 7a3 3 0 0 0 6 0z", "M19 7l-3 7a3 3 0 0 0 6 0z"],
  doc: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6M8 13h8M8 17h5"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  alert: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 8v4M12 16h.01"],
  wifi: ["M2 8.8a15 15 0 0 1 20 0", "M5 12.5a10 10 0 0 1 14 0", "M8.5 16a5 5 0 0 1 7 0", "M12 19.5h.01"],
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6M10 14L21 3"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5M12 15V3"],
};
function icon(name, size = 22) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

function pick(o, ...keys) {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function parseMaybeJson(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}
function asArray(v) { return Array.isArray(v) ? v : []; }

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function money(v) { const n = num(v); return n === null ? null : inrFmt.format(n); }
function qty(q, unit) { const n = num(q); if (n === null) return null; return unit ? `${qtyFmt.format(n)} ${unit}` : qtyFmt.format(n); }
function perUnit(price, unit) { const m = money(price); if (!m) return null; return unit ? `${m} per ${unit}` : m; }

function toDate(ts) {
  if (ts === null || ts === undefined || ts === "") return null;
  const d = typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
function clock(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : null;
}
function dateTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
}
function timeEl(ts, fmt = clock) {
  const d = toDate(ts);
  const t = fmt(ts);
  return t ? h("time", { datetime: d.toISOString(), text: t }) : null;
}

/** Only http(s) links or same-origin paths ever become an href. */
function safeUrl(u) {
  if (typeof u !== "string" || !u) return null;
  try {
    const url = new URL(u, location.origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch { return null; }
}
function extLink(href, label, cls) {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", class: cls }, label, icon("external", 16));
}

/** Text with the right lang attribute so Devanagari and Kannada use their Noto faces. */
function scripted(tag, text, props = {}) {
  const sc = scriptOf(text);
  return h(tag, { ...props, lang: sc === "hi" ? "hi" : sc === "kn" ? "kn" : undefined, text });
}

/** Shared panel states: kind = empty | loading | error. */
function stateView(kind, { icon: ic, title, text, action }) {
  return h("div", { class: `state ${kind}`, role: kind === "error" ? "alert" : undefined },
    kind === "loading" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon(ic || (kind === "error" ? "alert" : "list"), 30),
    h("p", { class: "state-title", text: title }),
    text ? h("p", { class: "state-text", text }) : null,
    action ? h("button", { class: "btn btn-small", type: "button", on: { click: action.run }, text: action.label }) : null);
}
function bootStates(container, what) {
  if (state.boot === "loading") {
    container.replaceChildren(stateView("loading", { title: `Loading ${what}`, text: "Fetching the latest from the Sahay server." }));
    return true;
  }
  if (state.boot === "error") {
    container.replaceChildren(stateView("error", {
      title: `Could not load ${what}`,
      text: state.bootError ? state.bootError.message : "The Sahay server did not answer.",
      action: { label: "Try again", run: () => boot() },
    }));
    return true;
  }
  return false;
}

function setCount(id, n) {
  const el = $(id);
  if (!el) return;
  el.hidden = !(n > 0);
  el.textContent = n > 0 ? String(n) : "";
}

/* ======================================================================= store */

const state = {
  boot: "loading", // loading | onboarding | ready | error
  bootError: null,
  onboard: { busy: false, error: null, fieldErrors: {}, accessCodeRequired: false },
  business: null,
  stream: "connecting",
  requirement: null,
  requirements: [],
  adapt: [],
  jobs: new Map(),
  vendors: new Map(),
  negotiations: new Map(),
  quotes: new Map(),
  approvals: new Map(),
  approvalUi: new Map(),
  orders: new Map(),
  followups: new Map(),
  audit: new Map(),
  serverErrors: [],
  voiceServer: null, // GET /api/state `voice`: { channel, agentId, active } or null
  voiceServerUi: { busy: false, error: null },
  telegram: { linked: false, busy: false, error: null, link: null, blocked: false },
  listen: { negotiationId: null, status: "idle", error: null, speakers: 0, note: null },
  copyUi: new Map(),
  call: {
    status: "idle", agentState: null, muted: false, lang: null, langSource: null,
    error: null, note: null, ended: null, autoplay: false, issues: [], metrics: {}, transcriptLink: true,
  },
  transcript: [],
  // Server events shown among the spoken turns (a follow-up that fired); cleared with the transcript.
  systemLines: [],
};

function resetData() {
  state.requirement = null;
  state.requirements = [];
  state.adapt = [];
  state.jobs.clear();
  state.vendors.clear();
  state.negotiations.clear();
  state.quotes.clear();
  state.approvals.clear();
  state.orders.clear();
  state.followups.clear();
  state.audit.clear();
}

/** A new requirement replaces the vendor, negotiation and quote views (the server scopes them to the latest requirement). */
function clearRequirementScoped() {
  state.vendors.clear();
  state.negotiations.clear();
  state.quotes.clear();
}

const dirty = new Set();
let frame = 0;
const RENDERERS = {};
function invalidate(...parts) {
  for (const p of parts) dirty.add(p);
  if (!frame) frame = requestAnimationFrame(flush);
}
function invalidateAll() { invalidate(...Object.keys(RENDERERS)); }
function flush() {
  frame = 0;
  const parts = [...dirty];
  dirty.clear();
  for (const p of parts) {
    try { RENDERERS[p](); } catch (err) { console.error(`render ${p} failed`, err); }
  }
}

/* ================================================================ normalizers */
// Snapshot rows follow src/db/schema.sql (snake_case, JSON columns already parsed by the
// server); event payloads follow the emitters (camelCase). Both are accepted.

function bool(v) { return v === true || v === 1 || v === "1"; }

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
    notes: pick(r, "notes"),
    missing: asArray(pick(d, "missing") ?? pick(r, "missing")),
    status: pick(r, "status"),
    createdAt: pick(r, "created_at", "createdAt"),
  };
}

/** Jobs: a snapshot row has progress as an array of { ts, message, data? } and no input;
 *  job.* events carry { jobId, kind, input? | message, data? | result | error }. */
function normJob(d) {
  const j = d && d.job && typeof d.job === "object" ? d.job : d;
  const input = parseMaybeJson(pick(j, "input"));
  const progress = parseMaybeJson(pick(j, "progress"));
  const entries = Array.isArray(progress) ? progress.filter((e) => e && typeof e === "object") : [];
  let last = entries.length ? entries[entries.length - 1] : null;
  // job.progress as emitted by src/jobs.js: { jobId, kind, message, data? }.
  if (typeof pick(j, "message") === "string") last = { message: j.message, data: j.data && typeof j.data === "object" ? j.data : null };
  // job.* per architecture.md: { jobId, kind, status, progress: { message, done?, total?, pct?, ... } }.
  if (progress && typeof progress === "object" && !Array.isArray(progress) && typeof progress.message === "string") {
    const { message, data, ...rest } = progress;
    last = { message, data: { ...rest, ...(data && typeof data === "object" ? data : {}) } };
  }
  let joinUrl = null;
  for (const e of [...entries, last]) {
    const u = e && e.data && typeof e.data === "object" ? e.data.joinUrl : null;
    if (typeof u === "string") joinUrl = u;
  }
  const inp = input && typeof input === "object" ? input : {};
  return {
    id: pick(j, "jobId", "job_id", "id"),
    kind: pick(j, "kind"),
    status: pick(j, "status"),
    progressMessage: last && typeof last.message === "string" ? last.message : undefined,
    // Snapshot rows carry the whole history; live events add one line each (see applyEvent).
    progressLog: entries.length ? entries.filter((e) => typeof e.message === "string" && e.message).map((e) => ({ ts: e.ts ?? null, message: e.message })) : undefined,
    progressData: last && last.data && typeof last.data === "object" ? last.data : undefined,
    error: pick(j, "error"),
    createdAt: pick(j, "created_at", "createdAt"),
    updatedAt: pick(j, "updated_at", "updatedAt"),
    requirementId: pick(j, "requirement_id") ?? pick(inp, "requirementId"),
    vendorId: pick(inp, "vendorId"),
    negotiationId: pick(inp, "negotiationId"),
    counterpart: pick(inp, "counterpart"),
    joinUrl: joinUrl ?? undefined,
  };
}

function normVendor(v) {
  return {
    id: pick(v, "vendorId", "vendor_id", "id"),
    requirementId: pick(v, "requirement_id", "requirementId"),
    name: pick(v, "name"),
    city: pick(v, "city"),
    itemTitle: pick(v, "item_title", "itemTitle"),
    listedPriceText: pick(v, "listed_price_text", "listedPriceText"),
    rating: num(pick(v, "rating")),
    ratingCount: num(pick(v, "rating_count", "ratingCount")),
    sourceUrl: pick(v, "source_url", "sourceUrl"),
    rank: num(pick(v, "rank")),
    source: pick(v, "source"),
    kind: pick(v, "kind"),
    score: num(pick(v, "score")),
  };
}

/** A negotiation turn, from a negotiations.transcript entry or a negotiation.turn event. */
function normTurn(t, fallbackTs) {
  const ts = pick(t, "ts") ?? fallbackTs ?? null;
  const speaker = speakerOf(t);
  const text = pick(t, "text");
  return {
    key: `${ts}|${speaker}|${typeof text === "string" ? text : ""}`,
    ts,
    speaker,
    text,
    offer: num(pick(t, "offer")),
    unit: pick(t, "unit"),
    round: num(pick(t, "round")),
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

/** A quotes row, a quote.recorded event (the same row) or a ranked deal from GET /api/state. */
function normQuote(q) {
  return {
    id: pick(q, "quoteId", "quote_id", "id"),
    requirementId: pick(q, "requirement_id", "requirementId"),
    vendorId: pick(q, "vendorId", "vendor_id"),
    vendorName: pick(q, "vendorName", "vendor_name"),
    negotiationId: pick(q, "negotiationId", "negotiation_id"),
    unitPrice: num(pick(q, "unit_price", "unitPrice")),
    unit: pick(q, "unit"),
    moq: num(pick(q, "moq")),
    leadTimeDays: num(pick(q, "lead_time_days", "leadTimeDays")),
    freight: num(pick(q, "freight")),
    landedCost: num(pick(q, "landed_cost", "landedCost")),
    goodsCost: num(pick(q, "goodsCost")),
    paymentTerms: pick(q, "payment_terms"),
    simulated: q && "simulated" in q ? bool(q.simulated) : undefined,
    rank: num(pick(q, "rank")),
    dealStatus: pick(q, "rank") !== undefined ? pick(q, "status") : undefined,
    reason: pick(q, "reason"),
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
    evidence: pick(a, "evidence_utterance", "evidenceUtterance"),
    reason: pick(a, "reason"),
    simulated: a && "simulated" in a ? bool(a.simulated) : undefined,
  };
}

function normOrder(o) {
  return {
    id: pick(o, "orderId", "order_id", "id"),
    quoteId: pick(o, "quote_id", "quoteId"),
    poNumber: pick(o, "po_number", "poNumber"),
    status: pick(o, "status"),
    amount: num(pick(o, "amount")),
    currency: pick(o, "currency"),
    vendorName: pick(o, "vendor"),
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

/* ===================================================================== reducer */

const TYPE_LABEL = {
  "session.started": "Call started",
  "session.ended": "Call ended",
  "requirement.saved": "Requirement saved",
  "job.started": "Job started",
  "job.progress": "Job progress",
  "job.done": "Job finished",
  "job.failed": "Job failed",
  "job.cancelled": "Job cancelled",
  "vendor.found": "Vendor found",
  "negotiation.turn": "Negotiation turn",
  "negotiation.ended": "Negotiation ended",
  "quote.recorded": "Quote recorded",
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
  "order.created": "Order created",
  "order.status": "Order status",
  "payment.link": "Payment link created",
  "followup.fired": "Follow-up sent",
  "telegram.linked": "Telegram linked",
  "error": "Error",
};

const NEGO_STATUS = {
  open: "In progress", running: "In progress", starting: "Starting",
  agreed: "Agreed", walked_away: "Sahay walked away", no_deal: "No deal",
};
function negotiationRunning(n) {
  return !n.endedAt && (!n.status || n.status === "open" || n.status === "running" || n.status === "starting");
}

const ORDER_STATUS = {
  confirmed: "Confirmed", paid: "Paid", in_transit: "In transit",
  delivered: "Delivered", closed: "Closed", cancelled: "Cancelled",
};
const FOLLOWUP_KIND = { payment_due: "Payment reminder", delivery_check: "Delivery check" };

let resyncTimer = 0;
/** Some changes are only visible in GET /api/state (ranked deals, scheduled follow-ups). */
function scheduleResync() {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => { if (state.boot === "ready") resync(); }, 700);
}

function applyEvent(evt, { live = true } = {}) {
  const { type } = evt;
  const d = evt.data && typeof evt.data === "object" ? evt.data : {};

  switch (type) {
    case "requirement.saved": {
      const r = normRequirement(d);
      if (!r) break;
      const prev = state.requirement;
      if (prev && r.id !== undefined && String(prev.id) === String(r.id)) {
        const changes = describeRequirementChange(prev, r);
        if (changes) state.adapt.push({ ts: evt.ts, text: changes });
      } else if (prev && live) {
        clearRequirementScoped();
      }
      state.requirement = r;
      const i = state.requirements.findIndex((x) => String(x.id) === String(r.id));
      if (i === -1) state.requirements.push(r); else state.requirements[i] = r;
      invalidate("requirement", "plan", "vendors", "negotiation", "quotes");
      break;
    }
    case "job.started":
    case "job.progress":
    case "job.done":
    case "job.failed":
    case "job.cancelled": {
      const j = normJob(d);
      j.status = { "job.done": "done", "job.failed": "failed", "job.cancelled": "cancelled" }[type] || "running";
      if (type === "job.started") j.createdAt = j.createdAt || evt.ts;
      if (type === "job.failed") j.error = j.error || pick(d, "message");
      j.updatedAt = evt.ts || j.updatedAt;
      const prev = j.id !== undefined ? state.jobs.get(String(j.id)) : null;
      if (type === "job.started" && !prev) {
        // A new job of a kind that failed earlier is Sahay re-planning after a failure.
        const failed = [...state.jobs.values()].find((x) => x.kind === j.kind && x.status === "failed");
        if (failed) state.adapt.push({ ts: evt.ts, text: `Retried ${kindLabel(j.kind).toLowerCase()} after a failure` });
      }
      if (j.progressMessage && !j.progressLog) {
        const log = prev && Array.isArray(prev.progressLog) ? prev.progressLog : [];
        const lastLine = log[log.length - 1];
        j.progressLog = lastLine && lastLine.message === j.progressMessage ? log : [...log, { ts: evt.ts ?? null, message: j.progressMessage }];
      }
      merge(state.jobs, j);
      // The live vendor.found stream arrives in discovery order; the snapshot carries the
      // ranked order (scoring.rankVendors) the agent speaks from.
      if (live && type === "job.done" && j.kind === "sourcing") scheduleResync();
      invalidate("jobs", "plan", "vendors", "negotiation");
      break;
    }
    case "vendor.found": {
      const v = d.vendor && typeof d.vendor === "object" ? d.vendor : null;
      if (v) merge(state.vendors, { ...normVendor(v), requirementId: pick(v, "requirement_id") ?? pick(d, "requirementId") });
      invalidate("vendors", "plan", "negotiation", "quotes");
      break;
    }
    case "negotiation.turn": {
      const nid = pick(d, "negotiationId");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      const turn = normTurn(d, evt.ts);
      if (!n.turns.some((t) => t.key === turn.key)) n.turns.push(turn);
      if (!n.status) n.status = "open";
      invalidate("negotiation", "plan");
      break;
    }
    case "negotiation.ended": {
      const nid = pick(d, "negotiationId");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      n.status = pick(d, "status") || "ended";
      n.outcome = parseMaybeJson(pick(d, "outcome")) ?? n.outcome;
      n.endedAt = n.endedAt || evt.ts || new Date().toISOString();
      if (live && state.listen.negotiationId === String(nid) && state.listen.status !== "idle") {
        listener.stop().then(() => { state.listen.note = "The negotiation ended, so listening stopped."; invalidate("negotiation"); });
      }
      invalidate("negotiation", "plan");
      break;
    }
    case "quote.recorded": {
      merge(state.quotes, normQuote(d));
      if (live) scheduleResync();
      invalidate("quotes", "plan");
      break;
    }
    case "approval.requested":
    case "approval.decided": {
      const a = normApproval(d);
      if (type === "approval.requested") { a.status = a.status || "pending"; a.requestedAt = a.requestedAt || evt.ts; }
      if (type === "approval.decided") a.decidedAt = a.decidedAt || evt.ts;
      const rec = merge(state.approvals, a);
      if (rec && type === "approval.decided") state.approvalUi.delete(String(rec.id));
      invalidate("approval", "plan", "order");
      break;
    }
    case "order.created": {
      const o = normOrder(d);
      o.createdAt = o.createdAt || evt.ts;
      merge(state.orders, o);
      if (live) scheduleResync();
      invalidate("order", "plan");
      break;
    }
    case "order.status": {
      const oid = pick(d, "orderId");
      if (oid !== undefined) merge(state.orders, { id: oid, poNumber: pick(d, "poNumber"), status: pick(d, "to") });
      invalidate("order");
      break;
    }
    case "payment.link": {
      const oid = pick(d, "orderId");
      if (oid !== undefined) merge(state.orders, { id: oid, poNumber: pick(d, "poNumber"), paymentUrl: pick(d, "url") });
      invalidate("order", "plan");
      break;
    }
    case "followup.fired": {
      const f = normFollowup(d);
      f.status = "fired";
      f.firedAt = f.firedAt || evt.ts;
      if (f.id !== undefined) merge(state.followups, f);
      // E2E r3 bug 3: also a line in the live transcript, at the moment it fired.
      const key = `followup:${f.id ?? evt.id ?? state.systemLines.length}`;
      const at = toDate(f.firedAt);
      if (live && !state.systemLines.some((l) => l.key === key)) {
        state.systemLines.push({ key, role: "system", time: at ? at.getTime() : Date.now(), label: FOLLOWUP_KIND[f.kind] || "Follow-up", text: f.message || "" });
        invalidate("transcript");
      }
      invalidate("order", "plan");
      break;
    }
    case "telegram.linked": {
      state.telegram.linked = true;
      state.telegram.link = null;
      state.telegram.error = null;
      invalidate("order");
      break;
    }
    case "session.started":
    case "session.ended": {
      if (pick(d, "kind") === "owner") {
        state.voiceServer = type === "session.started" ? { channel: pick(d, "channel"), active: true } : null;
        // Closed from another tab or by the server while this tab still holds the call. A tab that
        // pressed End itself is already "ending" or "idle" here, so endedByServer ignores it.
        if (live && type === "session.ended") call.endedByServer(pick(d, "channel"), pick(d, "reason"));
        invalidate("call");
      }
      break;
    }
    case "error": {
      if (live) {
        state.serverErrors.unshift({ ts: evt.ts, code: pick(d, "code"), message: pick(d, "message") || "The server reported an error." });
        state.serverErrors = state.serverErrors.slice(0, 3);
        invalidate("banner");
      }
      break;
    }
    default:
      break;
  }

  const key = evt.id !== null && evt.id !== undefined ? String(evt.id) : `local-${state.audit.size}-${type}`;
  if (!state.audit.has(key)) {
    state.audit.set(key, { id: key, ts: evt.ts, actor: evt.actor || "system", type, data: d });
    invalidate("audit");
  }
}

function kindLabel(kind) {
  if (kind === "sourcing") return "Sourcing";
  if (kind === "negotiation") return "Negotiation";
  return kind ? String(kind) : "Job";
}

function speakerOf(d) {
  const s = String(pick(d, "speaker") || "").toLowerCase();
  if (s === "agent") return "agent";
  if (s === "vendor") return "vendor";
  return s || "unknown";
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

function describeRequirementChange(a, b) {
  const parts = [];
  if (a.quantity !== b.quantity && b.quantity !== null) parts.push(`quantity ${qty(a.quantity, a.unit) ?? "unset"} to ${qty(b.quantity, b.unit)}`);
  if (a.maxPrice !== b.maxPrice && b.maxPrice !== null) parts.push(`price ceiling ${money(a.maxPrice) ?? "unset"} to ${money(b.maxPrice)}`);
  if (a.city !== b.city && b.city) parts.push(`city to ${b.city}`);
  if (a.item !== b.item && b.item) parts.push(`item to ${b.item}`);
  if (a.deliveryBy !== b.deliveryBy && b.deliveryBy) parts.push(`delivery to ${b.deliveryBy}`);
  return parts.length ? `Changed ${parts.join(", ")}` : null;
}

/**
 * GET /api/state -> rebuild everything. The audit rows (newest 200, oldest first) are
 * replayed for the audit trail and the "Adapt" history; then every collection the snapshot
 * returns replaces what the replay produced, because the snapshot is authoritative.
 */
function applySnapshot(snap) {
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
  state.telegram.linked = snap.telegramLinked === true;
  if (state.telegram.linked) state.telegram.link = null;
  invalidateAll();
}

/* ================================================================== renderers */

const LANG_NAME = { "hi-IN": "Hindi", "kn-IN": "Kannada", "en-IN": "English" };
const LANG_SHORT = { "hi-IN": "hi", "kn-IN": "kn", "en-IN": "en" };

RENDERERS.onboarding = () => {
  const onboarding = state.boot === "onboarding";
  const card = $("onboarding");
  const wasHidden = card.hidden;
  card.hidden = !onboarding;
  $("main").hidden = onboarding;
  $("call-skip").hidden = onboarding;
  if (!onboarding) return;

  const ob = state.onboard;
  $("ob-access").hidden = !ob.accessCodeRequired;
  const fields = { name: "ob-name", ownerName: "ob-owner", city: "ob-city", language: "ob-language", accessCode: "ob-code" };
  for (const [key, id] of Object.entries(fields)) {
    const msg = ob.fieldErrors[key] || "";
    const err = $(`${id}-error`);
    err.textContent = msg;
    err.hidden = !msg;
    const target = key === "language" ? $("ob-language") : $(id);
    if (msg) target.setAttribute("aria-invalid", "true");
    else target.removeAttribute("aria-invalid");
  }
  const formError = $("ob-form-error");
  formError.replaceChildren();
  formError.hidden = !ob.error;
  if (ob.error) {
    append(formError, [icon("alert", 20), h("div", { class: "body" },
      h("strong", { text: "Sahay could not save your business" }), h("span", { text: ob.error }))]);
  }
  for (const el of $("onboard-form").elements) el.disabled = ob.busy;
  const submit = $("ob-submit");
  submit.replaceChildren();
  if (ob.busy) append(submit, [h("span", { class: "spinner", "aria-hidden": "true" }), "Saving"]);
  else submit.textContent = "Continue";
  if (wasHidden) requestAnimationFrame(() => $("ob-name").focus());
};

RENDERERS.header = () => {
  const el = $("business-name");
  const b = state.business;
  const name = b && pick(b, "name");
  const where = b && pick(b, "city");
  el.hidden = !name;
  el.textContent = name ? [name, where].filter(Boolean).join(" · ") : "";

  const s = $("stream-status");
  s.hidden = state.boot === "onboarding";
  s.dataset.state = state.stream;
  $("stream-text").textContent = {
    connecting: "Connecting to live updates",
    open: "Live updates on",
    reconnecting: "Reconnecting live updates",
    closed: "Live updates offline",
  }[state.stream] || "";
};

RENDERERS.banner = () => {
  const el = $("banner");
  const items = [];
  if (state.stream === "closed" && state.boot === "ready") {
    items.push(h("div", { class: "notice warn", role: "status" }, icon("wifi", 20),
      h("div", { class: "body" },
        h("strong", { text: "Live updates are offline" }),
        h("span", { text: "Panels may be out of date until the connection is back." })),
      h("button", { class: "btn btn-small", type: "button", text: "Reconnect", on: { click: () => events && events.retryNow() } })));
  }
  for (const e of state.serverErrors) {
    items.push(h("div", { class: "notice error", role: "alert" }, icon("alert", 20),
      h("div", { class: "body" },
        h("strong", { text: e.code ? `Server error: ${e.code}` : "Server error" }),
        scripted("span", e.message)),
      h("button", { class: "btn btn-small", type: "button", text: "Dismiss", on: { click: () => { state.serverErrors = state.serverErrors.filter((x) => x !== e); invalidate("banner"); } } })));
  }
  el.hidden = items.length === 0 || state.boot === "onboarding";
  el.replaceChildren(...items);
};

const ORB = {
  idle: ["idle", "Ready to call", "Press Start call, then tell Sahay what you need to buy."],
  mic: ["connecting", "Allow the microphone", "Your browser will ask for microphone access."],
  connecting: ["connecting", "Connecting", "Joining the call channel."],
  waiting: ["waiting", "Waiting for Sahay", "Sahay is joining. It will introduce itself as an automated assistant."],
  reconnecting: ["reconnecting", "Reconnecting", "The network dropped. Trying to rejoin; your call is still open."],
  ending: ["connecting", "Ending call", "Hanging up and releasing the microphone."],
};
const AGENT = {
  listening: ["listening", "Listening", "Speak now. You can interrupt Sahay at any time."],
  thinking: ["thinking", "Thinking", "Sahay is working on it."],
  speaking: ["speaking", "Speaking", "Talk over Sahay to interrupt."],
  idle: ["ready", "Your turn", "Sahay is waiting for you to speak."],
  silent: ["ready", "Your turn", "Sahay is waiting for you to speak."],
};

RENDERERS.call = () => {
  const c = state.call;
  let view;
  if (c.status === "error") view = ["error", c.error ? c.error.title : "Call stopped", c.error ? c.error.message : "The call stopped."];
  else if (c.status === "live") view = AGENT[c.agentState] || AGENT.idle;
  else view = ORB[c.status] || ORB.idle;
  const [orbState, label, sub] = view;
  $("orb").dataset.state = orbState;
  $("orb-label").textContent = label;
  $("orb-sub").textContent = c.status === "idle" && c.ended ? "The call ended. Press Start call to talk to Sahay again."
    : c.status === "idle" && c.note ? `${c.note} ${sub}` : sub;

  const ready = state.boot === "ready";
  const btn = $("call-btn");
  btn.replaceChildren();
  btn.disabled = false;
  if (c.status === "idle" || c.status === "error") {
    btn.className = "btn btn-primary";
    btn.textContent = c.status === "error" && c.error && c.error.retry ? "Try again" : "Start call";
    btn.disabled = !ready || (c.status === "error" && c.error && c.error.retry === false);
  } else if (c.status === "mic" || c.status === "connecting") {
    btn.className = "btn btn-primary";
    btn.disabled = true;
    append(btn, [h("span", { class: "spinner", "aria-hidden": "true" }), "Connecting"]);
  } else if (c.status === "ending") {
    btn.className = "btn btn-stop";
    btn.disabled = true;
    append(btn, [h("span", { class: "spinner", "aria-hidden": "true" }), "Ending"]);
  } else {
    btn.className = "btn btn-stop";
    btn.textContent = "End call";
  }

  const inCall = ["waiting", "live", "reconnecting"].includes(c.status);
  const mic = $("mic-btn");
  mic.disabled = !inCall;
  mic.setAttribute("aria-pressed", String(inCall && c.muted));
  mic.setAttribute("aria-label", c.muted ? "Unmute microphone" : "Mute microphone");
  mic.title = c.muted ? "Unmute microphone" : "Mute microphone";

  // Before the owner speaks, show the business's chosen language.
  const businessLang = state.business ? LANG_SHORT[pick(state.business, "language")] : null;
  const shown = c.lang || businessLang;
  for (const el of document.querySelectorAll("#lang-row .lang")) {
    el.setAttribute("aria-current", String(el.dataset.lang === shown));
  }
  $("lang-note").textContent = c.lang
    ? (c.langSource === "asr" ? "Detected by speech recognition." : "Detected from the script of your last sentence.")
    : businessLang ? "Your business language. Sahay answers in whichever language you speak." : "Detected from your speech once you talk.";

  $("audio-unlock").hidden = !c.autoplay;

  const pipe = $("pipeline");
  const labels = [["asr", "Speech to text"], ["llm", "Reasoning"], ["tts", "Murf Falcon voice"], ["turn", "Full turn"]];
  const chips = labels.filter(([k]) => typeof c.metrics[k] === "number")
    .map(([k, l]) => h("span", { class: "pipe-chip" }, l, h("b", { text: `${Math.round(c.metrics[k])} ms` })));
  pipe.hidden = chips.length === 0;
  pipe.replaceChildren(...chips);

  const issues = [];
  const vs = state.voiceServer;
  if ((c.status === "idle" || c.status === "error") && vs && vs.active) {
    const ui = state.voiceServerUi;
    issues.push(h("div", { class: "notice warn" }, icon("alert", 20),
      h("div", { class: "body" },
        h("strong", { text: "An earlier call is still open" }),
        h("span", { text: "Sahay is still in a call started earlier, perhaps in another tab. Start call rejoins it, or end it here." }),
        ui.error ? h("span", { class: "field-error", text: ui.error }) : null),
      h("button", { class: "btn btn-small", type: "button", disabled: ui.busy ? true : undefined, on: { click: endServerCall } },
        ui.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : null, ui.busy ? "Ending" : "End that call")));
  }
  if (inCall && !c.transcriptLink) {
    issues.push(h("div", { class: "notice warn" }, icon("wifi", 20),
      h("div", { class: "body" }, h("strong", { text: "Transcript link interrupted" }),
        h("span", { text: "Audio continues. The transcript catches up when the link is back." }))));
  }
  if (c.status === "idle" && c.ended) {
    issues.push(h("div", { class: "notice error", role: "alert" }, icon("alert", 20),
      h("div", { class: "body" },
        h("strong", { text: "The call ended. Start a new call to continue." }),
        c.ended.reason ? h("span", { text: `${c.ended.reason} Nothing you say now reaches Sahay.` }) : h("span", { text: "Nothing you say now reaches Sahay." }))));
  }
  for (const i of c.issues) {
    if (c.status === "idle" && c.ended) break; // stale in-call warnings would only confuse
    issues.push(h("div", { class: "notice warn" }, icon("alert", 20),
      h("div", { class: "body" }, h("strong", { text: issueTitle(i.source) }), scripted("span", i.message))));
  }
  $("call-issues").replaceChildren(...issues);
};

async function endServerCall() {
  state.voiceServerUi = { busy: true, error: null };
  invalidate("call");
  try {
    await api.stopVoice();
    state.voiceServer = null;
    state.voiceServerUi = { busy: false, error: null };
  } catch (err) {
    state.voiceServerUi = { busy: false, error: err.message || "The server did not end the call." };
  }
  invalidate("call");
}

function issueTitle(source) {
  return {
    asr: "Speech recognition issue", llm: "Reasoning issue", tts: "Voice output issue",
    network: "Network", token: "Call token", audio: "Audio playback", mic: "Microphone",
    agent: "Sahay agent", message: "Message delivery",
  }[source] || "Call issue";
}

RENDERERS.transcript = () => {
  const box = $("transcript");
  const turns = withSystemLines(state.transcript, state.systemLines);
  setCount("transcript-count", turns.length);
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

  if (turns.length === 0) {
    const s = state.call.status;
    if (s === "mic" || s === "connecting" || s === "waiting") {
      box.replaceChildren(stateView("loading", { title: "Waiting for Sahay's greeting", text: "Sahay opens by saying it is an automated assistant." }));
    } else if (s === "live" || s === "reconnecting") {
      box.replaceChildren(stateView("empty", { icon: "chat", title: "Listening", text: "Your words appear here as you speak." }));
    } else {
      box.replaceChildren(stateView("empty", { icon: "chat", title: "No conversation yet", text: "Start a call and speak. Both sides appear here in Devanagari, Kannada or English, as spoken." }));
    }
    return;
  }

  box.replaceChildren(...turns.map((t) => {
    if (t.role === "system") {
      return h("div", { class: "turn system", role: "status" },
        h("div", { class: "who" }, "Follow-up sent", timeEl(t.time)),
        h("p", { class: "bubble" }, h("strong", { text: t.label }), t.text ? " " : null, t.text ? scripted("span", t.text) : null));
    }
    const owner = t.role === "owner";
    const flag = t.interrupted ? "Interrupted" : t.live ? (owner ? "Hearing you" : "Speaking") : null;
    return h("div", { class: `turn ${owner ? "owner" : "agent"}${t.live ? " live" : ""}${t.interrupted ? " cut" : ""}` },
      h("div", { class: "who" }, owner ? "You" : "Sahay", timeEl(t.time)),
      scripted("p", t.text, { class: "bubble" }),
      flag ? h("span", { class: "flag", text: flag }) : null);
  }));
  if (nearBottom) box.scrollTop = box.scrollHeight;
};

RENDERERS.plan = () => {
  const steps = computePlan();
  $("plan-steps").replaceChildren(...steps.map((s, i) => h("li", { class: "step", dataset: { status: s.status } },
    h("div", { class: "step-top" },
      h("span", { class: "step-num", "aria-hidden": "true" }, s.status === "done" ? icon("check", 18) : String(i + 1)),
      h("span", { class: "step-bar", "aria-hidden": "true" })),
    h("p", { class: "step-name" }, s.name, h("span", { class: "sr-only", text: `, ${s.status === "done" ? "done" : s.status === "active" ? "in progress" : "not started"}` })),
    s.detail ? scripted("p", s.detail, { class: "step-detail" }) : null)));
};

function computePlan() {
  const req = state.requirement;
  const jobs = [...state.jobs.values()];
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const quotes = [...state.quotes.values()];
  const approvals = [...state.approvals.values()];
  const pending = approvals.find((a) => a.status === "pending");
  const approved = approvals.find((a) => a.status === "approved" || a.status === "consumed");
  const orders = [...state.orders.values()];
  const inCall = ["waiting", "live", "reconnecting"].includes(state.call.status);

  const initiate = req
    ? { status: "done", detail: [req.item, qty(req.quantity, req.unit), req.city].filter(Boolean).join(", ") }
    : { status: inCall ? "active" : "upcoming", detail: inCall ? "Tell Sahay what you need" : null };

  const plan = jobs.length
    ? { status: "done", detail: "Steps set and work started" }
    : { status: req ? "active" : "upcoming", detail: req ? "Sahay is planning the steps" : null };

  let execute = { status: "upcoming", detail: null };
  if (running.length) {
    const latest = running.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    execute = { status: "active", detail: progressText(latest) || `${kindLabel(latest.kind)} running` };
  } else if (quotes.length) {
    const vendorsQuoted = new Set(quotes.map((q) => q.vendorId)).size;
    execute = { status: "done", detail: `${quotes.length} quote${quotes.length === 1 ? "" : "s"} from ${vendorsQuoted} vendor${vendorsQuoted === 1 ? "" : "s"}` };
  } else if (jobs.length) {
    const failed = jobs.find((j) => j.status === "failed");
    execute = failed ? { status: "active", detail: `${kindLabel(failed.kind)} failed` } : { status: "done", detail: `${state.vendors.size} vendors found` };
  }

  const lastAdapt = state.adapt[state.adapt.length - 1];
  const adapt = lastAdapt ? { status: "done", detail: lastAdapt.text } : { status: "upcoming", detail: null };

  let confirm = { status: "upcoming", detail: null };
  const lastOrder = orders.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (lastOrder) {
    const fired = [...state.followups.values()].filter((f) => f.status === "fired").sort((a, b) => String(a.firedAt || "").localeCompare(String(b.firedAt || "")));
    const fu = fired[fired.length - 1];
    confirm = { status: "done", detail: fu ? `Follow-up: ${FOLLOWUP_KIND[fu.kind] || fu.kind || "sent"}` : (lastOrder.poNumber ? `PO ${lastOrder.poNumber}` : "Order raised") };
  } else if (pending) {
    confirm = { status: "active", detail: "Waiting for your yes" };
  } else if (approved) {
    confirm = { status: "active", detail: "Approved, raising the order" };
  }

  return [
    { name: "Initiate", ...initiate },
    { name: "Plan", ...plan },
    { name: "Execute", ...execute },
    { name: "Adapt", ...adapt },
    { name: "Confirm & follow up", ...confirm },
  ];
}

function progressText(job) {
  return job && typeof job.progressMessage === "string" && job.progressMessage ? job.progressMessage : null;
}
function progressFraction(job) {
  const p = job && job.progressData;
  if (!p || typeof p !== "object") return null;
  const pct = num(pick(p, "pct"));
  if (pct !== null) return Math.max(0, Math.min(1, pct > 1 ? pct / 100 : pct));
  const done = num(pick(p, "done")), total = num(pick(p, "total"));
  if (done !== null && total) return Math.max(0, Math.min(1, done / total));
  return null;
}

function formatWhen(v) {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) && dateTime(v) ? dateTime(v) : String(v);
}

RENDERERS.requirement = () => {
  const box = $("requirement-body");
  if (bootStates(box, "the requirement")) return;
  const r = state.requirement;
  if (!r) {
    box.replaceChildren(stateView("empty", { icon: "list", title: "No requirement yet", text: "Tell Sahay on the call what you need: the item, how much, where it should be delivered and your price limit." }));
    return;
  }
  const facts = [
    ["Item", r.item, false],
    ["Quantity", qty(r.quantity, r.unit), true],
    ["Deliver to", r.city, false],
    ["Price ceiling", perUnit(r.maxPrice, r.unit), true],
    ["Target price", perUnit(r.targetPrice, r.unit), true],
    ["Needed by", formatWhen(r.deliveryBy), false],
  ].filter(([, v]) => v);
  const missing = r.missing.filter((m) => typeof m === "string");
  const earlier = state.requirements
    .filter((x) => String(x.id) !== String(r.id))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  fill(box,
    h("dl", { class: "facts" }, ...facts.map(([k, v, mono]) => h("div", { class: "fact" }, h("dt", { text: k }), scripted("dd", v, { class: mono ? "mono" : undefined })))),
    r.notes ? scripted("p", r.notes, { class: "row-meta" }) : null,
    missing.length ? h("div", { class: "notice warn" }, icon("alert", 20),
      h("div", { class: "body" }, h("strong", { text: "Sahay still needs" }), h("span", { text: missing.join(", ") }))) : null,
    earlier.length ? h("details", { class: "earlier" },
      h("summary", { text: `Earlier requests (${earlier.length})` }),
      h("ul", { class: "earlier-list" }, ...earlier.map((x) => h("li", {},
        scripted("span", [x.item, qty(x.quantity, x.unit), x.city].filter(Boolean).join(", ") || "Requirement without details"),
        x.createdAt ? h("span", { class: "row-meta mono", text: dateTime(x.createdAt) || "" }) : null)))) : null);
};

const JOB_CHIP = { queued: "", running: "amber", done: "jade", failed: "terra", cancelled: "" };

/** Earlier progress lines of a job, newest first, below the current one. */
const JOB_HISTORY_LINES = 4;
function jobHistory(j) {
  const log = Array.isArray(j.progressLog) ? j.progressLog : [];
  const earlier = log.slice(0, -1).filter((e) => e.message !== progressText(j)).slice(-JOB_HISTORY_LINES).reverse();
  if (!earlier.length) return null;
  return h("ol", { class: "job-log", "aria-label": `Earlier ${kindLabel(j.kind).toLowerCase()} progress` },
    ...earlier.map((e) => h("li", {},
      e.ts && clock(e.ts) ? h("span", { class: "mono job-log-time", text: clock(e.ts) }) : null,
      scripted("span", e.message))));
}

RENDERERS.jobs = () => {
  const box = $("jobs-body");
  const jobs = [...state.jobs.values()].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  setCount("jobs-count", jobs.length);
  if (bootStates(box, "jobs")) return;
  if (!jobs.length) {
    box.replaceChildren(stateView("empty", { icon: "gear", title: "No jobs running", text: "When Sahay starts sourcing or negotiating, the work shows here with live progress." }));
    return;
  }
  box.replaceChildren(h("ul", { class: "rows" }, ...jobs.map((j) => {
    const frac = progressFraction(j);
    const status = j.status || "queued";
    const vendor = j.vendorId ? state.vendors.get(String(j.vendorId)) : null;
    const bar = status === "done" ? 1 : frac;
    return h("li", { class: "row", dataset: { status } },
      h("div", { class: "row-head" },
        h("span", { class: "row-title" }, kindLabel(j.kind), vendor && vendor.name ? ` with ${vendor.name}` : ""),
        h("span", { class: `chip ${JOB_CHIP[status] || ""}` }, status === "running" ? h("span", { class: "spinner", "aria-hidden": "true", style: "width:12px;height:12px;border-width:2px" }) : null, status)),
      status === "failed"
        ? scripted("p", j.error ? String(j.error) : "The job stopped with an error.", { class: "row-meta", style: "color:var(--terra)" })
        : (progressText(j) ? scripted("p", progressText(j), { class: "row-meta job-now", "aria-live": status === "running" ? "polite" : undefined }) : null),
      jobHistory(j),
      status === "failed" || status === "cancelled" ? null : h("div", { class: `bar${bar === null && status === "running" ? " indeterminate" : ""}`, role: "progressbar", "aria-label": `${kindLabel(j.kind)} progress`, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": bar === null ? undefined : String(Math.round(bar * 100)) },
        h("span", { style: bar === null ? undefined : `width:${Math.round(bar * 100)}%` })),
      h("p", { class: "row-meta mono", style: "font-size:13px" }, j.createdAt ? `Started ${clock(j.createdAt) || ""}` : "", j.updatedAt && j.updatedAt !== j.createdAt ? ` · updated ${clock(j.updatedAt) || ""}` : ""));
  })));
};

/**
 * The server's rank (scoring.rankVendors, the order the agent speaks from) when the snapshot
 * gave one. Vendors streamed in by vendor.found before the post-sourcing resync have none
 * yet: they follow by score, rating, then name, so the panel never depends on arrival order.
 */
function sortVendors(list) {
  const desc = (a, b) => (b ?? -Infinity) - (a ?? -Infinity);
  return list.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
    || desc(a.score, b.score)
    || desc(a.rating, b.rating)
    || desc(a.ratingCount, b.ratingCount)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""), "en-IN")
    || String(a.id).localeCompare(String(b.id)));
}

RENDERERS.vendors = () => {
  const box = $("vendors-body");
  const vendors = sortVendors([...state.vendors.values()]);
  setCount("vendors-count", vendors.length);
  if (bootStates(box, "vendors")) return;
  if (!vendors.length) {
    const sourcing = [...state.jobs.values()].filter((j) => j.kind === "sourcing")
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
    if (sourcing && (sourcing.status === "running" || sourcing.status === "queued")) {
      box.replaceChildren(stateView("loading", { title: "Searching IndiaMART", text: progressText(sourcing) || "Looking up real listings for your requirement." }));
    } else if (sourcing && sourcing.status === "failed") {
      box.replaceChildren(stateView("error", { title: "Sourcing failed", text: sourcing.error ? String(sourcing.error) : "Sahay could not fetch vendor listings. Ask Sahay to try again." }));
    } else {
      box.replaceChildren(stateView("empty", { icon: "store", title: "No vendors yet", text: "Vendors appear here once Sahay starts sourcing. Every card links to its real IndiaMART listing." }));
    }
    return;
  }
  box.replaceChildren(h("ul", { class: "vendors" }, ...vendors.map((v, i) => {
    const url = safeUrl(v.sourceUrl);
    const simulated = v.kind === "simulated" || v.source === "simulated";
    return h("li", { class: "vendor" },
      h("div", { class: "row-head" },
        h("span", { class: "vendor-rank mono", text: `#${v.rank ?? i + 1}` }),
        simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : v.kind === "human" ? h("span", { class: "chip info", text: "Joins by link" }) : null,
        v.score !== null ? h("span", { class: "chip", text: `Score ${qtyFmt.format(v.score)}` }) : null),
      scripted("p", v.name || "Unnamed listing", { class: "vendor-name" }),
      v.city ? scripted("p", v.city, { class: "vendor-city" }) : null,
      v.itemTitle ? scripted("p", v.itemTitle, { class: "row-meta" }) : null,
      v.listedPriceText ? scripted("p", v.listedPriceText, { class: "vendor-price" }) : h("p", { class: "row-meta", text: "No price listed" }),
      v.rating !== null ? h("p", { class: "vendor-line" },
        h("span", { class: "stars", text: `★ ${qtyFmt.format(v.rating)}` }),
        v.ratingCount !== null ? `${qtyFmt.format(v.ratingCount)} ratings` : null) : null,
      url ? extLink(url, v.source === "indiamart" || /indiamart\.com/i.test(url) ? "View IndiaMART listing" : "View listing") : null);
  })));
};

RENDERERS.negotiation = () => {
  const box = $("nego-body");
  const negos = [...state.negotiations.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  setCount("nego-count", negos.length);
  if (bootStates(box, "negotiations")) return;
  if (!negos.length) {
    const job = [...state.jobs.values()].find((j) => j.kind === "negotiation" && (j.status === "running" || j.status === "queued"));
    if (job) {
      box.replaceChildren(stateView("loading", { title: "Opening the negotiation", text: progressText(job) || "Sahay is connecting to the vendor." }));
    } else {
      box.replaceChildren(stateView("empty", { icon: "handshake", title: "No negotiation yet", text: "When Sahay negotiates, each offer and counter-offer appears here. A simulated vendor is always labelled." }));
    }
    return;
  }
  box.replaceChildren(...negos.map((n) => {
    const vendor = n.vendorId ? state.vendors.get(String(n.vendorId)) : null;
    const name = (vendor && vendor.name) || (n.outcome && n.outcome.vendorName) || "Vendor";
    const simulated = n.counterpart === "simulated" || (vendor && vendor.kind === "simulated");
    const running = negotiationRunning(n);
    const job = [...state.jobs.values()].find((j) => j.negotiationId !== undefined && String(j.negotiationId) === n.id);
    const joinUrl = running && n.counterpart === "human" && job ? safeUrl(job.joinUrl) : null;
    return h("article", { class: "nego" },
      h("div", { class: "nego-head" },
        scripted("span", name, { class: "row-title" }),
        simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : n.counterpart === "human" ? h("span", { class: "chip info", text: "Human vendor" }) : n.counterpart === "phone" ? h("span", { class: "chip info", text: "Phone call" }) : null,
        h("span", { class: `chip ${running ? "amber" : n.status === "agreed" ? "jade" : ""}`, text: NEGO_STATUS[n.status] || (running ? "In progress" : String(n.status || "Ended")) })),
      joinUrl ? joinLinkView(n.id, joinUrl) : null,
      running ? listenView(n) : (state.listen.note && state.listen.lastId === n.id ? h("p", { class: "row-meta", text: state.listen.note }) : null),
      n.turns.length
        ? h("ol", { class: "timeline" }, ...n.turns.map((t) => {
            const who = t.speaker === "agent" ? "Sahay" : t.speaker === "vendor" ? (simulated ? "Simulated vendor" : name) : "Unknown speaker";
            return h("li", { class: `tl-item ${t.speaker}` },
              h("span", { class: "tl-who" }, who, t.round !== null ? h("span", { class: "chip", text: `Round ${t.round}` }) : null, timeEl(t.ts)),
              t.offer !== null ? h("span", { class: "tl-offer", text: perUnit(t.offer, t.unit) }) : null,
              t.text ? scripted("p", String(t.text), { class: "tl-text" }) : null);
          }))
        : running
          ? stateView("loading", { title: "Waiting for the first offer", text: n.counterpart === "human" ? "The call starts when the vendor opens the join link." : null })
          : h("p", { class: "row-meta", text: "No turns were recorded for this negotiation." }),
      running ? null : outcomeView(n));
  }));
};

function joinLinkView(nid, url) {
  const copied = state.copyUi.get(nid);
  return h("div", { class: "notice info-notice" }, icon("external", 20),
    h("div", { class: "body" },
      h("strong", { text: "Send this link to the vendor" }),
      h("span", { text: "They join the call from their phone browser. The page tells them they are talking to Sahay's automated buyer assistant." }),
      h("a", { class: "join-link mono", href: url, target: "_blank", rel: "noopener noreferrer", text: url })),
    h("button", { class: "btn btn-small", type: "button", on: { click: () => copyText(nid, url) } },
      copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy link"));
}

async function copyText(key, text) {
  try {
    await navigator.clipboard.writeText(text);
    state.copyUi.set(key, "ok");
  } catch {
    state.copyUi.set(key, "fail");
  }
  invalidate("negotiation");
  setTimeout(() => { state.copyUi.delete(key); invalidate("negotiation"); }, 2500);
}

function listenView(n) {
  const L = state.listen;
  const mine = L.negotiationId === n.id;
  const status = mine ? L.status : "idle";
  if (status === "listening") {
    return h("div", { class: "listen live" },
      h("span", { class: "listen-dot", "aria-hidden": "true" }),
      h("div", { class: "body", role: "status" },
        h("strong", { text: "Listening in" }),
        h("span", { text: L.speakers ? "You hear both sides. They cannot hear you." : "Connected. Audio plays as soon as someone speaks. They cannot hear you." })),
      h("button", { class: "btn btn-small btn-stop", type: "button", on: { click: () => listener.stop() }, text: "Stop listening" }));
  }
  return h("div", { class: "listen" },
    h("button", { class: "btn btn-small", type: "button", disabled: status === "joining" ? true : undefined, on: { click: () => { state.listen.note = null; listener.start(n.id); } } },
      status === "joining" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("wifi", 18),
      status === "joining" ? "Joining" : "Listen in"),
    h("span", { class: "row-meta", text: "Hear the call live. Your microphone stays off." }),
    status === "error" && L.error ? h("p", { class: "field-error", role: "alert", text: L.error }) : null);
}

function outcomeView(n) {
  const o = n.outcome && typeof n.outcome === "object" ? n.outcome : {};
  const price = num(pick(o, "unitPrice"));
  const ok = o.agreed === true || n.status === "agreed";
  const head = ok
    ? (price !== null ? `Agreed at ${perUnit(price, pick(o, "unit"))}` : "Agreed")
    : n.status === "walked_away" ? "Sahay walked away: the price stayed above your limit" : "No deal";
  const rounds = num(pick(o, "rounds"));
  return h("div", { class: `outcome ${ok ? "ok" : "bad"}` }, head,
    rounds !== null ? h("span", { style: "display:block;font-weight:500", text: `${rounds} round${rounds === 1 ? "" : "s"}` }) : null);
}

RENDERERS.approval = () => {
  const box = $("approval-body");
  const panel = $("panel-approval");
  const chip = $("approval-chip");
  const all = [...state.approvals.values()];
  const pending = all.filter((a) => a.status === "pending").sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))[0];
  const latest = pending || all.sort((a, b) => String(b.decidedAt || b.requestedAt || "").localeCompare(String(a.decidedAt || a.requestedAt || "")))[0];
  panel.dataset.attention = String(Boolean(pending));
  chip.hidden = !latest;
  if (bootStates(box, "approvals")) return;
  if (!latest) {
    box.replaceChildren(stateView("empty", { icon: "shield", title: "Nothing to approve", text: "Sahay reads the final deal aloud and waits for your yes before any order or payment link." }));
    return;
  }
  const status = latest.status || "pending";
  chip.className = `chip ${status === "pending" ? "amber" : status === "rejected" ? "terra" : "jade"}`;
  chip.textContent = status === "pending" ? "Waiting for you" : status === "rejected" ? "Rejected" : status === "consumed" ? "Order raised" : "Approved";

  const ui = state.approvalUi.get(String(latest.id)) || {};
  const parts = [
    latest.simulated ? h("p", {}, h("span", { class: "chip sim", text: "Simulated vendor" })) : null,
    latest.readback ? scripted("p", String(latest.readback), { class: "readback" }) : h("p", { class: "row-meta", text: "The server did not send a read-back sentence for this approval." }),
    latest.totalAmount !== null ? h("p", { class: "decided" }, "Total", h("span", { class: "total", text: money(latest.totalAmount) })) : null,
  ];
  if (status === "pending") {
    parts.push(h("div", { class: "approve-actions" },
      h("button", { class: "btn btn-approve", type: "button", disabled: ui.busy ? true : undefined, on: { click: () => decide(latest.id, "approve") } },
        ui.busy === "approve" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", 22), ui.busy === "approve" ? "Sending" : "Approve"),
      h("button", { class: "btn btn-stop", type: "button", disabled: ui.busy ? true : undefined, on: { click: () => decide(latest.id, "reject") } },
        ui.busy === "reject" ? h("span", { class: "spinner", "aria-hidden": "true" }) : null, ui.busy === "reject" ? "Sending" : "Reject")));
    parts.push(h("p", { class: "row-meta", text: "You can also say yes or no on the call." }));
    if (ui.error) {
      parts.push(h("div", { class: "notice error", role: "alert" }, icon("alert", 20),
        h("div", { class: "body" }, h("strong", { text: "Your decision was not recorded" }), h("span", { text: ui.error }))));
    }
  } else {
    parts.push(h("p", { class: "decided" },
      status === "rejected" ? "Rejected" : "Approved",
      latest.decidedVia ? ` by ${latest.decidedVia === "voice" ? "voice" : "button"}` : "",
      latest.decidedAt ? h("span", { class: "mono" }, " at ", timeEl(latest.decidedAt)) : null));
    if (latest.reason) parts.push(scripted("p", String(latest.reason), { class: "row-meta" }));
    if (latest.evidence) parts.push(h("p", { class: "evidence" }, "Your words: ", h("q", {}, scripted("span", String(latest.evidence)))));
  }
  fill(box, ...parts);
};

async function decide(id, decision) {
  const key = String(id);
  state.approvalUi.set(key, { busy: decision });
  invalidate("approval");
  try {
    const res = await api.decideApproval(id, decision);
    const status = res && pick(res, "status");
    merge(state.approvals, { id, status: status || (decision === "approve" ? "approved" : "rejected"), decidedVia: "button" });
    state.approvalUi.delete(key);
  } catch (err) {
    state.approvalUi.set(key, { error: err.message || "The server did not accept the decision." });
  }
  invalidate("approval", "plan");
}

const DEAL_CHIP = { demoted: ["amber", "Outside your limits"], unrankable: ["", "Not comparable"], freight_unknown: ["", "Freight unknown"] };

RENDERERS.quotes = () => {
  const box = $("quotes-body");
  const quotes = [...state.quotes.values()].sort((a, b) =>
    (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.landedCost ?? Infinity) - (b.landedCost ?? Infinity));
  setCount("quotes-count", quotes.length);
  if (bootStates(box, "quotes")) return;
  if (!quotes.length) {
    box.replaceChildren(stateView("empty", { icon: "scale", title: "No quotes yet", text: "Quotes appear after Sahay talks to vendors. Freight a vendor did not state shows as not quoted, never as zero." }));
    return;
  }
  const top = quotes[0];
  const best = top && top.rank === 1 && (top.dealStatus === undefined || top.dealStatus === "ranked") ? top.id : null;
  const rows = quotes.map((q) => {
    const vendor = q.vendorId ? state.vendors.get(String(q.vendorId)) : null;
    const name = (vendor && vendor.name) || q.vendorName || "Vendor";
    const isBest = q.id === best && quotes.length > 1;
    const simulated = q.simulated === true || (vendor && vendor.kind === "simulated");
    const dc = DEAL_CHIP[q.dealStatus];
    return h("tr", { class: isBest ? "best" : undefined },
      h("td", {},
        h("div", { class: "quote-vendor" }, scripted("span", name),
          simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : null,
          isBest ? h("span", { class: "chip jade", text: "Best" }) : null,
          dc ? h("span", { class: `chip ${dc[0]}`, text: dc[1] }) : null),
        q.reason ? scripted("p", String(q.reason), { class: "row-meta" }) : null),
      h("td", { class: "num", text: perUnit(q.unitPrice, q.unit) ?? "Not quoted" }),
      h("td", { class: "num hide-sm", text: q.freight === null ? "Not quoted" : money(q.freight) }),
      h("td", { class: "num", text: money(q.landedCost) ?? "Needs freight" }),
      h("td", { class: "num hide-sm", text: q.leadTimeDays === null ? "Not stated" : `${q.leadTimeDays} days` }));
  });
  box.replaceChildren(h("div", { class: "table-wrap" },
    h("table", { class: "quote-table" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col", text: "Vendor" }),
        h("th", { scope: "col", class: "num", text: "Unit price" }),
        h("th", { scope: "col", class: "num hide-sm", text: "Freight" }),
        h("th", { scope: "col", class: "num", text: "Landed cost" }),
        h("th", { scope: "col", class: "num hide-sm", text: "Delivery" }))),
      h("tbody", {}, ...rows))));
};

RENDERERS.order = () => {
  const box = $("order-body");
  const orders = [...state.orders.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (bootStates(box, "orders")) return;
  const tg = telegramView();
  if (!orders.length) {
    const approved = [...state.approvals.values()].find((a) => a.status === "approved");
    if (approved) {
      box.replaceChildren(stateView("loading", { title: "Raising the purchase order", text: "Approval received. Sahay is creating the PO and payment link." }), tg);
    } else {
      box.replaceChildren(stateView("empty", { icon: "doc", title: "No order yet", text: "After you approve, Sahay raises a purchase order with a PDF and a Razorpay test-mode payment link." }), tg);
    }
    return;
  }
  const followups = [...state.followups.values()];
  box.replaceChildren(...orders.map((o) => {
    const pdf = safeUrl(o.pdfUrl) || (o.id ? safeUrl(api.poPdfUrl(o.id)) : null);
    const pay = safeUrl(o.paymentUrl);
    const quote = o.quoteId ? state.quotes.get(String(o.quoteId)) : null;
    const vendor = quote && quote.vendorId ? state.vendors.get(String(quote.vendorId)) : null;
    const vendorName = o.vendorName || (vendor && vendor.name) || (quote && quote.vendorName) || null;
    const fus = followups.filter((f) => String(f.orderId) === String(o.id))
      .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
    return h("article", { class: "order" },
      h("div", { class: "row-head" },
        h("div", { class: "po", style: "flex:1 1 auto" }, h("span", { class: "k", text: "Purchase order" }), h("span", { class: "v", text: o.poNumber || "Number pending" })),
        o.simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : null,
        o.status ? h("span", { class: `chip ${o.status === "cancelled" ? "terra" : "jade"}`, text: ORDER_STATUS[o.status] || o.status }) : null),
      vendorName ? scripted("p", vendorName, { class: "row-title" }) : null,
      o.amount !== null ? h("p", { class: "decided" }, "Amount", h("span", { class: "total", text: money(o.amount) })) : null,
      h("div", { class: "order-actions" },
        pdf ? h("a", { class: "btn btn-small", href: pdf, target: "_blank", rel: "noopener" }, icon("download", 18), "Download PO (PDF)") : null,
        pay ? h("a", { class: "btn btn-small btn-primary", href: pay, target: "_blank", rel: "noopener noreferrer" }, icon("external", 18), "Open payment link")
            : h("span", { class: "row-meta", text: "Payment link not created yet." })),
      pay ? h("p", { class: "row-meta" }, h("span", { class: "chip amber", text: "Test mode" }), " Razorpay test link. No real money moves.") : null,
      fus.length ? h("div", { class: "followup-block" },
        h("p", { class: "fu-title", text: "Follow-ups" }),
        h("ul", { class: "followups" }, ...fus.map((f) => h("li", { dataset: { status: f.status || "scheduled" } },
          icon(f.status === "fired" ? "check" : "clock", 16),
          h("div", { class: "fu-body" },
            h("span", { class: "fu-kind" }, FOLLOWUP_KIND[f.kind] || f.kind || "Follow-up",
              h("span", { class: "row-meta mono", text: f.status === "fired"
                ? ` sent ${dateTime(f.firedAt) || ""}`
                : f.status === "cancelled" ? " not needed" : ` due ${dateTime(f.dueAt) || ""}` })),
            f.message ? scripted("span", f.message, { class: "row-meta" }) : null))))) : null);
  }), tg);
};

function telegramView() {
  const t = state.telegram;
  if (t.linked) {
    return h("div", { class: "telegram linked" }, icon("check", 20),
      h("div", { class: "body" },
        h("strong", { text: "Telegram updates are on" }),
        h("span", { text: "Order, payment and follow-up updates also go to your Telegram chat." })));
  }
  const parts = [
    h("div", { class: "body" },
      h("strong", { text: "Get updates on Telegram" }),
      h("span", { text: t.link
        ? `Press Start in Telegram to finish linking.${t.link.expiresAt ? ` The link works until ${clock(t.link.expiresAt) || ""}.` : ""}`
        : "Payment reminders and delivery checks reach you even when this page is closed." })),
  ];
  const actions = h("div", { class: "telegram-actions" },
    h("button", { class: "btn btn-small", type: "button", disabled: t.busy ? true : undefined, on: { click: linkTelegram } },
      t.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("external", 18),
      t.busy ? "Opening Telegram" : t.link ? "Get a new link" : "Get updates on Telegram"),
    t.link && t.blocked ? h("a", { class: "btn btn-small btn-primary", href: t.link.url, target: "_blank", rel: "noopener noreferrer" }, "Open Telegram") : null);
  parts.push(actions);
  if (t.error) parts.push(h("p", { class: "field-error", role: "alert", text: t.error }));
  return h("div", { class: "telegram" }, ...parts);
}

async function linkTelegram() {
  const t = state.telegram;
  // Open the tab inside the click so pop-up blockers allow it, then point it at the deep link.
  let win = null;
  try { win = window.open("", "_blank"); } catch { win = null; }
  t.busy = true;
  t.error = null;
  invalidate("order");
  try {
    const r = await api.telegramLinkCode();
    const url = r && typeof r.deepLink === "string" && /^https:\/\/t\.me\//.test(r.deepLink) ? r.deepLink : null;
    if (!url) throw new Error("The server did not return a Telegram link.");
    t.link = { url, expiresAt: r.expiresAt || null };
    if (win && !win.closed) {
      try { win.opener = null; } catch { /* ignore */ }
      win.location.href = url;
      t.blocked = false;
    } else {
      t.blocked = true;
    }
  } catch (err) {
    if (win && !win.closed) win.close();
    t.error = err && err.code === "TELEGRAM_NOT_CONFIGURED"
      ? "Telegram updates are not set up on this server."
      : (err && err.message) || "Could not create a Telegram link.";
  }
  t.busy = false;
  invalidate("order");
}

RENDERERS.audit = () => {
  const box = $("audit-body");
  const rows = [...state.audit.values()].sort((a, b) => {
    const x = num(a.id), y = num(b.id);
    if (x !== null && y !== null) return y - x;
    return String(b.ts || "").localeCompare(String(a.ts || ""));
  }).slice(0, 250);
  setCount("audit-count", state.audit.size);
  if (bootStates(box, "the audit trail")) return;
  if (!rows.length) {
    box.replaceChildren(stateView("empty", { icon: "clock", title: "Nothing recorded yet", text: "Every step Sahay takes and every decision you make is logged here with a time." }));
    return;
  }
  box.replaceChildren(h("ol", { class: "audit" }, ...rows.map((r) => {
    const actor = ["owner", "agent", "system", "vendor"].includes(r.actor) ? r.actor : "system";
    const summary = auditSummary(r);
    return h("li", {},
      timeEl(r.ts) || h("time", { text: "" }),
      h("span", { class: `chip actor-${actor}`, text: actor === "agent" ? "Sahay" : actor }),
      h("span", { class: "what" }, h("b", { text: TYPE_LABEL[r.type] || r.type }), summary ? [": ", scripted("span", summary)] : null));
  })));
};

function auditSummary(r) {
  const d = r.data || {};
  switch (r.type) {
    case "requirement.saved": { const q = normRequirement(d); return q ? [q.item, qty(q.quantity, q.unit), q.city].filter(Boolean).join(", ") : null; }
    case "job.started": case "job.done": case "job.cancelled": return kindLabel(pick(d, "kind"));
    case "job.progress": return [kindLabel(pick(d, "kind")), pick(d, "message") ?? pick(pick(d, "progress"), "message")].filter(Boolean).join(": ");
    case "job.failed": return [kindLabel(pick(d, "kind")), pick(d, "error")].filter(Boolean).join(": ");
    case "vendor.found": { const v = normVendor(d.vendor || {}); return [v.name, v.city].filter(Boolean).join(", ") || null; }
    case "negotiation.turn": {
      const who = speakerOf(d) === "vendor" ? (pick(d, "counterpart") === "simulated" ? "Simulated vendor" : "Vendor") : "Sahay";
      const offer = perUnit(num(pick(d, "offer")), pick(d, "unit"));
      return offer ? `${who} offered ${offer}` : who;
    }
    case "negotiation.ended": return NEGO_STATUS[pick(d, "status")] || pick(d, "status") || null;
    case "quote.recorded": { const q = normQuote(d); return [perUnit(q.unitPrice, q.unit), q.landedCost !== null ? `landed ${money(q.landedCost)}` : null, q.simulated ? "simulated vendor" : null].filter(Boolean).join(", "); }
    case "approval.requested": return pick(d, "readback") || null;
    case "approval.decided": { const a = normApproval(d); return [a.status, a.decidedVia ? `by ${a.decidedVia}` : null].filter(Boolean).join(" ") || null; }
    case "order.created": return pick(d, "poNumber") ? `PO ${pick(d, "poNumber")}` : null;
    case "order.status": return [pick(d, "poNumber"), ORDER_STATUS[pick(d, "to")] || pick(d, "to")].filter(Boolean).join(": ") || null;
    case "payment.link": return "Razorpay test mode";
    case "followup.fired": return FOLLOWUP_KIND[pick(d, "kind")] || pick(d, "kind") || null;
    case "session.started": case "session.ended": return pick(d, "kind") === "negotiation" ? "Negotiation call" : null;
    case "error": return pick(d, "message", "code") || null;
    default: return null;
  }
}

/* ======================================================================== call */

const call = new VoiceCall({
  onStatus(status, detail) {
    const c = state.call;
    c.status = status;
    if (status === "error") c.error = detail.error || null;
    if (status === "idle") {
      c.note = detail.note || null;
      c.agentState = null;
      // The owner did not press End: say plainly that nothing more reaches Sahay.
      c.ended = detail.unexpected ? { reason: detail.note || null } : null;
    }
    if (status === "error") c.ended = null;
    if (status === "mic") { c.ended = null; c.error = null; c.note = null; c.issues = []; c.metrics = {}; c.lang = null; c.langSource = null; c.transcriptLink = true; c.muted = false; state.transcript = []; state.systemLines = []; }
    if (status === "error" || status === "idle") c.muted = false;
    invalidate("call", "transcript", "plan");
  },
  onAgentState(s) { state.call.agentState = s; invalidate("call"); },
  onTranscript(turns) { state.transcript = turns; invalidate("transcript"); },
  onLanguage({ lang, source }) {
    if (state.call.lang !== lang || state.call.langSource !== source) {
      state.call.lang = lang; state.call.langSource = source; invalidate("call");
    }
  },
  onIssue(issue) {
    const list = state.call.issues;
    const now = Date.now();
    if (list.some((i) => i.message === issue.message && now - i.at < 1500)) return;
    list.unshift({ ...issue, at: now });
    state.call.issues = list.slice(0, 6);
    invalidate("call");
  },
  onLevels({ mic, agent }) {
    const orb = $("orb");
    const speaking = state.call.agentState === "speaking";
    orb.style.setProperty("--level", String(Math.min(1, speaking ? agent * 1.4 : mic)));
    const meter = $("mic-meter");
    meter.dataset.active = String(mic > 0.05);
    const bars = meter.children;
    const shape = [0.55, 0.85, 1, 0.85, 0.55];
    for (let i = 0; i < bars.length; i++) bars[i].style.height = `${4 + Math.round(Math.min(1, mic * 1.6) * 18 * shape[i])}px`;
  },
  onAutoplay(blocked) { state.call.autoplay = blocked; invalidate("call"); },
  onMetric({ stage, ms }) {
    const k = /asr|stt/i.test(stage) ? "asr" : /llm/i.test(stage) ? "llm" : /tts/i.test(stage) ? "tts" : stage === "turn" ? "turn" : null;
    if (!k) return;
    state.call.metrics[k] = ms;
    invalidate("call");
  },
  onTranscriptLink(ok) { state.call.transcriptLink = ok; invalidate("call"); },
  // Where the time from Start call to Sahay's first words went (E2E r3 bug 8). Milliseconds only.
  onTimings(marks) {
    state.call.timings = marks;
    window.__sahayCallTimings = marks;
    console.info(`[call] ms since Start call: ${formatTimings(marks)}`);
  },
});

$("call-btn").addEventListener("click", () => {
  const s = state.call.status;
  if (s === "idle" || s === "error") call.start();
  else if (["waiting", "live", "reconnecting"].includes(s)) call.end();
});
$("mic-btn").addEventListener("click", async () => {
  state.call.muted = await call.setMuted(!state.call.muted);
  invalidate("call");
});
$("audio-unlock").addEventListener("click", () => call.resumeAudio());

/* ======================================================================= theme */

$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("sahay-theme", next); } catch { /* storage blocked */ }
});

/* ================================================================ listen in */

const listener = new NegotiationListener(({ negotiationId, status, error, speakers }) => {
  const L = state.listen;
  L.negotiationId = negotiationId;
  if (negotiationId) L.lastId = negotiationId;
  L.status = status;
  L.error = error;
  L.speakers = speakers;
  invalidate("negotiation");
});

/* ================================================================== onboarding */

const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
// Same rule as the server (src/routes/api.js nameText): letters and marks of any script,
// digits, space, . , & ' - ( ), and ZWNJ/ZWJ; at least one letter or digit.
const NAME_MAX = 80;
const NAME_RULE = "Use letters, numbers, spaces and . , & ' - ( ) only.";
const isNameText = (v) => /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u.test(v) && /[\p{L}\p{N}]/u.test(v);

function readOnboarding() {
  const form = $("onboard-form");
  const value = (id) => $(id).value.trim();
  const checked = form.querySelector('input[name="language"]:checked');
  const details = {
    name: value("ob-name"),
    ownerName: value("ob-owner"),
    city: value("ob-city"),
    language: checked ? checked.value : "",
  };
  const errors = {};
  if (!details.name) errors.name = "Enter your business name.";
  else if (details.name.length > NAME_MAX) errors.name = `Keep the business name under ${NAME_MAX} characters.`;
  else if (!isNameText(details.name)) errors.name = NAME_RULE;
  if (details.ownerName.length > NAME_MAX) errors.ownerName = `Keep your name under ${NAME_MAX} characters.`;
  else if (details.ownerName && !isNameText(details.ownerName)) errors.ownerName = NAME_RULE;
  if (!details.city) errors.city = "Enter the city your business is in.";
  else if (details.city.length > NAME_MAX) errors.city = `Keep the city under ${NAME_MAX} characters.`;
  else if (!isNameText(details.city)) errors.city = NAME_RULE;
  if (!LANGUAGES.includes(details.language)) errors.language = "Choose the language Sahay should speak on calls.";
  if (state.onboard.accessCodeRequired) {
    details.accessCode = $("ob-code").value.trim();
    if (!details.accessCode) errors.accessCode = "Enter the access code for this Sahay server.";
  }
  if (!details.ownerName) delete details.ownerName;
  return { details, errors };
}

$("onboard-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.onboard.busy) return;
  const { details, errors } = readOnboarding();
  state.onboard.fieldErrors = errors;
  state.onboard.error = null;
  const first = Object.keys(errors)[0];
  if (first) {
    invalidate("onboarding");
    const focusId = { name: "ob-name", ownerName: "ob-owner", city: "ob-city", language: "ob-lang-hi", accessCode: "ob-code" }[first];
    requestAnimationFrame(() => $(focusId).focus());
    return;
  }
  state.onboard.busy = true;
  invalidate("onboarding");
  let session;
  try {
    session = await api.openSession(details);
  } catch (err) {
    state.onboard.busy = false;
    if (err.code === "ACCESS_CODE_REQUIRED") {
      // The server needs a code even if /api/config could not be read: show the field.
      state.onboard.accessCodeRequired = true;
      state.onboard.fieldErrors = { accessCode: err.message || "Enter the access code for this Sahay server." };
      invalidate("onboarding");
      requestAnimationFrame(() => $("ob-code").focus());
      return;
    }
    state.onboard.error = err.message || "The server did not answer.";
    invalidate("onboarding");
    return;
  }
  state.onboard = { busy: false, error: null, fieldErrors: {}, accessCodeRequired: false };
  await boot({ session });
});

// Clear a field's error as soon as the owner edits it.
$("onboard-form").addEventListener("input", (e) => {
  const key = { "ob-name": "name", "ob-owner": "ownerName", "ob-city": "city", "ob-code": "accessCode" }[e.target.id] || (e.target.name === "language" ? "language" : null);
  if (key && state.onboard.fieldErrors[key]) {
    delete state.onboard.fieldErrors[key];
    invalidate("onboarding");
  }
});

/* ======================================================================== boot */

let events = null;
let booting = null;

/**
 * POST /api/session (no body: an existing cookie loads the business; without one the
 * server answers BUSINESS_DETAILS_REQUIRED and the onboarding card is shown), then
 * GET /api/state, then the event stream. `session` skips the first step after onboarding.
 */
async function boot({ session } = {}) {
  if (booting) return booting;
  booting = (async () => {
    state.boot = "loading";
    state.bootError = null;
    invalidateAll();
    try {
      let s = session;
      if (!s) {
        try {
          s = await api.openSession();
        } catch (err) {
          if (err.code === "BUSINESS_DETAILS_REQUIRED") {
            // Ask for the access code only when this server needs one; if this check fails the
            // form still works and the server's ACCESS_CODE_REQUIRED answer reveals the field.
            try {
              state.onboard.accessCodeRequired = Boolean((await api.getConfig()).accessCodeRequired);
            } catch { /* see above */ }
            state.boot = "onboarding";
            state.stream = "closed";
            invalidateAll();
            return;
          }
          throw err;
        }
      }
      state.business = (s && s.business) || null;
      const snap = await api.getState();
      applySnapshot(snap);
      state.boot = "ready";
    } catch (err) {
      state.boot = "error";
      state.bootError = err;
    }
    if (state.boot === "ready" && !events) {
      state.stream = "connecting";
      events = connectEvents({
        onEvent: (evt) => applyEvent(evt),
        onStatus: (st, info) => {
          state.stream = st;
          invalidate("header", "banner");
          if (st === "open" && info && info.resumed) resync();
        },
      });
    } else if (state.boot === "error") {
      state.stream = "closed";
    }
    invalidateAll();
  })().finally(() => { booting = null; });
  return booting;
}

async function resync() {
  try {
    applySnapshot(await api.getState());
  } catch (err) {
    state.serverErrors.unshift({ ts: Date.now(), code: err.code || "RESYNC", message: `Could not refresh after reconnecting: ${err.message}` });
    state.serverErrors = state.serverErrors.slice(0, 3);
    invalidate("banner");
  }
}

invalidateAll();
boot();
// Start fetching the Agora SDKs after first paint; the call button awaits them if needed.
requestAnimationFrame(() => setTimeout(() => preloadSdks().catch(() => {}), 0));
