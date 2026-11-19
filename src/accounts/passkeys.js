"use strict";

/**
 * Passkeys (WebAuthn) with @simplewebauthn/server 14.0.3.
 *
 * Relying party: the PUBLIC_URL host and origin; a page opened on localhost uses rpID
 * "localhost" and its own origin (local development). User verification is "preferred"
 * (fingerprint / screen lock when the device has one); verification does not require it.
 *
 * A challenge is remembered in this process for 5 minutes with what it was issued for
 * (registration for one account, or login, optionally for one account), and is taken at most
 * once: the challenge inside the browser's response names it, so no cookie is needed.
 */

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { config } = require("../config");
const { AccountError } = require("./errors");
const store = require("./store");

const RP_NAME = "Sahay";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 60 * 1000;
const MAX_CHALLENGES = 5000;

const rejected = (status = 400) => new AccountError("PASSKEY_REJECTED", "That passkey could not be checked. Try again or use your PIN.", status);

/**
 * `{rpID, origin}` for a request. `req` needs hostname, protocol and host (the Host header with port).
 * Only "localhost" gets its own relying party; any other host, forged or not, gets PUBLIC_URL's.
 */
function relyingParty({ hostname, protocol, host }, publicUrl = config.publicUrl) {
  if (hostname === "localhost") return { rpID: "localhost", origin: `${protocol}://${host}` };
  if (!publicUrl) throw new AccountError("PASSKEY_UNAVAILABLE", "Passkeys need PUBLIC_URL to be set on this server.", 503);
  const url = new URL(publicUrl);
  return { rpID: url.hostname, origin: url.origin };
}

const fromRequest = (req) => relyingParty({ hostname: req.hostname, protocol: req.protocol, host: req.get("host") });

/* ---------------------------------------------------------- challenges --- */

const pending = new Map(); // challenge -> { kind, accountId, rp, expires }

const challenges = {
  remember(challenge, { kind, accountId = null, restrict = false, rp }, now = Date.now()) {
    if (pending.size >= MAX_CHALLENGES) {
      for (const [c, v] of pending) if (v.expires <= now) pending.delete(c);
      // Still full: drop the oldest (Map keeps insertion order).
      while (pending.size >= MAX_CHALLENGES) pending.delete(pending.keys().next().value);
    }
    pending.set(challenge, { kind, accountId, restrict, rp, expires: now + CHALLENGE_TTL_MS });
  },
  /** The record for `challenge` if it was issued for `kind` and has not expired; removed either way. */
  take(challenge, kind, now = Date.now()) {
    if (typeof challenge !== "string") return null;
    const record = pending.get(challenge);
    if (!record) return null;
    pending.delete(challenge);
    if (record.kind !== kind || record.expires <= now) return null;
    return record;
  },
  reset() {
    pending.clear();
  },
};

/** The challenge the browser signed, read from the response's clientDataJSON; null when unreadable. */
function challengeOf(response) {
  try {
    const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
    return typeof clientData?.challenge === "string" ? clientData.challenge : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- registration --- */

/** Options for navigator.credentials.create for a signed-in account. */
async function registrationOptions(account, rp) {
  const existing = store.listPasskeys(account.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: account.phone,
    userID: new TextEncoder().encode(account.id),
    timeout: TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  challenges.remember(options.challenge, { kind: "register", accountId: account.id, rp });
  return options;
}

/** Verify the browser's registration response and save the passkey. Returns {id, created_at}. */
async function verifyRegistration(account, response) {
  const challenge = response && typeof response === "object" ? challengeOf(response) : null;
  const record = challenges.take(challenge, "register");
  if (!record || record.accountId !== account.id) throw rejected();
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: record.rp.origin,
      expectedRPID: record.rp.rpID,
      requireUserVerification: false,
    });
  } catch {
    throw rejected();
  }
  if (!result.verified) throw rejected();
  const { credential } = result.registrationInfo;
  return store.addPasskey(account.id, {
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
  });
}

/* ------------------------------------------------------- authentication --- */

/**
 * Options for navigator.credentials.get.
 * - `restrict: false`: any saved passkey may sign its own account in (discoverable credential).
 * - `restrict: true`: the owner typed a phone; only that account's passkeys are listed and only
 *   they can sign in. `accountId` null (no account for that phone) lists none and admits none.
 */
async function authenticationOptions(rp, { restrict = false, accountId = null } = {}) {
  const allow = restrict ? (accountId ? store.listPasskeys(accountId) : []).map((p) => ({ id: p.credential_id, transports: p.transports })) : undefined;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: TIMEOUT_MS,
    userVerification: "preferred",
    ...(allow ? { allowCredentials: allow } : {}),
  });
  challenges.remember(options.challenge, { kind: "login", restrict, accountId, rp });
  return options;
}

/** Verify a login response. Returns the account id the passkey belongs to, or throws PASSKEY_REJECTED (401). */
async function verifyAuthentication(response) {
  const challenge = response && typeof response === "object" ? challengeOf(response) : null;
  const record = challenges.take(challenge, "login");
  if (!record) throw rejected(401);
  const passkey = store.passkeyByCredentialId(response.id);
  if (!passkey) throw rejected(401);
  if (record.restrict && record.accountId !== passkey.account_id) throw rejected(401);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: record.rp.origin,
      expectedRPID: record.rp.rpID,
      credential: { id: passkey.credential_id, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports },
      requireUserVerification: false,
    });
  } catch {
    throw rejected(401);
  }
  if (!result.verified) throw rejected(401);
  store.updatePasskeyCounter(passkey.credential_id, result.authenticationInfo.newCounter);
  return passkey.account_id;
}

module.exports = {
  relyingParty, fromRequest, challenges,
  registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication,
};
