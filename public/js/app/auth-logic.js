// Sign up / Log in rules with no DOM (tested in test/auth-logic.test.js). The screens in auth.js
// and welcome.js ask these functions what the next step is, whether an answer is valid and what a
// server refusal means for the owner; they never decide it themselves.

export const NAME_MAX = 80;
/** Same rule as the server (src/routes/auth.js NAME_CHARS + HAS_LETTER_OR_DIGIT). */
export const isNameText = (v) => /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u.test(v) && /[\p{L}\p{N}]/u.test(v);
/** An Indian mobile number: 10 digits starting 6-9 (the server's INVALID_PHONE rule). */
export const isMobile = (d) => /^[6-9]\d{9}$/.test(String(d || ""));
/** "98765 43210" for the screen; the number is sent without spaces. */
export const fmtPhone = (d) => { const s = String(d || ""); return s.length > 5 ? `${s.slice(0, 5)} ${s.slice(5)}` : s; };
/** "+91 98765 43210" from a stored "+919876543210" or bare digits. */
export function phoneLine(stored) {
  const digits = String(stored || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return digits.length === 10 ? `+91 ${fmtPhone(digits)}` : String(stored || "");
}

export const PIN_LENGTH = 4;
export const PHONE_LENGTH = 10;

/** Sign-up steps in order; the access code only when the server asks for one. */
export function signupSteps({ accessCodeRequired = false } = {}) {
  return ["lang", "phone", "name", "city", "pin", "pin2", ...(accessCodeRequired ? ["code"] : [])];
}
/** Log-in steps with the PIN (fingerprint is a separate screen before these). */
export const loginSteps = () => ["phone", "pinEnter"];

/** Steps answered with the number keypad. */
export const isPadStep = (kind) => kind === "phone" || kind === "pin" || kind === "pin2" || kind === "pinEnter";
/** Steps answered with a text field. */
export const isTextStep = (kind) => kind === "name" || kind === "city" || kind === "code";

/**
 * D13: the phone step moves on by itself at 10 valid digits (no extra Done tap); a PIN moves on at
 * 4 digits. An invalid 10-digit phone does not move on: it shows the error instead.
 * -> "advance" | "invalid" | null (keep typing)
 */
export function padOutcome(kind, value) {
  const v = String(value || "");
  if (kind === "phone") {
    if (v.length < PHONE_LENGTH) return null;
    return isMobile(v) ? "advance" : "invalid";
  }
  if (isPadStep(kind)) return v.length >= PIN_LENGTH ? "advance" : null;
  return null;
}

/**
 * A typed answer for the shop name, city or access code -> null when fine, else the i18n key of
 * the one-line error shown under the field.
 */
export function textProblem(kind, raw) {
  const v = String(raw ?? "").trim();
  if (kind === "code") return v ? null : "err.codeEmpty";
  if (!v) return kind === "name" ? "err.nameEmpty" : "err.cityEmpty";
  if (v.length > NAME_MAX) return "err.long";
  if (!isNameText(v)) return "err.chars";
  return null;
}

/** Retry-After header (seconds, or an HTTP date) -> whole seconds, or null. */
export function retryAfterSeconds(header, now = Date.now()) {
  if (header === null || header === undefined || header === "") return null;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(String(header));
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Seconds left on a PIN lock -> whole minutes to show (at least 1 while locked). */
export function lockMinutes(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  return Math.max(1, Math.ceil(s / 60));
}

/**
 * What a refused sign-up means: { kind, step?, key?, clearPin? }
 *   kind "field": stay on / go back to `step` with a one-line error under it
 *   kind "form":  a card-level error (optionally with an action named by `action`)
 *   kind "noAccounts": this server has no /api/auth (offer the old device-only start)
 */
export function signupRefusal(err, { accessCodeRequired = false } = {}) {
  const code = err && err.code;
  const steps = signupSteps({ accessCodeRequired: accessCodeRequired || code === "ACCESS_CODE_REQUIRED" });
  if (err && err.status === 404) return { kind: "noAccounts" };
  if (code === "ACCESS_CODE_REQUIRED") return { kind: "field", step: steps.indexOf("code"), key: "err.codeEmpty", needsCode: true };
  if (code === "PHONE_TAKEN") return { kind: "form", action: "login", key: "err.save" };
  if (code === "INVALID_PHONE") return { kind: "field", step: steps.indexOf("phone"), key: "auth.badPhone" };
  if (code === "INVALID_PIN") return { kind: "field", step: steps.indexOf("pin"), key: "err.save", clearPin: true };
  if (code === "INVALID" || code === "BUSINESS_DETAILS_REQUIRED") return { kind: "field", step: steps.indexOf("name"), key: "err.chars" };
  if (err && err.status === 429) return { kind: "form", key: "err.limit" };
  if (err && err.status === 0) return { kind: "form", key: "err.network" };
  return { kind: "form", key: "err.save" };
}

/**
 * What a refused PIN log-in means: { kind: "locked", minutes } | { kind: "wrong" } | { kind: "form", key }
 * PIN_LOCKED carries Retry-After (15 minutes for a phone+address pair, an hour for the phone).
 */
export function loginRefusal(err) {
  const code = err && err.code;
  if (err && err.status === 404) return { kind: "noAccounts" };
  if (code === "PIN_LOCKED") return { kind: "locked", minutes: lockMinutes(err.retryAfterSeconds) };
  if (code === "RATE_LIMITED") return { kind: "form", key: "err.limit", minutes: lockMinutes(err.retryAfterSeconds) };
  if (code === "WRONG_PIN" || code === "INVALID_PHONE" || code === "INVALID_PIN") return { kind: "wrong" };
  if (err && err.status === 0) return { kind: "form", key: "err.network" };
  return { kind: "form", key: "err.save" };
}

/** First screen without a session: the chooser on a fresh device, Log in on one that had an account. */
export function startMode(hash, hadAccount) {
  if (/^#\/login/.test(hash || "")) return "login";
  if (/^#\/signup/.test(hash || "")) return "signup";
  return hadAccount ? "login" : "choose";
}

/** The cities offered as tiles on the city step (the rest are typed or dictated). */
export const CITY_TILES = ["Bengaluru", "Mumbai", "Delhi", "Chennai", "Hyderabad", "Mysuru"];
