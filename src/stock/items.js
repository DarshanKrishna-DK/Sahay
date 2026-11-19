"use strict";

/**
 * Items: what the business buys or sells (contract STK). Every function takes businessId first.
 *
 * One item is stored once whatever script it was named in: `name_key` folds the item's words the
 * same way across scripts through the trade-word table (src/discovery/slug.js itemIn), so "rice",
 * "चावल" and "ಅಕ್ಕಿ" are one item. A word the table does not know is folded as written, and the
 * item's native-script name (name_native) is matched as well.
 *
 * Quantities of an item (stock, reorder level) are in its `unit`, one of the units.js codes.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const { itemIn } = require("../discovery/slug");
const { canonicalUnit } = require("../procurement/units");
const { vendorText, VENDOR_TEXT_MAX } = require("../db/vendor-text");
const { StockError } = require("./errors");

const GST_RATE_MAX = 40;
const AMOUNT_MAX = 10_000_000;
const HAS_LETTER = /\p{L}/u;
const INDIC = /[\p{Script=Devanagari}\p{Script=Kannada}]/u;

const invalid = (message) => new StockError("INVALID_ITEM", message);
const now = () => new Date().toISOString();

/* ---------------------------------------------------------------- names --- */

/** Composed, lower case, no joiners or punctuation, single spaces. */
const fold = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .replace(/[‌‍]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

/** Words that never name an item: digits and unit words ("50 किलो चावल" names चावल). */
const isQuantityWord = (word) => /^\d+(?:\.\d+)?$/.test(word) || canonicalUnit(word) !== null;

/**
 * The item's words, the same across scripts when the trade-word table knows every word:
 * nameKey("basmati rice") === nameKey("बासमती चावल") === nameKey("ಬಾಸ್ಮತಿ ಅಕ್ಕಿ").
 */
function nameKey(text) {
  const words = fold(text).split(" ").filter((w) => w && !isQuantityWord(w));
  if (!words.length) return "";
  // The whole name first (pairs such as "wheat flour" -> आटा), else word by word, so a name with
  // one unknown word ("sona masoori rice") still shares its known words with "चावल".
  return itemIn(words.join(" "), "hi-IN") ?? words.map((w) => itemIn(w, "hi-IN") ?? w).join(" ");
}

function cleanName(value, field) {
  if (typeof value !== "string") throw invalid(`${field} is required.`);
  const clean = vendorText(value, Number.MAX_SAFE_INTEGER);
  if (!clean || !HAS_LETTER.test(clean)) throw invalid(`${field} is required.`);
  if ([...clean].length > VENDOR_TEXT_MAX) throw invalid(`${field} is at most ${VENDOR_TEXT_MAX} characters.`);
  if (!nameKey(clean)) throw invalid(`${field} must name an item, not only a quantity.`);
  return clean;
}

/* --------------------------------------------------------------- fields --- */

function cleanUnit(value) {
  const unit = typeof value === "string" ? canonicalUnit(value) : null;
  if (!unit) throw new StockError("UNKNOWN_UNIT", `Unknown unit "${value}". Use one Sahay knows, such as kg, litre, piece or bag.`, { details: { unit: value } });
  return unit;
}

function cleanHsn(value) {
  if (value == null) return null;
  const hsn = String(value).replace(/\s+/g, "");
  if (!/^\d{4,8}$/.test(hsn)) throw invalid("hsn is a code of 4 to 8 digits.");
  return hsn;
}

function cleanNumber(value, field, { max = AMOUNT_MAX } = {}) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw invalid(`${field} must be a number from 0 to ${max}.`);
  return Math.round(value * 1000) / 1000;
}

/* ----------------------------------------------------------------- rows --- */

/** The public item shape (contract STK). */
function toItem(row) {
  if (!row) return null;
  const { name_key: _key, business_id: _business, ...item } = row;
  return { ...item };
}

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") throw new StockError("BUSINESS_REQUIRED", "A business id is required.");
  return businessId;
}

const rowsOf = (businessId) => db.prepare("SELECT * FROM items WHERE business_id = ? ORDER BY created_at, rowid").all(tenant(businessId));

function get(businessId, itemId) {
  if (typeof itemId !== "string" || itemId === "") return null;
  return toItem(db.prepare("SELECT * FROM items WHERE business_id = ? AND id = ?").get(tenant(businessId), itemId));
}

const list = (businessId) => rowsOf(businessId).map(toItem);

/* ------------------------------------------------------------- matching --- */

/** Keys an item answers to: its own name and its native-script name. */
const keysOf = (row) => [row.name_key, row.name_native ? nameKey(row.name_native) : null].filter(Boolean);

/**
 * Items `text` may mean, best tier only: an exact name match (any script), else items whose words
 * all appear in the text ("basmati rice 50 kg" -> basmati rice) or that contain all of the text's
 * words ("चावल" -> बासमती चावल). Empty when nothing matches.
 */
