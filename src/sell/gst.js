"use strict";

/**
 * GST arithmetic and identifiers, as code (never a model). Pure functions only.
 *
 * Sources (checked 19 Nov 2026, notes in the SELL report):
 * - Tax invoice / bill of supply particulars: CGST Rules 46 and 49, as listed on
 *   https://cbic-gst.gov.in/gst-invoice-rules.html (serial number unique per financial year,
 *   at most 16 characters of letters, digits, "-" and "/").
 * - Rate schedules from 22 Sep 2025 (notification 9/2025-Central Tax (Rate)): total rates
 *   0.25, 1.5, 3, 5, 18, 28 (tobacco, until the compensation cess ends) and 40; the 12% slab
 *   was removed. 0 covers exempt / nil-rated goods.
 * - HSN digits: notification 78/2020-Central Tax (4 digits up to Rs 5 crore turnover, 6 above).
 * - State codes: first two digits of the GSTIN (secondary sources agree; the portal page was
 *   not reachable from here).
 *
 * Money is integer paise throughout. Tax is computed per line and rounded half-up per tax head;
 * invoice totals are the sum of the rounded lines, never recomputed from the total.
 */

class GstError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GstError";
    this.code = code;
  }
}

/* --------------------------------------------------------------- rates --- */

const LEGAL_RATES = Object.freeze([0, 0.25, 1.5, 3, 5, 18, 28, 40]);
const isLegalRate = (rate) => typeof rate === "number" && LEGAL_RATES.includes(rate);

/** Rate in thousandths of a percent (0.125% -> 125), so half of every legal rate is an integer. */
const milliPercent = (rate) => Math.round(rate * 1000);

/* -------------------------------------------------------------- states --- */

