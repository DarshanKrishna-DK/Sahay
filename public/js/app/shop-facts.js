// Shop GST facts for the browser, with no DOM and no imports, so node:test can load it as is.
// The state list is src/sell/gst.js STATES (GST code, English, Hindi, Kannada where it has one);
// test/shop-settings.test.js keeps the two lists identical. The browser only checks the GSTIN's
// shape; the server checks its check character and answers with a spoken `say`.

export const SCHEMES = ["unregistered", "regular", "composition"];

export const STATES = [
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

const COL = { en: 1, hi: 2, kn: 3 };
const BY_CODE = new Map(STATES.map((row) => [row[0], row]));

/** A state's name in the owner's script when the list has one, else English; null for an unknown code. */
export function stateLabel(code, lang = "en") {
  const row = BY_CODE.get(String(code ?? ""));
  if (!row) return null;
  return row[COL[lang] || 1] || row[1];
}

/** True when the label shown for this code is in the owner's script (so it can carry lang=). */
export function stateIsNative(code, lang) {
  const row = BY_CODE.get(String(code ?? ""));
  return Boolean(row && lang !== "en" && row[COL[lang]]);
}

/** [{code, label, native}] for the picker, sorted by the label in the owner's language. */
export function statesFor(lang = "en") {
  const locale = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" }[lang] || "en-IN";
  let collate;
  try { collate = new Intl.Collator(locale).compare; } catch { collate = (a, b) => (a < b ? -1 : a > b ? 1 : 0); }
  return STATES.map(([code]) => ({ code, label: stateLabel(code, lang), native: stateIsNative(code, lang) }))
    .sort((a, b) => collate(a.label, b.label));
}

/** What the owner typed, as a GSTIN is written: capitals and digits only, at most 15. */
export const cleanGstin = (text) => String(text ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);

// Same shape as src/sell/gst.js GSTIN_SHAPE: state code, PAN, entity number, Z, check character.
const GSTIN_SHAPE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The browser's check of a GSTIN: "empty", "short" (fewer than 15), "shape" (15 but not a GSTIN's
 * pattern or not a known state code) or "ok". The check character is the server's to judge.
 */
export function gstinProblem(value) {
  const g = cleanGstin(value);
  if (!g) return "empty";
  if (g.length < 15) return "short";
  const m = GSTIN_SHAPE.exec(g);
  if (!m || !BY_CODE.has(m[1])) return "shape";
  return "ok";
}

/** The state a GSTIN belongs to (its first two digits), when its shape is right. */
export const stateOfGstin = (value) => (gstinProblem(value) === "ok" ? cleanGstin(value).slice(0, 2) : null);

export const needsGstin = (scheme) => scheme === "regular" || scheme === "composition";

/** The Sell settings as the browser keeps them (GET /api/sell `settings`, snake or camel case). */
export function normSettings(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pick = (...keys) => { for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) return raw[k]; return null; };
  const scheme = pick("gstScheme", "gst_scheme");
  return {
    gstScheme: SCHEMES.includes(scheme) ? scheme : "unregistered",
    gstin: pick("gstin"),
    stateCode: pick("stateCode", "state_code"),
    address: pick("address"),
    invoicePrefix: pick("invoicePrefix", "invoice_prefix"),
    saved: Boolean(raw.saved),
  };
}

/**
 * What the server would refuse a bill for (src/sell/settings.js supplier()): a GST scheme with no
 * GSTIN -> "GSTIN_REQUIRED"; no state -> "STATE_REQUIRED"; else null.
 */
export function missingFact(settings) {
  if (!settings) return null;
  if (settings.gstScheme !== "unregistered" && !settings.gstin) return "GSTIN_REQUIRED";
  if (!settings.stateCode) return "STATE_REQUIRED";
  return null;
}

/** The codes a bill can be refused with for missing shop details. */
export const SHOP_CODES = ["GSTIN_REQUIRED", "STATE_REQUIRED"];

/**
 * Check the sheet's fields; returns { gstin?, state? } problems (empty object when all is well).
 * A shape-correct GSTIN gives the state, so the picker is not needed then.
 */
export function formProblems({ scheme, gstin, state }) {
  const out = {};
  if (needsGstin(scheme)) {
    const p = gstinProblem(gstin);
    if (p !== "ok") out.gstin = p;
  }
  const fromGstin = needsGstin(scheme) ? stateOfGstin(gstin) : null;
  if (!fromGstin && !BY_CODE.has(String(state ?? ""))) out.state = "empty";
  return out;
}

/**
 * The POST /api/sell/settings body for the sheet's fields. The state is sent as its GST code
 * (the server reads codes and names); with a GSTIN it is the GSTIN's own state, so the two can
 * never disagree. An unregistered shop sends no GSTIN (the server clears it). An empty address
 * clears the saved one.
 */
export function settingsBody({ scheme, gstin, state, address }) {
  const body = { gst_scheme: SCHEMES.includes(scheme) ? scheme : "unregistered" };
  if (needsGstin(body.gst_scheme)) body.gstin = cleanGstin(gstin);
  const st = needsGstin(body.gst_scheme) ? stateOfGstin(gstin) || state : state;
  if (st) body.state = String(st);
  body.address = String(address ?? "").trim().slice(0, 300);
  return body;
}
