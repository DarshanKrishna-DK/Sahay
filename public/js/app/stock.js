// Stock: every item as a jar filled to what is on hand, with a dashed reorder line; items at or
// below the line turn coral and pulse gently (still under reduced motion: no pulse, the word "Low"
// and the alert icon carry it). On hand is in the item's unit, in the owner's script. "Buy more"
// asks the agent (Talk with a prompt; the buying flow and its yes gate do the rest). Purchase
// orders not yet arrived sit under "Coming to you" with "Arrived" (POST /api/orders/:id/delivered).

import { h, icon, patch, svgEl, amount } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { state as appState, vendorName, isSimulatedVendor } from "./store.js";
import { stateView } from "./empty.js";
import { paper, perforation, pill, keycapButton, yesNo } from "./ui.js";
import { stock, loadStock, openOrders, markDelivered, decideReorder } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { ensureCss, money, qtyText, itemName, scriptedText, readButton, partState, agentAction, sectionHead, buttonError, ask, alignNotches } from "./sell-kit.js";

/* ------------------------------------------------------------------ jar -- */

const BODY = "M31 18h38v7c0 5 15 9 15 21v63a13 13 0 0 1-13 13H29a13 13 0 0 1-13-13V46c0-12 15-16 15-21z";
const TOP = 30;    // inner top of the jar body (y)
const BOTTOM = 122;

/** How full the jar looks: on hand against a scale that keeps the reorder line low in the jar. */
function scale(it) {
  const on = Math.max(0, it.onHand ?? 0);
  const lvl = it.reorderLevel;
  if (lvl !== null && lvl !== undefined && lvl > 0) return Math.max(on * 1.12, lvl * 3);
  return on > 0 ? on / 0.72 : 1;
}

let jarSeq = 0;
function jar(it, low) {
  const id = `sb-jar-${++jarSeq}`;
  const cap = scale(it);
  const frac = Math.min(1, Math.max(0, (it.onHand ?? 0) / cap));
  const fillTop = BOTTOM - (BOTTOM - TOP) * frac;
  const svg = svgEl("svg", { class: `sb-jar${low ? " is-low" : ""}`, viewBox: "0 0 100 128", width: 100, height: 128, "aria-hidden": "true", focusable: "false" });
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id });
  clip.append(svgEl("path", { d: BODY }));
  defs.append(clip);
  const fill = svgEl("g", { "clip-path": `url(#${id})` });
  fill.append(
    svgEl("rect", { class: "sb-jar-fill", x: 0, y: fillTop.toFixed(1), width: 100, height: (BOTTOM + 8 - fillTop).toFixed(1) }),
    frac > 0 ? svgEl("rect", { class: "sb-jar-surface", x: 0, y: fillTop.toFixed(1), width: 100, height: 3 }) : null,
    svgEl("rect", { class: "sb-jar-shine", x: 24, y: 44, width: 7, height: 62, rx: 3.5 }));
  svg.append(defs, svgEl("rect", { class: "sb-jar-lid", x: 26, y: 5, width: 48, height: 13, rx: 4 }), fill, svgEl("path", { class: "sb-jar-glass", d: BODY }));
  const lvl = it.reorderLevel;
  if (lvl !== null && lvl !== undefined && lvl > 0) {
    const y = (BOTTOM - (BOTTOM - TOP) * Math.min(1, lvl / cap)).toFixed(1);
    svg.append(svgEl("line", { class: "sb-jar-line", x1: 8, x2: 92, y1: y, y2: y }));
  }
  return svg;
}

/* ------------------------------------------------------------- the items -- */

