// Stock, as data: how full each jar is, where its reorder line sits, which items are low, and
// which open purchase orders are bringing more of an item. Pure functions, no DOM and no
// imports, so node:test loads this file as is (test/stock-model.test.js).

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Low: the server's flag when it sent one, else on hand at or under the reorder line. */
export function isLow(it) {
  if (!it) return false;
  if (typeof it.low === "boolean") return it.low;
  return isNum(it.onHand) && isNum(it.reorderLevel) && it.reorderLevel > 0 && it.onHand <= it.reorderLevel;
}

/**
 * How the jar looks: fill (0..1) of on hand, and the reorder line (0..1, null without a level).
 * The scale keeps the reorder line in the lower third so "low" reads at a glance; an item with no
 * level fills to about three quarters.
 */
export function jarLevels(it) {
  const on = Math.max(0, isNum(it && it.onHand) ? it.onHand : 0);
  const lvl = it && isNum(it.reorderLevel) && it.reorderLevel > 0 ? it.reorderLevel : null;
  const cap = lvl !== null ? Math.max(on * 1.12, lvl * 3) : on > 0 ? on / 0.74 : 1;
  const fill = Math.min(1, Math.max(0, on / cap));
  return { fill, line: lvl !== null ? Math.min(1, lvl / cap) : null };
}

/** Low items first (emptiest against its line first), then the rest by name. */
export function shelves(items, nameOf = (i) => String(i.name || "")) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const ratio = (i) => (isNum(i.onHand) ? i.onHand : 0) / (isNum(i.reorderLevel) && i.reorderLevel > 0 ? i.reorderLevel : 1);
  const low = list.filter(isLow).sort((a, b) => ratio(a) - ratio(b) || nameOf(a).localeCompare(nameOf(b)));
  const rest = list.filter((i) => !isLow(i)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return { low, rest };
}

const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which open orders bring more of each item: Map itemId -> [{ orderId, quantity, unit, po }].
 * `incoming` rows are { orderId, item, quantity, unit, po } (from the order's quote and need); an
 * order is matched to a stock item by the item's name or its native-script name, exactly.
 */
export function incomingByItem(items, incoming) {
  const byName = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    for (const n of [it.name, it.nameNative]) if (n) byName.set(norm(n), String(it.id));
  }
  const out = new Map();
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const id = row && row.item ? byName.get(norm(row.item)) : null;
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ orderId: String(row.orderId), quantity: isNum(row.quantity) ? row.quantity : null, unit: row.unit || null, po: row.po || null });
  }
  return out;
}

/** Counts for the summary line: items, low, on the way. */
export function stockCounts(items, open) {
  const list = Array.isArray(items) ? items : [];
  return { items: list.length, low: list.filter(isLow).length, coming: Array.isArray(open) ? open.length : 0 };
}

/* ------------------------------------------------------- names per script -- */

const SCRIPTS = { hi: /[ऀ-ॿ]/u, kn: /[ಀ-೿]/u, en: /[A-Za-z]/ };

/** The script a name is written in ("hi" | "kn" | "en"), or null for digits and signs only / mixed. */
export function scriptOfName(text) {
  const s = String(text || "");
  const found = Object.keys(SCRIPTS).filter((k) => SCRIPTS[k].test(s));
  return found.length === 1 ? found[0] : null;
}

/**
 * An item name as the owner's screen should show it: the same item's name in the screen's script
 * when a stock item carries one (name or native name), else the words as they were said.
 * A Kannada "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ" need on a Hindi screen reads "बासमती चावल" when stock knows both.
 */
export function itemInLang(text, items, lang) {
  if (!text) return text || "";
  const sc = scriptOfName(text);
  if (!sc || sc === lang) return text;
  const n = norm(text);
  const it = (Array.isArray(items) ? items : []).find((i) => i && [i.name, i.nameNative].some((x) => x && norm(x) === n));
  if (!it) return text;
  for (const cand of [it.nameNative, it.name]) if (cand && scriptOfName(cand) === lang) return cand;
  return text;
}
