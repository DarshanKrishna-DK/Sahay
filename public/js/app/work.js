// Work: what Sahay is doing for the current need, as the curved river of stations, the price
// ladder while bargaining, Listen in (receive-only) while a negotiation runs, and the earlier
// needs. Everything is rebuilt from the store, so a reload or an SSE reconnect gives the same
// river with no duplicate stations.

import { h, icon, patch, scripted, rupees, amount } from "./dom.js";
import { t, unitWord, cityWord } from "./i18n.js";
import { state, isSimulatedVendor, vendorName, dismissRequirement } from "./store.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, renderRiver, stationDetail } from "./river.js";
import { renderLadder } from "./ladder.js";
import { stateView, talkAction } from "./empty.js";
import { speakButton } from "./speak.js";
import { openSheet, closeSheet } from "./sheet.js";

const wide = matchMedia("(min-width: 900px)");

export function createWork() {
  const el = h("section", { class: "work", "aria-labelledby": "work-title" });
  const head = h("div", { class: "work-head" });
  const riverBox = h("div", { class: "river-box" });
  const listenBox = h("div", { class: "listen-box" });
  const ladderBox = h("div", { class: "ladder-box" });
  const earlier = h("div", { class: "earlier" });
  const empty = h("div", { class: "work-empty" });
  el.append(head, riverBox, listenBox, ladderBox, earlier, empty);

  const knownVendors = new Set();
  let firstRiver = true;
  let sheet = null; // { station id, api }
  const listen = { negotiationId: null, status: "idle", error: null, speakers: 0 };
  const listener = new NegotiationListener((s) => {
    Object.assign(listen, s);
    renderListen();
    if (sheet && sheet.id === "bargain" && sheet.api.isOpen()) sheet.api.setBody(bargainBody(currentModel()));
  });

  function currentModel() { return stationsFor(state.requirement); }

  function runningNegotiation(model) {
    const s = model.stations.find((x) => x.id === "bargain");
    return s && s.running ? s.negotiation : null;
  }

  function listenControl(model) {
    const n = runningNegotiation(model);
    if (!n && listen.status === "idle") return null;
    const on = listen.status !== "idle" && listen.status !== "error";
    const busy = listen.status === "connecting";
    return h("div", { class: "listen" },
      h("button", {
        class: `btn ${on ? "btn-ghost" : "btn-primary"}`, type: "button", "aria-pressed": String(on), disabled: busy ? true : undefined,
        on: { click: () => { if (on) listener.stop(); else if (n) listener.start(n.id); } },
      }, busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("headphones", 24), h("span", { text: on ? t("work.stopListen") : t("work.listen") })),
      on && !busy ? h("span", { class: "listen-live", role: "status" }, h("span", { class: "now-dot", "aria-hidden": "true" }), h("span", { text: t("work.listening") })) : null,
      listen.error ? h("p", { class: "listen-err", role: "alert" }, icon("alert", 20), h("span", { text: `${t("work.listenFail")} ${listen.error.message || ""}`.trim() })) : null);
  }

  function ladderFor(model) {
    const s = model.stations.find((x) => x.id === "bargain");
    const n = s && s.negotiation;
    if (!n) return null;
    const vid = n.vendorId;
    return renderLadder(n, { vendor: vendorName(vid) || (n.outcome && n.outcome.vendorName) || null, simulated: n.counterpart === "simulated" || isSimulatedVendor(vid) || Boolean(n.outcome && n.outcome.simulated) });
  }

  function bargainBody(model) {
    return stationDetail({ id: "bargain" }, model, state.requirement, speakButton, { ladder: ladderFor(model) || h("p", { class: "fact muted", text: t("ladder.empty") }), listen: listenControl(model) });
  }

  function onStation(s, opener) {
    const model = currentModel();
    const title = t({ heard: "st.heard", search: "st.search", bargain: "st.bargain", yes: "st.yes", ordered: "st.ordered", paid: "st.paid", reminder: "st.reminder" }[s.id]);
    const body = s.id === "bargain" ? bargainBody(model) : stationDetail(model.stations.find((x) => x.id === s.id) || s, model, state.requirement, speakButton);
    sheet = { id: s.id, api: openSheet({ title, body, opener }) };
  }

  function renderHead(req) {
    const key = JSON.stringify([req, document.documentElement.lang]);
    patch(head, key, () => {
      if (!req) return [];
      const line = [amount(req.quantity), unitWord(req.unit), req.item].filter(Boolean).join(" ");
      const meta = [
        req.maxPrice !== null && req.maxPrice !== undefined ? h("span", { class: "need-meta" }, icon("rupee", 20), h("span", { text: t("work.upTo", { p: `${rupees(req.maxPrice)}${req.unit ? `/${unitWord(req.unit)}` : ""}` }) })) : null,
        req.city ? h("span", { class: "need-meta" }, icon("pin", 20), scripted("span", cityWord(req.city))) : null,
      ];
      return [
        h("div", { class: "need" },
          h("p", { class: "need-kicker" }, icon("box", 22), h("span", { text: t("work.title") })),
          scripted("h1", line, { class: "need-title", id: "work-title" }),
          h("div", { class: "need-metas" }, ...meta)),
        speakButton(`need:${req.id}`),
      ];
    });
  }

  function renderRiverBox(model) {
    const vertical = !wide.matches;
    const fresh = new Set();
    for (const v of model.vendors) {
      const id = String(v.id);
      if (!knownVendors.has(id)) { if (!firstRiver) fresh.add(id); knownVendors.add(id); }
    }
    const key = JSON.stringify([vertical, document.documentElement.lang, model.stations.map((s) => [s.id, s.status]), model.vendors.map((v) => v.id)]);
    patch(riverBox, key, () => renderRiver(model, { vertical, onStation, freshVendorIds: fresh }));
    firstRiver = false;
  }

  function renderListen() {
    const model = currentModel();
    const c = listenControl(model);
    patch(listenBox, JSON.stringify([listen, Boolean(runningNegotiation(model)), document.documentElement.lang]), () => c || []);
  }

  function renderLadderBox(model) {
    const s = model.stations.find((x) => x.id === "bargain");
    const n = s && s.negotiation;
    const key = JSON.stringify([n && n.id, n && n.turns.length, n && n.endedAt, document.documentElement.lang]);
    patch(ladderBox, key, () => ladderFor(model) || []);
  }

  // Earlier needs, each with a small cross button (only when no work is running for it) that asks first.
  const dismissUi = new Map(); // need id -> { busy, error }
  let dismissSheet = null;

  function needLine(r) { return [amount(r.quantity), unitWord(r.unit), r.item].filter(Boolean).join(" "); }
  function needBusy(r) { return [...state.jobs.values()].some((j) => String(j.requirementId) === String(r.id) && (j.status === "running" || j.status === "queued")); }

  function dismissBody(r) {
    const ui = dismissUi.get(String(r.id)) || {};
    return [
      scripted("p", needLine(r), { class: "sheet-big" }),
      h("p", { class: "fact muted", text: t("work.dismissWhy") }),
      h("div", { class: "rule-actions" },
        h("button", { class: "yes-btn yes-btn-no", type: "button", "aria-label": t("work.dismissNo"), disabled: ui.busy ? true : undefined, on: { click: () => { closeSheet(); dismissSheet = null; } } },
          icon("x", 36), h("span", { class: "yes-btn-word", text: t("work.dismissNo") })),
        h("button", { class: "yes-btn yes-btn-yes", type: "button", "aria-label": t("work.dismissYes"), disabled: ui.busy ? true : undefined, on: { click: () => confirmDismiss(r) } },
          ui.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", 44), h("span", { class: "yes-btn-word", text: t("work.dismissYes") }))),
      ui.error ? h("p", { class: "yes-error", role: "alert" }, icon("alert", 20), h("span", { text: ui.error })) : null,
    ].filter(Boolean);
  }

  function askDismiss(r, opener) {
    dismissUi.delete(String(r.id));
    dismissSheet = { id: String(r.id), api: openSheet({ title: t("work.dismissAsk"), body: dismissBody(r), opener }) };
  }

  async function confirmDismiss(r) {
    const id = String(r.id);
    dismissUi.set(id, { busy: true });
    if (dismissSheet && dismissSheet.api.isOpen()) dismissSheet.api.setBody(dismissBody(r));
    try {
      await dismissRequirement(id);
      dismissUi.delete(id);
      closeSheet(false);
      dismissSheet = null;
      requestAnimationFrame(() => { const t0 = earlier.querySelector(".earlier-x") || main(); if (t0) t0.focus({ preventScroll: true }); });
    } catch (err) {
      const code = err && err.code;
      dismissUi.set(id, { error: code === "REQUIREMENT_BUSY" ? t("work.dismissBusy") : code === "REQUIREMENT_ORDERED" ? t("work.dismissOrdered") : t("work.dismissFail") });
      if (dismissSheet && dismissSheet.api.isOpen()) dismissSheet.api.setBody(dismissBody(r));
    }
  }

  function main() { return document.getElementById("main"); }

  function renderEarlier(req) {
    const others = state.requirements.filter((r) => r.status !== "dismissed" && (!req || String(r.id) !== String(req.id))).slice().reverse().slice(0, 8);
    const key = JSON.stringify([others.map((r) => [r.id, needBusy(r)]), document.documentElement.lang]);
    patch(earlier, key, () => others.length ? [
      h("h2", { class: "earlier-title", text: t("work.earlier") }),
      h("ul", { class: "earlier-list" }, ...others.map((r) => {
        const text = needLine(r);
        return h("li", { class: "earlier-need" },
          icon("box", 20), scripted("span", text, { class: "earlier-text" }),
          needBusy(r) ? null : h("button", {
            class: "earlier-x", type: "button", "aria-label": t("work.dismiss", { item: text }), dataset: { tip: t("work.dismissYes") },
            on: { click: (e) => askDismiss(r, e.currentTarget) },
          }, icon("x", 18)));
      })),
    ] : []);
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (!all && !parts.has("work") && !parts.has("approvals") && !parts.has("orders") && !parts.has("resize")) return;
    const req = state.requirement;
    const has = Boolean(req);
    empty.hidden = has;
    if (!has) el.classList.remove("has-ladder");
    for (const b of [head, riverBox, listenBox, ladderBox]) b.hidden = !has;
    if (!has) {
      patch(empty, `empty|${document.documentElement.lang}`, () => [
        h("h1", { class: "screen-title", id: "work-title", text: t("nav.buy") }),
        stateView({ kind: "empty", icon: "river", title: t("empty.work.title"), text: t("empty.work.text"), action: talkAction() }),
      ]);
      renderEarlier(null);
      return;
    }
    const model = currentModel();
    const bargain = model.stations.find((x) => x.id === "bargain");
    el.classList.toggle("has-ladder", Boolean(bargain && bargain.negotiation));
    renderHead(req);
    renderRiverBox(model);
    renderListen();
    renderLadderBox(model);
    renderEarlier(req);
    // The bargaining sheet follows the live price talk; other sheets keep what they showed.
    if (sheet && sheet.id === "bargain" && sheet.api.isOpen()) {
      const n = runningNegotiation(model);
      const k = JSON.stringify([n && n.id, n && n.turns.length, listen.status]);
      if (k !== sheet.key) { sheet.key = k; sheet.api.setBody(bargainBody(model)); }
    }
  }

  wide.addEventListener("change", () => render(new Set(["resize"])));

  return {
    el,
    update: (_s, parts) => render(parts),
    leave() { if (listen.status !== "idle") listener.stop(); },
  };
}
