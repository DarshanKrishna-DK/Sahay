// Route id -> screen factory. A screen is { el, update(state, parts), enter?(), leave?() }.

import { createTalk } from "./talk.js";
import { createWork } from "./work.js";
import { createOrders } from "./orders.js";
import { createMe } from "./me.js";
import { createHistory } from "./history.js";

export const SCREENS = {
  talk: createTalk,
  work: createWork,
  orders: createOrders,
  me: createMe,
  history: createHistory,
};
