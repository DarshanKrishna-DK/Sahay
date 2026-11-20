// History rows with no DOM (tested in test/history-lines.test.js): which audit rows an owner sees,
// the one line and icon for each, newest first, grouped by day. Words come from the caller's `t`
// so this file holds no strings; numbers and units go through the caller's formatters.
//
//   historyRows(auditRows) -> rows to show (newest first, at most 150)
//   historyLine(row, fmt)  -> { key, vars, detail, tone, via, icon } | null
//   dayGroups(rows, now)   -> [{ day: "today"|"yesterday"|"YYYY-MM-DD", rows }]
//   clockWords(date, lang) -> "सुबह 10:30" / "ಸಂಜೆ 6:05" / "10:30 am" (time of day in the owner's words)

/** Icon per audit type (names from dom.js ICONS). */
export const HISTORY_ICON = {
  "requirement.saved": "ear", "job.started": "search", "job.done": "check", "job.failed": "x",
  "vendor.found": "store", "negotiation.ended": "handshake", "quote.recorded": "tag",
  "approval.requested": "alert", "approval.decided": "check", "order.created": "doc", "order.paid": "rupee",
  "payment.link": "rupee", "followup.fired": "bell", "session.started": "mic", "session.ended": "phoneOff",
  "telegram.linked": "send", "rule.decided": "spark", "rule.suggested": "spark", "error": "alert",
  "invoice.issued": "receipt", "invoice.decided": "receipt", "invoice.paid": "rupee", "receipt.recorded": "wallet",
  "stock.low": "jar", "stock.reorder_proposed": "jar", "stock.reorder_decided": "jar",
  "customer.saved": "users", "sell.settings_saved": "store",
  "account.registered": "key", "account.signed_in": "key", "account.passkey_added": "fingerprint", "account.pin_locked": "lock",
};

/** Types an owner never needs on a timeline (machine detail, or a repeat of another row). */
export const HISTORY_SKIP = new Set([
  "job.progress", "negotiation.turn", "transcript", "memory.updated", "profile.updated", "order.status",
  "rule.spoken", "approval.spoken", "invoice.spoken", "receipt.spoken", "stock.reorder_spoken", "item.tax_spoken",
  "invoice.drafted", "invoice.requested", "invoice.pay_link", "item.saved", "item.tax_confirmed", "stock.moved",
  "receipt.cancelled", "job.cancelled", "account.signed_out",
]);

const present = (v) => v !== null && v !== undefined && v !== "";
const yes = (status) => status === "approved" || status === "consumed" || status === "accepted" || status === "issued" || status === "active";

/**
 * One owner line for an audit row. fmt = { rupees(n) -> "₹1,000"|null, unit(u) -> word, byVoice, byButton }.
 * Returns null for a row that has no owner line.
 */
