// Sell, khata and stock data for the app: GET /api/sell and GET /api/stock snapshots, the reducers
// for their live events (contract SELL + STK), and the button paths (bill decision, receipts,
// reminders, goods arrived). main.js imports this file once; it plugs into the shared store with
// registerReducer / registerSnapshot and re-renders screens through touch("sell" | "stock").
//
// Contract: docs/superpowers/plans/2026-11-19-business-suite-contract.md. Rows may arrive
// snake_case (snapshots) or camelCase (events); money may arrive in rupees or in paise
// (`total`, or `totalPaise` / `total_paise`). Both are read. A route that is not on this server
// yet answers 404 and is shown as its own designed state ("missing"), never as sample data.

import { state as appState, touch, agentRequest, registerReducer, registerSnapshot } from "./store.js";
import { pick, num, parseMaybeJson, asArray } from "./dom.js";

export const sell = {
  status: "idle", // idle | loading | ready | missing | error
  error: null,
  customers: new Map(),
  invoices: new Map(),
  receipts: [],
  owed: [],
};

export const stock = {
  status: "idle",
  error: null,
  items: new Map(),
  moves: [],
  proposals: new Map(), // itemId -> { quantity, unit, at }: Sahay asked "buy more?"
};

/* ---------------------------------------------------------- normalisers -- */

/** Rupees from o[base], else from o[basePaise] / o[base_paise] divided by 100. */
export function rupeesOf(o, base) {
  if (!o || typeof o !== "object") return null;
  const r = num(o[base]);
  if (r !== null) return r;
  const snake = base.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const p = num(pick(o, `${base}Paise`, `${snake}_paise`));
  return p === null ? null : p / 100;
}

const idOf = (o, ...keys) => {
  const v = pick(o, ...keys);
  return v === undefined || v === null ? null : String(v);
};

function normCustomer(c) {
  if (!c || typeof c !== "object") return null;
  return {
    id: idOf(c, "customerId", "customer_id", "id"),
    name: pick(c, "name"),
    phone: pick(c, "phone"),
    gstin: pick(c, "gstin"),
    state: pick(c, "state", "state_code", "stateCode"),
    createdAt: pick(c, "created_at", "createdAt"),
  };
}

function normLine(l) {
  const item = l && typeof l.item === "object" ? l.item : null;
  return {
    itemId: idOf(l, "item_id", "itemId") ?? (item ? idOf(item, "id") : null),
    name: pick(l, "name", "item_name", "itemName", "description") ?? (item ? pick(item, "name") : null),
    nameNative: pick(l, "name_native", "nameNative") ?? (item ? pick(item, "name_native") : null),
    qty: num(pick(l, "qty", "quantity")),
    unit: pick(l, "unit") ?? (item ? pick(item, "unit") : null),
    unitPrice: rupeesOf(l, "unitPrice") ?? rupeesOf(l, "unit_price") ?? rupeesOf(l, "rate"),
    gstRate: num(pick(l, "gst_rate", "gstRate")),
    hsn: pick(l, "hsn"),
    taxable: rupeesOf(l, "taxable"),
    cgst: rupeesOf(l, "cgst"),
    sgst: rupeesOf(l, "sgst"),
    igst: rupeesOf(l, "igst"),
  };
}

function normTotals(raw) {
  const t = parseMaybeJson(raw);
  if (!t || typeof t !== "object") return null;
  const out = {
    taxable: rupeesOf(t, "taxable"),
    cgst: rupeesOf(t, "cgst"),
    sgst: rupeesOf(t, "sgst"),
    igst: rupeesOf(t, "igst"),
    tax: rupeesOf(t, "tax"),
    total: rupeesOf(t, "total"),
  };
  if (out.tax === null) {
    const parts = [out.cgst, out.sgst, out.igst].filter((x) => x !== null);
    out.tax = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  }
  return out;
}

