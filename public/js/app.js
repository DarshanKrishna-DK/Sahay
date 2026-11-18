// Sahay voice console: one state store, fed by REST (GET /api/state), SSE (/api/events)
// and the Agora call. Panels render only what the server or the call produced; every
// panel has a designed empty, loading and error state. All text goes in via textContent.

import * as api from "./api.js";
import { connectEvents } from "./events.js";
import { VoiceCall, preloadSdks, scriptOf } from "./voice.js";

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
  boot: "loading",
  bootError: null,
  business: null,
  stream: "connecting",
  requirement: null,
  adapt: [],
  jobs: new Map(),
  vendors: new Map(),
  negotiations: new Map(),
  quotes: new Map(),
  approvals: new Map(),
  approvalUi: new Map(),
  orders: new Map(),
  followups: [],
  audit: new Map(),
  serverErrors: [],
  call: {
    status: "idle", agentState: null, muted: false, lang: null, langSource: null,
    error: null, note: null, autoplay: false, issues: [], metrics: {}, transcriptLink: true,
  },
  transcript: [],
};

function resetData() {
  state.requirement = null;
  state.adapt = [];
  state.jobs.clear();
  state.vendors.clear();
  state.negotiations.clear();
  state.quotes.clear();
  state.approvals.clear();
  state.orders.clear();
  state.followups = [];
  state.audit.clear();
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
// Field names follow src/db/schema.sql (snake_case) with camelCase accepted too, because
// architecture.md does not yet pin event payload shapes.

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
  };
}

function normJob(d) {
  const j = d && d.job && typeof d.job === "object" ? d.job : d;
  return {
    id: pick(j, "jobId", "job_id", "id"),
    kind: pick(j, "kind"),
    status: pick(j, "status"),
    progress: parseMaybeJson(pick(j, "progress")),
    error: pick(j, "error"),
    createdAt: pick(j, "created_at", "createdAt"),
    updatedAt: pick(j, "updated_at", "updatedAt"),
    vendorId: pick(j, "vendorId", "vendor_id"),
  };
}

function normVendor(v) {
  return {
    id: pick(v, "vendorId", "vendor_id", "id"),
    name: pick(v, "name"),
    city: pick(v, "city"),
    itemTitle: pick(v, "item_title", "itemTitle"),
    listedPriceText: pick(v, "listed_price_text", "listedPriceText"),
    rating: num(pick(v, "rating")),
    ratingCount: num(pick(v, "rating_count", "ratingCount")),
    sourceUrl: pick(v, "source_url", "sourceUrl"),
    source: pick(v, "source"),
    kind: pick(v, "kind"),
    score: num(pick(v, "score")),
  };
}

function normQuote(q) {
  const sim = pick(q, "simulated");
  return {
    id: pick(q, "quoteId", "quote_id", "id"),
    vendorId: pick(q, "vendorId", "vendor_id"),
    vendorName: pick(q, "vendorName", "vendor_name"),
    negotiationId: pick(q, "negotiationId", "negotiation_id"),
    unitPrice: num(pick(q, "unit_price", "unitPrice")),
    unit: pick(q, "unit"),
    moq: num(pick(q, "moq")),
    leadTimeDays: num(pick(q, "lead_time_days", "leadTimeDays")),
    freight: num(pick(q, "freight")),
    landedCost: num(pick(q, "landed_cost", "landedCost")),
    simulated: sim === true || sim === 1 || sim === "1",
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
    decidedVia: pick(a, "decided_via", "decidedVia"),
    evidence: pick(a, "evidence_utterance", "evidenceUtterance"),
  };
}

