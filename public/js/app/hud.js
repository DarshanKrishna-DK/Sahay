// The "now doing" HUD on Sahay home: one line of what Sahay is doing (activity.js nowLine, read
// aloud with the server key `now`) and a row of tracker chips in corner brackets (the Gather-style
// HUD), each one a number the server sent: the need, the price cap, sellers found, the live
// bargaining round, the best price, decisions waiting. A tracker that has no real value is not
// drawn; nothing is invented. A chip flashes once when its value changes (not under reduced motion).

import { h, icon, patch, scripted } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { state, pendingApprovals, vendorName, isSimulatedVendor } from "./store.js";
import { pendingInvoices } from "./store-sell.js";
import { call } from "./call.js";
import { nowLine } from "./activity.js";
import { speakButton } from "./speak.js";
import { hudTrackers, liveBargain, bestQuote, inr, grouped } from "./home-model.js";

let waitingCount = null; // from waiting.js onCount once the tray exists (W3); else approvals + bills
export function setWaitingCount(n) { waitingCount = Number.isFinite(n) ? n : null; }

function per(price, unit) {
  const p = inr(price);
  return unit ? `${p}/${unitWord(unit)}` : p;
}

/** The live tracker input from the store (exported for the call dock's one-line summary). */
export function trackerInput() {
  const req = state.requirement;
  const orders = [...state.orders.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const done = req && orders[0] && String(orders[0].createdAt || "") >= String(req.createdAt || "");
  const waitingYes = waitingCount ?? (pendingApprovals().length + pendingInvoices().length);
  if (!req || done) return { requirement: null, sellers: null, bargain: null, best: null, waitingYes };
  const sellers = [...state.vendors.values()].filter((v) => !v.requirementId || !req.id || String(v.requirementId) === String(req.id)).length;
  const b = liveBargain([...state.negotiations.values()]);
  const best = b ? null : bestQuote([...state.quotes.values()], req.id);
  return {
    requirement: { quantity: req.quantity, unit: req.unit, maxPrice: req.maxPrice },
    sellers: sellers || null,
    bargain: b ? { ...b, vendor: vendorName(b.vendorId), simulated: isSimulatedVendor(b.vendorId) } : null,
    best: best ? { ...best, simulated: best.simulated || isSimulatedVendor(best.vendorId) } : null,
    waitingYes,
  };
}

function words(tr) {
  const v = tr.vars || {};
  if (tr.id === "need") return t(tr.key, { qty: `${grouped(v.qty)} ${unitWord(v.unit)}`.trim() });
  if (tr.id === "cap" || tr.id === "bargain" || tr.id === "best") return t(tr.key, { n: v.n, per: per(v.price, v.unit) });
  return t(tr.key, v);
}

export function createHud() {
  const line = h("div", { class: "sh-now" });
  const row = h("ul", { class: "sh-trackers", role: "list" });
  const el = h("section", { class: "sh-hud", "aria-label": "" }, line, row);
  const seen = new Map(); // tracker id -> last text, for the change flash

  function render() {
    el.setAttribute("aria-label", t("home.now"));
    const n = nowLine();
    const text = t(n.key, n.vars);
    patch(line, `${text}|${n.tone}|${document.documentElement.lang}`, () => [
      h("p", { class: "sh-now-line", dataset: { tone: n.tone } },
        h("span", { class: "sh-now-mark", "aria-hidden": "true" }),
        scripted("span", text, { class: "sh-now-text" })),
      speakButton("now", { size: "sm" }),
    ]);

    const list = hudTrackers(trackerInput());
    if (call.status === "live" && call.route === "proxy") list.push({ id: "route", icon: "shield", key: "home.saferOn", vars: {}, tone: "warn" });
    const items = list.map((tr) => ({ ...tr, text: words(tr) }));
    const key = JSON.stringify([document.documentElement.lang, items.map((x) => [x.id, x.text, x.tone, x.sim])]);
    const changed = new Set(items.filter((x) => seen.has(x.id) && seen.get(x.id) !== x.text).map((x) => x.id));
    patch(row, key, () => items.map((x) => h("li", { class: `sh-tracker${changed.has(x.id) ? " is-new" : ""}`, dataset: { tone: x.tone, id: x.id } },
      icon(x.icon, 18),
      scripted("span", x.text, { class: "sh-tracker-text" }),
      x.sim ? h("span", { class: "pill pill-sim sh-sim", text: t("hud.sim") }) : null)));
    seen.clear();
    for (const x of items) seen.set(x.id, x.text);
    row.hidden = items.length === 0;
  }

  return { el, update: render };
}
