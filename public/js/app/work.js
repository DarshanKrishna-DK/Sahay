// Buy, the current need (UI v4, Stitch 05-buy-laptop): the page head ("Buy", the need in one line,
// Talk on the right), the steps card, the price ladder card (with Listen in, "give your yes" when
// Sahay is waiting for it, and the "ready to read" line, D9 in its foot) and the earlier needs.
// Everything is rebuilt from the store, so a reload or an SSE reconnect gives the same screen; each
// part has its own key (patch), so live price turns redraw only the ladder.

import { h, icon, patch, scripted, rupees, amount, toDate } from "./dom.js";
import { t, when, unitWord, cityWord, lang } from "./i18n.js";
import { state, dismissRequirement, retryEvents } from "./store.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, hudFor, ladderRows, earlierNeeds } from "./buy-model.js";
import { renderRiver, STATION_WORD } from "./river.js";
import { renderLadder } from "./ladder.js";
import { itemLine } from "./item-line.js";
import { pageHead } from "./ui.js";
import * as sheets from "./sheet.js";
import { btn, talkHere, simPill, testPill, stateView, skel, errLine, dateTime, itemWords } from "./buy-kit.js";

const needLine = (r) => [amount(r.quantity), unitWord(r.unit), itemWords(r.item)].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
const perUnit = (p, unit) => `${rupees(p)}${unit ? ` / ${unitWord(unit)}` : ""}`;
const langKey = () => document.documentElement.lang;

/** Open the Waiting tray (W3 listens for sahay:open-tray; README-v3 section 3). */
function openWaiting() { document.dispatchEvent(new CustomEvent("sahay:open-tray")); }

/** sheet.js: openSheet returns { close() } in v3; closeSheet() is the older way. */
function shut(api, restore = true) {
  if (api && typeof api.close === "function") api.close(restore);
  else if (typeof sheets.closeSheet === "function") sheets.closeSheet(restore);
}

