"use strict";

/**
 * Server-side state of browser sessions (security review r2 #5). The cookie stays a signed token
 * with its own expiry (src/auth.js); on every request auth.requireSession also asks check():
 *
 *   - a session revoked by logout is refused (revoked_sessions, keyed by the token's sessionId);
 *   - an account session is live only while that account is still linked to that business;
 *   - a device session (no account) is live only while nobody owns its business: once an account
 *     claims the business, every old device token for it stops working.
 *
 * Rows are written only for revoked sessions and pruned once their token would have expired, so
 * sessions issued before this table existed keep working until they are logged out or expire.
 */

const db = require("../db");

const REASONS = ["logout"];

/** null when the session may be used, else the refusal code. `claims` come from auth.verifySession. */
function check(claims) {
  if (db.prepare("SELECT 1 AS revoked FROM revoked_sessions WHERE session_id = ?").get(claims.sessionId)) return "SESSION_REVOKED";
  if (claims.accountId !== undefined) {
    const linked = db.prepare("SELECT 1 AS ok FROM account_businesses WHERE business_id = ? AND account_id = ?").get(claims.businessId, claims.accountId);
    return linked ? null : "ACCOUNT_NOT_LINKED";
  }
  const owned = db.prepare("SELECT 1 AS owned FROM account_businesses WHERE business_id = ? AND role = 'owner'").get(claims.businessId);
  return owned ? "DEVICE_SESSION_CLAIMED" : null;
}

/** End a session before its token expires. Idempotent. Prunes rows whose tokens have expired anyway. */
function revoke(claims, reason) {
  if (!REASONS.includes(reason)) throw new Error(`revoke reason must be one of: ${REASONS.join(", ")}.`);
  if (typeof claims?.sessionId !== "string" || claims.sessionId === "") throw new Error("revoke needs the token's sessionId.");
  const nowSeconds = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    db.prepare("DELETE FROM revoked_sessions WHERE expires_at < ?").run(nowSeconds);
    db.prepare("INSERT OR IGNORE INTO revoked_sessions (session_id, business_id, reason, revoked_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      claims.sessionId, claims.businessId, reason, new Date().toISOString(), claims.exp,
    );
  });
}

module.exports = { check, revoke };
