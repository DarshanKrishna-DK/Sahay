"use strict";

/**
 * An item's HSN and GST rate are never guessed (contract SELL, set_item). The server reads them
 * back to the owner in the call (recordSpoken); only the owner's spoken yes to exactly that
 * sentence (confirm) writes them onto the item (src/stock/items.js upsert) and marks the read-back
 * confirmed. An invoice uses an item's tax only when a confirmed read-back with the same item,
 * HSN and rate exists (confirmedTax), whatever else may have written the item's columns.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const gst = require("./gst");
const { SellError } = require("./errors");
const { canonicalUnit } = require("../procurement/units");

const items = () => require("../stock/items");

const READBACK = {
  "hi-IN": (v) => `${v.item}: एचएसएन कोड ${v.hsnSpoken}, जीएसटी ${v.rate} प्रतिशत${v.price ? `, बिक्री भाव ${v.price} रुपये प्रति ${v.unit}` : ""}। क्या यह सही है?`,
  "kn-IN": (v) => `${v.item}: ಎಚ್‌ಎಸ್‌ಎನ್ ಕೋಡ್ ${v.hsnSpoken}, ಜಿಎಸ್‌ಟಿ ಶೇಕಡಾ ${v.rate}${v.price ? `, ಮಾರಾಟ ಬೆಲೆ ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ` : ""}. ಇದು ಸರಿಯೇ?`,
  "en-IN": (v) => `${v.item}: HSN code ${v.hsnSpoken}, GST ${v.rate} percent${v.price ? `, selling price ${v.price} rupees per ${v.unit}` : ""}. Is that right?`,
};

/** HSN read digit by digit ("1 0 0 6"), so speech does not turn it into "one thousand and six". */
const hsnSpoken = (hsn) => hsn.split("").join(" ");

/** The read-back sentence for an item's tax, in a language and its own script. */
function readback({ item, hsn, gstRate, salePrice, unitWord }, language) {
  const sentence = READBACK[language];
  if (!sentence) throw new SellError("UNSUPPORTED_LANGUAGE", `No read-back wording for "${language}".`);
  return sentence({ item, hsnSpoken: hsnSpoken(hsn), rate: String(gstRate), price: salePrice != null ? String(salePrice) : null, unit: unitWord });
}

/** Validate what the owner said before anything is read back. */
function validate({ hsn, gst_rate: gstRate, unit }) {
  const clean = gst.parseHsn(hsn);
  if (!gst.isLegalRate(gstRate)) throw new SellError("GST_RATE_INVALID", `${gstRate}% is not a GST rate. Rates are ${gst.LEGAL_RATES.join(", ")} percent.`);
  const canonical = unit == null ? null : canonicalUnit(unit);
  if (unit != null && !canonical) throw new SellError("UNKNOWN_UNIT", `Unknown unit "${unit}".`);
  return { hsn: clean, gstRate, unit: canonical };
}

/**
 * The server spoke `text` (an item tax read-back) through agentId. Earlier pending read-backs of
 * this business are superseded, so a yes can only confirm the latest one.
 */
function recordSpoken(businessId, { itemName, unit = null, salePrice = null, hsn, gstRate, agentId, text, sessionId = null }) {
  if (!agentId) throw new SellError("READBACK_NOT_SPOKEN", "An item's tax is read out in a call before it is confirmed.", { status: 409 });
  return db.transaction(() => {
    const at = new Date().toISOString();
    db.prepare("UPDATE item_tax_readbacks SET status = 'superseded', decided_at = ? WHERE business_id = ? AND status = 'pending'").run(at, businessId);
    const id = repo.newId("itx");
    db.prepare(
      `INSERT INTO item_tax_readbacks (id, business_id, item_name, unit, sale_price, hsn, gst_rate, agent_id, spoken_text, status, spoken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, businessId, itemName, unit, salePrice, hsn, gstRate, agentId, text, at);
    const row = get(businessId, id);
    events.emit(businessId, "item.tax_spoken", { readbackId: id, item: itemName, hsn, gstRate, text }, { sessionId, actor: "agent" });
    return row;
  });
}

function get(businessId, id) {
  return db.prepare("SELECT * FROM item_tax_readbacks WHERE business_id = ? AND id = ?").get(businessId, id) ?? null;
}

/** The pending read-back this call's agent spoke last, or null. */
function pendingFor(businessId, agentId) {
  return db
    .prepare("SELECT * FROM item_tax_readbacks WHERE business_id = ? AND agent_id = ? AND status = 'pending' ORDER BY spoken_at DESC, rowid DESC LIMIT 1")
    .get(businessId, agentId) ?? null;
}

/**
 * The owner's spoken yes to the pending read-back (answerAfterSpoken: after it, in order, not over
 * it, nothing else read out in between, a typed reply never counts). Writes the item and marks the
 * read-back confirmed. Returns { item, readback }.
 */
function confirm(businessId, { agentId, history, sessionId = null }) {
  const pending = agentId ? pendingFor(businessId, agentId) : null;
  if (!pending) throw new SellError("READBACK_NOT_SPOKEN", "No item tax was read out in this call.", { status: 409 });
  const { text } = approvals.answerAfterSpoken(businessId, history, { agentId, spoken: [pending.spoken_text], subject: {} });
  if (approvals.classifyUtterance(text) !== "affirmative") {
    throw new SellError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes; the item's tax is not saved.", { status: 409 });
  }
  return db.transaction(() => {
    const fields = { name: pending.item_name, hsn: pending.hsn, gst_rate: pending.gst_rate };
    if (pending.unit) fields.unit = pending.unit;
    if (pending.sale_price != null) fields.sale_price = pending.sale_price;
    const item = items().upsert(businessId, fields, { sessionId, actor: "owner" });
    const changed = db
      .prepare("UPDATE item_tax_readbacks SET status = 'confirmed', item_id = ?, evidence_utterance = ?, decided_at = ? WHERE business_id = ? AND id = ? AND status = 'pending'")
      .run(item.id, text, new Date().toISOString(), businessId, pending.id).changes;
    if (changed !== 1) throw new SellError("ALREADY_DECIDED", "This item's tax was already decided.", { status: 409 });
    events.emit(businessId, "item.tax_confirmed", { itemId: item.id, item: item.name, hsn: pending.hsn, gstRate: pending.gst_rate, evidenceUtterance: text }, { sessionId, actor: "owner" });
    return { item, readback: get(businessId, pending.id) };
  });
}

/**
 * The item's HSN and GST rate when the owner confirmed exactly these by voice; null otherwise
 * (never set, set by something else, or changed since the confirmation).
 */
function confirmedTax(businessId, item) {
  if (!item?.id || item.hsn == null || item.gst_rate == null) return null;
  const row = db
    .prepare("SELECT 1 FROM item_tax_readbacks WHERE business_id = ? AND item_id = ? AND status = 'confirmed' AND hsn = ? AND gst_rate = ? LIMIT 1")
    .get(businessId, item.id, item.hsn, item.gst_rate);
  return row ? { hsn: item.hsn, gstRate: item.gst_rate } : null;
}

module.exports = { readback, validate, recordSpoken, get, pendingFor, confirm, confirmedTax, hsnSpoken };