function normOrder(o) {
  return {
    id: pick(o, "orderId", "order_id", "id"),
    poNumber: pick(o, "po_number", "poNumber"),
    status: pick(o, "status"),
    amount: num(pick(o, "amount")),
    pdfUrl: pick(o, "pdfUrl", "pdf_url"),
    paymentUrl: pick(o, "payment_link_url", "paymentLinkUrl"),
    createdAt: pick(o, "created_at", "createdAt"),
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
  "vendor.found": "Vendor found",
  "negotiation.turn": "Negotiation turn",
  "negotiation.ended": "Negotiation ended",
  "quote.recorded": "Quote recorded",
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
  "order.created": "Order created",
  "payment.link": "Payment link created",
  "followup.fired": "Follow-up due",
  "error": "Error",
};

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
      }
      state.requirement = r;
      invalidate("requirement", "plan");
      break;
    }
    case "job.started":
    case "job.progress":
    case "job.done":
    case "job.failed": {
      const j = normJob(d);
      if (!j.status) j.status = type === "job.done" ? "done" : type === "job.failed" ? "failed" : "running";
      if (type === "job.done") j.status = "done";
      if (type === "job.failed") { j.status = "failed"; j.error = j.error || pick(d, "message"); }
      if (!j.createdAt && type === "job.started") j.createdAt = evt.ts;
      j.updatedAt = evt.ts || j.updatedAt;
      const prev = j.id !== undefined ? state.jobs.get(String(j.id)) : null;
      if (type === "job.started" && !prev) {
        // A new job of a kind that failed earlier is Sahay re-planning after a failure.
        const failed = [...state.jobs.values()].find((x) => x.kind === j.kind && x.status === "failed");
        if (failed) state.adapt.push({ ts: evt.ts, text: `Retried ${kindLabel(j.kind).toLowerCase()} after a failure` });
      }
      merge(state.jobs, j);
      invalidate("jobs", "plan", "vendors", "negotiation");
      break;
    }
    case "vendor.found": {
      const list = Array.isArray(d.vendors) ? d.vendors : [d.vendor && typeof d.vendor === "object" ? d.vendor : d];
      for (const v of list) merge(state.vendors, normVendor(v));
      invalidate("vendors", "plan", "negotiation", "quotes");
      break;
    }
    case "negotiation.turn": {
      const nid = pick(d, "negotiationId", "negotiation_id");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      const turn = {
        eid: evt.id,
        ts: evt.ts,
        speaker: speakerOf(d),
        text: pick(d, "text", "utterance", "message"),
        offer: num(pick(d, "offer", "unit_price", "unitPrice", "price")),
        unit: pick(d, "unit"),
        round: num(pick(d, "round")),
      };
      if (turn.eid === null || turn.eid === undefined || !n.turns.some((t) => t.eid === turn.eid)) n.turns.push(turn);
      if (!n.status) n.status = "running";
      invalidate("negotiation", "plan");
      break;
    }
    case "negotiation.ended": {
      const nid = pick(d, "negotiationId", "negotiation_id", "id");
      if (nid === undefined) break;
      const n = ensureNegotiation(nid, d);
      n.status = pick(d, "status") || "ended";
      n.outcome = parseMaybeJson(pick(d, "outcome")) ?? n.outcome;
      n.endedAt = evt.ts;
      invalidate("negotiation", "plan");
      break;
    }
    case "quote.recorded": {
      merge(state.quotes, normQuote(d.quote && typeof d.quote === "object" ? d.quote : d));
      invalidate("quotes", "plan");
      break;
    }
    case "approval.requested":
    case "approval.decided": {
      const a = normApproval(d);
      if (type === "approval.requested" && !a.status) a.status = "pending";
      if (type === "approval.requested" && !a.requestedAt) a.requestedAt = evt.ts;
      if (type === "approval.decided" && !a.decidedAt) a.decidedAt = evt.ts;
      if (type === "approval.decided" && !a.status) {
        const dec = pick(d, "decision");
        if (dec === "approve") a.status = "approved";
        if (dec === "reject") a.status = "rejected";
      }
      const rec = merge(state.approvals, a);
      if (rec && type === "approval.decided") state.approvalUi.delete(String(rec.id));
      invalidate("approval", "plan");
      break;
    }
    case "order.created": {
      const o = normOrder(d.order && typeof d.order === "object" ? d.order : d);
      if (!o.createdAt) o.createdAt = evt.ts;
      merge(state.orders, o);
      invalidate("order", "plan");
      break;
    }
    case "payment.link": {
      const oid = pick(d, "orderId", "order_id");
      const url = pick(d, "url", "payment_link_url", "paymentLinkUrl");
      if (oid !== undefined) merge(state.orders, { id: oid, paymentUrl: url });
      invalidate("order", "plan");
      break;
    }
    case "followup.fired": {
      state.followups.push({
        eid: evt.id, ts: evt.ts,
        orderId: pick(d, "orderId", "order_id"),
        kind: pick(d, "kind"),
        message: pick(d, "message", "say"),
        dueAt: pick(d, "due_at", "dueAt"),
      });
      invalidate("order", "plan");
      break;
    }
    case "error": {
      if (live) {
        state.serverErrors.unshift({ ts: evt.ts, code: pick(d, "code"), message: pick(d, "message", "say") || "The server reported an error." });
        state.serverErrors = state.serverErrors.slice(0, 3);
        invalidate("banner");
      }
      break;
    }
    default:
      break;
  }

  if (type !== "transcript") {
    const key = evt.id !== null && evt.id !== undefined ? String(evt.id) : `local-${state.audit.size}-${type}`;
    if (!state.audit.has(key)) {
      state.audit.set(key, { id: key, ts: evt.ts, actor: evt.actor || actorFor(type, d), type, data: d });
      invalidate("audit");
    }
  }
}

