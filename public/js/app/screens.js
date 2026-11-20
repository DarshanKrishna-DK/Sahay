// Route id -> screen factory (README-v3 section 3). A screen is { el, update(state, parts),
// enter?({ sub }), leave?() }. Each owner edits only its own line: W2 sahay, W4A buy / stock,
// W4B sell / money, W5 me (History is a section of My Sahay: #/me/history and #/history reach me with enter({ sub: "history" })). Routes and aliases are parsed in shell-geometry.js.

import { createSahayHome } from "./talk.js";
import { createBuy } from "./buy.js";
import { createSell } from "./sell.js";
import { createStock } from "./stock.js";
import { createMoney } from "./money.js";
import { createMe } from "./me.js";

export const SCREENS = {
  sahay: createSahayHome,
  buy: createBuy,
  sell: createSell,
  stock: createStock,
  money: createMoney,
  me: createMe,
};
