// Stock (UI v3): every item as a glass jar filled to what is on hand, with its reorder line.
// Low items come first (coral jar, alert icon and the word "Low"; never colour alone). On hand is
// a big number with the unit in the owner's script. Each jar: read aloud (item:<id>), "Buy more"
// (asks Sahay; the buying flow and its yes gate do the rest), an "on the way" chip when an open
// purchase order brings more of it (links to the order on Buy, D2), and Sahay's "buy more?"
// question inline. The question card itself is W3's YesCard (waiting.js renderCard, place
// "inline"); until that module is there, a small yes / no card with the same route stands in.
// Open purchase orders are listed under "On the way" with Arrived (POST /api/orders/:id/delivered).

import { h, icon, patch, svgEl, amount, scripted, rupees } from "./dom.js";
import { t, unitWord, lang } from "./i18n.js";
import { state as appState } from "./store.js";
import { stock, loadStock, openOrders, markDelivered, decideReorder } from "./store-sell.js";
import { scriptOf } from "../voice.js";
import { speakButton } from "./speak.js";
import { notifyReorder, notifyNotNow, notifyNeedSaved } from "./moments.js";
import { notify } from "./toast.js";
import { jarLevels, shelves, incomingByItem, stockCounts, isLow } from "./stock-model.js";
import { orderFacts } from "./buy-model.js";
import { yesNo } from "./ui.js";
import { ensureCss, btn, talkChip, talkHere, simPill, stateView, skel, errorWords, errLine } from "./buy-kit.js";

const qty = (q, unit) => { const n = amount(q); if (n === null) return ""; const u = unitWord(unit); return u ? `${n} ${u}` : n; };

/** The item's name in the owner's script when Sahay has it, else as stored. */
function nameOf(it) {
  if (!it) return "";
  const L = lang();
  if (it.nameNative && L !== "en" && scriptOf(it.nameNative) === L) return it.nameNative;
  return it.name || it.nameNative || "";
}

/* ------------------------------------------------------------- W3 hook -- */
let waiting = null; // waiting.js once it loads (W3's YesCard renderer)
let waitingTried = false;
function loadWaiting(onReady) {
  if (waitingTried) return;
  waitingTried = true;
  import("./waiting.js").then((m) => {
    if (!m || typeof m.renderCard !== "function") return;
    waiting = m;
    // A reorder question that reaches the tray after the jar was drawn swaps the stand-in for W3's card.
    if (typeof m.onCount === "function") m.onCount(() => onReady());
    else onReady();
  }).catch(() => {});
}
function inlineCard(proposalId) {
  if (!waiting || !proposalId || typeof waiting.waitingItems !== "function") return null;
  const item = waiting.waitingItems().find((x) => x && x.key === `reorder:${proposalId}`);
  if (!item) return null;
  try { return waiting.renderCard(item, { place: "inline" }); } catch { return null; }
}

/* ------------------------------------------------------------------ jar -- */

// A jar 100 x 132: lid, shoulder, body. Liquid is clipped to the body; the reorder line is dashed.
const BODY = "M30 24h40v6c0 4 16 8 16 20v62a14 14 0 0 1-14 14H28a14 14 0 0 1-14-14V50c0-12 16-16 16-20z";
const IN_TOP = 34, IN_BOTTOM = 124;
let jarSeq = 0;

function jarSvg(it, low) {
  const id = `s3-jar-${++jarSeq}`;
  const { fill, line } = jarLevels(it);
  const y = IN_BOTTOM - (IN_BOTTOM - IN_TOP) * fill;
  const svg = svgEl("svg", { class: `s3-jar${low ? " is-low" : ""}`, viewBox: "0 0 100 132", "aria-hidden": "true", focusable: "false" });
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: `${id}-c` });
  clip.append(svgEl("path", { d: BODY }));
  const grad = svgEl("linearGradient", { id: `${id}-g`, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl("stop", { offset: 0, class: "s3-liq-top" }), svgEl("stop", { offset: 1, class: "s3-liq-bottom" }));
  defs.append(clip, grad);
  const inside = svgEl("g", { "clip-path": `url(#${id}-c)` });
  inside.append(svgEl("rect", { class: "s3-jar-well", x: 0, y: 0, width: 100, height: 132 }));
  if (fill > 0) {
    inside.append(
      svgEl("rect", { class: "s3-liq", x: 0, y: y.toFixed(1), width: 100, height: (132 - y).toFixed(1), fill: `url(#${id}-g)` }),
      svgEl("rect", { class: "s3-liq-surface", x: 0, y: y.toFixed(1), width: 100, height: 2.5 }));
  }
  inside.append(svgEl("rect", { class: "s3-jar-shine", x: 22, y: 48, width: 6, height: 58, rx: 3 }));
  svg.append(defs,
    svgEl("rect", { class: "s3-jar-lid", x: 26, y: 6, width: 48, height: 14, rx: 5 }),
    svgEl("rect", { class: "s3-jar-lid-lip", x: 26, y: 17, width: 48, height: 3, rx: 1.5 }),
    inside,
    svgEl("path", { class: "s3-jar-glass", d: BODY }));
  if (line !== null) {
    const ly = (IN_BOTTOM - (IN_BOTTOM - IN_TOP) * line).toFixed(1);
    svg.append(svgEl("line", { class: "s3-jar-line", x1: 8, x2: 92, y1: ly, y2: ly }),
      svgEl("circle", { class: "s3-jar-line-end", cx: 92, cy: ly, r: 3 }));
  }
  return svg;
}

