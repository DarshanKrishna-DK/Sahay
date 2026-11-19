"use strict";

/**
 * Owner accounts: register (phone + 4-digit PIN, optionally claiming the device-session
 * business the browser already has), PIN login with lockout, and passkeys (./passkeys).
 * HTTP lives in src/routes/auth.js; this module never sees a request.
 */

const db = require("../db");
const repo = require("../db/repo");
const { AccountError } = require("./errors");
const { normalisePhone, maskPhone } = require("./phone");
const pin = require("./pin");
const lockout = require("./lockout");
const store = require("./store");
const passkeys = require("./passkeys");

/**
 * Create an account. With `claimBusinessId` (a device-session business nobody owns), the
 * account becomes its owner and the business keeps its details; otherwise a new business is
 * made from `business` ({name, city, state?, language}). Account, business and link are written
 * in one transaction. Returns {account, businessId, claimed}.
 */
async function register({ phone, pin: pinText, business, claimBusinessId = null }) {
  const pinHash = await pin.hashPin(pinText);
  return db.transaction(() => {
    const account = store.createAccount({ phone, pinHash });
    let businessId = claimBusinessId;
    if (businessId) {
      if (!repo.getBusiness(businessId)) throw new AccountError("NOT_FOUND", "That business no longer exists.", 404);
    } else {
      businessId = repo.createBusiness(repo.newId("biz"), business).id;
    }
    store.linkBusiness(businessId, account.id);
    return { account, businessId, claimed: Boolean(claimBusinessId) };
  });
}

/** A shop name compared as the owner means it: Unicode form, case and runs of spaces aside. */
const shopNameKey = (name) => (typeof name === "string" ? name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN") : "");

/**
 * Which device-session business (`device`: {id, name}, unowned, from the browser's signed cookie)
 * a signup takes over, or null for a new business. Only the same shop name as typed, or the
 * client's explicit `claimDevice === true` ("Continue with <device shop>?" answered yes): an old
 * anonymous cookie must never swallow a different shop the owner just typed (E2E 2026-11-19, 1a).
 */
function deviceBusinessToClaim({ device, typedName, claimDevice = false }) {
  if (!device?.id) return null;
  if (claimDevice === true) return device.id;
  const typed = shopNameKey(typedName);
  return typed && typed === shopNameKey(device.name) ? device.id : null;
}

/**
 * Check a PIN for a phone, counting the attempt against `lockKey` (phone + client IP).
 * Returns {account, businessId}. Throws PIN_LOCKED (429, retryAfterSeconds) or WRONG_PIN (401);
 * an unknown phone costs the same scrypt work and answers exactly like a wrong PIN.
 */
async function loginWithPin({ phone, pin: pinText, lockKey }) {
  const attempt = lockout.attempt(lockKey);
  if (attempt.locked) throw pinLocked(attempt.retryAfterSeconds);
  let ok = false;
  try {
    const row = store.findByPhone(phone);
    ok = (await pin.verifyPin(pinText, row?.pin_hash ?? (await pin.decoyHash()))) && Boolean(row);
    const result = attempt.finish(ok);
    if (!ok) throw result.locked ? pinLocked(result.retryAfterSeconds) : new AccountError("WRONG_PIN", "That phone number and PIN do not match.", 401);
    return { account: store.getAccount(row.id), businessId: primaryBusiness(row.id) };
  } catch (err) {
    attempt.finish(ok);
    throw err;
  }
}

function pinLocked(retryAfterSeconds) {
  return Object.assign(new AccountError("PIN_LOCKED", "Too many wrong PINs. Wait 15 minutes or use your passkey.", 429), { retryAfterSeconds });
}

/** The business an account signs in to: the first one it owns. */
function primaryBusiness(accountId) {
  const [businessId] = store.businessesOf(accountId);
  if (!businessId) throw new AccountError("NO_BUSINESS", "This account has no business.", 409);
  return businessId;
}

module.exports = {
  AccountError, normalisePhone, maskPhone, isPin: pin.isPin,
  register, loginWithPin, primaryBusiness, deviceBusinessToClaim,
  store, passkeys,
};
