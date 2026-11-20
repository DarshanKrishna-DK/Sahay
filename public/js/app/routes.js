// Routes of the v5 app (no DOM, no imports; tested in test/routes.test.js).
//   parseRoute(hash) -> { id, sub, canonical }
// Destinations: home (default), buy, sell, stock, money, me (+ sections), needs (opens the Yes host
// where the owner is), signup, login. Old links keep working through ALIASES.

export const TABS = ["home", "buy", "sell", "stock", "money"];
export const SCREEN_IDS = [...TABS, "me"];
export const ME_SECTIONS = ["teach", "voice", "shop", "history"];
const SPECIAL = ["needs", "signup", "login"];
export const ALIASES = { "": "home", sahay: "home", talk: "home", work: "buy", orders: "buy", history: "me/history", waiting: "needs" };

export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "").split(/[?#]/)[0].toLowerCase();
  let parts = raw.split("/").filter(Boolean);
  const first = parts[0] || "";
  if (Object.prototype.hasOwnProperty.call(ALIASES, first)) parts = ALIASES[first].split("/").concat(parts.slice(1));
  let id = parts[0];
  if (!SCREEN_IDS.includes(id) && !SPECIAL.includes(id)) id = "home";
  const sub = id === "me" && ME_SECTIONS.includes(parts[1]) ? parts[1] : null;
  return { id, sub, canonical: `#/${id}${sub ? `/${sub}` : ""}` };
}
