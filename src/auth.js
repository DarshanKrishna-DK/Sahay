"use strict";

/**
 * Signed sessions. The tenant is resolved here, once, from a token Sahay signed
 * itself: `req.auth.businessId`. No handler reads a business id from a body,
 * a query string or a URL.
 *
 * Token: v1.<base64url JSON payload>.<base64url HMAC-SHA256 over "v1.<payload>">
 */

const crypto = require("node:crypto");
const { config } = require("./config");

const VERSION = "v1";
const COOKIE_NAME = "sahay_session";
const SCOPES = ["browser", "mcp"];

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

function secret() {
  if (!config.sessionSecret) throw new AuthError("NO_SECRET", "SESSION_SIGNING_SECRET is not set.");
  return config.sessionSecret;
}

function mac(signedPart) {
  return crypto.createHmac("sha256", secret()).update(signedPart).digest();
}

const isId = (value) => typeof value === "string" && value !== "";
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Sign a session. `exp` is a Unix time in seconds and is mandatory: Sahay does
 * not issue tokens that never expire.
 */
function signSession({ businessId, sessionId, scope, exp }) {
  if (!isId(businessId) || !isId(sessionId)) throw new AuthError("INVALID_CLAIMS", "businessId and sessionId are required.");
  if (!SCOPES.includes(scope)) throw new AuthError("INVALID_CLAIMS", `scope must be one of: ${SCOPES.join(", ")}.`);
  if (!Number.isInteger(exp) || exp <= nowSeconds()) {
    throw new AuthError("INVALID_CLAIMS", "exp must be a Unix time in seconds, in the future.");
  }
  const payload = Buffer.from(JSON.stringify({ businessId, sessionId, scope, exp })).toString("base64url");
  const signedPart = `${VERSION}.${payload}`;
  return `${signedPart}.${mac(signedPart).toString("base64url")}`;
}

/** Verify a token and return `{ businessId, sessionId, scope, exp }`, or throw an AuthError. */
function verifySession(token, { scope } = {}) {
  if (typeof token !== "string") throw new AuthError("MALFORMED", "No session token.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new AuthError("MALFORMED", "Malformed session token.");

  // Compare the encoded text, not decoded bytes: a lenient base64 decode must not widen what is accepted.
  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`).toString("base64url"));
  const given = Buffer.from(parts[2]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AuthError("BAD_SIGNATURE", "Session token signature does not match.");
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AuthError("MALFORMED", "Malformed session token.");
  }
  if (!claims || !isId(claims.businessId) || !isId(claims.sessionId) || !SCOPES.includes(claims.scope) || !Number.isInteger(claims.exp)) {
    throw new AuthError("MALFORMED", "Malformed session token.");
  }
  if (claims.exp <= nowSeconds()) throw new AuthError("EXPIRED", "Session token has expired.");
  if (scope !== undefined && claims.scope !== scope) throw new AuthError("WRONG_SCOPE", "Session token is not valid here.");

  return { businessId: claims.businessId, sessionId: claims.sessionId, scope: claims.scope, exp: claims.exp };
}

function cookieToken(req) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

function bearerToken(req) {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization ?? ""));
  return match ? match[1] : null;
}

/** Build middleware that sets `req.auth` from a verified token, or answers 401. */
function guard(readToken, scope) {
  return (req, res, next) => {
    let auth;
    try {
      auth = verifySession(readToken(req), { scope });
    } catch (err) {
      if (!(err instanceof AuthError) || err.code === "NO_SECRET") return next(err);
      return res.status(401).json({ error: "unauthorized", code: err.code });
    }
    req.auth = auth;
    next();
  };
}

/** Browser routes: the HttpOnly session cookie. */
const requireSession = guard(cookieToken, "browser");

/** The MCP endpoint: `Authorization: Bearer <token>` signed for one agent session. */
const requireBearer = guard(bearerToken, "mcp");

/** Set the browser session cookie. The token never reaches page scripts. */
function setSessionCookie(req, res, token) {
  const { exp } = verifySession(token, { scope: "browser" });
  const attributes = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${exp - nowSeconds()}`,
  ];
  if (req.secure || req.headers["x-forwarded-proto"] === "https") attributes.push("Secure");
  res.append("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

module.exports = {
  AuthError, COOKIE_NAME,
  signSession, verifySession,
  requireSession, requireBearer,
  setSessionCookie, clearSessionCookie,
};