/* ------------------------------------------------- the "buy more?" card -- */

function fallbackQuestion(it, prop, ask, onAnswer) {
  const name = nameOf(it);
  const q = prop.quantity ? qty(prop.quantity, prop.unit || it.unit) : null;
  return h("div", { class: "s3-ask" },
    h("p", { class: "s3-ask-q" }, icon("spark", 20), h("span", { text: q ? t("s3.proposed", { q }) : t("s3.proposedItem") })),
    h("p", { class: "s3-ask-why", text: t("s3.proposedWhy") }),
    ask.error ? errLine(ask.error) : null,
    prop.id
      ? yesNo({ size: "md", busy: ask.busy || null, yesWord: t("s3.yes"), noWord: t("s3.no"),
        yesLabel: t("s3.proposedYes", { item: name }), noLabel: t("s3.proposedNo"),
        onYes: () => onAnswer(it.id, "yes"), onNo: () => onAnswer(it.id, "no") })
      : btn({ icon: "mic", word: t("s3.answer"), tone: "lime", onClick: () => talkHere({ hint: "s3.buyHint" }) }));
}

/* ------------------------------------------------------------- the jar card -- */

function jarCard(it, { asks, onAnswer, incoming }) {
  const low = isLow(it);
  const name = nameOf(it);
  const prop = stock.proposals.get(String(it.id));
  const level = it.reorderLevel !== null && it.reorderLevel !== undefined && it.reorderLevel > 0 ? qty(it.reorderLevel, it.unit) : null;
  const coming = incoming.get(String(it.id)) || [];
  const comingQty = coming.length === 1 && coming[0].quantity !== null ? qty(coming[0].quantity, coming[0].unit || it.unit) : null;
  const comingTotal = coming.length > 1 && coming.every((c) => c.quantity !== null && (c.unit || it.unit) === (coming[0].unit || it.unit))
    ? qty(coming.reduce((s, c) => s + c.quantity, 0), coming[0].unit || it.unit) : comingQty;
  const card = prop ? (inlineCard(prop.id) || fallbackQuestion(it, prop, asks.get(String(it.id)) || {}, onAnswer)) : null;
  return h("li", { class: `s3-item${low ? " is-low" : ""}${prop ? " has-ask" : ""}` },
    h("article", { class: `s3-card card${low ? " card-alert" : ""}`, "aria-label": name },
      h("span", { class: "card-speak s3-card-speak" }, speakButton(`item:${it.id}`)),
      h("div", { class: "s3-jar-wrap" }, jarSvg(it, low),
        low ? h("span", { class: "s3-low-tag" }, icon("alert", 16), h("span", { text: t("s3.lowWord") })) : null),
      h("div", { class: "s3-card-main" },
        scripted("h3", name, { class: "s3-name" }),
        h("p", { class: "s3-onhand" },
          h("span", { class: "s3-onhand-num", text: amount(it.onHand ?? 0) ?? "0" }),
          h("span", { class: "s3-onhand-unit", text: unitWord(it.unit) })),
        h("p", { class: `s3-level${level ? "" : " is-none"}` },
          h("span", { class: "s3-level-swatch", "aria-hidden": "true" }),
          h("span", { text: level ? t("s3.reorderAt", { q: level }) : t("s3.noLevel") })),
        coming.length ? h("a", { class: "s3-coming-chip", href: "#/buy", "aria-label": t("s3.incomingLong", { q: comingTotal || t("s3.order") }) },
          icon("truck", 18), h("span", { text: comingTotal ? t("s3.incoming", { q: comingTotal }) : t("s3.coming") }), icon("arrowRight", 16)) : null),
      card,
      card ? null : h("div", { class: "s3-card-acts" },
        btn({ icon: "cart", word: t("s3.buyMore"), label: t("s3.buyMoreLong", { item: name }), tone: low ? "lime" : "glass",
          onClick: () => talkHere({ prompt: t("s3.buyPrompt", { item: name }), hint: "s3.buyHint" }) }))));
}

