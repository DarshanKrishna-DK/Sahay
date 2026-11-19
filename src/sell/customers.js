"use strict";

/**
 * Customers of a business (contract SELL). Every function takes businessId first.
 * One customer per name, compared folded (case, spacing and punctuation do not matter).
 * A phone is an Indian mobile number stored as its 10 digits; a GSTIN is checked (format, state,
 * check character) and sets the customer's state.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const gst = require("./gst");
const { SellError } = require("./errors");

const NAME_MAX = 120;
const ADDRESS_MAX = 300;

const fold = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .replace(/[‌‍]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") throw new SellError("BUSINESS_REQUIRED", "A business id is required.");
  return businessId;
}

function cleanName(value) {
  const name = typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!name || !/\p{L}/u.test(name)) throw new SellError("INVALID", "A customer needs a name.");
  if ([...name].length > NAME_MAX) throw new SellError("INVALID", `A customer name is at most ${NAME_MAX} characters.`);
  return name;
}

/** "+91 98450 12345", "098450-12345", "९८४५०१२३४५" -> "9845012345"; anything else is refused. */
function cleanPhone(value) {
  if (value == null || value === "") return null;
  let digits = gst.asciiDigits(value).replace(/[\s()-]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new SellError("PHONE_INVALID", "A phone number is a 10-digit Indian mobile number.");
  return digits;
}

function cleanAddress(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > ADDRESS_MAX) throw new SellError("INVALID", `address is text of at most ${ADDRESS_MAX} characters.`);
  return value.trim() || null;
}

function toCustomer(row) {
  if (!row) return null;
  const { name_key: _key, business_id: _business, ...customer } = row;
  return { ...customer, state_name: customer.state_code ? gst.stateName(customer.state_code) : null };
}

const rows = (businessId) => db.prepare("SELECT * FROM customers WHERE business_id = ? ORDER BY created_at, rowid").all(tenant(businessId));

function get(businessId, customerId) {
  if (typeof customerId !== "string" || !customerId) return null;
  return toCustomer(db.prepare("SELECT * FROM customers WHERE business_id = ? AND id = ?").get(tenant(businessId), customerId));
}

const list = (businessId) => rows(businessId).map(toCustomer);

/**
 * Customers `text` may mean: the exact name (folded), else those whose name contains every word
 * of the text, or whose words all appear in the text. Empty when none.
 */
function match(businessId, text) {
  const key = fold(text);
  if (!key) return [];
  const all = rows(businessId);
  const exact = all.filter((r) => r.name_key === key);
  if (exact.length) return exact.map(toCustomer);
  const said = key.split(" ");
  return all
    .filter((r) => {
      const words = r.name_key.split(" ");
      return said.every((w) => words.includes(w)) || words.every((w) => said.includes(w));
    })
    .map(toCustomer);
}

/** The one customer `text` names, or null; several equally good matches throw AMBIGUOUS_CUSTOMER (never a guess). */
function findByName(businessId, text) {
  const found = match(businessId, text);
  if (found.length > 1) {
    throw new SellError("AMBIGUOUS_CUSTOMER", `"${text}" may mean ${found.map((c) => c.name).join(", ")}.`, { status: 409, details: { choices: found } });
  }
  return found[0] ?? null;
}

/**
 * Add a customer, or update the one with the same name: only the fields given change.
 * @param {{name: string, phone?: string, gstin?: string, state?: string, address?: string}} fields
 * Returns { customer, created }; emits customer.saved {customer, created}.
 */
function save(businessId, fields = {}, { sessionId = null, actor = "agent" } = {}) {
  tenant(businessId);
  if (!repo.getBusiness(businessId)) throw new SellError("NOT_FOUND", "There is no such business.", { status: 404 });
  const name = cleanName(fields.name);
  const patch = {};
  if (fields.phone !== undefined) patch.phone = cleanPhone(fields.phone);
  if (fields.address !== undefined) patch.address = cleanAddress(fields.address);
  if (fields.gstin !== undefined && fields.gstin !== null && fields.gstin !== "") {
    const parsed = gst.parseGstin(fields.gstin);
    patch.gstin = parsed.gstin;
    patch.state_code = parsed.stateCode;
  }
  if (fields.state !== undefined && fields.state !== null && fields.state !== "") {
    const code = gst.stateCode(fields.state);
    if (!code) throw new SellError("STATE_UNKNOWN", `"${fields.state}" is not an Indian state or union territory.`);
    if (patch.state_code && patch.state_code !== code) throw new SellError("GSTIN_STATE_MISMATCH", "The GSTIN belongs to another state than the one given.");
    patch.state_code = code;
  }

  return db.transaction(() => {
    const key = fold(name);
    const existing = db.prepare("SELECT * FROM customers WHERE business_id = ? AND name_key = ?").get(businessId, key);
    const at = new Date().toISOString();
    let id = existing?.id;
    if (!existing) {
      id = repo.newId("cus");
      db.prepare(
        "INSERT INTO customers (id, business_id, name, name_key, phone, gstin, state_code, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, businessId, name, key, patch.phone ?? null, patch.gstin ?? null, patch.state_code ?? null, patch.address ?? null, at, at);
    } else {
      if (existing.gstin && patch.state_code && !patch.gstin && existing.state_code !== patch.state_code) {
        throw new SellError("GSTIN_STATE_MISMATCH", "This customer's GSTIN belongs to another state than the one given.");
      }
      const columns = Object.keys(patch).filter((c) => patch[c] !== existing[c]);
      if (columns.length) {
        db.prepare(`UPDATE customers SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE business_id = ? AND id = ?`).run(
          ...columns.map((c) => patch[c]),
          at,
          businessId,
          id,
        );
      }
    }
    const customer = get(businessId, id);
    events.emit(businessId, "customer.saved", { customer, created: !existing }, { sessionId, actor });
    return { customer, created: !existing };
  });
}

/**
 * Where a sale to this customer is supplied: the state of the customer's GSTIN or the state the
 * owner gave; with neither, the supply is taken as made at the shop (over the counter, IGST Act
 * s.10(1)(c)), so the shop's own state. The caller prints the place of supply on the invoice.
 */
const placeOfSupply = (customer, supplierState) => customer?.state_code ?? supplierState;

module.exports = { get, list, match, findByName, save, placeOfSupply, cleanPhone, fold };
