// The price ladder (UI v4, Stitch 05-buy-laptop): one card. Head: title, "talking now" badge, what
// is being bought, and on the right the seller's latest ask (or the agreed price). Body: one numbered
// row per price said, in order: who said it (the seller, with the simulated-vendor pill, or Sahay),
// the words that came with it, the label and the price, and an "Agreed" / "Latest" tag. The agreed
// row is highlighted. Foot: Listen in and the decision buttons (passed in by work.js).
// Prices come only from negotiation turns (buy-model ladderRows); nothing is filled in.

import { h, icon, scripted, rupees } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { simPill } from "./buy-kit.js";

const perUnit = (p, unit) => `${rupees(p)}${unit ? ` / ${unitWord(unit)}` : ""}`;

/**
 * renderLadder(lad, { negotiation, vendor, simulated, live, sub, foot }) -> element
 * lad = ladderRows(negotiation); sub = "item · quantity needed"; foot = nodes for the card's foot.
 */
export function renderLadder(lad, { negotiation, vendor, simulated, live = false, sub = "", foot = [] } = {}) {
  const sim = Boolean(simulated || lad.simulated);
  const unit = lad.unit;
  const headline = lad.agreed !== null
    ? h("div", { class: "b4-lad-best is-agreed" }, h("span", { class: "b4-lad-best-label", text: t("b4.lad.agreedAt") }),
      h("span", { class: "b4-lad-best-num t-money" }, icon("lock", 18), h("span", { text: rupees(lad.agreed) }), unit ? h("span", { class: "b4-per", text: `/ ${unitWord(unit)}` }) : null))
    : lad.lastAsk !== null
      ? h("div", { class: "b4-lad-best" }, h("span", { class: "b4-lad-best-label", text: t("b4.lad.latestAsk") }),
        h("span", { class: "b4-lad-best-num t-money" }, h("span", { text: rupees(lad.lastAsk) }), unit ? h("span", { class: "b4-per", text: `/ ${unitWord(unit)}` }) : null))
      : null;

  const head = h("header", { class: "b4-lad-head" },
    h("span", { class: "b4-card-ico", "aria-hidden": "true" }, icon("handshake", 22)),
    h("div", { class: "b4-lad-titles" },
      h("div", { class: "b4-lad-title-row" },
        h("h2", { class: "b4-card-title t-h3", text: t("b4.lad.title") }),
        live ? h("span", { class: "b4-live", role: "status" }, h("span", { class: "b4-live-dot", "aria-hidden": "true" }), h("span", { text: t("b3.lad.live") })) : null,
        lad.noDeal ? h("span", { class: "b4-tag is-bad" }, icon("x", 16), h("span", { text: t("ladder.noDeal") })) : null),
      sub ? scripted("p", sub, { class: "b4-card-sub" }) : null),
    headline);

  let body;
  if (!negotiation) {
    body = h("p", { class: "b4-quiet" }, icon("handshake", 20), h("span", { text: t("b3.lad.none") }));
  } else if (!lad.rows.length) {
    body = h("p", { class: "b4-quiet", role: "status" }, lad.ended ? icon("x", 20) : h("span", { class: "spinner", "aria-hidden": "true" }),
      h("span", { text: lad.ended ? t("ladder.noDeal") : t("b3.lad.waitStart") }));
  } else {
    const last = lad.rows[lad.rows.length - 1];
    body = h("ol", { class: "b4-rungs" }, ...lad.rows.map((r, i) => {
      const ask = r.side === "ask";
      const who = ask ? (vendor || t("ladder.asks")) : t("b4.lad.sahay");
      const tag = r.meet ? h("span", { class: "b4-tag is-ok" }, icon("check", 16), h("span", { text: t("b4.lad.tagAgreed") }))
        : live && r === last ? h("span", { class: "b4-tag" }, h("span", { text: t("b4.lad.tagLatest") })) : null;
      return h("li", { class: `b4-rung is-${r.side}${r.meet ? " is-meet" : ""}` },
        h("span", { class: "b4-rung-num", "aria-hidden": "true", text: String(i + 1) }),
        h("div", { class: "b4-rung-main" },
          h("p", { class: "b4-rung-who" },
            ask ? icon("store", 16) : icon("spark", 16),
            scripted("span", who, { class: "b4-rung-name" }),
            ask && sim ? simPill() : null),
          r.text ? scripted("p", r.text, { class: "b4-rung-said" }) : null),
        h("div", { class: "b4-rung-end" },
          h("p", { class: "b4-rung-price" },
            h("span", { class: "b4-rung-label", text: ask ? t("ladder.asks") : t("ladder.offers") }),
            h("span", { class: "b4-rung-num-price t-money", text: perUnit(r.offer, r.unit || unit) })),
          tag));
    }));
  }

  const footNodes = [].concat(foot).filter(Boolean);
  return h("section", { class: `b4-ladder card${live ? " is-live" : ""}`, "aria-label": t("b4.lad.title") },
    head, body, footNodes.length ? h("footer", { class: "b4-lad-foot" }, ...footNodes) : null);
}
