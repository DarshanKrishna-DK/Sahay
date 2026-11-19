// Work: what Sahay is doing for the current need, as the curved river of stations, the price
// ladder while bargaining, Listen in (receive-only) while a negotiation runs, and the earlier
// needs. Everything is rebuilt from the store, so a reload or an SSE reconnect gives the same
// river with no duplicate stations.

import { h, icon, patch, scripted, rupees, amount } from "./dom.js";
import { t } from "./i18n.js";
import { state, isSimulatedVendor, vendorName } from "./store.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, renderRiver, stationDetail } from "./river.js";
import { renderLadder } from "./ladder.js";
import { stateView, talkAction } from "./empty.js";
import { speakButton } from "./speak.js";
import { openSheet } from "./sheet.js";

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
      const line = [amount(req.quantity), req.unit, req.item].filter(Boolean).join(" ");
      const meta = [
        req.maxPrice !== null && req.maxPrice !== undefined ? h("span", { class: "need-meta" }, icon("rupee", 20), h("span", { text: t("work.upTo", { p: `${rupees(req.maxPrice)}${req.unit ? `/${req.unit}` : ""}` }) })) : null,
        req.city ? h("span", { class: "need-meta" }, icon("pin", 20), scripted("span", req.city)) : null,
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

  function renderEarlier(req) {
    const others = state.requirements.filter((r) => !req || String(r.id) !== String(req.id)).slice().reverse();
    patch(earlier, JSON.stringify([others.map((r) => r.id), document.documentElement.lang]), () => others.length ? [
      h("h2", { class: "earlier-title", text: t("work.earlier") }),
      h("ul", { class: "earlier-list" }, ...others.slice(0, 8).map((r) => h("li", { class: "earlier-need" },
        icon("box", 20), scripted("span", [amount(r.quantity), r.unit, r.item].filter(Boolean).join(" "))))),
    ] : []);
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (!all && !parts.has("work") && !parts.has("approvals") && !parts.has("orders") && !parts.has("resize")) return;
    const req = state.requirement;
    const has = Boolean(req);
    empty.hidden = has;
    for (const b of [head, riverBox, listenBox, ladderBox]) b.hidden = !has;
    if (!has) {
      patch(empty, `empty|${document.documentElement.lang}`, () => [
        h("h1", { class: "screen-title", id: "work-title", text: t("nav.work") }),
        stateView({ kind: "empty", icon: "river", title: t("empty.work.title"), text: t("empty.work.text"), action: talkAction() }),
      ]);
      renderEarlier(null);
      return;
    }
    const model = currentModel();
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
