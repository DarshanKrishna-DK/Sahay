// The Yes card: floats over any screen while an approval is pending. Giant numbers, the
// seller (with "simulated vendor" when true), 🔊 (server readback via speak("approval:<id>")),
// and two big round buttons: the button path of the approval gate,
// POST /api/approvals/:id/decision. It leaves on approval.decided from SSE, so a decision in
// another tab (or by voice) closes it here too.

import { h, icon, fill, rupees, amount, scripted } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import * as api from "../api.js";
import { state, pendingApprovals, approvalView, touch } from "./store.js";
import { speakButton } from "./speak.js";

export function createYesLayer() {
  const el = h("div", { class: "yes-layer" });
  const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
  const ui = new Map();     // approvalId -> { busy: "approve"|"reject", error }
  const later = new Set();  // approvals the owner put aside with "Later"
  let index = 0;
  let lastKey = "";
  let announced = new Set();
  el.append(live);
  const body = h("div", { class: "yes-body" });
  el.append(body);

  async function decide(id, decision) {
    ui.set(id, { busy: decision });
    render(true);
    try {
      const res = await api.decideApproval(id, decision);
      const a = state.approvals.get(String(id));
      if (a) { a.status = (res && res.status) || (decision === "approve" ? "approved" : "rejected"); a.decidedVia = "button"; }
      ui.delete(id);
      touch("approvals", "work");
    } catch (err) {
      if (err.status === 409) {
        ui.set(id, { error: t("yes.gone") });
      } else {
        ui.set(id, { error: `${t("yes.error")} ${err.say || err.message || ""}`.trim() });
      }
      render(true);
    }
  }

  function card(v, n, total) {
    const a = v.approval;
    const id = String(a.id);
    const u = ui.get(id) || {};
    const per = v.unitPrice !== null && v.unitPrice !== undefined ? `${rupees(v.unitPrice)}${v.unit ? `/${unitWord(v.unit)}` : ""}` : null;
    const qty = v.quantity !== null && v.quantity !== undefined ? `${amount(v.quantity)}${v.unit ? ` ${unitWord(v.unit)}` : ""}` : null;
    const titleId = `yes-title-${id}`;
    return h("section", { class: "yes-card glass", role: "region", "aria-labelledby": titleId, dataset: { id } },
      h("div", { class: "yes-head" },
        h("span", { class: "yes-pulse", "aria-hidden": "true" }),
        h("h2", { class: "yes-title", id: titleId, tabindex: "-1", text: t("yes.title") }),
        total > 1 ? h("span", { class: "yes-count", text: `${n}/${total}` }) : null,
        speakButton(`approval:${id}`, { size: "sm" }),
        h("button", { class: "btn btn-ghost btn-sm yes-later", type: "button", on: { click: () => { later.add(id); render(); } } }, h("span", { text: t("yes.later") }))),
      h("div", { class: "yes-who" },
        h("span", { class: "yes-who-ico", "aria-hidden": "true" }, icon("store", 22)),
        v.vendor ? scripted("span", v.vendor, { class: "yes-vendor" }) : null,
        v.simulated ? h("span", { class: "sim-pill" }, icon("robot", 16), h("span", { text: t("simulated") })) : null),
      h("div", { class: "yes-sum" },
        per || qty ? h("p", { class: "yes-eq" },
          per ? h("span", { text: per }) : null,
          per && qty ? h("span", { class: "yes-op", "aria-hidden": "true", text: "×" }) : null,
          qty ? h("span", { text: qty }) : null) : null,
        v.total !== null && v.total !== undefined
          ? h("p", { class: "yes-total" }, h("span", { class: "yes-total-label", text: t("yes.total") }), h("span", { class: "yes-total-num", text: rupees(v.total) }))
          : null,
        v.leadTimeDays !== null && v.leadTimeDays !== undefined ? h("p", { class: "yes-meta" }, icon("truck", 20), h("span", { text: t("yes.delivery", { n: v.leadTimeDays }) })) : null,
        a.readback ? scripted("p", a.readback, { class: "yes-readback" }) : null),
      u.error ? h("p", { class: "yes-error", role: "alert" }, icon("alert", 20), h("span", { text: u.error })) : null,
      h("div", { class: "yes-actions" },
        h("button", {
          class: "yes-btn yes-btn-no", type: "button", "aria-label": t("yes.rejectLong"), disabled: u.busy ? true : undefined,
          on: { click: () => decide(id, "reject") },
        }, u.busy === "reject" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("x", 40), h("span", { class: "yes-btn-word", text: t("yes.reject") })),
        h("button", {
          class: "yes-btn yes-btn-yes", type: "button", "aria-label": t("yes.approveLong"), disabled: u.busy ? true : undefined,
          on: { click: () => decide(id, "approve") },
        }, u.busy === "approve" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", 48), h("span", { class: "yes-btn-word", text: t("yes.approve") }))),
      u.busy ? h("p", { class: "sr-only", role: "status", text: t("yes.saving") }) : null);
  }

  function render(force = false) {
    const pending = pendingApprovals();
    // Forget UI state of approvals that are no longer pending (decided here, elsewhere or by voice).
    for (const id of [...ui.keys()]) if (!pending.some((a) => String(a.id) === id)) ui.delete(id);
    const shown = pending.filter((a) => !later.has(String(a.id)));
    if (index >= shown.length) index = 0;
    const key = JSON.stringify([state.boot, shown.map((a) => [a.id, a.readback, a.totalAmount]), [...ui.entries()], later.size, pending.length, index, document.documentElement.lang, state.quotes.size]);
    if (!force && key === lastKey) return;
    lastKey = key;
    for (const a of pending) {
      if (!announced.has(String(a.id))) { announced.add(String(a.id)); live.textContent = t("yes.title"); }
    }
    if (state.boot !== "ready" || pending.length === 0) { fill(body); el.dataset.mode = "none"; return; }
    if (shown.length === 0) {
      el.dataset.mode = "mini";
      fill(body, h("button", { class: "yes-mini", type: "button", on: { click: () => { later.clear(); render(); focusCard(); } } },
        h("span", { class: "yes-pulse", "aria-hidden": "true" }), icon("check", 22), h("span", { text: t("yes.pending", { n: pending.length }) })));
      return;
    }
    el.dataset.mode = "card";
    const v = approvalView(shown[index]);
    fill(body, card(v, index + 1, shown.length));
  }

  function focusCard() {
    requestAnimationFrame(() => { const t2 = el.querySelector(".yes-title"); if (t2) t2.focus(); });
  }

  return {
    el,
    update(parts) {
      if (parts.has("approvals") || parts.has("work") || parts.has("boot") || parts.has("lang") || parts.has("all")) render(parts.has("lang"));
    },
    openFirst() { later.clear(); index = 0; render(true); focusCard(); },
  };
}
