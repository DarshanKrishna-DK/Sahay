"use strict";

/**
 * Indian mobile numbers. Stored as "+91" and ten digits starting 6-9. The number is not
 * verified (no SMS); logs only ever see maskPhone().
 */

const { AccountError } = require("./errors");

const MOBILE = /^[6-9][0-9]{9}$/;
const SEPARATORS = /[\s\-().]/g;

/** "98765 43210", "+91-9876543210", "09876543210" -> "+919876543210", or throw INVALID_PHONE. */
function normalisePhone(value) {
  if (typeof value !== "string" || value.length > 32) throw invalidPhone();
  let digits = value.replace(SEPARATORS, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!MOBILE.test(digits)) throw invalidPhone();
  return `+91${digits}`;
}

function invalidPhone() {
  return new AccountError("INVALID_PHONE", "Give a 10-digit Indian mobile number.");
}

/** "+919876543210" -> "+91******3210". Anything else -> "***". */
function maskPhone(phone) {
  return typeof phone === "string" && /^\+91[0-9]{10}$/.test(phone) ? `+91******${phone.slice(-4)}` : "***";
}

module.exports = { normalisePhone, maskPhone };