function itemCard(it, asks, onAnswer) {
  const low = it.low === true;
  const name = itemName(it);
  const prop = stock.proposals.get(it.id);
  const a = asks.get(it.id) || {};
  const levelQ = it.reorderLevel !== null && it.reorderLevel !== undefined ? qtyText(it.reorderLevel, it.unit) : null;
  const onNum = amount(it.onHand ?? 0) ?? "0";
  const buy = () => ask({ prompt: st("stock.buyPrompt", { item: name }), hint: st("stock.buyHint", { item: name }) });
  return h("li", { class: `sb-item${low ? " is-low" : ""}` },
    h("div", { class: "sb-item-jar" }, jar(it, low),
      low ? h("span", { class: "sb-low-mark" }, icon("alert", 18), h("span", { text: st("stock.lowWord") })) : null),
    h("div", { class: "sb-item-main" },
      h("div", { class: "sb-item-head" },
        scriptedText("h3", name, { class: "sb-item-name" }),
        readButton(`item:${it.id}`)),
      h("p", { class: "sb-onhand" },
        h("span", { class: "sb-onhand-num", text: onNum }),
        h("span", { class: "sb-onhand-unit", text: unitWord(it.unit) })),
      h("p", { class: "sb-level" },
        h("span", { class: "sb-level-swatch", "aria-hidden": "true" }),
        h("span", { text: levelQ ? st("stock.reorderAt", { q: levelQ }) : st("stock.noLevel") })),
      a.done ? h("p", { class: "sb-ok", role: "status" }, icon("checkCircle", 20), h("span", { text: a.done === "yes" ? st("stock.searching") : st("stock.notNow") }),
        a.done === "yes" ? h("a", { class: "btn btn-ghost btn-sm", href: "#/buy" }, icon("cart", 20), h("span", { text: t("nav.buy") })) : null) : null,
      prop && !a.done ? h("div", { class: "sb-proposal" },
        h("p", { class: "sb-proposal-q" }, icon("spark", 20),
          h("span", { text: st("stock.proposed", { q: prop.quantity ? qtyText(prop.quantity, prop.unit || it.unit) : name }) })),
        h("p", { class: "sb-proposal-why", text: st("stock.proposedWhy") }),
        a.error ? h("p", { class: "sb-error", role: "alert" }, icon("alert", 20), h("span", { text: a.error })) : null,
        prop.id
          ? yesNo({ size: "md", busy: a.busy || null, yesWord: st("inv.yes.approve"), noWord: st("inv.yes.reject"),
            yesLabel: st("stock.proposedYes", { item: name }), noLabel: st("stock.proposedNo"),
            onYes: () => onAnswer(it.id, "yes"), onNo: () => onAnswer(it.id, "no") })
          : keycapButton({ icon: "mic", word: st("stock.answer"), tone: "marigold", size: "md", onClick: () => ask({ hint: st("stock.buyHint", { item: name }) }) })) : null,
      prop && !a.done ? null : h("div", { class: "sb-item-acts" },
        keycapButton({ icon: "cart", word: st("stock.buyMore"), label: st("stock.buyMoreLong", { item: name }), tone: low ? "marigold" : "ghost", size: "md", onClick: buy }))));
}

/* ------------------------------------------------------- coming to you -- */

function orderWhat(o) {
  const q = o.quoteId !== undefined && o.quoteId !== null ? appState.quotes.get(String(o.quoteId)) : null;
  const reqId = q && q.requirementId;
  const req = reqId ? appState.requirements.find((r) => String(r.id) === String(reqId)) : null;
  const item = req ? req.item : null;
  const qty = (q && q.quantity) ?? (req ? req.quantity : null);
  const unit = (q && q.unit) || (req ? req.unit : null);
  return { item, qty, unit, vendor: o.vendorName || (q && (q.vendorName || vendorName(q.vendorId))) || null, simulated: Boolean(o.simulated || (q && (q.simulated || isSimulatedVendor(q.vendorId)))) };
}

function orderCard(o, ui, onArrived) {
  const id = String(o.id);
  const u = ui.get(id) || {};
  const w = orderWhat(o);
  return h("li", {},
    paper({ class: "sb-po", tone: "due" },
      h("div", { class: "sb-po-top" },
        h("span", { class: "sb-po-ico", "aria-hidden": "true" }, icon("truck", 24)),
        h("span", { class: "sb-po-id" },
          o.poNumber ? h("span", { class: "sb-bill-no", text: o.poNumber }) : h("span", { class: "sb-bill-no", text: st("stock.order") })),
        readButton(`order:${id}`)),
      perforation(),
      w.item ? h("p", { class: "sb-po-what" }, scriptedText("span", w.item, { class: "sb-po-item" }), w.qty !== null && w.qty !== undefined ? h("span", { class: "sb-po-qty", text: qtyText(w.qty, w.unit) }) : null) : null,
      w.vendor ? h("p", { class: "sb-po-from" }, icon("store", 20), scriptedText("span", w.vendor), w.simulated ? pill(t("simulated"), "robot", "sim") : null) : null,
      o.amount !== null && o.amount !== undefined ? h("p", { class: "sb-po-amt", text: money(o.amount) }) : null,
      u.error ? h("p", { class: "sb-error", role: "alert" }, icon("alert", 20), h("span", { text: u.error })) : null,
      u.done ? h("p", { class: "sb-ok", role: "status" }, icon("checkCircle", 20), h("span", { text: st("stock.arrivedDone") })) : null,
      u.done ? null : keycapButton({ icon: "check", word: st("stock.arrived"), label: st("stock.arrivedLong"), tone: "leaf", size: "md", busy: Boolean(u.busy), onClick: () => onArrived(id) })));
}

