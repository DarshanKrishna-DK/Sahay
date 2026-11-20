// Route id -> screen factory. A screen is { el, update(state, parts), enter?({ sub }), leave?() }.
// Each owner edits only its own line: W2 home, W4A buy / stock, W4B sell / money, W5 me (and its
// sections via enter({ sub })). Until a screen lands its line points at a title-only placeholder.

import { placeholder } from "./placeholder.js";
import { createHome } from "./home.js";

export const SCREENS = {
  home: createHome,
  buy: placeholder("nav.buy"),
  sell: placeholder("nav.sell"),
  stock: placeholder("nav.stock"),
  money: placeholder("nav.money"),
  me: placeholder("nav.me"),
};

/** The log in / sign up view (W5): a factory ({ mode }) -> { el, update(), show(mode), destroy() }. */
export const AUTH = null;
