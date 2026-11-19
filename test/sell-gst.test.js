"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const gst = require("../src/sell/gst");

test("legal slabs: post-22-Sep-2025 rates are accepted, 12% and made-up rates are refused", () => {
  for (const rate of [0, 0.25, 1.5, 3, 5, 18, 28, 40]) assert.equal(gst.isLegalRate(rate), true, String(rate));
  for (const rate of [12, 7, 2.5, -5, 100, NaN, "5"]) assert.equal(gst.isLegalRate(rate), false, String(rate));
});

test("GSTIN: format, checksum and state code", () => {
  assert.deepEqual(gst.parseGstin("27AAPFU0939F1ZV"), { gstin: "27AAPFU0939F1ZV", stateCode: "27", pan: "AAPFU0939F" });
  assert.equal(gst.parseGstin(" 27aapfu0939f1zv ").gstin, "27AAPFU0939F1ZV");
  assert.throws(() => gst.parseGstin("27AAPFU0939F1ZW"), (e) => e.code === "GSTIN_INVALID"); // wrong check digit
  assert.throws(() => gst.parseGstin("27AAPFU0939F1Z"), (e) => e.code === "GSTIN_INVALID");
  assert.throws(() => gst.parseGstin("00AAPFU0939F1ZV"), (e) => e.code === "GSTIN_INVALID"); // no state 00
  assert.equal(gst.checksumChar("27AAPFU0939F1Z"), "V");
});

test("state codes: by name (any case, native script) and by code", () => {
  assert.equal(gst.stateCode("Karnataka"), "29");
  assert.equal(gst.stateCode("karnataka"), "29");
  assert.equal(gst.stateCode("कर्नाटक"), "29");
  assert.equal(gst.stateCode("ಕರ್ನಾಟಕ"), "29");
  assert.equal(gst.stateCode("Maharashtra"), "27");
  assert.equal(gst.stateCode("29"), "29");
  assert.equal(gst.stateCode("Atlantis"), null);
  assert.equal(gst.stateName("29"), "Karnataka");
});

test("document kind follows the scheme", () => {
  assert.equal(gst.documentKind("regular"), "tax_invoice");
  assert.equal(gst.documentKind("composition"), "bill_of_supply");
  assert.equal(gst.documentKind("unregistered"), "bill");
  assert.throws(() => gst.documentKind("other"), (e) => e.code === "INVALID_SCHEME");
});

test("intra-state tax splits into CGST + SGST, rounded per line in integer paise", () => {
  const t = gst.computeInvoice({ kind: "tax_invoice", supplierState: "29", placeOfSupply: "29", lines: [{ quantity: 50, ratePaise: 9500, gstRate: 5 }] });
  assert.equal(t.intraState, true);
  assert.deepEqual(t.lines[0], { quantity: 50, ratePaise: 9500, gstRate: 5, taxablePaise: 475000, cgstPaise: 11875, sgstPaise: 11875, igstPaise: 0, totalPaise: 498750 });
  assert.deepEqual(t.totals, { taxablePaise: 475000, cgstPaise: 11875, sgstPaise: 11875, igstPaise: 0, taxPaise: 23750, totalPaise: 498750 });
});

test("odd half-paise: each half is rounded half-up on its own and the total is re-added from the lines", () => {
  // 3 x Rs 3.33 = 999 paise; 5% = 49.95 paise -> halves 24.975 -> 25 + 25 = 50
  const t = gst.computeInvoice({ kind: "tax_invoice", supplierState: "29", placeOfSupply: "29", lines: [{ quantity: 3, ratePaise: 333, gstRate: 5 }, { quantity: 2.5, ratePaise: 1001, gstRate: 18 }] });
  assert.equal(t.lines[0].cgstPaise, 25);
  assert.equal(t.lines[0].sgstPaise, 25);
  // 2.5 x 1001 = 2502.5 -> 2503 paise taxable; 9% = 225.27 -> 225 each half
  assert.equal(t.lines[1].taxablePaise, 2503);
  assert.equal(t.lines[1].cgstPaise, 225);
  assert.equal(t.totals.totalPaise, t.lines.reduce((s, l) => s + l.totalPaise, 0));
});

test("inter-state tax is IGST only; 0.25% splits into 0.125% halves", () => {
  const inter = gst.computeInvoice({ kind: "tax_invoice", supplierState: "29", placeOfSupply: "27", lines: [{ quantity: 10, ratePaise: 10000, gstRate: 18 }] });
  assert.equal(inter.intraState, false);
  assert.equal(inter.lines[0].igstPaise, 18000);
  assert.equal(inter.lines[0].cgstPaise + inter.lines[0].sgstPaise, 0);
  const quarter = gst.computeInvoice({ kind: "tax_invoice", supplierState: "29", placeOfSupply: "29", lines: [{ quantity: 1, ratePaise: 100000, gstRate: 0.25 }] });
  assert.equal(quarter.lines[0].cgstPaise, 125);
  assert.equal(quarter.lines[0].sgstPaise, 125);
});