function kindLabel(kind) {
  if (kind === "sourcing") return "Sourcing";
  if (kind === "negotiation") return "Negotiation";
  return kind ? String(kind) : "Job";
}

function speakerOf(d) {
  const s = String(pick(d, "speaker", "role", "actor", "from") || "").toLowerCase();
  if (["agent", "sahay", "buyer", "negotiator", "assistant"].includes(s)) return "agent";
  if (["vendor", "seller", "counterpart", "supplier"].includes(s)) return "vendor";
  return s || "unknown";
}

function actorFor(type, d) {
  const explicit = pick(d, "actor");
  if (typeof explicit === "string") return explicit;
  if (type === "approval.decided") return "owner";
  if (type === "negotiation.turn") return speakerOf(d) === "vendor" ? "vendor" : "agent";
  if (type === "requirement.saved" || type === "approval.requested" || type === "job.started") return "agent";
  return "system";
}

function ensureNegotiation(nid, d) {
  const key = String(nid);
  let n = state.negotiations.get(key);
  if (!n) {
    n = { id: key, turns: [], status: null, outcome: null, vendorId: null, vendorName: null, counterpart: null };
    state.negotiations.set(key, n);
  }
  n.vendorId = n.vendorId ?? pick(d, "vendorId", "vendor_id") ?? null;
  n.vendorName = n.vendorName ?? pick(d, "vendorName", "vendor_name") ?? null;
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

/** GET /api/state -> rebuild everything. Audit rows are the persisted events, so replaying
 *  them restores negotiation turns and follow-ups, which the snapshot does not list. */
function applySnapshot(snap) {
  resetData();
  const audit = asArray(snap && snap.audit).slice().sort((x, y) => {
    const a = num(x.id), b = num(y.id);
    if (a !== null && b !== null) return a - b;
    return String(x.ts).localeCompare(String(y.ts));
  });
  for (const row of audit) {
    applyEvent({ id: row.id, ts: row.ts, type: row.type, actor: row.actor, data: parseMaybeJson(row.detail) || {} }, { live: false });
  }
  if (snap && snap.requirement) state.requirement = normRequirement(snap.requirement);
  for (const j of asArray(snap && snap.jobs)) merge(state.jobs, normJob(j));
  for (const v of asArray(snap && snap.vendors)) merge(state.vendors, normVendor(v));
  for (const q of asArray(snap && snap.deals)) merge(state.quotes, normQuote(q));
  for (const a of asArray(snap && snap.approvals)) merge(state.approvals, normApproval(a));
  for (const o of asArray(snap && snap.orders)) merge(state.orders, normOrder(o));
  invalidateAll();
}

/* ================================================================== renderers */

RENDERERS.header = () => {
  const el = $("business-name");
  const name = state.business && pick(state.business, "name");
  el.hidden = !name;
  el.textContent = name ? String(name) : "";

  const s = $("stream-status");
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
  el.hidden = items.length === 0;
  el.replaceChildren(...items);
};

const ORB = {
  idle: ["idle", "Ready to call", "Press Start call, then tell Sahay what you need to buy."],
  mic: ["connecting", "Allow the microphone", "Your browser will ask for microphone access."],
  connecting: ["connecting", "Connecting", "Starting Sahay and joining the call."],
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
  $("orb-sub").textContent = c.status === "idle" && c.note ? `${c.note} ${sub}` : sub;

  const btn = $("call-btn");
  btn.replaceChildren();
  btn.disabled = false;
  if (c.status === "idle" || c.status === "error") {
    btn.className = "btn btn-primary";
    btn.textContent = c.status === "error" && c.error && c.error.retry ? "Try again" : "Start call";
    btn.disabled = c.status === "error" && c.error && c.error.retry === false;
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

  for (const el of document.querySelectorAll("#lang-row .lang")) {
    el.setAttribute("aria-current", String(el.dataset.lang === c.lang));
  }
  $("lang-note").textContent = c.lang
    ? (c.langSource === "asr" ? "Detected by speech recognition." : "Detected from the script of your last sentence.")
    : "Detected from your speech once you talk.";

  $("audio-unlock").hidden = !c.autoplay;

  const pipe = $("pipeline");
  const labels = [["asr", "Speech to text"], ["llm", "Reasoning"], ["tts", "Murf Falcon voice"], ["turn", "Full turn"]];
  const chips = labels.filter(([k]) => typeof c.metrics[k] === "number")
    .map(([k, l]) => h("span", { class: "pipe-chip" }, l, h("b", { text: `${Math.round(c.metrics[k])} ms` })));
  pipe.hidden = chips.length === 0;
  pipe.replaceChildren(...chips);

  const issues = [];
  if (inCall && !c.transcriptLink) {
    issues.push(h("div", { class: "notice warn" }, icon("wifi", 20),
      h("div", { class: "body" }, h("strong", { text: "Transcript link interrupted" }),
        h("span", { text: "Audio continues. The transcript catches up when the link is back." }))));
  }
  for (const i of c.issues) {
    issues.push(h("div", { class: "notice warn" }, icon("alert", 20),
      h("div", { class: "body" }, h("strong", { text: issueTitle(i.source) }), scripted("span", i.message))));
  }
  $("call-issues").replaceChildren(...issues);
};

function issueTitle(source) {
  return {
    asr: "Speech recognition issue", llm: "Reasoning issue", tts: "Voice output issue",
    network: "Network", token: "Call token", audio: "Audio playback", mic: "Microphone",
    agent: "Sahay agent", message: "Message delivery",
  }[source] || "Call issue";
}

RENDERERS.transcript = () => {
  const box = $("transcript");
  const turns = state.transcript;
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
    const fu = state.followups[state.followups.length - 1];
    confirm = { status: "done", detail: fu ? `Follow-up: ${fu.message || fu.kind || "due"}` : (lastOrder.poNumber ? `PO ${lastOrder.poNumber}` : "Order raised") };
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
  const p = job && job.progress;
  if (!p) return null;
  if (typeof p === "string") return p;
  return pick(p, "message", "say", "step", "stage") || null;
}
function progressFraction(job) {
  const p = job && job.progress;
  if (!p || typeof p !== "object") return null;
  const pct = num(pick(p, "pct", "percent"));
  if (pct !== null) return Math.max(0, Math.min(1, pct > 1 ? pct / 100 : pct));
  const done = num(pick(p, "done", "current")), total = num(pick(p, "total"));
  if (done !== null && total) return Math.max(0, Math.min(1, done / total));
  return null;
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
    ["Needed by", r.deliveryBy ? (/^\d{4}-\d{2}-\d{2}/.test(String(r.deliveryBy)) && dateTime(r.deliveryBy) ? dateTime(r.deliveryBy) : String(r.deliveryBy)) : null, false],
  ].filter(([, v]) => v);
  const missing = r.missing.filter((m) => typeof m === "string");
  box.replaceChildren(
    h("dl", { class: "facts" }, ...facts.map(([k, v, mono]) => h("div", { class: "fact" }, h("dt", { text: k }), scripted("dd", v, { class: mono ? "mono" : undefined })))),
    r.notes ? scripted("p", r.notes, { class: "row-meta" }) : null,
    missing.length ? h("div", { class: "notice warn" }, icon("alert", 20),
      h("div", { class: "body" }, h("strong", { text: "Sahay still needs" }), h("span", { text: missing.join(", ") }))) : null);
};

const JOB_CHIP = { queued: "", running: "amber", done: "jade", failed: "terra", cancelled: "" };

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
        : (progressText(j) ? scripted("p", progressText(j), { class: "row-meta" }) : null),
      status === "failed" ? null : h("div", { class: `bar${bar === null && status === "running" ? " indeterminate" : ""}`, role: "progressbar", "aria-label": `${kindLabel(j.kind)} progress`, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": bar === null ? undefined : String(Math.round(bar * 100)) },
        h("span", { style: bar === null ? undefined : `width:${Math.round(bar * 100)}%` })),
      h("p", { class: "row-meta mono", style: "font-size:13px" }, j.createdAt ? `Started ${clock(j.createdAt) || ""}` : "", j.updatedAt && j.updatedAt !== j.createdAt ? ` · updated ${clock(j.updatedAt) || ""}` : ""));
  })));
};

