// Constellation (My Sahay > Teach, spec 3.1 row 49): Sahay's own orb in a socket at the centre of
// a sky, rules and memories as stars joined to it. The first six items are stars you can press
// (icon + one word); the rest show as small lights on the outer orbit and are listed in full under
// the sky. Waiting suggestions have an amber ring, rules Sahay follows a lime ring, memories cyan;
// the word under each star says which, so colour is never the only signal. A star that arrived
// while the screen was open says "New" once.
//
//   renderSky(items, { langCode, onPick, fresh, orb }) -> HTMLElement
//   renderStarList(items, { langCode, onPick, fresh }) -> HTMLElement (ul.rows)
//   renderLegend(), starWord(item), starIcon(item), starTone(item)

import { h, icon, svgEl, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { starPositions, sentenceOf } from "./me-logic.js";
import "./me-strings.js";

const RULE_ICON = { max_price: "rupee", prefer_vendor: "heart", avoid_vendor: "ban", usual_quantity: "box", reply_language: "globe", bargain_style: "gauge" };
const MEM_ICON = { usual_item: "box", liked_vendor: "heart", last_price: "tag" };

export { sentenceOf };

export function starTone(it) {
  if (it.type === "memory") return "memory";
  return it.data.status === "suggested" ? "suggested" : "rule";
}

export function starWord(it) {
  const tone = starTone(it);
  return tone === "memory" ? t("me.memory") : tone === "suggested" ? t("me.suggested") : t("me.rule");
}

export function starIcon(it) {
  const k = it.data && it.data.kind;
  return (it.type === "memory" ? MEM_ICON[k] : RULE_ICON[k]) || (it.type === "memory" ? "box" : "star");
}

const keyOf = (it) => `${it.type}:${it.data.id}`;

/** The sky: orb socket, orbit rings, lines, up to six pressable stars and small lights for the rest. */
export function renderSky(items, { langCode, onPick, fresh = new Set(), orb = null }) {
  const pos = starPositions(items.length);
  const svg = svgEl("svg", { class: "sky-lines", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" });
  svg.append(
    svgEl("circle", { class: "sky-orbit", cx: 50, cy: 50, r: 27, "vector-effect": "non-scaling-stroke" }),
    svgEl("circle", { class: "sky-orbit sky-orbit-outer", cx: 50, cy: 50, r: 43, "vector-effect": "non-scaling-stroke" }));
  const stars = h("ul", { class: "sky-stars", "aria-label": t("me3.sky") });
  const lights = h("div", { class: "sky-lights", "aria-hidden": "true" });
  pos.forEach((p, i) => {
    const it = items[i];
    const tone = starTone(it);
    svg.append(svgEl("line", { x1: 50, y1: 50, x2: p.x, y2: p.y, class: `sky-line is-${tone}${p.ring ? " is-far" : ""}`, "vector-effect": "non-scaling-stroke" }));
    if (p.ring === 1) {
      lights.append(h("span", { class: `sky-light is-${tone}`, style: `--x:${p.x};--y:${p.y}` }));
      return;
    }
    const isNew = fresh.has(keyOf(it));
    stars.append(h("li", { class: "sky-star-slot", style: `--x:${p.x};--y:${p.y};--i:${i}` },
      h("button", {
        class: `sky-star is-${tone}${isNew ? " is-new" : ""}`, type: "button",
        "aria-label": `${starWord(it)}: ${sentenceOf(it.data, langCode)}`,
        on: { click: (e) => onPick(it, e.currentTarget) },
      },
      h("span", { class: "sky-star-dot" }, icon(starIcon(it), 22)),
      h("span", { class: "sky-star-word", text: isNew ? t("me3.new") : starWord(it) }))));
  });
  return h("div", { class: "sky" },
    svg,
    lights,
    h("span", { class: "sky-core", "aria-hidden": "true" }, orb || null),
    stars);
}

/** The full list under the sky: every rule and memory as a row with its sentence. */
export function renderStarList(items, { langCode, onPick, fresh = new Set() }) {
  return h("ul", { class: "rows sky-list", "aria-label": t("me3.list") }, ...items.map((it) => {
    const tone = starTone(it);
    const isNew = fresh.has(keyOf(it));
    return h("li", { class: "row" },
      h("button", { class: "row-button", type: "button", on: { click: (e) => onPick(it, e.currentTarget) } },
        h("span", { class: `row-ico sky-row-ico is-${tone}`, "aria-hidden": "true" }, icon(starIcon(it), 22)),
        h("span", { class: "row-main" },
          scripted("span", sentenceOf(it.data, langCode), { class: "row-title sky-row-title" }),
          h("span", { class: `row-sub sky-row-kind is-${tone}` },
            icon(tone === "suggested" ? "clock" : tone === "memory" ? "box" : "check", 18), h("span", { text: starWord(it) }))),
        h("span", { class: "row-end" },
          isNew ? h("span", { class: "pill pill-ok" }, h("span", { text: t("me3.new") })) : null,
          icon("chevronRight", 22))));
  }));
}

/** Legend: what the three rings mean (a ring sample + words). */
export function renderLegend() {
  return h("ul", { class: "sky-legend" },
    h("li", { class: "is-suggested" }, h("span", { class: "sky-legend-dot", "aria-hidden": "true" }), h("span", { text: t("me3.legend.suggested") })),
    h("li", { class: "is-rule" }, h("span", { class: "sky-legend-dot", "aria-hidden": "true" }), h("span", { text: t("me3.legend.rule") })),
    h("li", { class: "is-memory" }, h("span", { class: "sky-legend-dot", "aria-hidden": "true" }), h("span", { text: t("me3.legend.memory") })));
}