function matchByName(businessId, text) {
  const key = nameKey(text ?? "");
  if (!key) return [];
  const rows = rowsOf(businessId);
  const exact = rows.filter((row) => keysOf(row).includes(key));
  if (exact.length) return exact.map(toItem);
  const said = new Set(key.split(" "));
  const partial = rows.filter((row) =>
    keysOf(row).some((k) => {
      const words = k.split(" ");
      return words.every((w) => said.has(w)) || [...said].every((w) => words.includes(w));
    }),
  );
  return partial.map(toItem);
}

/**
 * The one item `text` names (native script, English or a trade word), or null when none does.
 * Several equally good matches throw AMBIGUOUS_ITEM with `details.choices` (the items) so the
 * caller can ask the owner which one; a guess is never made.
 */
function findByName(businessId, text) {
  const matches = matchByName(businessId, text);
  if (matches.length > 1) {
    throw new StockError("AMBIGUOUS_ITEM", `"${text}" may mean ${matches.map((m) => m.name).join(", ")}.`, { status: 409, details: { choices: matches } });
  }
  return matches[0] ?? null;
}

/* --------------------------------------------------------------- upsert --- */

function hasMoves(businessId, itemId) {
  return Boolean(db.prepare("SELECT 1 FROM stock_moves WHERE business_id = ? AND item_id = ? LIMIT 1").get(businessId, itemId));
}

/** A native-script name to speak, when `name` is Latin and every word is in the trade-word table. */
function nativeFor(businessId, name) {
  if (INDIC.test(name)) return name;
  const language = repo.getBusiness(businessId)?.language;
  return language === "hi-IN" || language === "kn-IN" ? itemIn(name, language) : null;
}

/**
 * Create the item, or update the one with the same name in any script. Only the fields given
 * change. Returns the item; emits item.saved {item, created}.
 * The unit of an item that already has stock moves cannot change (its ledger is in that unit).
 * @param {{name: string, name_native?: string, unit?: string, hsn?: string, gst_rate?: number,
 *          sale_price?: number, reorder_level?: number}} fields  unit is required for a new item
 * @param {{sessionId?: string|null, actor?: string}} [options]
 */
function upsert(businessId, fields = {}, { sessionId = null, actor = "agent" } = {}) {
  tenant(businessId);
  const name = cleanName(fields.name, "name");
  const nameNative = fields.name_native == null ? null : cleanName(fields.name_native, "name_native");
  const patch = {};
  if (fields.unit != null) patch.unit = cleanUnit(fields.unit);
  if (fields.hsn !== undefined) patch.hsn = cleanHsn(fields.hsn);
  if (fields.gst_rate !== undefined) patch.gst_rate = cleanNumber(fields.gst_rate, "gst_rate", { max: GST_RATE_MAX });
  if (fields.sale_price !== undefined) patch.sale_price = cleanNumber(fields.sale_price, "sale_price");
  if (fields.reorder_level !== undefined) patch.reorder_level = cleanNumber(fields.reorder_level, "reorder_level");

  return db.transaction(() => {
    const keys = [nameKey(name), nameNative ? nameKey(nameNative) : null].filter(Boolean);
    const existing = rowsOf(businessId).filter((row) => keysOf(row).some((k) => keys.includes(k)));
    if (existing.length > 1) {
      throw new StockError("AMBIGUOUS_ITEM", `"${name}" matches more than one item.`, { status: 409, details: { choices: existing.map(toItem) } });
    }
    const row = existing[0];
    let created = false;
    let itemId = row?.id;
    if (!row) {
      if (!patch.unit) throw invalid("unit is required for a new item.");
      const id = repo.newId("itm");
      const at = now();
      db.prepare(
        `INSERT INTO items (id, business_id, name, name_native, name_key, unit, hsn, gst_rate, sale_price, reorder_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, businessId, name, nameNative ?? nativeFor(businessId, name), nameKey(name), patch.unit, patch.hsn ?? null, patch.gst_rate ?? null, patch.sale_price ?? null, patch.reorder_level ?? null, at, at);
      created = true;
      itemId = id;
    } else {
      if (patch.unit && patch.unit !== row.unit && hasMoves(businessId, row.id)) {
        throw new StockError("UNIT_LOCKED", `${row.name} is counted in ${row.unit}; its unit cannot change once it has stock.`, { status: 409, details: { unit: row.unit } });
      }
      if (nameNative && nameNative !== row.name_native) patch.name_native = nameNative;
      else if (!row.name_native && INDIC.test(name)) patch.name_native = name;
      const columns = Object.keys(patch).filter((c) => patch[c] !== row[c]);
      if (columns.length) {
        db.prepare(`UPDATE items SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE business_id = ? AND id = ?`).run(
          ...columns.map((c) => patch[c]),
          now(),
          businessId,
          row.id,
        );
      }
    }
    const item = get(businessId, itemId);
    events.emit(businessId, "item.saved", { item, created }, { sessionId, actor });
    return item;
  });
}

module.exports = { upsert, get, list, findByName, matchByName, nameKey };