RENDERERS.vendors = () => {
  const box = $("vendors-body");
  const vendors = [...state.vendors.values()];
  vendors.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  setCount("vendors-count", vendors.length);
  if (bootStates(box, "vendors")) return;
  if (!vendors.length) {
    const sourcing = [...state.jobs.values()].find((j) => j.kind === "sourcing" && (j.status === "running" || j.status === "queued"));
    const failed = [...state.jobs.values()].find((j) => j.kind === "sourcing" && j.status === "failed");
    if (sourcing) {
      box.replaceChildren(stateView("loading", { title: "Searching IndiaMART", text: progressText(sourcing) || "Looking up real listings for your requirement." }));
    } else if (failed) {
      box.replaceChildren(stateView("error", { title: "Sourcing failed", text: failed.error ? String(failed.error) : "Sahay could not fetch vendor listings. Ask Sahay to try again." }));
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
        h("span", { class: "vendor-rank mono", text: `#${i + 1}` }),
        simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : null,
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
  const negos = [...state.negotiations.values()].reverse();
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
    const name = (vendor && vendor.name) || n.vendorName || "Vendor";
    const simulated = n.counterpart === "simulated" || (vendor && vendor.kind === "simulated");
    const ended = n.status && n.status !== "running";
    return h("article", { class: "nego" },
      h("div", { class: "nego-head" },
        scripted("span", name, { class: "row-title" }),
        simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : n.counterpart === "human" ? h("span", { class: "chip info", text: "Human vendor" }) : n.counterpart === "phone" ? h("span", { class: "chip info", text: "Phone call" }) : null,
        h("span", { class: `chip ${ended ? "" : "amber"}`, text: n.status || "running" })),
      n.turns.length
        ? h("ol", { class: "timeline" }, ...n.turns.map((t) => {
            const who = t.speaker === "agent" ? "Sahay" : t.speaker === "vendor" ? (simulated ? "Simulated vendor" : name) : "Unknown speaker";
            return h("li", { class: `tl-item ${t.speaker}` },
              h("span", { class: "tl-who" }, who, t.round !== null ? h("span", { class: "chip", text: `Round ${t.round}` }) : null, timeEl(t.ts)),
              t.offer !== null ? h("span", { class: "tl-offer", text: perUnit(t.offer, t.unit) }) : null,
              t.text ? scripted("p", String(t.text), { class: "tl-text" }) : null);
          }))
        : stateView("loading", { title: "Waiting for the first offer", text: null }),
      ended ? outcomeView(n) : null);
  }));
};

