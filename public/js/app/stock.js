// Stock (UI v5, screens.md 06 Stock): the page pattern, three groups at most.
//   1. Title "Stock", one sentence, ONE primary button: "Reorder low items" (asks Sahay on a call),
//      or "Add item" while the shop has no items yet.
//   2. "Running low" (only if any): a row per low item, "12 kg left, reorder at 20 kg" with an amber
//      dot, and one small button: Reorder (asks Sahay), or Check when Sahay already asked "buy more?"
//      (opens W3's Yes card for that question).
//   3. "All items": item and how much is left; a row opens a sheet (amount, reorder line, what is on
//      the way, Buy more). A search field shows at the top when there are more than 10 items.
// Purchase orders and Arrived live on Buy (D2); a coming order shows as "200 kg coming" in the sheet.
// Every number comes from the store (store-sell stock, stock-model); nothing is filled in.

import { h, icon, patch, scripted, amount,
  button, pageHead, card, list, chip, emptyState, skeleton, openSheet } from "./ui.js";
import { t, unitWord, lang } from "./i18n.js";
import { state as appState } from "./store.js";
import { stock, loadStock, openOrders } from "./store-sell.js";
import { scriptOf } from "../voice.js";

/** Open W3's Yes card for a key (yes.js openNeeds), or the shell's Needs you host while it loads. */
let yesMod = null;
import("./yes.js").then((m) => { yesMod = m; }).catch(() => {});
function openNeeds(key) {
  if (yesMod && typeof yesMod.openNeeds === "function") yesMod.openNeeds(key);
  else document.dispatchEvent(new CustomEvent("sahay:open-needs"));
}
import { shelves, incomingByItem, isLow } from "./stock-model.js";
import { orderFacts } from "./buy-model.js";
import { talkHere } from "./buy-kit.js";

const qty = (q, unit) => { const n = amount(q); if (n === null) return ""; const u = unitWord(unit); return u ? `${n} ${u}` : n; };
const langKey = () => document.documentElement.lang;
const norm = (s) => String(s || "").normalize("NFC").toLowerCase();

function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href }));
}

/** The item's name in the owner's script when Sahay has it, else as stored. */
function nameOf(it) {
  if (!it) return "";
  const L = lang();
  if (it.nameNative && L !== "en" && scriptOf(it.nameNative) === L) return it.nameNative;
  return it.name || it.nameNative || "";
}

