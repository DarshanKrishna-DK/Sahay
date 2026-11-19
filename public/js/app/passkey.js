// Fingerprint / screen-lock sign-in (passkeys) over the ACC routes. The browser helper is
// @simplewebauthn/browser 14.0.0's UMD bundle, served by our own server at
// /vendor/simplewebauthn-browser.js (global SimpleWebAuthnBrowser). Signatures checked against
// node_modules/@simplewebauthn/browser/esm/*.d.ts: startRegistration({ optionsJSON }),
// startAuthentication({ optionsJSON }), browserSupportsWebAuthn(), platformAuthenticatorIsAvailable().

import { agentRequest } from "./store.js";

let loading = null;

function lib() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/simplewebauthn-browser.js";
    s.async = true;
    s.onload = () => (window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error("PASSKEY_LIB")));
    s.onerror = () => { loading = null; reject(new Error("PASSKEY_LIB")); };
    document.head.append(s);
  });
  return loading;
}

/** True only when this device can do a platform passkey (fingerprint, face, screen lock). */
export async function passkeyAvailable() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    const L = await lib();
    return L.browserSupportsWebAuthn() && (await L.platformAuthenticatorIsAvailable());
  } catch { return false; }
}

/** Signed in: add a passkey for this account. Throws ApiError or the browser's error (NotAllowedError when cancelled). */
export async function addPasskey() {
  const L = await lib();
  const optionsJSON = await agentRequest("POST", "/api/auth/passkey/register/options", {});
  const result = await L.startRegistration({ optionsJSON });
  return agentRequest("POST", "/api/auth/passkey/register/verify", result);
}

/** Log in with a passkey; phone is optional (discoverable credentials). Resolves { account, business }. */
export async function loginWithPasskey(phone) {
  const L = await lib();
  const optionsJSON = await agentRequest("POST", "/api/auth/passkey/login/options", phone ? { phone } : {});
  const result = await L.startAuthentication({ optionsJSON });
  return agentRequest("POST", "/api/auth/passkey/login/verify", result);
}

/** The owner closed the system prompt (not an error worth a red line). */
export const cancelled = (err) => Boolean(err && (err.name === "NotAllowedError" || err.name === "AbortError" || err.code === "ERROR_CEREMONY_ABORTED"));
