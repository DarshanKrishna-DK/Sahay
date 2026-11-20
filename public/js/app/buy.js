// Buy (UI v4, Stitch 05-buy-laptop). Order, top to bottom: page head ("Buy", the need, Talk), the
// steps card, then two columns: the price ladder (with Listen in and the decision in its foot) and
// the earlier needs on the left, the orders card (To pay / On the way / Done) on the right. One
// column on a phone in that order. The columns come from a container query in app-buy.css, so they
// follow the width the shell gives the screen (nav, agent column), not the window.

import { h } from "./dom.js";
import { createWork } from "./work.js";
import { createOrders } from "./orders.js";
import { ensureCss } from "./buy-kit.js";

export function createBuy() {
  ensureCss("/css/app-buy.css");
  const work = createWork();
  const orders = createOrders();
  const el = h("section", { class: "b4-buy", "aria-labelledby": "b4-title" },
    work.head,
    work.stale,
    work.riverBox,
    h("div", { class: "b4-cols" },
      h("div", { class: "b4-col-main" }, work.emptyBox, work.ladderBox, work.earlier),
      h("div", { class: "b4-col-side" }, orders.el)));
  return {
    el,
    update(s, parts) { work.update(s, parts); orders.update(s, parts); },
    leave() { work.leave(); },
  };
}
