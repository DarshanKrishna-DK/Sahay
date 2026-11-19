// Memory constellation: the owner's agent orb in the middle, rules and memories as bubbles on
// two orbits joined to it. Suggestions float in with a coral ring; active rules have a leaf
// ring; memories are cyan. Each bubble is a button (icon + one word) that opens its sheet.

import { h, icon, svgEl } from "./dom.js";
import { t } from "./i18n.js";

const RULE_ICON = { max_price: "rupee", prefer_vendor: "heart", avoid_vendor: "ban", usual_quantity: "box", reply_language: "globe", bargain_style: "gauge" };
const MEM_ICON = { usual_item: "box", liked_vendor: "heart", last_price: "tag" };

export function sentenceOf(x, langCode) {
  const s = x && x.sentence;
  if (!s) return "";
  if (typeof s === "string") return s;
  return s[langCode] || s["en-IN"] || Object.values(s)[0] || "";
}

/** items: [{ type: "rule"|"memory", data }] */
export function renderConstellation(items, { langCode, onPick, fresh = new Set() }) {
  const n = items.length;
  const wrap = h("div", { class: "constellation" });
  const svg = svgEl("svg", { class: "const-lines", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" });
  const list = h("ul", { class: "const-items", "aria-label": t("me.rulesTitle") });
  // Up to 8 on the inner orbit, the rest outside.
  items.forEach((it, i) => {
    const inner = i < 8;
    const count = inner ? Math.min(n, 8) : n - 8;
    const k = inner ? i : i - 8;
    const a = (-90 + (360 / count) * k + (inner ? 0 : 180 / count)) * (Math.PI / 180);
    const r = inner ? 34 : 46;
    const x = 50 + r * Math.cos(a);
    const y = 50 + r * Math.sin(a);
    svg.append(svgEl("line", { x1: 50, y1: 50, x2: x, y2: y, class: `const-line ${lineClass(it)}`, "vector-effect": "non-scaling-stroke" }));
    const d = it.data;
    const kindWord = it.type === "memory" ? t("me.memory") : d.status === "suggested" ? t("me.suggested") : d.status === "off" ? t("me.off") : t("me.rule");
    const sentence = sentenceOf(d, langCode);
    const ic = it.type === "memory" ? MEM_ICON[d.kind] || "spark" : RULE_ICON[d.kind] || "spark";
    list.append(h("li", { class: "const-item", style: `--x:${x};--y:${y};--i:${i}` },
      h("button", {
        class: `star ${lineClass(it)}${fresh.has(`${it.type}:${d.id}`) ? " is-new" : ""}`, type: "button",
        "aria-label": `${kindWord}: ${sentence}`,
        on: { click: (e) => onPick(it, e.currentTarget) },
      }, icon(ic, 24), h("span", { class: "star-word", text: kindWord }))));
  });
  wrap.append(svg, h("span", { class: "const-core", "aria-hidden": "true" }), list);
  return wrap;
}

function lineClass(it) {
  if (it.type === "memory") return "is-memory";
  return { suggested: "is-suggested", active: "is-active", off: "is-off" }[it.data.status] || "is-active";
}
