"use strict";

/**
 * Owner accounts over HTTP (docs/superpowers/plans/2026-11-19-business-suite-contract.md, ACC).
 *
 *   POST /api/auth/register                {phone, pin, name, city, state?, language, accessCode?, claimDevice?} -> 201 {account, business}
 *     With an unowned device-session cookie, the account takes over that business only when `name`
 *     is its name (case and spaces aside) or claimDevice is exactly true (the app asked "Continue
 *     with <device shop>?"); any other name makes a new business from the typed details.
 *   POST /api/auth/login                   {phone, pin, language?} -> 200 {account, business}
 *   POST /api/auth/logout                  -> 204
 *   GET  /api/auth/me                      -> {account, business} | 401 NOT_SIGNED_IN
 *   POST /api/auth/passkey/register/options  (signed in) -> PublicKeyCredentialCreationOptionsJSON
 *   POST /api/auth/passkey/register/verify   (signed in) body = startRegistration() result -> 201 {passkey}
 *   POST /api/auth/passkey/login/options   {phone?} -> PublicKeyCredentialRequestOptionsJSON
 *   POST /api/auth/passkey/login/verify    body = startAuthentication() result -> 200 {account, business}
 *   GET  /vendor/simplewebauthn-browser.js  the @simplewebauthn/browser UMD bundle, from node_modules
 *
 * Signing in sets the same HttpOnly session cookie as POST /api/session, signed with the
 * account and the business (src/auth.js); the rest of /api keeps resolving the tenant from it.
 * Must be mounted before the vendor router (/vendor/:code) and the api router (its
 * requireSession covers all of /api). Errors answer `{code, message, say?}`.
 */

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { config } = require("../config");
const auth = require("../auth");
const limits = require("../limits");
const repo = require("../db/repo");
const events = require("../events");
const accounts = require("../accounts");
const { AccountError, store, passkeys } = accounts;
const { HttpError, RATE, closeSessionStreams } = require("./api");
const { clientAddress, rateCheck } = require("../client-address");

const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const BROWSER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const MINUTE = 60 * 1000;
/** Per client address; `untrusted` is the one bucket all callers share when no tunnel header names them. */
const LIMITS = Object.freeze({
  pinLogin: { perIp: { max: 30, windowMs: 15 * MINUTE }, untrusted: { max: 200, windowMs: 15 * MINUTE } },
  passkeyLogin: { perIp: { max: 30, windowMs: 15 * MINUTE }, untrusted: { max: 300, windowMs: 15 * MINUTE } },
  passkeyRegisterPerAccount: { max: 10, windowMs: 10 * MINUTE },
});

/** The exact UMD file @simplewebauthn/browser ships (its package exports hide dist/, so resolve from main). */
const BROWSER_BUNDLE = path.join(path.dirname(path.dirname(require.resolve("@simplewebauthn/browser"))), "dist", "bundle", "index.umd.min.js");

/** Same character rule as nameText in src/routes/api.js: these names reach the agent's prompts. */
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NAME_MAX = 80;

