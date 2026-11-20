// Buy (UI v3): everything about buying in one place. Need header and work river on top; then
// the decision lines, the price ladder with Listen in and the earlier needs on one side, and
// every purchase order (To pay, On the way with Arrived, Done) on the other. One column on a
// phone in that order; the columns come from a container query in app-buy.css, so the layout
// follows the width the shell gives the screen (nav, agent column), not the window.

import { h } from "./dom.js";
import { createWork } from "./work.js";
import { createOrders } from "./orders.js";
import { ensureCss } from "./buy-kit.js";

export function createBuy() {
  ensureCss("/css/app-buy.css");
  const work = createWork();
  const orders = createOrders();
  const el = h("section", { class: "b3-buy", "aria-labelledby": "b3-title" },
    work.head,
    work.stale,
    work.emptyBox,
    work.riverBox,
    h("div", { class: "b3-cols" },
      h("div", { class: "b3-col-a" }, work.yesBox, work.readyBox, work.ladderBox, work.earlier),
      h("div", { class: "b3-col-b" }, orders.el)));
  return {
    el,
    update(s, parts) { work.update(s, parts); orders.update(s, parts); },
    leave() { work.leave(); },
  };
}