function outcomeView(n) {
  const o = n.outcome && typeof n.outcome === "object" ? n.outcome : {};
  const price = num(pick(o, "unit_price", "unitPrice", "agreed_price", "agreedPrice", "price"));
  const agreed = pick(o, "agreed", "deal");
  const ok = agreed === true || (price !== null && agreed !== false) || n.status === "agreed" || n.status === "done";
  const text = pick(o, "summary", "say", "reason");
  const head = price !== null ? `${ok ? "Agreed at" : "Last offer"} ${perUnit(price, pick(o, "unit"))}` : (ok ? "Negotiation finished" : "No deal");
  return h("div", { class: `outcome ${ok ? "ok" : "bad"}` }, head, text ? h("span", { style: "display:block;font-weight:500" }, scripted("span", String(text))) : null);
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
    if (latest.evidence) parts.push(h("p", { class: "evidence" }, "Your words: ", h("q", {}, scripted("span", String(latest.evidence)))));
  }
  box.replaceChildren(...parts);
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

RENDERERS.quotes = () => {
  const box = $("quotes-body");
  const quotes = [...state.quotes.values()].sort((a, b) => (a.landedCost ?? Infinity) - (b.landedCost ?? Infinity));
  setCount("quotes-count", quotes.length);
  if (bootStates(box, "quotes")) return;
  if (!quotes.length) {
    box.replaceChildren(stateView("empty", { icon: "scale", title: "No quotes yet", text: "Quotes appear after Sahay talks to vendors. Freight a vendor did not state shows as not quoted, never as zero." }));
    return;
  }
  const best = quotes[0] && quotes[0].landedCost !== null ? quotes[0].id : null;
  const rows = quotes.map((q) => {
    const vendor = q.vendorId ? state.vendors.get(String(q.vendorId)) : null;
    const name = (vendor && vendor.name) || q.vendorName || "Vendor";
    const isBest = q.id === best && quotes.length > 1;
    return h("tr", { class: isBest ? "best" : undefined },
      h("td", {}, scripted("span", name), " ", q.simulated ? h("span", { class: "chip sim", text: "Simulated vendor" }) : null, isBest ? h("span", { class: "chip jade", text: "Best" }) : null),
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
  if (!orders.length) {
    const approved = [...state.approvals.values()].find((a) => a.status === "approved");
    if (approved) {
      box.replaceChildren(stateView("loading", { title: "Raising the purchase order", text: "Approval received. Sahay is creating the PO and payment link." }));
    } else {
      box.replaceChildren(stateView("empty", { icon: "doc", title: "No order yet", text: "After you approve, Sahay raises a purchase order with a PDF and a Razorpay test-mode payment link." }));
    }
    return;
  }
  box.replaceChildren(...orders.map((o) => {
    const pdf = safeUrl(o.pdfUrl) || (o.id ? safeUrl(api.poPdfUrl(o.id)) : null);
    const pay = safeUrl(o.paymentUrl);
    const fus = state.followups.filter((f) => f.orderId === undefined || String(f.orderId) === String(o.id));
    return h("article", { class: "order" },
      h("div", { class: "row-head" },
        h("div", { class: "po", style: "flex:1 1 auto" }, h("span", { class: "k", text: "Purchase order" }), h("span", { class: "v", text: o.poNumber || "Number pending" })),
        o.status ? h("span", { class: "chip jade", text: o.status }) : null),
      o.amount !== null ? h("p", { class: "decided" }, "Amount", h("span", { class: "total", text: money(o.amount) })) : null,
      h("div", { class: "order-actions" },
        pdf ? h("a", { class: "btn btn-small", href: pdf, target: "_blank", rel: "noopener" }, icon("download", 18), "Download PO (PDF)") : null,
        pay ? h("a", { class: "btn btn-small btn-primary", href: pay, target: "_blank", rel: "noopener noreferrer" }, icon("external", 18), "Open payment link")
            : h("span", { class: "row-meta", text: "Payment link not created yet." })),
      pay ? h("p", { class: "row-meta" }, h("span", { class: "chip amber", text: "Test mode" }), " Razorpay test link. No real money moves.") : null,
      fus.length ? h("ul", { class: "followups" }, ...fus.map((f) => h("li", {},
        icon("clock", 16), " ", timeEl(f.ts), " ", scripted("span", f.message || f.kind || "Follow-up due"),
        f.dueAt ? h("span", { class: "row-meta" }, ` (due ${dateTime(f.dueAt) || f.dueAt})`) : null))) : null);
  }));
};

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
    return h("li", {},
      timeEl(r.ts) || h("time", { text: "" }),
      h("span", { class: `chip actor-${actor}`, text: actor === "agent" ? "Sahay" : actor }),
      h("span", { class: "what" }, h("b", { text: TYPE_LABEL[r.type] || r.type }), auditSummary(r) ? [": ", scripted("span", auditSummary(r))] : null));
  })));
};

