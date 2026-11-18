"use strict";

/**
 * Agora RTC + RTM tokens, minted on the server only. The browser receives a
 * token for its own uid in its own channel, never the certificate.
 *
 * Shape (agora-findings.md section 1, LIVE in spike S0 with agora-token@2.0.6):
 *   RtcTokenBuilder.buildTokenWithRtm(appId, appCertificate, channel, String(uid),
 *                                     RtcRole.PUBLISHER, tokenExpire, privilegeExpire)
 * Both expiries are seconds from now; never 0; at most 86400.
 */

const { RtcTokenBuilder, RtcRole } = require("agora-token");
const { config } = require("../config");

const DEFAULT_TTL_SECONDS = 3600;
const MAX_TTL_SECONDS = 86400;

class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

/**
 * @param {string} channel
 * @param {number|string} uid
 * @param {number} [ttlSeconds]
 * @param {{appId?: string, appCertificate?: string, now?: number}} [options]  tests pass credentials
 * @returns {{token: string, expiresAt: string, appId: string}}
 */
function buildRtcRtmToken(channel, uid, ttlSeconds = DEFAULT_TTL_SECONDS, options = {}) {
  const appId = options.appId ?? config.agora.appId;
  const appCertificate = options.appCertificate ?? config.agora.appCertificate;
  if (String(appId ?? "").length !== 32 || String(appCertificate ?? "").length !== 32) {
    throw new TokenError("AGORA_NOT_CONFIGURED", "AGORA_APP_ID and AGORA_APP_CERTIFICATE must each be 32 characters.");
  }
  if (typeof channel !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(channel)) {
    throw new TokenError("INVALID_CHANNEL", "A channel name is 1 to 64 letters, digits, underscores or hyphens.");
  }
  const uidText = String(uid);
  if (!/^\d{1,10}$/.test(uidText) || Number(uidText) === 0) throw new TokenError("INVALID_UID", "A uid is a positive integer.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new TokenError("INVALID_TTL", `A token lives between 60 and ${MAX_TTL_SECONDS} seconds.`);
  }
  const token = RtcTokenBuilder.buildTokenWithRtm(appId, appCertificate, channel, uidText, RtcRole.PUBLISHER, ttlSeconds, ttlSeconds);
  if (!token) throw new TokenError("TOKEN_EMPTY", "The token builder returned an empty token.");
  const now = options.now ?? Date.now();
  return { token, expiresAt: new Date(now + ttlSeconds * 1000).toISOString(), appId };
}

module.exports = { buildRtcRtmToken, TokenError, DEFAULT_TTL_SECONDS };
