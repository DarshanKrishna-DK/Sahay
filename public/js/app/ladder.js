// Price ladder: the negotiation as a staircase of price chips. The seller's asks step down
// from above, Sahay's offers step up from below, and the meeting point glows. Prices come
// only from negotiation.turn offers; "simulated vendor" is shown whenever it is one.

import { h, icon, svgEl, rupees } from "./dom.js";
import { t, unitWord } from "./i18n.js";

export function renderLadder(n, { vendor, simulated }) {
  const turns = (n && n.turns ? n.turns : []).filter((x) => x.offer !== null && x.offer !== undefined);
  const head = h("div", { class: "ladder-head" },
    h("h3", { class: "ladder-title", text: t("ladder.title") }),
    vendor ? h("span", { class: "ladder-vendor" }, icon("store", 18), h("span", { text: vendor })) : null,
    simulated ? h("span", { class: "sim-pill" }, icon("robot", 16), h("span", { text: t("simulated") })) : null);
  if (!turns.length) {
    return h("section", { class: "ladder" }, head, h("p", { class: "ladder-empty" }, h("span", { class: "wait-dot", "aria-hidden": "true" }), h("span", { text: t("ladder.empty") })));
  }
  const asks = turns.filter((x) => x.speaker === "vendor");
  const offers = turns.filter((x) => x.speaker === "agent");
  const prices = turns.map((x) => x.offer);
  const max = Math.max(...prices), min = Math.min(...prices);
  const span = Math.max(1, max - min);
  const rounds = Math.max(...turns.map((x) => x.round || 1));
  const outcome = n.outcome && typeof n.outcome === "object" ? n.outcome : null;
  const agreed = outcome && outcome.agreed && outcome.unitPrice !== null && outcome.unitPrice !== undefined ? outcome.unitPrice : null;
  const unit = (turns[0] && turns[0].unit) || (outcome && outcome.unit) || "";

  // Chip positions: x by round, y by price (high at top).
  const W = 100, top = 8, bottom = 92;
  const xOf = (r) => (rounds <= 1 ? 50 : 8 + ((r - 1) / (rounds - 1)) * 84);
  const yOf = (p) => top + (1 - (p - min) / span) * (bottom - top);
  const line = (list, cls) => {
    if (list.length < 2) return null;
    const pts = list.map((x) => `${xOf(x.round || 1)},${yOf(x.offer)}`).join(" ");
    return svgEl("polyline", { points: pts, class: cls, "vector-effect": "non-scaling-stroke" });
  };
  const svg = svgEl("svg", { class: "ladder-svg", viewBox: `0 0 ${W} 100`, preserveAspectRatio: "none", "aria-hidden": "true" });
  for (const el of [line(asks, "ladder-ask"), line(offers, "ladder-offer")]) if (el) svg.append(el);

  const chips = h("ol", { class: "ladder-chips" });
  const seen = new Set();
  for (const x of turns) {
    const key = `${x.speaker}|${x.round}|${x.offer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meet = agreed !== null && x.offer === agreed;
    const who = x.speaker === "vendor" ? t("ladder.asks") : t("ladder.offers");
    chips.append(h("li", {
      class: `pchip pchip-${x.speaker === "vendor" ? "ask" : "offer"}${meet ? " is-meet" : ""}`,
      style: `--x:${xOf(x.round || 1)};--y:${yOf(x.offer)}`,
    }, h("span", { class: "sr-only", text: `${who}: ` }), h("span", { text: rupees(x.offer) })));
  }
  const legend = h("p", { class: "ladder-legend" },
    h("span", { class: "lg lg-ask" }, h("span", { class: "lg-dot", "aria-hidden": "true" }), h("span", { text: t("ladder.asks") })),
    h("span", { class: "lg lg-offer" }, h("span", { class: "lg-dot", "aria-hidden": "true" }), h("span", { text: t("ladder.offers") })));
  const result = n.endedAt
    ? (agreed !== null
      ? h("p", { class: "ladder-result is-agreed" }, icon("check", 22), h("span", { text: t("ladder.agreed", { p: `${rupees(agreed)}${unit ? `/${unitWord(unit)}` : ""}` }) }))
      : h("p", { class: "ladder-result is-nodeal" }, icon("x", 22), h("span", { text: t("ladder.noDeal") })))
    : null;
  return h("section", { class: "ladder" }, head, legend, h("div", { class: "ladder-plot" }, svg, chips), result);
}