export function createStock() {
  ensureCss("/css/stock.css");
  const el = h("div", { class: "screen s5-stock" });
  const headBox = h("div");
  const body = h("div", { class: "s5-body" });
  el.append(headBox, body);
  let query = "";

  const buyMore = (it) => talkHere({ prompt: t("s3.buyPrompt", { item: nameOf(it) }), hint: "s3.buyHint" });
  const left = (it) => qty(it.onHand ?? 0, it.unit);

  function comingText(it, incoming) {
    const c = incoming.get(String(it.id)) || [];
    if (!c.length) return null;
    const same = c.every((x) => x.quantity !== null && (x.unit || it.unit) === (c[0].unit || it.unit));
    const q = same ? qty(c.reduce((s, x) => s + x.quantity, 0), c[0].unit || it.unit) : null;
    return q ? t("s3.incoming", { q }) : t("s5.way");
  }

  function itemSheet(it, incoming, opener) {
    const level = it.reorderLevel > 0 ? qty(it.reorderLevel, it.unit) : null;
    const coming = comingText(it, incoming);
    const prop = stock.proposals.get(String(it.id));
    openSheet({
      title: nameOf(it), opener, speakKey: `item:${it.id}`,
      body: [
        h("p", { class: "s5-left" }, h("span", { class: "figure num", text: amount(it.onHand ?? 0) ?? "0" }), h("span", { class: "s5-left-unit", text: `${unitWord(it.unit)} ${t("s5.left")}`.trim() })),
        isLow(it) ? chip(t("s5.low1"), { tone: "warn", icon: "alert" }) : level ? chip(t("s5.ok"), { tone: "good", icon: "check" }) : null,
        h("p", { class: "s5-fact" }, icon("tag", 20), h("span", { text: level ? t("s3.reorderAt", { q: level }) : t("s3.noLevel") })),
        coming ? h("a", { class: "s5-fact s5-coming", href: "#/buy" }, icon("truck", 20), h("span", { text: coming })) : null,
      ].filter(Boolean),
      footer: prop && prop.id
        ? button({ word: t("b5.check"), icon: "check", kind: "primary", label: t("s3.proposedItem"), onClick: () => openNeeds(`reorder:${prop.id}`) })
        : button({ word: t("s3.buyMore"), icon: "cart", kind: "primary", label: t("s3.buyMoreLong", { item: nameOf(it) }), onClick: () => buyMore(it) }),
    });
  }

  function lowRow(it) {
    const prop = stock.proposals.get(String(it.id));
    const level = it.reorderLevel > 0 ? qty(it.reorderLevel, it.unit) : null;
    const asked = prop && prop.id;
    return {
      title: nameOf(it),
      sub: level ? t("s5.leftAt", { q: left(it), r: level }) : t("s5.leftOnly", { q: left(it) }),
      end: asked
        ? button({ word: t("b5.check"), icon: "check", kind: "primary", size: "sm", label: t("s3.proposedItem"), onClick: () => openNeeds(`reorder:${prop.id}`) })
        : button({ word: t("s5.reorder"), icon: "cart", kind: "secondary", size: "sm", label: t("s3.buyMoreLong", { item: nameOf(it) }), onClick: () => buyMore(it) }),
    };
  }

  function render(force = false) {
    const items = [...stock.items.values()];
    const ready = stock.status === "ready";
    const low = items.filter(isLow);
    patch(headBox, JSON.stringify([langKey(), ready && !items.length]), () => pageHead({ title: t("nav.stock"), sentence: t("s5.sentence2"),
      action: ready && !items.length
        ? { word: t("s5.addItem"), icon: "plus", onClick: () => talkHere({ hint: "s3.hint" }) }
        : { word: t("s5.reorderLow"), icon: "mic", onClick: () => talkHere({ prompt: low.length ? t("s5.reorderPrompt") : null, hint: "s3.buyHint" }) } }));
    if (force) body.__key = null;
    const open = openOrders();
    const key = JSON.stringify([langKey(), stock.status, stock.error && (stock.error.say || stock.error.status), items, [...stock.proposals.entries()], open.map((o) => [o.id, o.status]), appState.quotes.size, appState.requirements.length, query]);
    patch(body, key, () => {
      if (stock.status === "idle" || stock.status === "loading") return card({ title: t("s5.allItems"), body: skeleton("rows", 4) });
      if (stock.status === "missing") return emptyState({ icon: "info", title: t("s3.missing.title"), text: t("s3.missing.text"), action: { word: t("retry"), icon: "refresh", onClick: () => loadStock() } });
      if (stock.status === "error") {
        const err = stock.error;
        return emptyState({ icon: "alert", title: t("s3.err.title"), text: (err && (err.say || (err.status === 0 ? t("err.network") : null))) || t("s3.err.text"), action: { word: t("retry"), icon: "refresh", onClick: () => loadStock() } });
      }
      if (!items.length) return card({ title: t("s5.allItems"), body: h("p", { class: "s5-empty", text: t("s5.noItems") }) });

      const incoming = incomingByItem(items, open.map((o) => { const f = orderFacts(appState, o); return { orderId: o.id, item: f.item, quantity: f.quantity, unit: f.unit, po: o.poNumber }; }));
      const { low: lows, rest } = shelves(items, nameOf);
      const all = [...lows, ...rest].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      const shown = query ? all.filter((it) => norm(nameOf(it)).includes(norm(query)) || norm(it.name).includes(norm(query)) || norm(it.nameNative).includes(norm(query))) : all;
      const search = all.length > 10 ? searchField() : null;
      return [
        lows.length ? card({ title: t("s5.low"), needs: true, cls: "s5-low", body: list(lows.map(lowRow), { limit: 5, label: t("s5.low") }) }) : null,
        card({ title: t("s5.allItems"), cls: "s5-all",
          body: [search,
            shown.length
              ? list(shown.map((it) => ({
                title: nameOf(it),
                sub: [t("s5.leftOnly", { q: left(it) }), comingText(it, incoming)].filter(Boolean).join(" · "),
                end: isLow(it) ? chip(t("s5.low1"), { tone: "warn" }) : null,
                label: `${nameOf(it)}, ${t("s5.leftOnly", { q: left(it) })}`,
                onClick: (e) => itemSheet(it, incoming, e.currentTarget),
              })), { limit: 5, label: t("s5.allItems") })
              : h("p", { class: "s5-empty", text: t("s5.noMatch") })].filter(Boolean) }),
      ].filter(Boolean);
    });
  }

  let searchEl = null;
  function searchField() {
    if (!searchEl) {
      const input = h("input", { class: "input", type: "search", "aria-label": t("s5.search"), placeholder: t("s5.search"), autocomplete: "off" });
      input.addEventListener("input", () => { query = input.value.trim(); render(); requestAnimationFrame(() => { input.focus(); }); });
      searchEl = h("label", { class: "s5-search" }, icon("search", 20), input);
    }
    return searchEl;
  }

  return {
    el,
    update: (_s, parts) => {
      if (stock.status === "idle" && appState.boot === "ready") loadStock();
      if (parts.has("all") || parts.has("lang") || parts.has("stock") || parts.has("orders") || parts.has("work") || parts.has("waiting")) {
        if (parts.has("lang")) searchEl = null;
        render(parts.has("lang"));
      }
    },
    enter: () => { if (stock.status === "idle" || stock.status === "error" || stock.status === "missing") loadStock(); },
  };
}
