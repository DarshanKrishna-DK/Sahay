// Buy steps (UI v4, Stitch 05-buy-laptop): the current need as seven numbered steps on one line,
// Need -> Sellers -> Bargain -> Your yes -> Ordered -> Paid -> Reminder. Each step: a numbered dot
// (a check when done, an alert when it needs the owner, a cross when it stopped), "n. Name", and one
// line of real figures from the store (buy-model hudFor) or its state word. Horizontal when the
// card is wide (container query in app-buy.css), vertical on a phone. A step opens its sheet.

import { h, icon, rupees, toDate, amount } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { simPill, timeOnly, dateTime, itemWords } from "./buy-kit.js";
import { shortName } from "./buy-model.js";

export const STATION_WORD = { heard: "b4.step.heard", search: "b4.step.search", bargain: "b4.step.bargain", yes: "b4.step.yes", ordered: "b4.step.ordered", paid: "b4.step.paid", reminder: "b4.step.reminder" };
export const STATE_WORD = { done: "st.done", active: "st.active", needs: "st.needsYou", upcoming: "st.upcoming", failed: "st.failed" };

const perUnit = (p, unit) => `${rupees(p)}${unit ? `/${unitWord(unit)}` : ""}`;

/** The one line under a step: real figures only, else the step's state word (nothing while upcoming). */
export function stepLine(s, hud, req) {
  const x = hud && hud[s.id];
  switch (s.id) {
    case "heard":
      if (req) {
        const line = [amount(req.quantity), unitWord(req.unit), itemWords(req.item)].filter((v) => v !== null && v !== undefined && v !== "").join(" ");
        if (line) return line;
        const d = toDate(req.createdAt);
        if (d) return timeOnly(d);
      }
      break;
    case "search":
      if (x && x.error) return t("b3.searchFailed");
      if (x && x.sellers) return x.sellers === 1 ? t("b3.hud.sellersOne") : t("b3.hud.sellers", { n: x.sellers });
      break;
    case "bargain":
      if (x && x.agreed !== null) return t("ladder.agreed", { p: perUnit(x.agreed, x.unit) });
      if (x && x.ask !== null) return `${t("b3.hud.round", { n: x.rounds })} · ${perUnit(x.ask, x.unit)}`;
      break;
    case "yes":
      if (x) return t("b3.hud.total", { p: rupees(x.total) });
      break;
    case "ordered":
      if (x) return x.po;
      break;
    case "paid":
      if (x) return x.paid ? t("b3.hud.paid") : t("b3.hud.link");
      break;
    case "reminder":
      if (x) { const d = toDate(x.at); if (d) return t(x.sent ? "b3.hud.sent" : "b3.hud.next", { d: dateTime(d) }); }
      break;
    default:
  }
  return s.status === "upcoming" ? "" : t(STATE_WORD[s.status]);
}

/**
 * renderRiver(model, hud, req, { onStation, freshVendorIds }) -> the steps card.
 * onStation(step, button) opens the step's sheet.
 */
export function renderRiver(model, hud, req, { onStation, freshVendorIds = new Set() } = {}) {
  const { stations, vendors } = model;
  let reach = 0;
  stations.forEach((s, i) => { if (s.status !== "upcoming") reach = i; });
  const list = h("ol", { class: "b4-steps", style: `--n:${stations.length};--reach:${reach}` });
  stations.forEach((s, i) => {
    const word = t(STATION_WORD[s.id]);
    const line = stepLine(s, hud, req);
    const stateWord = t(STATE_WORD[s.status]);
    const mark = s.status === "done" ? icon("check", 18) : s.status === "failed" ? icon("x", 18) : s.status === "needs" ? icon("alert", 18) : h("span", { text: String(i + 1) });
    list.append(h("li", { class: `b4-step${i < reach ? " is-passed" : ""}`, dataset: { status: s.status, id: s.id } },
      h("button", {
        class: "b4-step-btn", type: "button",
        "aria-label": `${i + 1}. ${word}, ${stateWord}${line && line !== stateWord ? `, ${line}` : ""}`,
        on: { click: (e) => onStation && onStation(s, e.currentTarget) },
      },
      h("span", { class: "b4-step-dot", "aria-hidden": "true" }, mark),
      h("span", { class: "b4-step-text", "aria-hidden": "true" },
        h("span", { class: "b4-step-word", text: `${i + 1}. ${word}` }),
        line ? h("span", { class: "b4-step-line", text: line }) : null))));
  });

  const extra = vendors.length > 6 ? vendors.length - 5 : 0;
  const shown = vendors.slice(0, extra ? 5 : 6);
  const sellers = vendors.length ? h("div", { class: "b4-sellers" },
    h("p", { class: "b4-sellers-head" }, icon("store", 18), h("span", { text: vendors.length === 1 ? t("b3.hud.sellersOne") : t("b3.hud.sellers", { n: vendors.length }) })),
    h("ul", { class: "b4-sellers-list" },
      ...shown.map((v, i) => {
        const full = String(v.name || "");
        return h("li", { class: `b4-seller${freshVendorIds.has(String(v.id)) ? " is-new" : ""}${v.simulated ? " is-sim" : ""}`, style: `--i:${i}`, title: v.simulated ? `${full}, ${t("simulated")}` : full },
          icon(v.simulated ? "robot" : "store", 16),
          h("span", { class: "b4-seller-name", text: shortName(full) || full }),
          v.simulated ? h("span", { class: "sr-only", text: `, ${t("simulated")}` }) : null);
      }),
      extra ? h("li", { class: "b4-seller is-more", text: `+${extra}` }) : null),
    vendors.some((v) => v.simulated) ? simPill() : null) : null;

  return h("section", { class: "b4-steps-card card", "aria-label": t("work.stations") }, list, sellers);
}