export function historyLine(row, fmt = {}) {
  if (!row || HISTORY_SKIP.has(row.type)) return null;
  const d = row.data && typeof row.data === "object" ? row.data : {};
  const rupees = fmt.rupees || ((n) => (present(n) ? `₹${n}` : null));
  const unit = fmt.unit || ((u) => u || "");
  const via = d.via || d.decided_via || d.decidedVia || null;
  const out = { key: `hist.${row.type}`, detail: null, tone: "", via: via === "voice" ? "voice" : via ? "button" : null, icon: HISTORY_ICON[row.type] || "spark" };
  switch (row.type) {
    case "approval.decided": {
      const ok = yes(d.status);
      return { ...out, key: ok ? "hist.approval.yes" : "hist.approval.no", tone: ok ? "ok" : "bad", icon: ok ? "check" : "x", detail: rupees(d.total_amount ?? d.totalAmount) };
    }
    case "invoice.decided": {
      const ok = yes(d.status);
      return { ...out, key: ok ? "hx.invoice.yes" : "hx.invoice.no", tone: ok ? "ok" : "bad", icon: ok ? "check" : "x", detail: d.number || null };
    }
    case "stock.reorder_decided": {
      const ok = yes(d.status);
      return { ...out, key: ok ? "hx.reorder.yes" : "hx.reorder.no", tone: ok ? "ok" : "bad" };
    }
    case "requirement.saved": {
      const q = d.requirement || d;
      return { ...out, key: q.status === "dismissed" ? "hist.requirement.dismissed" : out.key, detail: [q.quantity, unit(q.unit), q.item].filter(present).join(" ") || null };
    }
    case "vendor.found": return { ...out, detail: (d.vendor && d.vendor.name) || null, simulated: Boolean(d.vendor && d.vendor.simulated) };
    case "order.created": return { ...out, tone: "ok", detail: [d.po_number || d.poNumber, rupees(d.amount)].filter(present).join(", ") || null, simulated: Boolean(d.simulated) };
    case "order.paid": return { ...out, key: "hx.order.paid", tone: "ok", detail: [d.poNumber || d.po_number, rupees(d.amount)].filter(present).join(", ") || null };
    case "approval.requested": return { ...out, tone: "needs", detail: rupees(d.total_amount ?? d.totalAmount) };
    case "quote.recorded": return { ...out, detail: present(d.unit_price) ? `${rupees(d.unit_price)}${d.unit ? ` / ${unit(d.unit)}` : ""}` : null };
    case "followup.fired": return { ...out, detail: d.message || null };
    case "job.failed": case "error": return { ...out, tone: "bad" };
    case "rule.decided": {
      const st = d.rule && d.rule.status;
      return { ...out, key: st === "active" ? "hx.rule.kept" : "hx.rule.forgot", tone: st === "active" ? "ok" : "" };
    }
    case "invoice.issued": {
      const inv = d.invoice || {};
      return { ...out, key: "hx.invoice.issued", tone: "ok", detail: [inv.number, rupees(inv.total ?? inv.grand_total)].filter(present).join(", ") || null };
    }
    case "invoice.paid": return { ...out, key: "hx.invoice.paid", tone: "ok", detail: [d.number, present(d.amountPaise) ? rupees(Number(d.amountPaise) / 100) : null].filter(present).join(", ") || null };
    case "receipt.recorded": {
      const r = d.receipt || {};
      const name = d.customer && d.customer.name;
      return { ...out, key: "hx.receipt", tone: "ok", detail: [name, rupees(r.amount)].filter(present).join(", ") || null };
    }
    case "stock.low": return { ...out, key: "hx.stock.low", tone: "needs", detail: (d.item && d.item.name) || null };
    case "stock.reorder_proposed": return { ...out, key: "hx.reorder.asked", tone: "needs", detail: (d.item && d.item.name) || null };
    case "customer.saved": return d.created ? { ...out, key: "hx.customer.new", detail: (d.customer && d.customer.name) || null } : null;
    case "sell.settings_saved": return { ...out, key: "hx.shop.saved" };
    case "account.registered": return { ...out, key: "hx.account.made" };
    case "account.signed_in": return { ...out, key: d.via === "passkey" ? "hx.account.finger" : "hx.account.in", via: null };
    case "account.passkey_added": return { ...out, key: "hx.account.fingerAdded" };
    case "account.pin_locked": return { ...out, key: "hx.account.locked", tone: "bad", detail: null, minutes: d.minutes ?? null };
    default: return out;
  }
}

const idNum = (r) => { const n = Number(r && r.id); return Number.isFinite(n) ? n : null; };

/** Owner rows only, newest first (by id when numeric, else by time), capped. `has(key)` drops rows with no words. */
export function historyRows(audit, { has = () => true, limit = 150 } = {}) {
  const rows = [];
  for (const r of audit || []) {
    const L = historyLine(r);
    if (L && has(L.key)) rows.push(r);
  }
  rows.sort((a, b) => {
    const x = idNum(a), y = idNum(b);
    if (x !== null && y !== null) return y - x;
    return String(b.ts || "").localeCompare(String(a.ts || ""));
  });
  return rows.slice(0, limit);
}

function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Rows (already newest first) in day groups: today, yesterday, then dates. Rows without a time go last. */
export function dayGroups(rows, now = new Date()) {
  const today = localDay(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = localDay(y);
  const groups = [];
  let cur = null;
  for (const r of rows) {
    const t = r && r.ts !== undefined && r.ts !== null ? new Date(typeof r.ts === "number" && r.ts < 1e12 ? r.ts * 1000 : r.ts) : null;
    const key = t && !Number.isNaN(t.getTime()) ? localDay(t) : "unknown";
    const day = key === today ? "today" : key === yesterday ? "yesterday" : key;
    if (!cur || cur.day !== day) { cur = { day, rows: [] }; groups.push(cur); }
    cur.rows.push(r);
  }
  return groups;
}

/* Time of day in the owner's words. The browser's hi-IN format writes a Latin "am/pm" (QA #18), so
   Hindi and Kannada say the part of the day instead: morning 4-11, afternoon 12-15, evening 16-19,
   night 20-3, with a 12-hour clock. English keeps "10:30 am". */
const DAY_PART = {
  hi: ["रात", "सुबह", "दोपहर", "शाम"],
  kn: ["ರಾತ್ರಿ", "ಬೆಳಿಗ್ಗೆ", "ಮಧ್ಯಾಹ್ನ", "ಸಂಜೆ"],
};
export function dayPart(hour) {
  if (hour >= 4 && hour < 12) return 1;
  if (hour >= 12 && hour < 16) return 2;
  if (hour >= 16 && hour < 20) return 3;
  return 0;
}
export function clockWords(d, lang = "en") {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const hr = d.getHours();
  const clock = `${hr % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
  const words = DAY_PART[lang];
  if (words) return `${words[dayPart(hr)]} ${clock}`;
  return `${clock} ${hr < 12 ? "am" : "pm"}`;
}