function normInvoice(r) {
  if (!r || typeof r !== "object") return null;
  const cust = r.customer && typeof r.customer === "object" ? normCustomer(r.customer) : null;
  const lines = asArray(parseMaybeJson(r.lines)).map(normLine);
  const totals = normTotals(r.totals) || (rupeesOf(r, "total") !== null ? { total: rupeesOf(r, "total") } : null);
  return {
    id: idOf(r, "invoiceId", "invoice_id", "id"),
    number: pick(r, "number", "invoiceNumber"),
    status: pick(r, "status"),
    kind: pick(r, "kind"),
    customerId: idOf(r, "customer_id", "customerId") ?? (cust ? cust.id : null),
    customer: cust,
    lines: lines.length ? lines : undefined,
    totals: totals || undefined,
    paid: rupeesOf(r, "paid") ?? rupeesOf(r, "amountPaid") ?? rupeesOf(r, "amount_paid"),
    pdfUrl: pick(r, "pdfUrl", "pdf_url"),
    payUrl: pick(r, "payUrl", "pay_url"),
    shareUrl: pick(r, "shareUrl", "share_url"),
    readback: pick(r, "readback"),
    simulated: r.simulated === true || r.simulated === 1 ? true : undefined,
    createdAt: pick(r, "created_at", "createdAt"),
    issuedAt: pick(r, "issued_at", "issuedAt"),
  };
}

function normReceipt(r) {
  if (!r || typeof r !== "object") return null;
  return {
    id: idOf(r, "receiptId", "receipt_id", "id"),
    customerId: idOf(r, "customer_id", "customerId"),
    invoiceId: idOf(r, "invoice_id", "invoiceId"),
    amount: rupeesOf(r, "amount"),
    mode: pick(r, "mode"),
    createdAt: pick(r, "created_at", "createdAt"),
  };
}

function normOwed(o) {
  if (!o || typeof o !== "object") return null;
  const cust = o.customer && typeof o.customer === "object" ? normCustomer(o.customer) : null;
  return {
    customerId: (cust && cust.id) || idOf(o, "customer_id", "customerId"),
    customer: cust,
    amount: rupeesOf(o, "amount"),
    oldestDue: pick(o, "oldest_due", "oldestDue"),
  };
}

function normItem(i) {
  if (!i || typeof i !== "object") return null;
  const onHand = num(pick(i, "on_hand", "onHand"));
  const level = num(pick(i, "reorder_level", "reorderLevel"));
  return {
    id: idOf(i, "itemId", "item_id", "id"),
    name: pick(i, "name"),
    nameNative: pick(i, "name_native", "nameNative"),
    unit: pick(i, "unit"),
    hsn: pick(i, "hsn"),
    gstRate: num(pick(i, "gst_rate", "gstRate")),
    salePrice: num(pick(i, "sale_price", "salePrice")),
    reorderLevel: level,
    onHand,
    low: typeof i.low === "boolean" ? i.low : (onHand !== null && level !== null ? onHand <= level : undefined),
    createdAt: pick(i, "created_at", "createdAt"),
  };
}

function merge(map, rec) {
  if (!rec || rec.id === null || rec.id === undefined) return null;
  const prev = map.get(rec.id) || {};
  const next = { ...prev };
  for (const [k, v] of Object.entries(rec)) if (v !== undefined && v !== null) next[k] = v;
  map.set(rec.id, next);
  return next;
}

/* ------------------------------------------------------------- requests -- */

/** The route itself is not on this server yet (the generic API 404, not "no such bill"). */
export const routeMissing = (err) => Boolean(err && err.status === 404 && (err.code === "NOT_FOUND" || err.code === "HTTP_404") && /route|HTTP 404|does not know/i.test(err.message || ""));

