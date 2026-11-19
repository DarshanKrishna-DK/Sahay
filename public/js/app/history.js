// History: a plain timeline of what happened, from the audit rows (GET /api/state + SSE).
// One icon and one short line per step, newest first; no ids, no raw data.

import { h, icon, patch, scripted, rupees, toDate } from "./dom.js";
import { t, when, unitWord } from "./i18n.js";
import { state } from "./store.js";
import { stateView, talkAction } from "./empty.js";

const ICON = {
  "requirement.saved": "ear", "job.started": "search", "job.done": "check", "job.failed": "x",
  "vendor.found": "store", "negotiation.ended": "handshake", "quote.recorded": "tag",
  "approval.requested": "alert", "approval.decided": "check", "order.created": "doc",
  "payment.link": "rupee", "followup.fired": "bell", "session.started": "mic", "session.ended": "phoneOff",
  "telegram.linked": "send", "rule.decided": "spark", "rule.suggested": "spark", "error": "alert",
};
// Too fine-grained for an owner's timeline.
const SKIP = new Set(["job.progress", "negotiation.turn", "transcript", "memory.updated", "profile.updated", "rule.spoken", "order.status"]);

function line(r) {
  const d = r.data || {};
  let key = `hist.${r.type}`;
  let detail = null;
  let tone = "";
  if (r.type === "approval.decided") {
    const yes = d.status === "approved" || d.status === "consumed";
    key = yes ? "hist.approval.yes" : "hist.approval.no";
    tone = yes ? "ok" : "bad";
    if (d.decided_via || d.decidedVia) detail = t((d.decided_via || d.decidedVia) === "voice" ? "hist.byVoice" : "hist.byButton");
  } else if (r.type === "requirement.saved") {
    const q = d.requirement || d;
    if (q.status === "dismissed") key = "hist.requirement.dismissed";
    detail = [q.quantity, unitWord(q.unit), q.item].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
  } else if (r.type === "vendor.found") {
    detail = d.vendor && d.vendor.name ? d.vendor.name : null;
  } else if (r.type === "order.created") {
    detail = [d.po_number || d.poNumber, rupees(d.amount)].filter(Boolean).join(", ");
    tone = "ok";
  } else if (r.type === "approval.requested") {
    detail = rupees(d.total_amount ?? d.totalAmount);
    tone = "needs";
  } else if (r.type === "quote.recorded") {
    detail = d.unit_price !== undefined ? `${rupees(d.unit_price)}${d.unit ? `/${unitWord(d.unit)}` : ""}` : null;
  } else if (r.type === "followup.fired") {
    detail = d.message || null;
  } else if (r.type === "job.failed" || r.type === "error") {
    tone = "bad";
  } else if (r.type === "rule.decided" && d.rule) {
    detail = d.rule.status === "active" ? t("me.keep") : t("me.forget");
  }
  const label = t(key);
  return label === key ? null : { label, detail, tone };
}

export function createHistory() {
  const el = h("section", { class: "history", "aria-labelledby": "hist-title" });
  const head = h("div", { class: "hist-head" });
  const body = h("div", { class: "hist-body" });
  el.append(head, body);

  function render(parts) {
    if (!parts.has("all") && !parts.has("lang") && !parts.has("history")) return;
    patch(head, document.documentElement.lang, () => [
      h("a", { class: "icon-btn tip-below", href: "#/me", "aria-label": t("nav.me"), dataset: { tip: t("nav.me") } }, icon("arrowLeft", 24)),
      h("h1", { class: "screen-title", id: "hist-title", text: t("hist.title") }),
    ]);
    const rows = [...state.audit.values()].filter((r) => !SKIP.has(r.type) && line(r))
      .sort((a, b) => { const x = Number(a.id), y = Number(b.id); return Number.isFinite(x) && Number.isFinite(y) ? y - x : String(b.ts || "").localeCompare(String(a.ts || "")); })
      .slice(0, 150);
    patch(body, JSON.stringify([document.documentElement.lang, rows.map((r) => r.id)]), () => {
      if (!rows.length) return stateView({ kind: "empty", icon: "history", title: t("empty.history.title"), text: t("empty.history.text"), action: talkAction() });
      return h("ol", { class: "timeline" }, ...rows.map((r) => {
        const L = line(r);
        const d = toDate(r.ts);
        return h("li", { class: `tl-item${L.tone ? ` tl-${L.tone}` : ""}` },
          h("span", { class: "tl-dot", "aria-hidden": "true" }, icon(ICON[r.type] || "spark", 20)),
          h("div", { class: "tl-text" },
            h("p", { class: "tl-label", text: L.label }),
            L.detail ? scripted("p", String(L.detail), { class: "tl-detail" }) : null),
          d ? h("time", { class: "tl-time", datetime: d.toISOString(), text: when(d) }) : null);
      }));
    });
  }

  return { el, update: (_s, parts) => render(parts) };
}