const SAY = {
  PHONE_TAKEN: {
    "en-IN": "This phone number already has a Sahay account. Please log in.",
    "hi-IN": "इस फ़ोन नंबर पर पहले से सहाय खाता है। कृपया लॉग इन कीजिए।",
    "kn-IN": "ಈ ಫೋನ್ ನಂಬರ್‌ಗೆ ಈಗಾಗಲೇ ಸಹಾಯ್ ಖಾತೆ ಇದೆ. ದಯವಿಟ್ಟು ಲಾಗ್ ಇನ್ ಮಾಡಿ.",
  },
  WRONG_PIN: {
    "en-IN": "That phone number and PIN do not match. Please try again.",
    "hi-IN": "यह फ़ोन नंबर और पिन मेल नहीं खाते। कृपया फिर से कोशिश कीजिए।",
    "kn-IN": "ಈ ಫೋನ್ ನಂಬರ್ ಮತ್ತು ಪಿನ್ ಹೊಂದುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
  PIN_LOCKED: {
    // No duration here: a pair lock is 15 minutes, a whole-phone lock an hour (Retry-After says which).
    "en-IN": "Too many wrong PINs. PIN login is paused for a while; please try later, or log in with your fingerprint.",
    "hi-IN": "बहुत बार गलत पिन डाला गया। पिन से लॉग इन कुछ समय के लिए रुका है; कृपया बाद में कोशिश कीजिए, या फ़िंगरप्रिंट से लॉग इन कीजिए।",
    "kn-IN": "ತುಂಬಾ ಬಾರಿ ತಪ್ಪು ಪಿನ್ ಹಾಕಲಾಗಿದೆ. ಪಿನ್ ಲಾಗ್ ಇನ್ ಸ್ವಲ್ಪ ಸಮಯ ನಿಂತಿದೆ; ದಯವಿಟ್ಟು ನಂತರ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಬೆರಳಚ್ಚಿನಿಂದ ಲಾಗ್ ಇನ್ ಮಾಡಿ.",
  },
  PASSKEY_REJECTED: {
    "en-IN": "The fingerprint login did not work. Please try again, or use your PIN.",
    "hi-IN": "फ़िंगरप्रिंट से लॉग इन नहीं हो पाया। कृपया फिर कोशिश कीजिए, या अपना पिन डालिए।",
    "kn-IN": "ಬೆರಳಚ್ಚಿನಿಂದ ಲಾಗ್ ಇನ್ ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ನಿಮ್ಮ ಪಿನ್ ಬಳಸಿ.",
  },
  RATE_LIMITED: {
    "en-IN": "Too many tries from this network. Please wait a few minutes, then try again.",
    "hi-IN": "इस नेटवर्क से बहुत बार कोशिश हुई। कृपया कुछ मिनट रुककर फिर कोशिश कीजिए।",
    "kn-IN": "ಈ ನೆಟ್‌ವರ್ಕ್‌ನಿಂದ ತುಂಬಾ ಬಾರಿ ಪ್ರಯತ್ನಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷ ಕಾದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
};
const sayIn = (code, language) => SAY[code]?.[LANGUAGES.includes(language) ? language : "en-IN"];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** An AccountError becomes an HttpError with a line in `language`; anything else passes through. */
function asHttp(err, language) {
  if (!(err instanceof AccountError)) return err;
  return new HttpError(err.status, err.code, err.message, sayIn(err.code, language), { retryAfterSeconds: err.retryAfterSeconds });
}

function limit({ key, max, windowMs }, language) {
  if (!limits.allow(key, max, windowMs)) {
    throw new HttpError(429, "RATE_LIMITED", "Too many requests. Wait a few minutes and try again.", sayIn("RATE_LIMITED", language), {
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    });
  }
}

function nameText(value, name, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, "BUSINESS_DETAILS_REQUIRED", "Tell Sahay the shop name, city and language to sign up.");
    return undefined;
  }
  const out = typeof value === "string" ? value.trim() : null;
  if (out === null || out.length > NAME_MAX || !NAME_CHARS.test(out) || !HAS_LETTER_OR_DIGIT.test(out)) {
    throw new HttpError(400, "INVALID", `${name} may use letters, digits, spaces and . , & ' - ( ) only, at most ${NAME_MAX} characters.`);
  }
  return out;
}

function accessCodeMatches(given) {
  if (typeof given !== "string" || given.length > 256) return false;
  const digest = (s) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(digest(given), digest(config.accessCode));
}

const businessView = (b) => ({ id: b.id, name: b.name, city: b.city, state: b.state, language: b.language });

/**
 * Claims of a browser session the server still honours (not logged out; see auth.verifyBrowserSession),
 * or null. A missing signing secret is a server error, not "signed out".
 */
function cookieClaims(req) {
  try {
    return auth.verifyBrowserSession(auth.cookieToken(req));
  } catch (err) {
    if (err?.code === "NO_SECRET") throw err;
    return null;
  }
}

/** {account, business} when the cookie names an account that owns the cookie's business; else null. */
function signedIn(req) {
  const claims = cookieClaims(req);
  if (!claims?.accountId) return null;
  const account = store.getAccount(claims.accountId);
  if (!account || !store.isLinked(claims.businessId, account.id)) return null;
  const business = repo.getBusiness(claims.businessId);
  return business ? { claims, account, business } : null;
}

function requireAccount(req) {
  const who = signedIn(req);
  if (!who) throw new HttpError(401, "NOT_SIGNED_IN", "Log in to your Sahay account first.");
  return who;
}

/** Sign the session cookie for an account and its business, write the audit row and answer. */
function signIn(req, res, { account, businessId, via, status = 200, type = "account.signed_in", extra = {} }) {
  const token = auth.signSession({
    businessId,
    sessionId: repo.newId("web"),
    scope: "browser",
    exp: Math.floor(Date.now() / 1000) + BROWSER_SESSION_SECONDS,
    accountId: account.id,
  });
  auth.setSessionCookie(req, res, token);
  events.emit(businessId, type, { accountId: account.id, via, ...extra }, { actor: "owner" });
  res.status(status).json({ account: store.publicAccount(account), business: businessView(repo.getBusiness(businessId)) });
}

