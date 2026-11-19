"use strict";

// src/orders/po-ref.js: a purchase order named the way an owner says or types it (E2E regress bug 5:
// "SAHAY/2026/6799-0001" given to create_payment_link was "order not found").

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { digitsOf, findByPo } = require("../src/orders/po-ref");

const orders = [
  { id: "ord_a", po_number: "SAHAY/2026/6799-0001" },
  { id: "ord_b", po_number: "SAHAY/2026/6799-0002" },
  { id: "ord_c", po_number: "SAHAY/2026/6799-0011" },
];

test("digitsOf reads ASCII, Devanagari and Kannada digits and spoken digit words, ignoring spacing and punctuation", () => {
  assert.equal(digitsOf("SAHAY/2026/6799-0001"), "202667990001");
  assert.equal(digitsOf("sahay 2026 6799 0001"), "202667990001");
  assert.equal(digitsOf("६७९९-०००१"), "67990001");
  assert.equal(digitsOf("೬೭೯೯ ೦೦೦೧"), "67990001");
  assert.equal(digitsOf("छह सात नौ नौ शून्य शून्य शून्य एक"), "67990001");
  assert.equal(digitsOf("ಆರು ಏಳು ಒಂಬತ್ತು ಒಂಬತ್ತು ಸೊನ್ನೆ ಸೊನ್ನೆ ಸೊನ್ನೆ ಒಂದು"), "67990001");
  assert.equal(digitsOf("six seven nine nine zero zero zero one"), "67990001");
  assert.equal(digitsOf("no number here"), "");
});

test("findByPo: the full number in any form, its tail, or the sequence number; several matches are ambiguous; nothing is never a guess", () => {
  for (const ref of ["SAHAY/2026/6799-0001", "sahay/2026/6799 - 0001", "SAHAY २०२६ ६७९९ ०००१", "6799-0001", "0001", "1", "एक"]) {
    assert.equal(findByPo(orders, ref).order?.id, "ord_a", ref);
  }
  assert.equal(findByPo(orders, "11").order?.id, "ord_c");
  assert.equal(findByPo(orders, "6799"), null, "the business code alone is not a tail or a sequence number");
  const twoYears = [...orders, { id: "ord_old", po_number: "SAHAY/2025/6799-0001" }];
  assert.deepEqual(findByPo(twoYears, "6799-0001").ambiguous?.map((o) => o.id).sort(), ["ord_a", "ord_old"]);
  assert.equal(findByPo(twoYears, "SAHAY/2026/6799-0001").order?.id, "ord_a", "the full number still picks one");
  assert.equal(findByPo(orders, "SAHAY/2026/6799-0009"), null);
  assert.equal(findByPo(orders, ""), null);
  assert.equal(findByPo(orders, "abc"), null);
});
