// The price ladder (UI v3): vendor asks on the left (cyan), Sahay's offers on the right (lime),
// rung by rung as they were said, each with the words that came with the price. Wide, ask k sits
// beside offer k; narrow, the rungs read top to bottom in the order said, asks left and offers
// right. Prices come only from negotiation turns (buy-model ladderRows); the agreed price is
// locked at the top; "simulated vendor" is shown whenever the seller is one.

import { h, icon, scripted, rupees } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { simPill } from "./buy-kit.js";

const perUnit = (p, unit) => `${rupees(p)}${unit ? ` / ${unitWord(unit)}` : ""}`;

function badge(lad, live) {
  if (lad.agreed !== null) {
    return h("p", { class: "b3-lad-badge is-agreed" }, icon("lock", 20), h("span", { text: t("ladder.agreed", { p: perUnit(lad.agreed, lad.unit) }) }));
  }
  if (lad.noDeal) return h("p", { class: "b3-lad-badge is-nodeal" }, icon("x", 20), h("span", { text: t("ladder.noDeal") }));
  if (live) return h("p", { class: "b3-lad-badge is-live", role: "status" }, h("span", { class: "b3-live-dot", "aria-hidden": "true" }), h("span", { text: t("b3.lad.live") }));
  return null;
}

/**
 * renderLadder(lad, { negotiation, vendor, simulated, live, listen }) -> element
 * lad = ladderRows(negotiation); listen = the Listen-in control (or null).
 */
export function renderLadder(lad, { negotiation, vendor, simulated, live = false, listen = null } = {}) {
  const sim = Boolean(simulated || lad.simulated);
  const head = h("header", { class: "b3-lad-head" },
    h("div", { class: "b3-lad-title-row" },
      h("span", { class: "b3-lad-ico", "aria-hidden": "true" }, icon("handshake", 22)),
      h("h2", { class: "b3-lad-title", text: t("ladder.title") }),
      badge(lad, live)),
    vendor || sim ? h("p", { class: "b3-lad-who" },
      vendor ? h("span", { class: "b3-lad-vendor" }, icon("store", 18), scripted("span", vendor)) : null,
      sim ? simPill() : null) : null);

  let body;
  if (!negotiation) {
    body = h("p", { class: "b3-lad-quiet" }, icon("handshake", 20), h("span", { text: t("b3.lad.none") }));
  } else if (!lad.rows.length) {
    body = h("p", { class: "b3-lad-quiet", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }),
      h("span", { text: lad.ended ? t("ladder.noDeal") : t("b3.lad.waitStart") }));
  } else {
    const last = lad.rows[lad.rows.length - 1];
    const rungs = h("ol", { class: "b3-rungs", style: `--pairs:${Math.max(...lad.rows.map((r) => r.pair))}` },
      h("li", { class: "b3-col-head is-ask", "aria-hidden": "true" }, h("span", { class: "b3-side-dot" }), h("span", { text: t("ladder.asks") })),
      h("li", { class: "b3-col-head is-offer", "aria-hidden": "true" }, h("span", { class: "b3-side-dot" }), h("span", { text: t("ladder.offers") })),
      ...lad.rows.map((r) => {
        const who = r.side === "ask" ? t("ladder.asks") : t("ladder.offers");
        const final = lad.ended && r === last;
        return h("li", { class: `b3-rung is-${r.side}${r.meet ? " is-meet" : ""}`, style: `--pair:${r.pair};--row:${r.pair + 1}` },
          h("span", { class: "sr-only", text: `${who}: ` }),
          h("span", { class: "b3-rung-top" },
            h("span", { class: "b3-rung-who", "aria-hidden": "true" }, icon(r.side === "ask" ? "store" : "spark", 16), h("span", { text: who })),
            h("span", { class: "b3-rung-round", text: final ? t("b3.lad.final") : r.round !== null ? t("b3.lad.round", { n: r.round }) : "" })),
          h("span", { class: "b3-rung-price" }, r.meet ? icon("check", 20) : null, h("span", { text: perUnit(r.offer, r.unit || lad.unit) })),
          r.text ? scripted("span", r.text, { class: "b3-rung-said" }) : null);
      }));
    const start = lad.firstAsk !== null ? h("p", { class: "b3-lad-start" }, icon("tag", 18), h("span", { text: t("b3.lad.start", { p: perUnit(lad.firstAsk, lad.unit) }) })) : null;
    body = [rungs, start];
  }

  return h("section", { class: `b3-ladder card${live ? " card-now" : ""}`, "aria-label": t("ladder.title") }, head, ...[].concat(body), listen);
}