/** GST state codes with English, Hindi and (for the south) Kannada names. */
const STATES = [
  ["01", "Jammu and Kashmir", "जम्मू और कश्मीर"],
  ["02", "Himachal Pradesh", "हिमाचल प्रदेश"],
  ["03", "Punjab", "पंजाब"],
  ["04", "Chandigarh", "चंडीगढ़"],
  ["05", "Uttarakhand", "उत्तराखंड"],
  ["06", "Haryana", "हरियाणा"],
  ["07", "Delhi", "दिल्ली", "ದೆಹಲಿ"],
  ["08", "Rajasthan", "राजस्थान"],
  ["09", "Uttar Pradesh", "उत्तर प्रदेश"],
  ["10", "Bihar", "बिहार"],
  ["11", "Sikkim", "सिक्किम"],
  ["12", "Arunachal Pradesh", "अरुणाचल प्रदेश"],
  ["13", "Nagaland", "नागालैंड"],
  ["14", "Manipur", "मणिपुर"],
  ["15", "Mizoram", "मिज़ोरम"],
  ["16", "Tripura", "त्रिपुरा"],
  ["17", "Meghalaya", "मेघालय"],
  ["18", "Assam", "असम"],
  ["19", "West Bengal", "पश्चिम बंगाल"],
  ["20", "Jharkhand", "झारखंड"],
  ["21", "Odisha", "ओडिशा"],
  ["22", "Chhattisgarh", "छत्तीसगढ़"],
  ["23", "Madhya Pradesh", "मध्य प्रदेश"],
  ["24", "Gujarat", "गुजरात"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu", "दादरा और नगर हवेली और दमन और दीव"],
  ["27", "Maharashtra", "महाराष्ट्र", "ಮಹಾರಾಷ್ಟ್ರ"],
  ["29", "Karnataka", "कर्नाटक", "ಕರ್ನಾಟಕ"],
  ["30", "Goa", "गोवा", "ಗೋವಾ"],
  ["31", "Lakshadweep", "लक्षद्वीप"],
  ["32", "Kerala", "केरल", "ಕೇರಳ"],
  ["33", "Tamil Nadu", "तमिलनाडु", "ತಮಿಳುನಾಡು"],
  ["34", "Puducherry", "पुडुचेरी"],
  ["35", "Andaman and Nicobar Islands", "अंडमान और निकोबार द्वीपसमूह"],
  ["36", "Telangana", "तेलंगाना", "ತೆಲಂಗಾಣ"],
  ["37", "Andhra Pradesh", "आंध्र प्रदेश", "ಆಂಧ್ರ ಪ್ರದೇಶ"],
  ["38", "Ladakh", "लद्दाख"],
];
const STATE_NAME = new Map(STATES.map(([code, name]) => [code, name]));
const fold = (text) => String(text ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
const STATE_BY_NAME = new Map(STATES.flatMap(([code, ...names]) => names.map((n) => [fold(n), code])));
for (const [alias, code] of [["orissa", "21"], ["new delhi", "07"], ["pondicherry", "34"], ["bangalore", null]]) if (code) STATE_BY_NAME.set(alias, code);

/** The GST state code for a state name or code, or null when it is not a known state. */
function stateCode(value) {
  const text = String(value ?? "").trim();
  if (/^\d{2}$/.test(text)) return STATE_NAME.has(text) ? text : null;
  return STATE_BY_NAME.get(fold(text)) ?? null;
}

const stateName = (code) => STATE_NAME.get(code) ?? null;

/* --------------------------------------------------------------- GSTIN --- */

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

/** The 15th character of a GSTIN from its first 14 (mod-36 check used by the GST portal). */
function checksumChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Validate a GSTIN (shape, state code, check character). Returns { gstin, stateCode, pan }. */
function parseGstin(value) {
  const gstin = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  const match = GSTIN_SHAPE.exec(gstin);
  if (!match || !STATE_NAME.has(match[1]) || checksumChar(gstin.slice(0, 14)) !== gstin[14]) {
    throw new GstError("GSTIN_INVALID", "That is not a valid GSTIN.");
  }
  return { gstin, stateCode: match[1], pan: match[2] };
}

/* ----------------------------------------------------------------- HSN --- */

const DEVANAGARI_ZERO = 0x966;
const KANNADA_ZERO = 0xce6;
const asciiDigits = (text) =>
  String(text ?? "")
    .replace(/[०-९]/g, (d) => String(d.codePointAt(0) - DEVANAGARI_ZERO))
    .replace(/[೦-೯]/g, (d) => String(d.codePointAt(0) - KANNADA_ZERO));

/** HSN for goods: 4, 6 or 8 digits (spaces and Indic digits allowed on the way in). */
function parseHsn(value) {
  const hsn = asciiDigits(value).replace(/\s+/g, "");
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) throw new GstError("HSN_INVALID", "An HSN code has 4, 6 or 8 digits.");
  return hsn;
}

/* ----------------------------------------------------- document kinds --- */

const SCHEMES = Object.freeze(["regular", "composition", "unregistered"]);
const KIND_BY_SCHEME = { regular: "tax_invoice", composition: "bill_of_supply", unregistered: "bill" };
const KIND_TITLE = { tax_invoice: "Tax Invoice", bill_of_supply: "Bill of Supply", bill: "Bill" };

function documentKind(scheme) {
  const kind = KIND_BY_SCHEME[scheme];
  if (!kind) throw new GstError("INVALID_SCHEME", `The GST scheme is one of: ${SCHEMES.join(", ")}.`);
  return kind;
}

/* ---------------------------------------------------------------- money --- */

/** Rupees (a number with at most two decimals) to integer paise. */
function toPaise(rupees) {
  if (typeof rupees !== "number" || !Number.isFinite(rupees) || rupees < 0) throw new GstError("INVALID_AMOUNT", "An amount is a number of zero or more.");
  const paise = Math.round(rupees * 100);
  if (Math.abs(paise - rupees * 100) > 1e-6 * Math.max(1, Math.abs(rupees))) throw new GstError("INVALID_AMOUNT", "An amount has at most two decimals.");
  return paise;
}

/** Paise as plain rupee digits ("4987.50", "95"), for speech and text. */
function rupeesText(paise) {
  const whole = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest ? `${whole}.${String(rest).padStart(2, "0")}` : String(whole);
}

/** Integer division rounded half-up (non-negative operands). */
const divRound = (numerator, denominator) => Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

/* ------------------------------------------------------------- invoice --- */

const QTY_SCALE = 1000; // quantities to three decimals

/**
 * Lines and totals of an invoice.
 * @param {{kind, supplierState, placeOfSupply, lines: {quantity, ratePaise, gstRate?}[]}} input
 *   kind tax_invoice | bill_of_supply | bill; states are GST codes ("29").
 * Returns { intraState, lines: [{quantity, ratePaise, gstRate, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise}], totals }.
 */
function computeInvoice({ kind, supplierState, placeOfSupply, lines }) {
  if (!KIND_TITLE[kind]) throw new GstError("INVALID_KIND", "Unknown document kind.");
  if (!Array.isArray(lines) || !lines.length) throw new GstError("NO_LINES", "An invoice needs at least one line.");
  if (!STATE_NAME.has(supplierState)) throw new GstError("STATE_REQUIRED", "The business's state is needed to work out the tax.");
  if (!STATE_NAME.has(placeOfSupply)) throw new GstError("STATE_REQUIRED", "The place of supply is needed to work out the tax.");
  const intraState = supplierState === placeOfSupply;
  // A composition taxpayer may not make inter-state outward supplies (CGST Act s.10(2)(c)).
  if (kind === "bill_of_supply" && !intraState) throw new GstError("COMPOSITION_INTERSTATE", "A composition dealer cannot bill a customer in another state.");
  const taxed = kind === "tax_invoice";

  const out = lines.map((line, i) => {
    const { quantity, ratePaise } = line;
    if (typeof quantity !== "number" || !(quantity > 0) || !Number.isFinite(quantity)) throw new GstError("INVALID_LINE", `Line ${i + 1}: quantity must be above zero.`);
    if (!Number.isInteger(ratePaise) || ratePaise < 0) throw new GstError("INVALID_LINE", `Line ${i + 1}: the rate must be whole paise.`);
    const qtyMilli = Math.round(quantity * QTY_SCALE);
    if (Math.abs(qtyMilli - quantity * QTY_SCALE) > 1e-6) throw new GstError("INVALID_LINE", `Line ${i + 1}: quantity has at most three decimals.`);
    const taxablePaise = divRound(qtyMilli * ratePaise, QTY_SCALE);
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    let gstRate = null;
    if (taxed) {
      if (!isLegalRate(line.gstRate)) throw new GstError("GST_RATE_INVALID", `Line ${i + 1}: ${line.gstRate}% is not a GST rate.`);
      gstRate = line.gstRate;
      const mp = milliPercent(gstRate); // percent * 1000; tax = taxable * mp / 100000
      if (intraState) {
        cgstPaise = divRound(taxablePaise * (mp / 2), 100000);
        sgstPaise = cgstPaise;
      } else {
        igstPaise = divRound(taxablePaise * mp, 100000);
      }
    }
    return { quantity, ratePaise, gstRate, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise };
  });

  const sum = (key) => out.reduce((s, l) => s + l[key], 0);
  const totals = { taxablePaise: sum("taxablePaise"), cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise") };
  totals.taxPaise = totals.cgstPaise + totals.sgstPaise + totals.igstPaise;
  totals.totalPaise = totals.taxablePaise + totals.taxPaise;
  if (!Number.isSafeInteger(totals.totalPaise)) throw new GstError("INVALID_LINE", "The invoice total is too large.");
  return { intraState, lines: out, totals };
}

/* ------------------------------------------------- numbering and dates --- */

const IST_OFFSET_MS = 330 * 60 * 1000;

/** "2026-27": Indian financial year (1 April to 31 March, India time) of a moment. */
function financialYear(at = new Date()) {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

const PREFIX = /^[A-Z]{1,3}$/;

/** "INV/2026-27/0001". Rule 46(b): at most 16 characters, unique per financial year. */
function invoiceNumber(prefix, fy, seq) {
  if (!PREFIX.test(prefix)) throw new GstError("INVOICE_PREFIX_INVALID", "An invoice prefix is one to three capital letters.");
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) throw new GstError("INVOICE_SERIES_FULL", "This year's invoice series is full (9999).");
  const number = `${prefix}/${fy}/${String(seq).padStart(4, "0")}`;
  if (number.length > 16) throw new GstError("INVOICE_PREFIX_INVALID", "An invoice number has at most 16 characters.");
  return number;
}

/* ------------------------------------------------------ amount in words --- */

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function below1000(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
}

/** Whole number in Indian numbering words (crore, lakh, thousand). */
function indianWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  const thousand = Math.floor((n % 1e5) / 1e3);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  const rest = n % 1000;
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** "Rupees Four Thousand Nine Hundred Eighty Seven and Fifty Paise Only". */
function rupeesInWords(paise) {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${indianWords(rupees)}${rest ? ` and ${below100(rest)} Paise` : ""} Only`;
}

module.exports = {
  GstError,
  LEGAL_RATES, isLegalRate,
  STATES, stateCode, stateName,
  parseGstin, checksumChar, parseHsn, asciiDigits,
  SCHEMES, documentKind, KIND_TITLE,
  toPaise, rupeesText, computeInvoice,
  financialYear, invoiceNumber,
  rupeesInWords,
};
