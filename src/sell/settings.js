"use strict";

/**
 * How a business bills: GST scheme (regular -> tax invoice, composition -> bill of supply,
 * unregistered -> plain bill), its GSTIN, address and invoice prefix. No row means the default:
 * unregistered (a plain bill, no GSTIN needed, so a first-time owner can bill at once), prefix INV.
 * Saving a GSTIN without a scheme makes the shop regular. Nothing here is guessed: a regular or
 * composition business needs its own GSTIN before it can bill, and the state comes from the GSTIN,
 * the saved state, the business's own state, or its city when the city is one of the known ones.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const gst = require("./gst");
const { citySlug } = require("../discovery/slug");
const { SellError } = require("./errors");

const DEFAULTS = Object.freeze({ gst_scheme: "unregistered", gstin: null, state_code: null, address: null, invoice_prefix: "INV" });
const ADDRESS_MAX = 300;

/**
 * GST state code of a city, for a business whose signup gave no state. Only cities whose state is
 * a fact (the IndiaMART city table in src/discovery/slug.js); any other city stays unknown.
 */
const CITY_STATE = Object.freeze({
  bengaluru: "29", mysuru: "29", hubli: "29", mangalore: "29", tumkur: "29", belgaum: "29", shimoga: "29", gulbarga: "29", bellary: "29", davangere: "29",
  delhi: "07", mumbai: "27", pune: "27", kolkata: "19", chennai: "33", gurgaon: "06", kochi: "32", trivandrum: "32",
  vadodara: "24", ahmedabad: "24", visakhapatnam: "37", hyderabad: "36", allahabad: "09", lucknow: "09", varanasi: "09", jaipur: "08", pondicherry: "34",
});
const stateOfCity = (city) => CITY_STATE[citySlug(city)] ?? null;

function row(businessId) {
  return db.prepare("SELECT * FROM sell_settings WHERE business_id = ?").get(businessId) ?? null;
}

/** The billing settings with the state code worked out (GSTIN, else saved state, else the business's state). */
function get(businessId) {
  const business = repo.getBusiness(businessId);
  if (!business) throw new SellError("NOT_FOUND", "There is no such business.", { status: 404 });
  const saved = row(businessId);
  const s = { ...DEFAULTS, ...(saved ? { gst_scheme: saved.gst_scheme, gstin: saved.gstin, state_code: saved.state_code, address: saved.address, invoice_prefix: saved.invoice_prefix } : {}) };
  const stateCode = s.gstin ? s.gstin.slice(0, 2) : s.state_code ?? gst.stateCode(business.state) ?? stateOfCity(business.city);
  return {
    gstScheme: s.gst_scheme,
    kind: gst.documentKind(s.gst_scheme),
    gstin: s.gstin,
    stateCode: stateCode ?? null,
    stateName: stateCode ? gst.stateName(stateCode) : null,
    address: s.address,
    invoicePrefix: s.invoice_prefix,
    saved: Boolean(saved),
  };
}

/**
 * Save the settings (owner's button on the Sell screen). Fields not given keep their value.
 * @param {{gst_scheme?, gstin?, state?, address?, invoice_prefix?}} fields
 */
function save(businessId, fields = {}, { sessionId = null } = {}) {
  const current = get(businessId);
  let gstin = fields.gstin === undefined ? current.gstin : fields.gstin;
  if (gstin === "") gstin = null;
  // A GSTIN on its own means the shop is GST-registered: an unregistered shop becomes regular.
  const scheme = fields.gst_scheme ?? (gstin != null && current.gstScheme === "unregistered" ? "regular" : current.gstScheme);
  gst.documentKind(scheme); // validates
  if (gstin != null) gstin = gst.parseGstin(gstin).gstin;
  if (scheme === "unregistered") gstin = null;
  let stateCode = current.saved ? row(businessId).state_code : null;
  if (fields.state !== undefined && fields.state !== null && fields.state !== "") {
    stateCode = gst.stateCode(fields.state);
    if (!stateCode) throw new SellError("STATE_UNKNOWN", `"${fields.state}" is not an Indian state or union territory.`);
  }
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) {
    throw new SellError("GSTIN_STATE_MISMATCH", "The GSTIN belongs to another state than the one given.");
  }
  let address = fields.address === undefined ? current.address : fields.address;
  if (address != null) {
    if (typeof address !== "string" || address.trim().length > ADDRESS_MAX) throw new SellError("INVALID", `address is text of at most ${ADDRESS_MAX} characters.`);
    address = address.trim() || null;
  }
  const prefix = fields.invoice_prefix ?? current.invoicePrefix;
  if (typeof prefix !== "string" || !/^[A-Z]{1,3}$/.test(prefix)) throw new SellError("INVOICE_PREFIX_INVALID", "An invoice prefix is one to three capital letters.");

  return db.transaction(() => {
    db.prepare(
      `INSERT INTO sell_settings (business_id, gst_scheme, gstin, state_code, address, invoice_prefix, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (business_id) DO UPDATE SET gst_scheme = excluded.gst_scheme, gstin = excluded.gstin, state_code = excluded.state_code,
         address = excluded.address, invoice_prefix = excluded.invoice_prefix, updated_at = excluded.updated_at`,
    ).run(businessId, scheme, gstin, stateCode, address, prefix, new Date().toISOString());
    const settings = get(businessId);
    events.emit(businessId, "sell.settings_saved", { settings }, { sessionId, actor: "owner" });
    return settings;
  });
}

/**
 * Who is billing, as printed on an invoice. Throws when a fact the document needs is missing:
 * a registered scheme without a GSTIN, or no state to work the tax out from.
 */
function supplier(businessId) {
  const business = repo.getBusiness(businessId);
  const s = get(businessId);
  if (s.gstScheme !== "unregistered" && !s.gstin) {
    throw new SellError("GSTIN_REQUIRED", "Add the shop's GSTIN in Sell settings before making a GST bill (or choose unregistered).", { status: 409 });
  }
  if (!s.stateCode) throw new SellError("STATE_REQUIRED", "Add the shop's state in Sell settings before making a bill.", { status: 409 });
  return {
    name: business.name,
    address: s.address ?? ([business.city, business.state].filter(Boolean).join(", ") || null),
    gstin: s.gstin,
    stateCode: s.stateCode,
    stateName: s.stateName,
    scheme: s.gstScheme,
    kind: s.kind,
    invoicePrefix: s.invoicePrefix,
  };
}

module.exports = { get, save, supplier, DEFAULTS };
