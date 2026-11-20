"use strict";

/**
 * Owner accounts: register (phone + 4-digit PIN, optionally claiming the device-session
 * business the browser already has), PIN login with lockout, and passkeys (./passkeys).
 * HTTP lives in src/routes/auth.js; this module never sees a request.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const { AccountError } = require("./errors");
const { normalisePhone, maskPhone } = require("./phone");
const pin = require("./pin");
const lockout = require("./lockout");
const store = require("./store");
const passkeys = require("./passkeys");
const sessions = require("./browser-sessions");

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
 * Check a PIN for a phone, counting the attempt per phone + `address` (the client address bucket,
 * or "untrusted") and per phone from anywhere (./lockout). Returns {account, businessId}.
 * Throws PIN_LOCKED (429, retryAfterSeconds) or WRONG_PIN (401); an unknown phone costs the same
 * scrypt work and answers exactly like a wrong PIN. When a failure locks the whole phone, the
 * account's business gets an audit row and, if a Telegram chat is linked, a notice.
 */
async function loginWithPin({ phone, pin: pinText, address }) {
  const attempt = lockout.attempt({ phone, address });
  if (attempt.locked) throw pinLocked(attempt.retryAfterSeconds);
  let ok = false;
  try {
    const row = store.findByPhone(phone);
    ok = (await pin.verifyPin(pinText, row?.pin_hash ?? (await pin.decoyHash()))) && Boolean(row);
    const result = attempt.finish(ok);
    if (result.lockedNow === "phone" && row) phoneLocked(row.id, result.retryAfterSeconds);
    if (!ok) throw result.locked ? pinLocked(result.retryAfterSeconds) : new AccountError("WRONG_PIN", "That phone number and PIN do not match.", 401);
    return { account: store.getAccount(row.id), businessId: primaryBusiness(row.id) };
  } catch (err) {
    attempt.finish(ok);
    throw err;
  }
}

const LOCK_NOTICE = {
  "en-IN": (minutes) => `Sahay: someone entered a wrong PIN for your account 10 times. PIN login is paused for ${minutes} minutes. You can still log in with your fingerprint (passkey). If this was not you, keep your PIN private.`,
  "hi-IN": (minutes) => `सहाय: आपके खाते पर 10 बार गलत पिन डाला गया। पिन से लॉग इन ${minutes} मिनट के लिए रोका गया है। आप फ़िंगरप्रिंट (पासकी) से लॉग इन कर सकते हैं। अगर यह आप नहीं थे, तो अपना पिन किसी को न बताएं।`,
  "kn-IN": (minutes) => `ಸಹಾಯ್: ನಿಮ್ಮ ಖಾತೆಗೆ 10 ಬಾರಿ ತಪ್ಪು ಪಿನ್ ಹಾಕಲಾಗಿದೆ. ಪಿನ್ ಲಾಗ್ ಇನ್ ಅನ್ನು ${minutes} ನಿಮಿಷ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ನೀವು ಬೆರಳಚ್ಚು (ಪಾಸ್‌ಕೀ) ಮೂಲಕ ಲಾಗ್ ಇನ್ ಮಾಡಬಹುದು. ಇದು ನೀವಲ್ಲದಿದ್ದರೆ, ನಿಮ್ಮ ಪಿನ್ ಅನ್ನು ಯಾರಿಗೂ ಹೇಳಬೇಡಿ.`,
};

/**
 * The whole phone was just locked: an audit row on the account's business (no phone number) and a
 * Telegram notice to its linked chat. A Telegram failure is recorded as an error event, never thrown
 * into the login answer.
 */
function phoneLocked(accountId, retryAfterSeconds) {
  const [businessId] = store.businessesOf(accountId);
  if (!businessId) return;
  const minutes = Math.ceil(retryAfterSeconds / 60);
  events.emit(businessId, "account.pin_locked", { accountId, scope: "phone", minutes }, { actor: "system" });
  const telegram = require("../notify/telegram");
  if (!telegram.isConfigured()) return;
  const language = repo.getBusiness(businessId)?.language;
  const text = (LOCK_NOTICE[language] ?? LOCK_NOTICE["en-IN"])(minutes);
  telegram.sendToOwner(businessId, text).catch((err) => {
    events.emit(businessId, "error", { code: err?.code ?? "TELEGRAM_FAILED", scope: "account.pin_locked", message: "The PIN lock notice could not be sent on Telegram." });
  });
}

function pinLocked(retryAfterSeconds) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return Object.assign(new AccountError("PIN_LOCKED", `Too many wrong PINs. Wait ${minutes} minutes or use your passkey.`, 429), { retryAfterSeconds });
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
  store, passkeys, sessions,
};
