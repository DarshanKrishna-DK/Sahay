// The list card the Sell and Money screens share (UI v5 spec, "Card" and "Page pattern"): a card
// whose header holds the segmented filter, an optional totals line, then rows of 72px: [24px icon,
// muted] [main line + meta line] [amount right + status word with an 8px dot] [one action]. The
// whole row opens the details sheet; the action is its own button beside it. Five rows, then
// "Show all". Styles: css/sell.css.

import { h, icon, scripted, fill, segmented } from "./ui.js";
import { t } from "./i18n.js";

/** A status word with its 8px dot (spec: status colours only as a dot + the word, never a fill). */
export function statusWord(word, tone) {
  return h("span", { class: `sv5-status${tone ? ` is-${tone}` : ""}` }, h("i", { class: "sv5-dot", "aria-hidden": "true" }), scripted("span", word));
}

/** A plain coloured note in the meta line, e.g. "simulated vendor" or "Test mode" (spec: --warn text, not a pill). */
export const warnWord = (word) => scripted("span", word, { class: "sv5-warn" });

/**
 * One row: { icon, title, meta: [text|Node], amount, amountTone, status: Node, action: Node, onOpen, openLabel }.
 * Without onOpen the row is plain text (nothing to open).
 */
export function dataRow({ icon: ic, title, meta = [], amount, amountTone, status, action, onOpen, openLabel }) {
  const metaKids = meta.filter((m) => m !== null && m !== undefined && m !== "").map((m) => (typeof m === "string" ? scripted("span", m) : m));
  const inner = [
    ic ? h("span", { class: "sv5-row-ico", "aria-hidden": "true" }, icon(ic, 22)) : null,
    h("span", { class: "sv5-row-main" },
      scripted("span", title || "", { class: "sv5-row-title" }),
      metaKids.length ? h("span", { class: "sv5-row-meta" }, ...metaKids) : null),
    amount || status ? h("span", { class: "sv5-row-end" },
      amount ? h("span", { class: `amount sv5-row-amt${amountTone ? ` is-${amountTone}` : ""}`, text: amount }) : null,
      status || null) : null,
  ];
  const main = onOpen
    ? h("button", { class: "sv5-row-open", type: "button", "aria-label": openLabel, on: { click: (e) => onOpen(e.currentTarget) } }, ...inner)
    : h("div", { class: "sv5-row-open is-static" }, ...inner);
  return h("li", { class: `sv5-row${action ? " has-act" : ""}` }, main, action ? h("div", { class: "sv5-row-act" }, action) : null);
}

/**
 * The list card: { label, head: Node (segmented), total: Node, rows: [li], empty: text, limit }.
 * Returns the card element; "Show all" toggles in place.
 */
export function rowsCard({ label, head, total, rows, empty, limit = 5, id }) {
  const listWrap = h("div", { class: "sv5-list-wrap" });
  let open = false;
  function draw() {
    if (!rows.length) { fill(listWrap, scripted("p", empty || "", { class: "sv5-empty" })); return; }
    const shown = open ? rows : rows.slice(0, limit);
    fill(listWrap,
      h("ul", { class: "sv5-rows", "aria-label": label, id }, ...shown),
      rows.length > limit ? h("button", { class: "link-btn sv5-show-all", type: "button", "aria-expanded": String(open), on: { click: () => { open = !open; draw(); } } },
        h("span", { text: open ? t("ui.showLess") : t("ui.showAll", { n: rows.length }) })) : null);
  }
  draw();
  return h("section", { class: "card sv5-card", "aria-label": label },
    head ? h("div", { class: "sv5-card-head" }, head) : null,
    total || null,
    listWrap);
}

/**
 * The kit's segmented tabs with a count after each word: { label, value, onPick, options: [{ id,
 * word, n }] }. The count is its own span in the display face with tabular digits (in the HUD face
 * a "1" reads as "I").
 */
export function countedTabs({ label, value, onPick, options }) {
  const el = segmented({ label, value, onPick, options: options.map(({ id, word }) => ({ id, word })) });
  for (const o of options) {
    const btn = el.querySelector(`.seg-opt[data-id="${o.id}"]`);
    if (!btn) continue;
    const word = btn.querySelector("span");
    if (word) word.classList.add("sv5-seg-w");
    if (o.n !== undefined && o.n !== null) btn.append(h("span", { class: "sv5-seg-n", text: String(o.n) }));
  }
  return el;
}