function auditSummary(r) {
  const d = r.data || {};
  switch (r.type) {
    case "requirement.saved": { const q = normRequirement(d); return q ? [q.item, qty(q.quantity, q.unit), q.city].filter(Boolean).join(", ") : null; }
    case "job.started": case "job.done": return kindLabel(pick(d, "kind"));
    case "job.progress": return [kindLabel(pick(d, "kind")), progressText({ progress: parseMaybeJson(pick(d, "progress")) })].filter(Boolean).join(": ");
    case "job.failed": return [kindLabel(pick(d, "kind")), pick(d, "error", "message")].filter(Boolean).join(": ");
    case "vendor.found": {
      if (Array.isArray(d.vendors)) return `${d.vendors.length} vendors`;
      const v = normVendor(d.vendor || d); return [v.name, v.city].filter(Boolean).join(", ");
    }
    case "negotiation.turn": {
      const who = speakerOf(d) === "vendor" ? (pick(d, "counterpart") === "simulated" ? "Simulated vendor" : "Vendor") : "Sahay";
      const offer = perUnit(num(pick(d, "offer", "unit_price", "unitPrice", "price")), pick(d, "unit"));
      return offer ? `${who} offered ${offer}` : who;
    }
    case "negotiation.ended": return pick(d, "status") || null;
    case "quote.recorded": { const q = normQuote(d.quote || d); return [perUnit(q.unitPrice, q.unit), q.landedCost !== null ? `landed ${money(q.landedCost)}` : null, q.simulated ? "simulated vendor" : null].filter(Boolean).join(", "); }
    case "approval.requested": return pick(d, "readback") || null;
    case "approval.decided": { const a = normApproval(d); return [a.status || pick(d, "decision"), a.decidedVia ? `by ${a.decidedVia}` : null].filter(Boolean).join(" "); }
    case "order.created": return pick(d, "po_number", "poNumber") ? `PO ${pick(d, "po_number", "poNumber")}` : null;
    case "payment.link": return "Razorpay test mode";
    case "followup.fired": return pick(d, "message", "kind") || null;
    case "session.started": case "session.ended": return pick(d, "kind") === "negotiation" ? "Negotiation call" : null;
    case "error": return pick(d, "message", "say", "code") || null;
    default: return null;
  }
}