let sellLoad = null;
export function loadSell({ quiet = false } = {}) {
  if (sellLoad) return sellLoad;
  if (!quiet || sell.status !== "ready") { sell.status = "loading"; sell.error = null; touch("sell"); }
  sellLoad = (async () => {
    try {
      const r = await agentRequest("GET", "/api/sell");
      const customers = new Map();
      for (const c of asArray(r.customers)) merge(customers, normCustomer(c));
      const invoices = new Map();
      for (const i of asArray(r.invoices)) merge(invoices, normInvoice(i));
      sell.customers = customers;
      sell.invoices = invoices;
      sell.receipts = asArray(r.receipts).map(normReceipt).filter(Boolean)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      sell.owed = asArray(r.owed).map(normOwed).filter((o) => o && o.amount !== null && o.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      for (const o of sell.owed) if (o.customer) merge(sell.customers, o.customer);
      sell.status = "ready";
      sell.error = null;
    } catch (err) {
      if (!(quiet && sell.status === "ready")) {
        sell.status = err.status === 404 ? "missing" : "error";
        sell.error = err;
      }
    }
    touch("sell");
  })().finally(() => { sellLoad = null; });
  return sellLoad;
}

let stockLoad = null;
export function loadStock({ quiet = false } = {}) {
  if (stockLoad) return stockLoad;
  if (!quiet || stock.status !== "ready") { stock.status = "loading"; stock.error = null; touch("stock"); }
  stockLoad = (async () => {
    try {
      const r = await agentRequest("GET", "/api/stock");
      const items = new Map();
      for (const i of asArray(r.items)) merge(items, normItem(i));
      stock.items = items;
      stock.moves = asArray(r.moves).slice(0, 50);
      if (Array.isArray(r.proposals)) {
        stock.proposals = new Map();
        for (const p of r.proposals) {
          const itemId = idOf(p, "item_id", "itemId");
          if (itemId && (pick(p, "status") || "open") === "open") stock.proposals.set(itemId, { quantity: num(pick(p, "quantity")), unit: pick(p, "unit") });
        }
      }
      stock.status = "ready";
      stock.error = null;
    } catch (err) {
      if (!(quiet && stock.status === "ready")) {
        stock.status = err.status === 404 ? "missing" : "error";
        stock.error = err;
      }
    }
    touch("stock");
  })().finally(() => { stockLoad = null; });
  return stockLoad;
}

/** Button path of the bill gate: POST /api/invoices/:id/decision { decision }. */
export async function decideInvoice(id, decision) {
  const r = await agentRequest("POST", `/api/invoices/${encodeURIComponent(id)}/decision`, { decision });
  const body = r && typeof r.invoice === "object" ? r.invoice : null;
  const inv = body ? normInvoice(body) : null;
  if (inv && inv.id) merge(sell.invoices, inv);
  else {
    const cur = sell.invoices.get(String(id));
    if (cur) cur.status = decision === "approve" ? "issued" : "draft";
  }
  touch("sell");
  scheduleSell();
  return r;
}

/** POST /api/receipts { customer_id, amount, mode, invoice_id? } (button path). Amount in rupees. */
export async function recordReceipt({ customerId, amount, mode, invoiceId }) {
  const body = { customer_id: customerId, amount, mode };
  if (invoiceId) body.invoice_id = invoiceId;
  const r = await agentRequest("POST", "/api/receipts", body);
  const rec = normReceipt((r && (r.receipt || r)) || {});
  if (rec && rec.id && !sell.receipts.some((x) => x.id === rec.id)) sell.receipts.unshift(rec);
  touch("sell");
  await loadSell({ quiet: true });
  return rec;
}

/** POST /api/customers/:id/remind -> the free WhatsApp share URL (https://wa.me/...). */
export async function remindCustomer(customerId) {
  const r = await agentRequest("POST", `/api/customers/${encodeURIComponent(customerId)}/remind`, {});
  const nested = r && typeof r.reminder === "object" ? r.reminder : {};
  const url = pick(r || {}, "shareUrl", "share_url", "url") ?? pick(nested, "shareUrl", "share_url", "url");
  return typeof url === "string" ? url : null;
}

/** POST /api/orders/:id/delivered: the goods of a purchase order reached the shop; stock goes up. */
export async function markDelivered(orderId) {
  const r = await agentRequest("POST", `/api/orders/${encodeURIComponent(orderId)}/delivered`, {});
  const o = appState.orders.get(String(orderId));
  if (o) o.status = (r && r.order && r.order.status) || "delivered";
  touch("orders", "stock");
  await loadStock({ quiet: true });
  return r;
}

/* ---------------------------------------------------------------- queries -- */

export const customerOf = (id) => (id ? sell.customers.get(String(id)) || null : null);
export const invoiceCustomer = (inv) => (inv && (inv.customer || customerOf(inv.customerId))) || null;
export const pendingInvoices = () => [...sell.invoices.values()].filter((i) => i.status === "pending")
  .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
export const itemOf = (id) => (id ? stock.items.get(String(id)) || null : null);

/** Purchase orders whose goods have not arrived yet (the Stock screen's "coming to you"). */
const NOT_OPEN = new Set(["delivered", "closed", "cancelled", "rejected"]);
export const openOrders = () => [...appState.orders.values()].filter((o) => o.status && !NOT_OPEN.has(o.status))
  .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

/* ----------------------------------------------------------- live events -- */

let sellTimer = 0;
let stockTimer = 0;
function scheduleSell() {
  clearTimeout(sellTimer);
  sellTimer = setTimeout(() => { if (sell.status !== "idle") loadSell({ quiet: true }); }, 450);
}
function scheduleStock() {
  clearTimeout(stockTimer);
  stockTimer = setTimeout(() => { if (stock.status !== "idle") loadStock({ quiet: true }); }, 450);
}

const INVOICE_STATUS = { "invoice.drafted": "draft", "invoice.requested": "pending", "invoice.issued": "issued" };

/**
 * Live and replayed events. Replays (live: false) come before every snapshot and are overwritten
 * by GET /api/sell and /api/stock, so only live events change data here.
 */
export function applySellEvent(evt, { live = true } = {}) {
  if (!live || !evt) return;
  const d = evt.data && typeof evt.data === "object" ? evt.data : {};
  switch (evt.type) {
    case "customer.saved":
      merge(sell.customers, normCustomer(d.customer || d));
      touch("sell");
      scheduleSell();
      break;
    case "invoice.drafted": case "invoice.requested": case "invoice.spoken": case "invoice.decided": case "invoice.issued": {
      const raw = d.invoice && typeof d.invoice === "object" ? d.invoice : { ...d, id: pick(d, "invoiceId", "invoice_id") };
      const inv = normInvoice(raw);
      if (inv && inv.id) {
        if (evt.type === "invoice.spoken") inv.status = undefined;
        else if (INVOICE_STATUS[evt.type] && (!d.invoice || !inv.status)) inv.status = INVOICE_STATUS[evt.type];
        if (evt.type === "invoice.decided" && !d.invoice) {
          const dec = pick(d, "decision", "status");
          inv.status = dec === "rejected" || dec === "reject" ? "draft" : undefined;
        }
        merge(sell.invoices, inv);
        if (inv.customer) merge(sell.customers, inv.customer);
      }
      touch("sell");
      scheduleSell();
      break;
    }
    case "receipt.recorded": {
      const rec = normReceipt(d.receipt || d);
      if (rec && rec.id && !sell.receipts.some((x) => x.id === rec.id)) sell.receipts.unshift(rec);
      touch("sell");
      scheduleSell();
      break;
    }
    case "reminder.sent":
      scheduleSell();
      break;
    case "item.saved":
      merge(stock.items, normItem(d.item || d));
      touch("stock");
      scheduleStock();
      break;
    case "stock.moved": {
      const move = d.move && typeof d.move === "object" ? d.move : null;
      const itemId = move ? idOf(move, "item_id", "itemId") : idOf(d, "itemId", "item_id");
      const it = itemId ? stock.items.get(itemId) : null;
      const onHand = num(pick(d, "on_hand", "onHand"));
      if (it && onHand !== null) {
        it.onHand = onHand;
        if (it.reorderLevel !== null && it.reorderLevel !== undefined) it.low = onHand <= it.reorderLevel;
      }
      if (move) stock.moves = [move, ...stock.moves].slice(0, 50);
      touch("stock");
      scheduleStock();
      break;
    }
    case "stock.low": {
      const it = normItem(d.item || {});
      if (it && it.id) {
        const onHand = num(pick(d, "on_hand", "onHand"));
        const level = num(pick(d, "level"));
        merge(stock.items, { ...it, onHand: onHand ?? it.onHand, reorderLevel: level ?? it.reorderLevel, low: true });
      }
      touch("stock");
      break;
    }
    case "stock.reorder_proposed": {
      const it = normItem(d.item || {});
      if (it && it.id) {
        merge(stock.items, it);
        stock.proposals.set(it.id, { quantity: num(pick(d, "quantity")), unit: pick(d, "unit") || it.unit, at: evt.ts });
      }
      touch("stock");
      break;
    }
    case "order.created": case "order.status":
      if (pick(d, "to") === "delivered") scheduleStock();
      touch("stock");
      break;
    default:
      break;
  }
}

registerReducer(applySellEvent);
// Every GET /api/state (boot, reconnect, resync): refresh what a screen has already opened.
registerSnapshot(() => {
  if (sell.status !== "idle") loadSell({ quiet: true });
  if (stock.status !== "idle") loadStock({ quiet: true });
});