/* --------------------------------------------------------- on the way -- */

function poRow(o, ui, onArrived) {
  const id = String(o.id);
  const u = ui.get(id) || {};
  const f = orderFacts(appState, o);
  return h("li", { class: "s3-po card" },
    h("span", { class: "s3-po-ico", "aria-hidden": "true" }, icon("truck", 22)),
    h("div", { class: "s3-po-main" },
      h("p", { class: "s3-po-what" },
        f.item ? scripted("span", f.item, { class: "s3-po-item" }) : h("span", { class: "s3-po-item", text: t("s3.order") }),
        f.quantity !== null ? h("span", { class: "s3-po-qty", text: qty(f.quantity, f.unit) }) : null),
      h("p", { class: "s3-po-sub" },
        o.poNumber ? h("span", { class: "s3-po-no", text: o.poNumber }) : null,
        f.vendor ? scripted("span", f.vendor, { class: "s3-po-vendor" }) : null,
        o.amount !== null && o.amount !== undefined ? h("span", { class: "s3-po-amt", text: rupees(o.amount) }) : null),
      f.simulated ? simPill() : null,
      u.error ? errLine(u.error) : null,
      u.done ? h("p", { class: "s3-ok", role: "status" }, icon("checkCircle", 20), h("span", { text: t("b3.arrivedDone") })) : null),
    h("div", { class: "s3-po-acts" },
      u.done ? null : btn({ icon: "check", word: t("b3.arrived"), label: t("b3.arrivedLong"), tone: "lime", busy: Boolean(u.busy), onClick: () => onArrived(id) }),
      btn({ icon: "receipt", word: t("s3.seeOrder"), href: "#/buy", size: "sm" })));
}

/* --------------------------------------------------------------- screen -- */

function loadingShape() {
  return h("div", { class: "s3-grid is-skel" }, ...Array.from({ length: 4 }, () => h("div", { class: "s3-card card is-skel" }, skel("skel-block", "is-jar"), skel("skel-line"), skel("skel-line", "is-num"), skel("skel-block", "is-btn"))));
}

