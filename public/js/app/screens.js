// Route id -> screen factory. A screen is { el, update(state, parts), enter?(), leave?() }.
// Sell, Stock and Money are owned by the UI-B track (sell*.js, stock*.js, money*.js).

import { createTalk } from "./talk.js";
import { createBuy } from "./buy.js";
import { createSell } from "./sell.js";
import { createStock } from "./stock.js";
import { createMoney } from "./money.js";
import { createMe } from "./me.js";
import { createHistory } from "./history.js";

export const SCREENS = {
  talk: createTalk,
  buy: createBuy,
  sell: createSell,
  stock: createStock,
  money: createMoney,
  me: createMe,
  history: createHistory,
};

/** Old links keep working: #/work and #/orders are both on Buy now. */
export const ALIASES = { work: "buy", orders: "buy" };