/* ======================================================================== call */

const call = new VoiceCall({
  onStatus(status, detail) {
    const c = state.call;
    c.status = status;
    if (status === "error") c.error = detail.error || null;
    if (status === "idle") { c.note = detail.note || null; c.agentState = null; }
    if (status === "mic") { c.error = null; c.note = null; c.issues = []; c.metrics = {}; c.lang = null; c.langSource = null; c.transcriptLink = true; c.muted = false; state.transcript = []; }
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

/* ======================================================================== boot */

let events = null;
let booting = null;

async function boot() {
  if (booting) return booting;
  booting = (async () => {
    state.boot = "loading";
    state.bootError = null;
    invalidateAll();
    try {
      const s = await api.openSession();
      state.business = (s && (s.business || s)) || null;
      const snap = await api.getState();
      applySnapshot(snap);
      state.boot = "ready";
    } catch (err) {
      state.boot = "error";
      state.bootError = err;
    }
    if (state.boot === "ready" && !events) {
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
    state.serverErrors.unshift({ ts: Date.now(), code: "resync", message: `Could not refresh after reconnecting: ${err.message}` });
    state.serverErrors = state.serverErrors.slice(0, 3);
    invalidate("banner");
  }
}

invalidateAll();
boot();
// Start fetching the Agora SDKs after first paint; the call button awaits them if needed.
requestAnimationFrame(() => setTimeout(() => preloadSdks().catch(() => {}), 0));