export function createWork() {
  const head = h("div", { class: "b4-head-box" });
  const stale = h("div", { class: "b4-stale-box" });
  const riverBox = h("div", { class: "b4-steps-box" });
  const ladderBox = h("div", { class: "b4-ladder-box" });
  const emptyBox = h("div", { class: "b4-empty-box" });
  const earlier = h("div", { class: "b4-earlier-box" });

  const knownVendors = new Set();
  let firstRiver = true;
  let sheet = null; // { id, api, key }
  const listen = { negotiationId: null, status: "idle", error: null, speakers: 0, route: null };
  const listener = new NegotiationListener((s) => {
    Object.assign(listen, s);
    render(new Set(["listen"]));
  });

  const model = () => stationsFor(state, state.requirement);

  /* --------------------------------------------------------- Listen in -- */
  function listenControl(m) {
    const n = m.runningNegotiation;
    if (!n && (listen.status === "idle" || !listen.status)) return null;
    const busy = listen.status === "joining";
    const on = listen.status === "listening";
    const err = listen.status === "error";
    const line = busy
      ? h("p", { class: "b4-listen-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t(listen.route === "proxy" ? "talk.saferRoute" : "b3.listen.connecting") }))
      : on
        ? h("p", { class: "b4-listen-line is-on", role: "status" }, h("span", { class: "b4-live-dot", "aria-hidden": "true" }), h("span", { text: t("work.listening") }))
        : h("p", { class: "b4-listen-line" }, h("span", { text: t("b3.listen.what") }));
    return h("div", { class: `b4-listen${on ? " is-on" : ""}${busy ? " is-busy" : ""}` },
      h("span", { class: "b4-listen-ico", "aria-hidden": "true" }, icon("headphones", 22)),
      line,
      on || busy
        ? btn({ icon: "x", word: t("work.stopListen"), onClick: () => listener.stop() })
        : btn({ icon: err ? "refresh" : "headphones", word: t("work.listen"), onClick: () => { if (n) listener.start(n.id); } }),
      err ? errLine(`${t("work.listenFail")} ${(listen.error && listen.error.message) || ""}`.trim()) : null);
  }

  /** The decision buttons in the ladder's foot: give your yes (opens the tray), or "ready to read" (D9). */
  function decisionFoot(m) {
    const a = m.approval && m.approval.status === "pending" ? m.approval : null;
    if (a) {
      return h("div", { class: "b4-yes", role: "status" },
        h("p", { class: "b4-yes-text" }, icon("alert", 20), h("span", { text: t("b3.yesWaiting") })),
        btn({ icon: "check", tone: "lime", size: "lg", label: t("b3.yesWaiting"), onClick: openWaiting,
          word: a.totalAmount !== null && a.totalAmount !== undefined ? t("b4.yesCta", { p: rupees(a.totalAmount) }) : t("b4.yesCtaPlain") }));
    }
    const ready = m.quotes.length > 0 && !m.approval && !m.order && !m.runningNegotiation;
    if (ready) {
      return h("div", { class: "b4-ready" },
        h("p", { class: "b4-ready-text" }, icon("speaker", 20), h("span", { text: t("b3.ready") })),
        btn({ icon: "mic", word: t("b4.talk"), onClick: () => talkHere({ hint: "b3.hint" }) }));
    }
    return null;
  }

  function ladderFor(m, withFoot = true) {
    const n = m.negotiation;
    const lad = ladderRows(n);
    const req = state.requirement;
    const v = n && n.vendorId !== undefined && n.vendorId !== null ? state.vendors.get(String(n.vendorId)) : null;
    const vendor = (v && v.name) || (n && n.outcome && n.outcome.vendorName) || null;
    const q = req && req.quantity !== null && req.quantity !== undefined ? `${amount(req.quantity)} ${unitWord(req.unit)}`.trim() : "";
    const sub = req && req.item ? (q ? t("b4.lad.sub", { item: itemWords(req.item), q }) : itemWords(req.item)) : "";
    return renderLadder(lad, {
      negotiation: n, vendor, sub, simulated: Boolean((v && v.simulated) || (n && n.counterpart === "simulated")),
      live: Boolean(m.runningNegotiation),
      foot: withFoot ? [listenControl(m), decisionFoot(m)] : [listenControl(m)],
    });
  }

  /* --------------------------------------------------------- the sheets -- */
  const fact = (ic, text, cls = "") => (text ? h("p", { class: `b4-fact ${cls}`.trim() }, icon(ic, 22), scripted("span", String(text))) : null);

  function stationBody(id, m) {
    const req = state.requirement;
    const s = m.stations.find((x) => x.id === id);
    const out = [];
    if (id === "heard" && req) {
      out.push(scripted("p", needLine(req), { class: "b4-sheet-big" }));
      out.push(fact("rupee", req.maxPrice !== null && req.maxPrice !== undefined ? t("work.upTo", { p: perUnit(req.maxPrice, req.unit) }) : null));
      out.push(fact("pin", req.city ? cityWord(req.city) : null));
      out.push(fact("truck", req.deliveryBy ? t("b3.deliverBy", { d: req.deliveryBy }) : null));
    } else if (id === "search") {
      if (s.status === "failed" && s.job && s.job.error) out.push(errLine(String(s.job.error)));
      if (!m.vendors.length) {
        const searching = itemLine("now.searching", { item: req ? itemWords(req.item) : "" }, lang());
        out.push(h("p", { class: "b4-fact is-quiet", role: s.status === "active" ? "status" : undefined },
          s.status === "active" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("search", 22),
          h("span", { text: s.status === "active" ? t(searching.key, searching.vars) : t("work.noSellers") })));
      } else {
        out.push(h("ol", { class: "b4-seller-rows" }, ...m.vendors.slice(0, 12).map((v) => h("li", { class: `b4-seller-row${v.simulated ? " is-sim" : ""}` },
          h("span", { class: "b4-seller-ico", "aria-hidden": "true" }, icon(v.simulated ? "robot" : "store", 22)),
          h("span", { class: "b4-seller-main" },
            scripted("span", v.name || "", { class: "b4-seller-full" }),
            h("span", { class: "b4-seller-sub", text: [v.city ? cityWord(v.city) : null, v.listedPrice !== null && v.listedPrice !== undefined ? perUnit(v.listedPrice, v.listedUnit) : v.listedPriceText].filter(Boolean).join(" · ") })),
          v.simulated ? simPill() : null))));
      }
    } else if (id === "bargain") {
      out.push(ladderFor(m, false));
    } else if (id === "yes" && m.approval) {
      const a = m.approval;
      if (a.totalAmount !== null && a.totalAmount !== undefined) out.push(h("p", { class: "b4-sheet-big is-num", text: t("b3.hud.total", { p: rupees(a.totalAmount) }) }));
      if (a.readback) out.push(scripted("p", a.readback, { class: "b4-sheet-text" }));
      if (a.status === "pending") out.push(btn({ icon: "check", word: t("b4.yesCtaPlain"), label: t("b3.yesWaiting"), tone: "lime", size: "lg", onClick: () => { shut(sheet && sheet.api, false); openWaiting(); } }));
      else out.push(fact(a.status === "rejected" ? "x" : "check", `${t(a.status === "rejected" ? "hist.approval.no" : "hist.approval.yes")}${a.decidedVia ? `, ${t(a.decidedVia === "voice" ? "hist.byVoice" : "hist.byButton")}` : ""}`));
    } else if ((id === "ordered" || id === "paid") && m.order) {
      const o = m.order;
      out.push(h("p", { class: "b4-sheet-big is-num", text: rupees(o.amount) || "" }));
      out.push(fact("doc", o.poNumber, "is-mono"));
      const paid = s.status === "done" && id === "paid";
      out.push(fact(paid ? "check" : "rupee", id === "paid" ? t(paid ? "b3.paid" : "b3.unpaid") : null));
      out.push(h("div", { class: "b4-sheet-acts" },
        o.paymentUrl && !paid ? h("span", { class: "b4-pay" }, btn({ icon: "rupee", word: t("b3.pay"), tone: "lime", href: o.paymentUrl, external: true }), testPill()) : null,
        btn({ icon: "download", word: t("b3.paper"), href: o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`, external: true })));
    } else if (id === "reminder" && (m.nextFollow || m.firedFollow)) {
      const f = m.nextFollow || m.firedFollow;
      const kind = `orders.rem.${f.kind}`;
      out.push(fact("bell", t(kind) !== kind ? t(kind) : f.kind));
      const d = toDate(f.status === "fired" ? f.firedAt : f.dueAt);
      out.push(fact("clock", d ? `${t(f.status === "fired" ? "b3.reminderSent" : "b3.reminderNext")}: ${dateTime(d)}` : null));
      if (f.message) out.push(scripted("p", f.message, { class: "b4-sheet-text" }));
    } else {
      out.push(h("p", { class: "b4-fact is-quiet" }, icon("spark", 22), h("span", { text: t("b3.notYet") })));
    }
    return out.filter(Boolean);
  }

  function sheetKey(id, m) {
    return JSON.stringify([id, langKey(), m.stations.map((s) => s.status), m.vendors.length, m.negotiation && m.negotiation.turns.length, m.negotiation && m.negotiation.endedAt, listen.status, m.approval && m.approval.status, m.order && [m.order.status, m.order.paymentUrl]]);
  }

  function onStation(s, opener) {
    const m = model();
    const title = t(STATION_WORD[s.id]);
    const req = state.requirement;
    const speakKey = (s.id === "heard" || s.id === "search") && req ? `need:${req.id}` : s.id === "yes" && m.approval ? `approval:${m.approval.id}` : (s.id === "ordered" || s.id === "paid") && m.order ? `order:${m.order.id}` : null;
    sheet = { id: s.id, key: sheetKey(s.id, m), api: sheets.openSheet({ title, body: stationBody(s.id, m), opener, speakKey }) };
  }

  /* ---------------------------------------------------------- page head -- */
  function renderHead(req) {
    patch(head, JSON.stringify([req, langKey()]), () => {
      // The subtitle is the need in one plain line (quantity, item, price cap, city), or what Buy does.
      const sub = req
        ? [needLine(req),
          req.maxPrice !== null && req.maxPrice !== undefined ? t("work.upTo", { p: perUnit(req.maxPrice, req.unit) }) : null,
          req.city ? cityWord(req.city) : null].filter(Boolean).join(" · ")
        : t("b4.sub");
      const node = pageHead({
        title: t("nav.buy"), sub,
        actions: [btn({ icon: "mic", word: t("b4.talk"), label: t("b3.talkLong"), tone: "lime", size: "lg", onClick: () => talkHere({ hint: "b3.hint" }) })],
        speakKey: req ? `need:${req.id}` : undefined,
      });
      const h1 = node.querySelector("h1");
      if (h1) h1.id = "b4-title";
      return node;
    });
  }

  /* ------------------------------------------------------ earlier needs -- */
  const dismissUi = new Map(); // need id -> { busy, error }
  let dismissSheet = null;

  function dismissBody(r) {
    const ui = dismissUi.get(String(r.id)) || {};
    return [
      scripted("p", needLine(r), { class: "b4-sheet-big" }),
      h("p", { class: "b4-sheet-text", text: t("work.dismissWhy") }),
      ui.error ? errLine(ui.error) : null,
      h("div", { class: "b4-dismiss-acts" },
        btn({ icon: "arrowLeft", word: t("work.dismissNo"), size: "lg", disabled: Boolean(ui.busy), onClick: () => { shut(dismissSheet && dismissSheet.api); dismissSheet = null; } }),
        btn({ icon: "x", word: t("work.dismissYes"), tone: "coral", size: "lg", busy: Boolean(ui.busy), onClick: () => confirmDismiss(r) })),
    ].filter(Boolean);
  }

  function askDismiss(r, opener) {
    dismissUi.delete(String(r.id));
    dismissSheet = { id: String(r.id), api: sheets.openSheet({ title: t("work.dismissAsk"), body: dismissBody(r), opener }) };
  }

  async function confirmDismiss(r) {
    const id = String(r.id);
    if ((dismissUi.get(id) || {}).busy) return;
    dismissUi.set(id, { busy: true });
    if (dismissSheet && dismissSheet.api.isOpen()) dismissSheet.api.setBody(dismissBody(r));
    try {
      await dismissRequirement(id);
      dismissUi.delete(id);
      shut(dismissSheet && dismissSheet.api, false);
      dismissSheet = null;
      requestAnimationFrame(() => { const f = earlier.querySelector(".b4-x") || document.getElementById("main"); if (f) f.focus({ preventScroll: true }); });
    } catch (err) {
      const code = err && err.code;
      dismissUi.set(id, { error: code === "REQUIREMENT_BUSY" ? t("work.dismissBusy") : code === "REQUIREMENT_ORDERED" ? t("work.dismissOrdered") : (err && err.say) || t("work.dismissFail") });
      if (dismissSheet && dismissSheet.api.isOpen()) dismissSheet.api.setBody(dismissBody(r));
    }
  }

  function renderEarlier(req) {
    const rows = earlierNeeds(state, req);
    patch(earlier, JSON.stringify([rows.map((x) => [x.need.id, x.need.item, x.need.quantity, x.need.unit, x.busy]), langKey()]), () => (rows.length ? h("section", { class: "b4-earlier card", "aria-labelledby": "b4-earlier-title" },
      h("header", { class: "b4-earlier-head" },
        h("h2", { class: "b4-card-title t-h3", id: "b4-earlier-title" }, h("span", { text: t("b3.earlier") }), h("span", { class: "b4-count", text: String(rows.length) })),
        h("p", { class: "b4-card-sub", text: t("b4.earlier.sub") })),
      h("ul", { class: "b4-earlier-list" }, ...rows.map(({ need, busy }) => {
        const text = needLine(need);
        const d = toDate(need.createdAt);
        return h("li", { class: "b4-earlier-row" },
          h("span", { class: "b4-earlier-ico", "aria-hidden": "true" }, icon("box", 20)),
          h("span", { class: "b4-earlier-main" },
            scripted("span", text, { class: "b4-earlier-text" }),
            busy ? h("span", { class: "b4-earlier-sub is-busy" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t("b3.earlierBusy") }))
              : d ? h("span", { class: "b4-earlier-sub", text: when(d, { day: "numeric", month: "short" }) }) : null),
          busy ? null : h("button", {
            class: "b4-x", type: "button", "aria-label": t("work.dismiss", { item: text }), "data-tip": t("work.dismissYes"),
            on: { click: (e) => askDismiss(need, e.currentTarget) },
          }, icon("x", 20)));
      }))) : []));
  }

  /* -------------------------------------------------------------- render -- */
  function loadingShape() {
    return h("div", { class: "b4-load-shape" }, ...Array.from({ length: 7 }, () => h("span", { class: "b4-load-step" }, skel("skel-circle", "is-dot"), skel("skel-line"))));
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (!all && !["work", "approvals", "orders", "resize", "listen", "stream"].some((p) => parts.has(p))) return;
    const req = state.requirement;
    const ready = state.boot === "ready";
    patch(stale, JSON.stringify([state.stream === "closed", langKey()]), () => (state.stream === "closed" ? h("div", { class: "b4-stale", role: "status" },
      icon("wifiOff", 22), h("p", { text: t("b3.stale") }), btn({ icon: "refresh", word: t("b3.reconnect"), size: "sm", onClick: () => retryEvents() })) : []));
    renderHead(ready ? req : null);
    for (const b of [riverBox, ladderBox]) b.hidden = !ready || !req;
    emptyBox.hidden = ready && Boolean(req);
    if (!ready) {
      patch(emptyBox, `loading|${langKey()}`, () => h("div", { class: "card b4-empty-card" }, stateView({ kind: "loading", title: t("b3.loading"), skeleton: loadingShape })));
      return;
    }
    if (!req) {
      patch(emptyBox, `empty|${langKey()}`, () => h("div", { class: "card b4-empty-card" }, stateView({ kind: "empty", icon: "cart", title: t("b3.empty.title"), text: t("b3.empty.text"), action: { label: t("b3.empty.cta"), icon: "mic", run: () => talkHere({ hint: "b3.hint" }) } })));
      renderEarlier(null);
      return;
    }
    const m = model();
    const hud = hudFor(m, req);
    const fresh = new Set();
    for (const v of m.vendors) {
      const id = String(v.id);
      if (!knownVendors.has(id)) { if (!firstRiver) fresh.add(id); knownVendors.add(id); }
    }
    patch(riverBox, JSON.stringify([langKey(), req, m.stations.map((s) => s.status), m.vendors.map((v) => [v.id, v.name]), hud]), () => renderRiver(m, hud, req, { onStation, freshVendorIds: fresh }));
    firstRiver = false;
    const n = m.negotiation;
    const a = m.approval;
    patch(ladderBox, JSON.stringify([langKey(), req, n && n.id, n && n.turns.length, n && n.endedAt, n && n.outcome, Boolean(m.runningNegotiation), listen.status, listen.route, listen.error && listen.error.message, a && [a.id, a.status, a.totalAmount], m.quotes.length, Boolean(m.order)]), () => ladderFor(m));
    renderEarlier(req);
    if (sheet && sheet.api.isOpen()) {
      const k = sheetKey(sheet.id, m);
      if (k !== sheet.key) { sheet.key = k; sheet.api.setBody(stationBody(sheet.id, m)); }
    }
  }

  return {
    head, stale, riverBox, ladderBox, emptyBox, earlier,
    update: (_s, parts) => render(parts),
    leave() { if (listen.status !== "idle") listener.stop(); },
  };
}
