"use strict";

/**
 * 4-digit PINs, hashed with scrypt (random 16-byte salt) and compared with timingSafeEqual.
 * Stored form: scrypt$N$r$p$<salt base64url>$<hash base64url>.
 * A 4-digit PIN has 10,000 values, so the hash alone cannot protect it offline; the online
 * guard is src/accounts/lockout.js (5 tries per phone+address, then 15 minutes; 10 per phone from
 * anywhere in an hour, then an hour).
 */

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { AccountError } = require("./errors");

const scrypt = promisify(crypto.scrypt);
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const STORED = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{32,})$/;

const isPin = (value) => typeof value === "string" && /^[0-9]{4}$/.test(value);

async function derive(pin, salt, { N, r, p }) {
  return scrypt(pin, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });
}

async function hashPin(pin) {
  if (!isPin(pin)) throw new AccountError("INVALID_PIN", "The PIN is 4 digits.");
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await derive(pin, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** True only when `pin` matches `stored`. A malformed or foreign `stored` is false, never an exception. */
async function verifyPin(pin, stored) {
  const m = typeof stored === "string" ? STORED.exec(stored) : null;
  if (!m || !isPin(pin)) return false;
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Only the parameters Sahay writes: a stored row must not be able to ask for a huge or tiny cost.
  if (N !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p) return false;
  const expected = Buffer.from(m[5], "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(pin, Buffer.from(m[4], "base64url"), { N, r, p });
  return crypto.timingSafeEqual(actual, expected);
}

/** A real hash of a PIN nobody holds: login checks an unknown phone against it so both take the same time. */
let decoy = null;
function decoyHash() {
  decoy ??= hashPin(String(crypto.randomInt(10000)).padStart(4, "0"));
  return decoy;
}

module.exports = { isPin, hashPin, verifyPin, decoyHash };