export function createStock() {
  ensureCss("/css/app-buy.css"); // shared loading shape (.x3-loading)
  ensureCss("/css/app-stock.css");
  const el = h("section", { class: "s3-stock", "aria-labelledby": "s3-title" });
  const head = h("header", { class: "screen-head s3-head" });
  const body = h("div", { class: "s3-body" });
  el.append(head, body);
  const ui = new Map();   // orderId -> { busy, error, done }
  const asks = new Map(); // itemId -> { busy: "yes"|"no", error }

  async function answer(itemId, decision) {
    const key = String(itemId);
    if ((asks.get(key) || {}).busy) return;
    asks.set(key, { busy: decision });
    render(true);
    try {
      const proposalId = (stock.proposals.get(key) || {}).id;
      const r = await decideReorder(key, decision);
      asks.delete(key);
      if (decision !== "yes") notifyNotNow({ proposalId });
      else if (r.sourcingStarted) notifyReorder({ proposalId, itemId: key, requirementId: r.requirementId });
      else if (r.sourcingError) notify({ id: `reorder:${proposalId}`, tone: "error", icon: "alert", title: t("toast.search.failed"), body: r.sourcingError.say || t("toast.search.failedBody") });
      else notifyNeedSaved({ proposalId, itemId: key });
    } catch (err) {
      asks.set(key, { error: errorWords(err) });
    }
    render(true);
  }

  async function arrived(id) {
    if ((ui.get(id) || {}).busy) return;
    ui.set(id, { busy: true });
    render(true);
    try {
      await markDelivered(id);
      ui.set(id, { done: true });
      setTimeout(() => { ui.delete(id); render(true); }, 2400);
    } catch (err) {
      ui.set(id, { error: errorWords(err) });
    }
    render(true);
  }

  function render(force = false) {
    const items = [...stock.items.values()];
    const open = openOrders();
    // An order that just arrived stays a moment to show "Added to stock".
    const just = [...ui.keys()].filter((id) => ui.get(id).done && !open.some((o) => String(o.id) === id)).map((id) => appState.orders.get(id)).filter(Boolean);
    const pos = [...open, ...just];
    const counts = stockCounts(items, open);
    const ready = stock.status === "ready";
    const empty = ready && !items.length && !pos.length;

    patch(head, JSON.stringify([document.documentElement.lang, ready, counts]), () => [
      h("div", { class: "s3-head-main" },
        h("h1", { class: "screen-title s3-title", id: "s3-title" }, icon("jar", 28), h("span", { text: t("nav.stock") })),
        ready && counts.items ? h("ul", { class: "s3-hud", "aria-label": t("nav.stock") },
          h("li", { class: "s3-hud-cell" }, h("span", { text: counts.items === 1 ? t("s3.itemsOne") : t("s3.items", { n: counts.items }) })),
          counts.low ? h("li", { class: "s3-hud-cell is-low" }, icon("alert", 16), h("span", { text: t("s3.lowCount", { n: counts.low }) })) : null,
          counts.coming ? h("li", { class: "s3-hud-cell is-coming" }, icon("truck", 16), h("span", { text: t("s3.comingCount", { n: counts.coming }) })) : null) : null),
      h("div", { class: "screen-head-tools" }, talkChip({ word: t("s3.talk"), hint: "s3.hint" })),
    ]);

    if (force) body.__key = null;
    const key = JSON.stringify([document.documentElement.lang, stock.status, stock.error && (stock.error.say || stock.error.status), items, [...stock.proposals.entries()], [...asks.entries()], pos.map((o) => [o.id, o.status, o.amount]), [...ui.entries()], appState.quotes.size, appState.requirements.length, Boolean(waiting)]);
    patch(body, key, () => {
      if (stock.status === "idle" || stock.status === "loading") return stateView({ kind: "loading", title: t("s3.loading"), skeleton: loadingShape });
      if (stock.status === "missing") return stateView({ kind: "missing", title: t("s3.missing.title"), text: t("s3.missing.text"), action: { label: t("retry"), run: () => loadStock() } });
      if (stock.status === "error") {
        const err = stock.error;
        return stateView({ kind: "error", title: t("s3.err.title"), text: (err && (err.say || (err.status === 0 ? t("err.network") : null))) || t("s3.err.text"), action: { label: t("retry"), run: () => loadStock() } });
      }
      if (empty) return stateView({ kind: "empty", icon: "jar", title: t("s3.empty.title"), text: t("s3.empty.text"), action: { label: t("s3.talk"), icon: "mic", run: () => talkHere({ hint: "s3.hint" }) } });

      const incomingRows = open.map((o) => { const f = orderFacts(appState, o); return { orderId: o.id, item: f.item, quantity: f.quantity, unit: f.unit, po: o.poNumber }; });
      const incoming = incomingByItem(items, incomingRows);
      const { low, rest } = shelves(items, nameOf);
      const ctx = { asks, onAnswer: answer, incoming };
      return [
        low.length ? h("section", { class: "s3-shelf is-low", "aria-labelledby": "s3-low-h" },
          h("h2", { class: "section-title s3-shelf-head", id: "s3-low-h" }, icon("alert", 22), h("span", { text: t("s3.low") }), h("span", { class: "s3-count", text: String(low.length) })),
          h("ul", { class: "s3-grid" }, ...low.map((i) => jarCard(i, ctx)))) : null,
        rest.length ? h("section", { class: "s3-shelf", "aria-labelledby": "s3-shelf-h" },
          h("h2", { class: "section-title s3-shelf-head", id: "s3-shelf-h" }, icon("jar", 22), h("span", { text: t("s3.shelf") }), h("span", { class: "s3-count", text: String(rest.length) })),
          h("ul", { class: "s3-grid" }, ...rest.map((i) => jarCard(i, ctx)))) : null,
        !items.length ? stateView({ kind: "empty", icon: "jar", title: t("s3.empty.title"), text: t("s3.empty.text"), compact: true, action: { label: t("s3.talk"), icon: "mic", run: () => talkHere({ hint: "s3.hint" }) } }) : null,
        pos.length ? h("section", { class: "s3-shelf is-coming", "aria-labelledby": "s3-coming-h" },
          h("h2", { class: "section-title s3-shelf-head", id: "s3-coming-h" }, icon("truck", 22), h("span", { text: t("s3.coming") }), h("span", { class: "s3-count", text: String(pos.length) })),
          h("p", { class: "s3-quiet", text: t("s3.comingText") }),
          h("ol", { class: "s3-pos" }, ...pos.map((o) => poRow(o, ui, arrived)))) : null,
      ];
    });
  }

  loadWaiting(() => render(true));

  return {
    el,
    update: (_s, parts) => {
      if (stock.status === "idle" && appState.boot === "ready") loadStock();
      if (parts.has("all") || parts.has("lang") || parts.has("stock") || parts.has("orders") || parts.has("work") || parts.has("waiting")) render(parts.has("lang"));
    },
    enter: () => { if (stock.status === "idle" || stock.status === "error" || stock.status === "missing") loadStock(); },
  };
}
