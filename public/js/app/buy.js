// Buy: everything about buying in one place. The work river for the current need (with the price
// ladder, Listen in and earlier needs) on top, and the orders as receipts below it.

import { h } from "./dom.js";
import { createWork } from "./work.js";
import { createOrders } from "./orders.js";

export function createBuy() {
  const work = createWork();
  const orders = createOrders();
  const el = h("section", { class: "buy" }, work.el, orders.el);
  return {
    el,
    update(s, parts) { work.update(s, parts); orders.update(s, parts); },
    enter() { if (work.enter) work.enter(); },
    leave() { if (work.leave) work.leave(); },
  };
}