test("bill of supply and plain bill carry no tax at all", () => {
  for (const kind of ["bill_of_supply", "bill"]) {
    const t = gst.computeInvoice({ kind, supplierState: "29", placeOfSupply: "29", lines: [{ quantity: 2, ratePaise: 5000, gstRate: 5 }] });
    assert.equal(t.totals.taxPaise, 0);
    assert.equal(t.totals.totalPaise, 10000);
    assert.equal(t.lines[0].gstRate, null);
  }
});

test("computeInvoice refuses what it cannot compute honestly", () => {
  const base = { kind: "tax_invoice", supplierState: "29", placeOfSupply: "29" };
  assert.throws(() => gst.computeInvoice({ ...base, lines: [] }), (e) => e.code === "NO_LINES");
  assert.throws(() => gst.computeInvoice({ ...base, lines: [{ quantity: 1, ratePaise: 100, gstRate: 12 }] }), (e) => e.code === "GST_RATE_INVALID");
  assert.throws(() => gst.computeInvoice({ ...base, lines: [{ quantity: 0, ratePaise: 100, gstRate: 5 }] }), (e) => e.code === "INVALID_LINE");
  assert.throws(() => gst.computeInvoice({ ...base, lines: [{ quantity: 1, ratePaise: 10.5, gstRate: 5 }] }), (e) => e.code === "INVALID_LINE");
  assert.throws(() => gst.computeInvoice({ ...base, supplierState: null, lines: [{ quantity: 1, ratePaise: 100, gstRate: 5 }] }), (e) => e.code === "STATE_REQUIRED");
  assert.throws(
    () => gst.computeInvoice({ kind: "bill_of_supply", supplierState: "29", placeOfSupply: "27", lines: [{ quantity: 1, ratePaise: 100 }] }),
    (e) => e.code === "COMPOSITION_INTERSTATE",
  );
});

test("financial year runs April to March in India time", () => {
  assert.equal(gst.financialYear(new Date("2026-11-19T10:00:00Z")), "2026-27");
  assert.equal(gst.financialYear(new Date("2027-03-31T18:00:00Z")), "2026-27"); // 31 Mar 23:30 IST
  assert.equal(gst.financialYear(new Date("2027-03-31T18:31:00Z")), "2027-28"); // 1 Apr 00:01 IST
});

test("invoice numbers are at most 16 characters and consecutive per year", () => {
  assert.equal(gst.invoiceNumber("INV", "2026-27", 1), "INV/2026-27/0001");
  assert.equal(gst.invoiceNumber("INV", "2026-27", 1).length, 16);
  assert.throws(() => gst.invoiceNumber("INV", "2026-27", 10000), (e) => e.code === "INVOICE_SERIES_FULL");
  assert.throws(() => gst.invoiceNumber("INVOICE", "2026-27", 1), (e) => e.code === "INVOICE_PREFIX_INVALID");
});

test("HSN is 4, 6 or 8 digits", () => {
  assert.equal(gst.parseHsn("1006"), "1006");
  assert.equal(gst.parseHsn(" 1006 30 "), "100630");
  assert.equal(gst.parseHsn("१००६"), "1006");
  for (const bad of ["100", "10063", "abcd", ""]) assert.throws(() => gst.parseHsn(bad), (e) => e.code === "HSN_INVALID");
});

test("amount in words (Indian numbering)", () => {
  assert.equal(gst.rupeesInWords(498750), "Rupees Four Thousand Nine Hundred Eighty Seven and Fifty Paise Only");
  assert.equal(gst.rupeesInWords(1234567800), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
  assert.equal(gst.rupeesInWords(100), "Rupees One Only");
  assert.equal(gst.rupeesInWords(5), "Rupees Zero and Five Paise Only");
});

test("rupees <-> paise without float drift", () => {
  assert.equal(gst.toPaise(95), 9500);
  assert.equal(gst.toPaise(0.1 + 0.2), 30);
  assert.equal(gst.toPaise(4987.5), 498750);
  assert.equal(gst.rupeesText(498750), "4987.50");
  assert.equal(gst.rupeesText(9500), "95");
  assert.throws(() => gst.toPaise(1.234), (e) => e.code === "INVALID_AMOUNT"); // a fraction of a paisa
  assert.throws(() => gst.toPaise(-1), (e) => e.code === "INVALID_AMOUNT");
});
