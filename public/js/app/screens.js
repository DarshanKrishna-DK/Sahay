// Route id -> screen factory. A screen is { el, update(state, parts), enter?({ sub }), leave?() }.
// Each owner edits only its own line: W2 home, W4A buy / stock, W4B sell / money, W5 me (and its
// sections via enter({ sub })). Until a screen lands its line points at a title-only placeholder.

import { placeholder } from "./placeholder.js";
import { createBuy } from "./buy.js";
import { createStock } from "./stock.js";
import { createSell } from "./sell.js";
import { createMoney } from "./money.js";

export const SCREENS = {
  home: placeholder("nav.home"),
  buy: createBuy,
  sell: createSell,
  stock: createStock,
  money: createMoney,
  me: placeholder("nav.me"),
};

/** The log in / sign up view (W5): a factory ({ mode }) -> { el, update(), show(mode), destroy() }. */
export const AUTH = null;
