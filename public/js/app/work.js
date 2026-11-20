// The current need on Buy (UI v3): need header (quantity, unit and city in the owner's script,
// price cap, delivery), the work river with HUD trackers, the price ladder with Listen in, the
// "your yes is waiting" and "ready to read" lines (D9), and the earlier needs with dismiss.
// Everything is rebuilt from the store, so a reload or an SSE reconnect gives the same screen.
// Each part has its own key (patch), so live price turns redraw only the ladder.

import { h, icon, patch, scripted, rupees, amount, toDate } from "./dom.js";
import { t, when, unitWord, cityWord, lang } from "./i18n.js";
import { state, dismissRequirement, retryEvents } from "./store.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, hudFor, ladderRows, earlierNeeds } from "./buy-model.js";
import { renderRiver, STATION_WORD } from "./river.js";
import { renderLadder } from "./ladder.js";
import { itemLine } from "./item-line.js";
import { speakButton } from "./speak.js";
import * as sheets from "./sheet.js";
import { btn, talkChip, simPill, testPill, stateView, skel, errLine, dateTime, itemWords } from "./buy-kit.js";

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
  const el = h("div", { class: "b3-work" });
  const head = h("header", { class: "screen-head b3-need" });
  const stale = h("div", { class: "b3-stale-box" });
  const riverBox = h("div", { class: "b3-river-box" });
  const yesBox = h("div", { class: "b3-yes-box" });
  const readyBox = h("div", { class: "b3-ready-box" });
  const ladderBox = h("div", { class: "b3-ladder-box" });
  const emptyBox = h("div", { class: "b3-empty-box" });
  const earlier = h("div", { class: "b3-earlier-box" });

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
      ? h("p", { class: "b3-listen-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t(listen.route === "proxy" ? "talk.saferRoute" : "b3.listen.connecting") }))
      : on
        ? h("p", { class: "b3-listen-line is-on", role: "status" }, h("span", { class: "b3-live-dot", "aria-hidden": "true" }), h("span", { text: t("work.listening") }))
        : h("p", { class: "b3-listen-line" }, h("span", { text: t("b3.listen.what") }));
    return h("div", { class: `b3-listen${on ? " is-on" : ""}${busy ? " is-busy" : ""}` },
      on || busy
        ? btn({ icon: "x", word: t("work.stopListen"), onClick: () => listener.stop() })
        : btn({ icon: err ? "refresh" : "headphones", word: t("work.listen"), tone: "lime", onClick: () => { if (n) listener.start(n.id); }, cls: n ? "" : "is-off" }),
      line,
      err ? errLine(`${t("work.listenFail")} ${(listen.error && listen.error.message) || ""}`.trim()) : null);
  }

  function ladderFor(m) {
    const n = m.negotiation;
    const lad = ladderRows(n);
    const v = n && n.vendorId !== undefined && n.vendorId !== null ? state.vendors.get(String(n.vendorId)) : null;
    const vendor = (v && v.name) || (n && n.outcome && n.outcome.vendorName) || null;
    return renderLadder(lad, {
      negotiation: n, vendor, simulated: Boolean((v && v.simulated) || (n && n.counterpart === "simulated")),
      live: Boolean(m.runningNegotiation), listen: listenControl(m),
    });
  }

  /* --------------------------------------------------------- the sheets -- */
  const fact = (ic, text, cls = "") => (text ? h("p", { class: `b3-fact ${cls}`.trim() }, icon(ic, 22), scripted("span", String(text))) : null);

  function stationBody(id, m) {
    const req = state.requirement;
    const s = m.stations.find((x) => x.id === id);
    const out = [];
    if (id === "heard" && req) {
      out.push(scripted("p", needLine(req), { class: "b3-sheet-big" }));
      out.push(fact("rupee", req.maxPrice !== null && req.maxPrice !== undefined ? t("work.upTo", { p: perUnit(req.maxPrice, req.unit) }) : null));
      out.push(fact("pin", req.city ? cityWord(req.city) : null));
      out.push(fact("truck", req.deliveryBy ? t("b3.deliverBy", { d: req.deliveryBy }) : null));
    } else if (id === "search") {
      if (s.status === "failed" && s.job && s.job.error) out.push(errLine(String(s.job.error)));
      if (!m.vendors.length) {
        const searching = itemLine("now.searching", { item: req ? itemWords(req.item) : "" }, lang());
        out.push(h("p", { class: "b3-fact is-quiet", role: s.status === "active" ? "status" : undefined },
          s.status === "active" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("search", 22),
          h("span", { text: s.status === "active" ? t(searching.key, searching.vars) : t("work.noSellers") })));
      } else {
        out.push(h("ol", { class: "b3-seller-rows" }, ...m.vendors.slice(0, 12).map((v) => h("li", { class: `b3-seller-row${v.simulated ? " is-sim" : ""}` },
          h("span", { class: "b3-seller-ico", "aria-hidden": "true" }, icon(v.simulated ? "robot" : "store", 22)),
          h("span", { class: "b3-seller-main" },
            scripted("span", v.name || "", { class: "b3-seller-full" }),
            h("span", { class: "b3-seller-sub", text: [v.city ? cityWord(v.city) : null, v.listedPrice !== null && v.listedPrice !== undefined ? perUnit(v.listedPrice, v.listedUnit) : v.listedPriceText].filter(Boolean).join(" · ") })),
          v.simulated ? simPill() : null))));
      }
    } else if (id === "bargain") {
      out.push(ladderFor(m));
    } else if (id === "yes" && m.approval) {
      const a = m.approval;
      if (a.totalAmount !== null && a.totalAmount !== undefined) out.push(h("p", { class: "b3-sheet-big is-num", text: t("b3.hud.total", { p: rupees(a.totalAmount) }) }));
      if (a.readback) out.push(scripted("p", a.readback, { class: "b3-sheet-text" }));
      if (a.status === "pending") out.push(btn({ icon: "check", word: t("b3.yesOpen"), label: t("b3.yesWaiting"), tone: "lime", size: "lg", onClick: () => { shut(sheet && sheet.api, false); openWaiting(); } }));
      else out.push(fact(a.status === "rejected" ? "x" : "check", `${t(a.status === "rejected" ? "hist.approval.no" : "hist.approval.yes")}${a.decidedVia ? `, ${t(a.decidedVia === "voice" ? "hist.byVoice" : "hist.byButton")}` : ""}`));
    } else if ((id === "ordered" || id === "paid") && m.order) {
      const o = m.order;
      out.push(h("p", { class: "b3-sheet-big is-num", text: rupees(o.amount) || "" }));
      out.push(fact("doc", o.poNumber, "is-mono"));
      const paid = s.status === "done" && id === "paid";
      out.push(fact(paid ? "check" : "rupee", id === "paid" ? t(paid ? "b3.paid" : "b3.unpaid") : null));
      out.push(h("div", { class: "b3-sheet-acts" },
        o.paymentUrl && !paid ? h("span", { class: "b3-pay" }, btn({ icon: "rupee", word: t("b3.pay"), tone: "lime", href: o.paymentUrl, external: true }), testPill()) : null,
        btn({ icon: "download", word: t("b3.paper"), href: o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`, external: true })));
    } else if (id === "reminder" && (m.nextFollow || m.firedFollow)) {
      const f = m.nextFollow || m.firedFollow;
      const kind = `orders.rem.${f.kind}`;
      out.push(fact("bell", t(kind) !== kind ? t(kind) : f.kind));
      const d = toDate(f.status === "fired" ? f.firedAt : f.dueAt);
      out.push(fact("history", d ? `${t(f.status === "fired" ? "b3.reminderSent" : "b3.reminderNext")}: ${dateTime(d)}` : null));
      if (f.message) out.push(scripted("p", f.message, { class: "b3-sheet-text" }));
    } else {
      out.push(h("p", { class: "b3-fact is-quiet" }, icon("spark", 22), h("span", { text: t("b3.notYet") })));
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

  /* -------------------------------------------------------- need header -- */
  function renderHead(req) {
    patch(head, JSON.stringify([req, langKey()]), () => {
      if (!req) {
        return [
          h("div", { class: "b3-need-main" },
            h("h1", { class: "screen-title b3-need-title is-screen", id: "b3-title", text: t("nav.buy") })),
          h("div", { class: "screen-head-tools b3-need-side" }, talkChip({ label: t("b3.talkLong"), hint: "b3.hint" })),
        ];
      }
      const chips = [
        req.maxPrice !== null && req.maxPrice !== undefined ? h("li", { class: "b3-chip is-cap" }, icon("rupee", 18), h("span", { text: t("work.upTo", { p: perUnit(req.maxPrice, req.unit) }) })) : null,
        req.city ? h("li", { class: "b3-chip" }, icon("pin", 18), scripted("span", cityWord(req.city))) : null,
        req.deliveryBy ? h("li", { class: "b3-chip" }, icon("truck", 18), scripted("span", t("b3.deliverBy", { d: req.deliveryBy }))) : null,
      ].filter(Boolean);
      return [
        h("div", { class: "b3-need-main" },
          h("p", { class: "b3-kicker" }, icon("cart", 18), h("span", { text: t("b3.need") })),
          scripted("h1", needLine(req), { class: "screen-title b3-need-title", id: "b3-title" }),
          chips.length ? h("ul", { class: "b3-chips" }, ...chips) : null),
        h("div", { class: "screen-head-tools b3-need-side" },
          speakButton(`need:${req.id}`),
          talkChip({ label: t("b3.talkLong"), hint: "b3.hint" })),
      ];
    });
  }

  /* ------------------------------------------------- yes / ready lines -- */
  function renderLines(m) {
    const a = m.approval && m.approval.status === "pending" ? m.approval : null;
    patch(yesBox, JSON.stringify([a && [a.id, a.totalAmount], langKey()]), () => (a ? h("div", { class: "b3-yesline card card-alert", role: "status" },
      h("span", { class: "b3-yesline-ico", "aria-hidden": "true" }, icon("alert", 24)),
      h("p", { class: "b3-yesline-text" },
        h("span", { class: "b3-yesline-word", text: t("b3.yesWaiting") }),
        a.totalAmount !== null && a.totalAmount !== undefined ? h("span", { class: "b3-yesline-amt", text: t("b3.hud.total", { p: rupees(a.totalAmount) }) }) : null),
      btn({ icon: "check", word: t("b3.yesOpen"), label: t("b3.yesWaiting"), tone: "lime", onClick: openWaiting })) : []));
    // D9: a deal exists for this need but Sahay has not asked for the yes yet.
    const ready = m.quotes.length > 0 && !m.approval && !m.order && !m.runningNegotiation;
    patch(readyBox, JSON.stringify([ready, langKey()]), () => (ready ? h("div", { class: "b3-ready" },
      h("span", { class: "b3-ready-ico", "aria-hidden": "true" }, icon("speaker", 22)),
      h("p", { class: "b3-ready-text", text: t("b3.ready") }),
      talkChip({ label: t("b3.talkLong"), hint: "b3.hint", cls: "is-sm" })) : []));
  }

  /* ------------------------------------------------------ earlier needs -- */
  const dismissUi = new Map(); // need id -> { busy, error }
  let dismissSheet = null;

  function dismissBody(r) {
    const ui = dismissUi.get(String(r.id)) || {};
    return [
      scripted("p", needLine(r), { class: "b3-sheet-big" }),
      h("p", { class: "b3-sheet-text", text: t("work.dismissWhy") }),
      ui.error ? errLine(ui.error) : null,
      h("div", { class: "b3-dismiss-acts" },
        (() => { const keep = btn({ icon: "arrowLeft", word: t("work.dismissNo"), size: "lg", onClick: () => { shut(dismissSheet && dismissSheet.api); dismissSheet = null; } }); if (ui.busy) keep.disabled = true; return keep; })(),
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
      requestAnimationFrame(() => { const f = earlier.querySelector(".b3-x") || document.getElementById("main"); if (f) f.focus({ preventScroll: true }); });
    } catch (err) {
      const code = err && err.code;
      dismissUi.set(id, { error: code === "REQUIREMENT_BUSY" ? t("work.dismissBusy") : code === "REQUIREMENT_ORDERED" ? t("work.dismissOrdered") : (err && err.say) || t("work.dismissFail") });
      if (dismissSheet && dismissSheet.api.isOpen()) dismissSheet.api.setBody(dismissBody(r));
    }
  }

  function renderEarlier(req) {
    const rows = earlierNeeds(state, req);
    patch(earlier, JSON.stringify([rows.map((x) => [x.need.id, x.need.item, x.need.quantity, x.need.unit, x.busy]), langKey()]), () => (rows.length ? h("details", { class: "b3-earlier fold" },
      h("summary", { class: "fold-head" }, icon("history", 20), h("span", { text: t("b3.earlier") }), h("span", { class: "fold-count", text: String(rows.length) })),
      h("ul", { class: "b3-earlier-list" }, ...rows.map(({ need, busy }) => {
        const text = needLine(need);
        const d = toDate(need.createdAt);
        return h("li", { class: "b3-earlier-row" },
          h("span", { class: "b3-earlier-ico", "aria-hidden": "true" }, icon("box", 20)),
          h("span", { class: "b3-earlier-main" },
            scripted("span", text, { class: "b3-earlier-text" }),
            busy ? h("span", { class: "b3-earlier-sub is-busy" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t("b3.earlierBusy") }))
              : d ? h("span", { class: "b3-earlier-sub", text: when(d, { day: "numeric", month: "short" }) }) : null),
          busy ? null : h("button", {
            class: "b3-x", type: "button", "aria-label": t("work.dismiss", { item: text }), title: t("work.dismissYes"),
            on: { click: (e) => askDismiss(need, e.currentTarget) },
          }, icon("x", 20)));
      }))) : []));
  }

  /* -------------------------------------------------------------- render -- */
  function loadingShape() {
    return h("div", { class: "b3-load-shape" },
      h("div", { class: "b3-load-head" }, skel("skel-line", "is-short"), skel("skel-line", "is-title")),
      h("div", { class: "b3-load-river" }, ...Array.from({ length: 7 }, () => skel("skel-circle", "is-dot"))));
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (!all && !["work", "approvals", "orders", "resize", "listen", "stream"].some((p) => parts.has(p))) return;
    const req = state.requirement;
    const ready = state.boot === "ready";
    patch(stale, JSON.stringify([state.stream === "closed", langKey()]), () => (state.stream === "closed" ? h("div", { class: "b3-stale", role: "status" },
      icon("wifi", 22), h("p", { text: t("b3.stale") }), btn({ icon: "refresh", word: t("b3.reconnect"), size: "sm", onClick: () => retryEvents() })) : []));
    renderHead(ready ? req : null);
    el.dataset.state = !ready ? "loading" : req ? "need" : "empty";
    for (const b of [riverBox, yesBox, readyBox, ladderBox]) b.hidden = !ready || !req;
    emptyBox.hidden = ready && Boolean(req);
    if (!ready) {
      patch(emptyBox, `loading|${langKey()}`, () => stateView({ kind: "loading", title: t("b3.loading"), skeleton: loadingShape }));
      return;
    }
    if (!req) {
      patch(emptyBox, `empty|${langKey()}`, () => stateView({ kind: "empty", icon: "cart", title: t("b3.empty.title"), text: t("b3.empty.text"), action: { label: t("b3.empty.cta"), icon: "mic", run: () => document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: "b3.hint" } })) } }));
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
    patch(riverBox, JSON.stringify([langKey(), m.stations.map((s) => s.status), m.vendors.map((v) => [v.id, v.name]), hud]), () => renderRiver(m, hud, { onStation, freshVendorIds: fresh }));
    firstRiver = false;
    renderLines(m);
    const n = m.negotiation;
    patch(ladderBox, JSON.stringify([langKey(), n && n.id, n && n.turns.length, n && n.endedAt, n && n.outcome, Boolean(m.runningNegotiation), listen.status, listen.route, listen.error && listen.error.message, m.stations[2].status]), () => ladderFor(m));
    renderEarlier(req);
    if (sheet && sheet.api.isOpen()) {
      const k = sheetKey(sheet.id, m);
      if (k !== sheet.key) { sheet.key = k; sheet.api.setBody(stationBody(sheet.id, m)); }
    }
  }

  return {
    el, head, stale, riverBox, yesBox, readyBox, ladderBox, emptyBox, earlier,
    update: (_s, parts) => render(parts),
    leave() { if (listen.status !== "idle") listener.stop(); },
  };
}