/* --------------------------------------------------------------- screen -- */

export function createStock() {
  ensureCss();
  const el = h("section", { class: "stock sb-screen", "aria-labelledby": "stock-title" });
  const title = h("h1", { class: "screen-title", id: "stock-title" });
  const topAct = h("div", { class: "sb-top-act" });
  const body = h("div", { class: "sb-body" });
  el.append(h("header", { class: "sb-top" }, title, topAct), body);
  const ui = new Map(); // orderId -> { busy, error, done }
  const asks = new Map(); // itemId -> { busy: "yes" | "no", error, done: "yes" | "no" }

  async function answer(itemId, decision) {
    asks.set(itemId, { busy: decision });
    render(true);
    try {
      await decideReorder(itemId, decision);
      asks.set(itemId, { done: decision });
      setTimeout(() => { asks.delete(itemId); render(true); }, 6000);
    } catch (err) {
      asks.set(itemId, { error: buttonError(err) });
    }
    render(true);
  }

  async function arrived(id) {
    ui.set(id, { busy: true });
    render(true);
    try {
      await markDelivered(id);
      ui.set(id, { done: true });
      setTimeout(() => { ui.delete(id); render(true); }, 2400);
    } catch (err) {
      ui.set(id, { error: buttonError(err) });
    }
    render(true);
  }

  function render(force = false) {
    title.textContent = t("nav.stock");
    const s = partState(stock, { which: "stock", reload: () => loadStock() });
    const items = [...stock.items.values()];
    const orders = openOrders();
    // An order that just arrived stays a moment to show "Added to stock".
    const justArrived = [...ui.keys()].filter((id) => ui.get(id).done && !orders.some((o) => String(o.id) === id))
      .map((id) => appState.orders.get(id)).filter(Boolean);
    const shown = [...orders, ...justArrived];
    const empty = stock.status === "ready" && !items.length && !shown.length;
    patch(topAct, JSON.stringify([document.documentElement.lang, empty, stock.status]), () =>
      (empty || stock.status !== "ready" ? [] : [agentAction({ word: st("stock.act"), hint: "stock.hint" })]));
    if (force) body.__key = null;
    const key = JSON.stringify([document.documentElement.lang, stock.status, items, [...stock.proposals.entries()], [...asks.entries()], shown.map((o) => [o.id, o.status, o.amount]), [...ui.entries()], appState.quotes.size]);
    patch(body, key, () => {
      if (s) return s;
      if (empty) {
        return stateView({ kind: "empty", icon: "jar", title: st("stock.empty.title"), text: st("stock.empty.text"),
          action: { label: st("stock.act"), icon: "mic", run: () => ask({ hint: "stock.hint" }) } });
      }
      const byName = (a, b) => itemName(a).localeCompare(itemName(b));
      const low = items.filter((i) => i.low === true).sort((a, b) => ((a.onHand ?? 0) / (a.reorderLevel || 1)) - ((b.onHand ?? 0) / (b.reorderLevel || 1)));
      const rest = items.filter((i) => i.low !== true).sort(byName);
      return [
        low.length ? h("section", { class: "sb-low", "aria-labelledby": "sb-low-h" },
          sectionHead("sb-low-h", "alert", st("stock.low"), low.length, "coral"),
          h("ul", { class: "sb-shelf" }, ...low.map((i) => itemCard(i, asks, answer)))) : null,
        rest.length ? h("section", { class: "sb-ok-shelf", "aria-labelledby": "sb-shelf-h" },
          sectionHead("sb-shelf-h", "jar", st("stock.shelf"), rest.length),
          h("ul", { class: "sb-shelf" }, ...rest.map((i) => itemCard(i, asks, answer)))) : null,
        !items.length ? h("p", { class: "sb-quiet", text: st("stock.empty.text") }) : null,
        shown.length ? h("section", { class: "sb-coming", "aria-labelledby": "sb-coming-h" },
          sectionHead("sb-coming-h", "truck", st("stock.coming"), shown.length),
          h("p", { class: "sb-quiet", text: st("stock.comingText") }),
          h("ol", { class: "sb-pos" }, ...shown.map((o) => orderCard(o, ui, arrived)))) : null,
      ];
    });
    alignNotches(body);
  }

  return {
    el,
    update: (_s, parts) => {
      if (stock.status === "idle" && appState.boot === "ready") loadStock();
      if (parts.has("all") || parts.has("lang") || parts.has("stock") || parts.has("orders") || parts.has("work")) render(parts.has("lang"));
    },
    enter: () => { if (stock.status === "idle" || stock.status === "error" || stock.status === "missing") loadStock(); },
  };
}
