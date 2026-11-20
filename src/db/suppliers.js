"use strict";

/**
 * Data access for the owner's own, real suppliers (schema.sql, SUPPLIERS). Like src/db/repo.js,
 * every function takes `businessId` first and filters on it, so a supplier of another business
 * reads the same as one that does not exist. Redeeming a Telegram link code is cross-tenant by
 * nature (the code is the credential) and lives under `system`.
 */

const crypto = require("node:crypto");
const db = require("./index");
const { vendorText } = require("./vendor-text");
const { RepoError, newId } = require("./repo");

const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const MAX_ITEMS = 20;
const ITEM_MAX = 40;
const NAME_MAX = 80;
/** Prefix of a supplier's Telegram start code; an owner's code is 16 characters with no prefix. */
const CODE_PREFIX = "sup_";
const PHONE = /^\+?[0-9 ]{6,16}$/;

const now = () => new Date().toISOString();

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") throw new RepoError("BUSINESS_REQUIRED", "A business id is required.");
  return businessId;
}

const invalid = (message) => new RepoError("INVALID", message);

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    items: JSON.parse(row.items),
    language: row.language,
    phone: row.phone ?? null,
    linked: Boolean(row.telegram_chat_id),
    telegram_chat_id: row.telegram_chat_id ?? null,
    linked_at: row.linked_at ?? null,
    created_at: row.created_at,
    simulated: false,
  };
}

/** Item words as the owner said them: cleaned, de-duplicated, at least one. */
function cleanItems(items) {
  const list = Array.isArray(items) ? items : typeof items === "string" ? items.split(/[,\n;]+/) : [];
  const out = [];
  for (const raw of list) {
    const item = vendorText(raw, ITEM_MAX);
    if (item && !out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
  }
  if (!out.length) throw invalid("items must name at least one thing the supplier sells.");
  if (out.length > MAX_ITEMS) throw invalid(`At most ${MAX_ITEMS} items per supplier.`);
  return out;
}

function createSupplier(businessId, { name, items, language, phone = null }) {
  tenant(businessId);
  const clean = vendorText(name, NAME_MAX);
  if (!clean) throw invalid("name is required.");
  if (!LANGUAGES.includes(language)) throw invalid("language must be hi-IN, kn-IN or en-IN.");
  if (phone != null && phone !== "" && !PHONE.test(String(phone))) throw invalid("phone must be digits, optionally starting with +.");
  const id = newId("sup");
  db.prepare("INSERT INTO suppliers (id, business_id, name, items, language, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    businessId,
    clean,
    JSON.stringify(cleanItems(items)),
    language,
    phone ? String(phone).replace(/\s+/g, "") : null,
    now(),
  );
  return getSupplier(businessId, id);
}

function getSupplier(businessId, supplierId) {
  if (typeof supplierId !== "string" || !supplierId) return null;
  return hydrate(db.prepare("SELECT * FROM suppliers WHERE business_id = ? AND id = ?").get(tenant(businessId), supplierId));
}

function listSuppliers(businessId) {
  return db.prepare("SELECT * FROM suppliers WHERE business_id = ? ORDER BY created_at, rowid").all(tenant(businessId)).map(hydrate);
}

/** Remove a supplier. Its shortlist mappings go with it; vendor rows, quotes and orders stay. */
function removeSupplier(businessId, supplierId) {
  return db.prepare("DELETE FROM suppliers WHERE business_id = ? AND id = ?").run(tenant(businessId), String(supplierId ?? "")).changes === 1;
}

/** A fresh one-time Telegram start code for this supplier. Earlier unused codes of it stop working. */
function createLinkCode(businessId, supplierId, { expiresAt }) {
  if (!getSupplier(businessId, supplierId)) throw new RepoError("NOT_FOUND", `No supplier ${supplierId} for this business.`);
  const code = `${CODE_PREFIX}${crypto.randomBytes(12).toString("base64url")}`; // 20 chars of [A-Za-z0-9_-]
  db.transaction(() => {
    db.prepare("DELETE FROM supplier_link_codes WHERE business_id = ? AND supplier_id = ?").run(businessId, supplierId);
    db.prepare("INSERT INTO supplier_link_codes (code, business_id, supplier_id, expires_at) VALUES (?, ?, ?, ?)").run(code, businessId, supplierId, expiresAt);
  });
  return code;
}

function setTelegramChat(businessId, supplierId, chatId) {
  const chat = String(chatId ?? "").trim();
  if (!chat) throw invalid("chat_id is required.");
  db.prepare("UPDATE suppliers SET telegram_chat_id = ?, linked_at = ? WHERE business_id = ? AND id = ?").run(chat, now(), tenant(businessId), supplierId);
  return getSupplier(businessId, supplierId);
}

/** Record that a shortlisted vendor row is this supplier. */
function attachVendor(businessId, vendorId, supplierId) {
  db.prepare("INSERT INTO supplier_vendors (vendor_id, business_id, supplier_id) VALUES (?, ?, ?) ON CONFLICT (vendor_id) DO NOTHING").run(
    vendorId,
    tenant(businessId),
    supplierId,
  );
}

/** The supplier a vendor row stands for, or null (a listed or simulated vendor, or a removed supplier). */
function supplierForVendor(businessId, vendorId) {
  const row = db
    .prepare("SELECT s.* FROM supplier_vendors m JOIN suppliers s ON s.id = m.supplier_id AND s.business_id = m.business_id WHERE m.business_id = ? AND m.vendor_id = ?")
    .get(tenant(businessId), String(vendorId ?? ""));
  return hydrate(row);
}

/** Vendor ids of a requirement that are the owner's suppliers. */
function supplierVendorIds(businessId, requirementId) {
  return new Set(
    db
      .prepare("SELECT m.vendor_id FROM supplier_vendors m JOIN vendors v ON v.id = m.vendor_id WHERE m.business_id = ? AND v.requirement_id = ?")
      .all(tenant(businessId), String(requirementId ?? ""))
      .map((r) => r.vendor_id),
  );
}

const system = {
  /** Use a supplier's one-time code. Returns { businessId, supplierId } or null. */
  redeemLinkCode(code, nowIso = now()) {
    return db.transaction(() => {
      db.prepare("DELETE FROM supplier_link_codes WHERE expires_at <= ?").run(nowIso);
      const row = db.prepare("DELETE FROM supplier_link_codes WHERE code = ? RETURNING business_id, supplier_id").get(String(code ?? ""));
      return row ? { businessId: row.business_id, supplierId: row.supplier_id } : null;
    });
  },
};

const isSupplierCode = (code) => typeof code === "string" && code.startsWith(CODE_PREFIX);

module.exports = {
  CODE_PREFIX,
  LANGUAGES,
  isSupplierCode,
  createSupplier,
  getSupplier,
  listSuppliers,
  removeSupplier,
  createLinkCode,
  setTelegramChat,
  attachVendor,
  supplierForVendor,
  supplierVendorIds,
  system,
};