function createAuthRouter() {
  const router = express.Router();
  const json = express.json({ limit: "64kb" });

  router.get("/vendor/simplewebauthn-browser.js", (_req, res, next) => {
    res.sendFile(BROWSER_BUNDLE, { maxAge: "1d" }, (err) => err && next(err));
  });

  router.post(
    "/api/auth/register",
    json,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const language = body.language ?? "hi-IN";
      try {
        const phone = accounts.normalisePhone(body.phone);
        if (!accounts.isPin(body.pin)) throw new AccountError("INVALID_PIN", "The PIN is 4 digits.");
        if (!LANGUAGES.includes(language)) throw new HttpError(400, "INVALID", `language must be one of: ${LANGUAGES.join(", ")}.`);
        const business = {
          name: nameText(body.name, "name", { required: true }),
          city: nameText(body.city, "city", { required: true }),
          state: nameText(body.state, "state"),
          language,
        };

        // The device-session business this browser already uses, when nobody owns it yet, is taken
        // over only for the same shop name or an explicit claimDevice: true; otherwise the typed
        // shop becomes a new business (and needs the access code like any new business).
        const claims = cookieClaims(req);
        const deviceBusiness = claims && !claims.accountId ? repo.getBusiness(claims.businessId) : null;
        const device = deviceBusiness && !store.ownerOf(deviceBusiness.id) ? deviceBusiness : null;
        const claimBusinessId = accounts.deviceBusinessToClaim({ device, typedName: business.name, claimDevice: body.claimDevice });

        // The same per-IP window as POST /api/session, counted before the access code is checked.
        limit(rateCheck(req, "session", RATE.newBusiness), language);
        if (!claimBusinessId && config.accessCode && !accessCodeMatches(body.accessCode)) {
          throw new HttpError(403, "ACCESS_CODE_REQUIRED", body.accessCode ? "That access code is not right." : "This Sahay server needs an access code to set up a new business.");
        }

        const out = await accounts.register({ phone, pin: body.pin, business, claimBusinessId });
        signIn(req, res, { account: out.account, businessId: out.businessId, via: "pin", status: 201, type: "account.registered", extra: { claimed: out.claimed } });
      } catch (err) {
        throw asHttp(err, language);
      }
    }),
  );

  router.post(
    "/api/auth/login",
    json,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const language = body.language;
      try {
        const phone = accounts.normalisePhone(body.phone);
        if (!accounts.isPin(body.pin)) throw new AccountError("INVALID_PIN", "The PIN is 4 digits.");
        limit(rateCheck(req, "login", LIMITS.pinLogin), language);
        const who = clientAddress(req);
        const { account, businessId } = await accounts.loginWithPin({ phone, pin: body.pin, address: who.trusted ? who.ip : "untrusted" });
        signIn(req, res, { account, businessId, via: "pin" });
      } catch (err) {
        throw asHttp(err, language);
      }
    }),
  );

  // Logout ends the session on the server too (security review r2 #5): any copy of this cookie is
  // refused from now on, and the event streams it opened are closed.
  router.post("/api/auth/logout", (req, res) => {
    const who = signedIn(req);
    const claims = cookieClaims(req);
    if (claims) accounts.sessions.revoke(claims, "logout");
    auth.clearSessionCookie(res);
    if (who) events.emit(who.business.id, "account.signed_out", { accountId: who.account.id }, { actor: "owner" });
    if (claims) closeSessionStreams(claims.sessionId);
    res.status(204).end();
  });

  router.get("/api/auth/me", (req, res) => {
    const { account, business } = requireAccount(req);
    res.json({ account: store.publicAccount(account), business: businessView(business) });
  });

  router.post(
    "/api/auth/passkey/register/options",
    json,
    wrap(async (req, res) => {
      const { account, business } = requireAccount(req);
      try {
        limit({ key: `passkey:register:${account.id}`, ...LIMITS.passkeyRegisterPerAccount }, business.language);
        res.json(await passkeys.registrationOptions(account, passkeys.fromRequest(req)));
      } catch (err) {
        throw asHttp(err, business.language);
      }
    }),
  );

  router.post(
    "/api/auth/passkey/register/verify",
    json,
    wrap(async (req, res) => {
      const { account, business } = requireAccount(req);
      try {
        const passkey = await passkeys.verifyRegistration(account, req.body);
        events.emit(business.id, "account.passkey_added", { accountId: account.id, passkeyId: passkey.id }, { actor: "owner" });
        res.status(201).json({ passkey });
      } catch (err) {
        throw asHttp(err, business.language);
      }
    }),
  );

  router.post(
    "/api/auth/passkey/login/options",
    json,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      try {
        limit(rateCheck(req, "passkey:login", LIMITS.passkeyLogin), body.language);
        const rp = passkeys.fromRequest(req);
        if (body.phone === undefined || body.phone === null || body.phone === "") {
          return res.json(await passkeys.authenticationOptions(rp));
        }
        const phone = accounts.normalisePhone(body.phone);
        const accountId = store.findByPhone(phone)?.id ?? null;
        res.json(await passkeys.authenticationOptions(rp, { restrict: true, accountId, phone }));
      } catch (err) {
        throw asHttp(err, body.language);
      }
    }),
  );

  router.post(
    "/api/auth/passkey/login/verify",
    json,
    wrap(async (req, res) => {
      const language = req.body?.language;
      try {
        limit(rateCheck(req, "passkey:login", LIMITS.passkeyLogin), language);
        const accountId = await passkeys.verifyAuthentication(req.body);
        signIn(req, res, { account: store.getAccount(accountId), businessId: accounts.primaryBusiness(accountId), via: "passkey" });
      } catch (err) {
        throw asHttp(err, language);
      }
    }),
  );

  return router;
}

module.exports = { createAuthRouter, signedIn, BROWSER_BUNDLE, LIMITS };
