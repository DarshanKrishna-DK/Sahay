"use strict";

/**
 * Data access for accounts, the businesses they own and their passkeys (schema section "ACC").
 * Accounts are not tenant-owned; every function about a business takes businessId first.
 * Never logs a phone number or a PIN hash.
 */

const crypto = require("node:crypto");
const db = require("../db");
const { AccountError } = require("./errors");

const newId = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
const now = () => new Date().toISOString();
const PHONE = /^\+91[6-9][0-9]{9}$/;
const isUniqueViolation = (err) => /UNIQUE constraint failed/.test(String(err?.message));

function requireBusinessId(businessId) {
  if (typeof businessId !== "string" || businessId === "") {
    throw Object.assign(new AccountError("BUSINESS_REQUIRED", "A business id is required."), { status: 500 });
  }
  return businessId;
}

/** What the API shows of an account: never the PIN hash. */
function publicAccount(row) {
  return { id: row.id, phone: row.phone, phone_verified: row.phone_verified === 1 || row.phone_verified === true };
}

/** Create an account. `phone` must already be normalised; `pinHash` comes from pin.hashPin. */
function createAccount({ phone, pinHash }) {
  if (typeof phone !== "string" || !PHONE.test(phone)) throw new AccountError("INVALID_PHONE", "Give a 10-digit Indian mobile number.");
  if (typeof pinHash !== "string" || !pinHash.startsWith("scrypt$")) throw new AccountError("INVALID", "A PIN hash is required.");
  const row = { id: newId("acc"), phone, pin_hash: pinHash, phone_verified: 0, created_at: now() };
  try {
    db.prepare("INSERT INTO accounts (id, phone, pin_hash, phone_verified, created_at) VALUES (?, ?, ?, ?, ?)").run(
      row.id, row.phone, row.pin_hash, row.phone_verified, row.created_at,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("PHONE_TAKEN", "This phone number already has a Sahay account. Log in instead.", 409);
    throw err;
  }
  return getAccount(row.id);
}

/** The account row without its PIN hash, or null. */
function getAccount(accountId) {
  if (typeof accountId !== "string" || accountId === "") return null;
  const row = db.prepare("SELECT id, phone, phone_verified, created_at FROM accounts WHERE id = ?").get(accountId);
  return row ? { ...row } : null;
}

/** The account row WITH its PIN hash (login only), or null. */
function findByPhone(phone) {
  if (typeof phone !== "string") return null;
  const row = db.prepare("SELECT * FROM accounts WHERE phone = ?").get(phone);
  return row ? { ...row } : null;
}

/** Make `accountId` the owner of `businessId`. Throws ALREADY_CLAIMED when the business has an owner. */
function linkBusiness(businessId, accountId) {
  requireBusinessId(businessId);
  try {
    db.prepare("INSERT INTO account_businesses (account_id, business_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(accountId, businessId, now());
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("ALREADY_CLAIMED", "This business already belongs to an account.", 409);
    throw err;
  }
}

/** The owner account id of a business, or null for a device-session business nobody claimed. */
function ownerOf(businessId) {
  requireBusinessId(businessId);
  return db.prepare("SELECT account_id FROM account_businesses WHERE business_id = ? AND role = 'owner'").get(businessId)?.account_id ?? null;
}

function isLinked(businessId, accountId) {
  requireBusinessId(businessId);
  return Boolean(db.prepare("SELECT 1 AS ok FROM account_businesses WHERE business_id = ? AND account_id = ?").get(businessId, accountId));
}

/** Business ids the account owns, oldest link first. */
function businessesOf(accountId) {
  return db
    .prepare("SELECT business_id FROM account_businesses WHERE account_id = ? ORDER BY created_at, rowid")
    .all(accountId)
    .map((r) => r.business_id);
}

/* ------------------------------------------------------------ passkeys --- */

function passkeyRow(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    credential_id: row.credential_id,
    publicKey: new Uint8Array(row.public_key),
    counter: Number(row.counter),
    transports: row.transports ? JSON.parse(row.transports) : undefined,
    created_at: row.created_at,
  };
}

function addPasskey(accountId, { credentialId, publicKey, counter = 0, transports }) {
  if (typeof credentialId !== "string" || credentialId === "" || !(publicKey instanceof Uint8Array)) {
    throw new AccountError("INVALID", "A passkey needs a credential id and a public key.");
  }
  const row = {
    id: newId("pky"),
    transports: Array.isArray(transports) && transports.every((t) => typeof t === "string") ? JSON.stringify(transports) : null,
    created_at: now(),
  };
  try {
    db.prepare("INSERT INTO passkeys (id, account_id, credential_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      row.id, accountId, credentialId, publicKey, counter, row.transports, row.created_at,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("PASSKEY_EXISTS", "This passkey is already saved.", 409);
    throw err;
  }
  return { id: row.id, created_at: row.created_at };
}

function listPasskeys(accountId) {
  return db.prepare("SELECT * FROM passkeys WHERE account_id = ? ORDER BY created_at, rowid").all(accountId).map(passkeyRow);
}

function passkeyByCredentialId(credentialId) {
  if (typeof credentialId !== "string" || credentialId === "") return null;
  const row = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId);
  return row ? passkeyRow(row) : null;
}

/** Raise the stored signature counter; never lowers it. */
function updatePasskeyCounter(credentialId, counter) {
  db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND counter < ?").run(counter, credentialId, counter);
}

module.exports = {
  publicAccount, createAccount, getAccount, findByPhone,
  linkBusiness, ownerOf, isLinked, businessesOf,
  addPasskey, listPasskeys, passkeyByCredentialId, updatePasskeyCounter,
};
