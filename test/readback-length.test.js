"use strict";

/**
 * Every line the server speaks as a read-back or a result goes out as ONE /speak piece (at most
 * 500 bytes UTF-8): Murf Falcon allows 2 concurrent streams outside US-East, and a read-back sent
 * as two pieces plus the model's own question stalled a live call (agora-findings.md, "Live check
 * 129a071 stall"). Checked with long, realistic values in hi, kn and en: 80-character vendor and
 * customer names, 6-digit totals.
 */

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const repo = require("../src/db/repo");
const approvals = require("../src/approvals");
const { splitUtf8 } = require("../src/agora/agent");
const { bytes, SPEAK_MAX_BYTES } = require("../src/agora/speech-fit");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const customers = require("../src/sell/customers");
const invoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const gate = require("../src/sell/gate");
const khata = require("../src/sell/khata");
const rules = require("../src/agent/rules");
const reorder = require("../src/stock/reorder");
const stockSay = require("../src/stock/say");
const registry = require("../src/tools/registry");
const sellPhrases = require("../src/tools/sell").PHRASES;
const khataPhrases = require("../src/tools/khata").PHRASES;
const narrator = require("../src/agora/narrator");
const outcome = require("../src/agora/outcome");

const LANGS = ["hi-IN", "kn-IN", "en-IN"];
const SHORT = { "hi-IN": "hi", "kn-IN": "kn", "en-IN": "en" };
const VENDOR = "Shree Venkateshwara Agro Foods and Rice Mills Private Limited Wholesale Division";
const CUSTOMER = "Ramesh Kumar Traders and General Provision Stores Wholesale and Retail Bengaluru";
const ITEM = { "hi-IN": "पुराना लंबे दाने वाला बासमती चावल", "kn-IN": "ಹಳೆಯ ಉದ್ದ ಕಾಳಿನ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", "en-IN": "aged extra long grain basmati rice" };

function onePiece(text, what) {
  assert.ok(bytes(text) <= SPEAK_MAX_BYTES, `${what}: ${bytes(text)} bytes > ${SPEAK_MAX_BYTES}: ${text}`);
  assert.equal(splitUtf8(text).length, 1, `${what} is one /speak piece`);
}

test("names are as long as the test says", () => {
  assert.equal(VENDOR.length, 80);
  assert.equal(CUSTOMER.length, 80);
});

test("the deal read-back is one /speak piece in hi, kn and en with long names and 6-digit totals, figures intact", () => {
  for (const language of LANGS) {
    for (const simulated of [true, false]) {
      for (const [freight, lead] of [[null, null], [12345.5, 14], [0, 0]]) {
        const deal = {
          vendorName: VENDOR,
          simulated,
          item: ITEM[language],
          quantity: 100,
          unit: "kg",
          unitPrice: 1234.5,
          freight,
          total: 123450 + (freight ?? 0),
          leadTimeDays: lead,
        };
        const text = approvals.buildReadback(deal, SHORT[language]);
        onePiece(text, `deal ${language} simulated=${simulated} freight=${freight}`);
        for (const figure of ["100", "1234.5", String(deal.total)]) assert.ok(text.includes(figure), `${language}: ${figure} in ${text}`);
        if (simulated) assert.match(text, /simulated vendor|सिम्युलेटेड|ಸಿಮ್ಯುಲೇಟೆಡ್/);
        assert.ok(text.includes("Shree Venkateshwara"), "the vendor is named");
      }
    }
  }
});

test("a deal read-back over the limit only because of a huge vendor name keeps every figure", () => {
  const deal = { vendorName: `${VENDOR} ${VENDOR} ${VENDOR}`, simulated: true, item: ITEM["hi-IN"], quantity: 250000, unit: "kg", unitPrice: 99999.75, freight: 54321, total: 25000013771.5, leadTimeDays: 30 };
  const text = approvals.buildReadback(deal, "hi");
  onePiece(text, "huge vendor");
  for (const figure of ["250000", "99999.75", "54321", "25000013771.5", "30"]) assert.ok(text.includes(figure), figure);
  assert.equal(approvals.buildReadback(deal, "hi"), text, "deterministic, so a stored read-back still matches the deal");
});

function business(language) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language });
  settings.save(id, { gst_scheme: "regular", gstin: "29AAPFU0939F1Z" + gst.checksumChar("29AAPFU0939F1Z"), address: "12 MG Road, Bengaluru" });
  return id;
}

let turn = 1;
function taxedItem(biz, name) {
  const text = itemTax.readback({ item: name, hsn: "10063020", gstRate: 5, unitWord: "kg" }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: name, unit: "kg", hsn: "10063020", gstRate: 5, agentId: "AG-len", text });
  const history = [
    { role: "assistant", content: text, metadata: { source: "command" }, turn_id: turn++ },
    { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: turn++ },
  ];
  return itemTax.confirm(biz, { agentId: "AG-len", history }).item;
}

test("the bill read-back is one /speak piece for one long line and for a six-line bill, with its total", () => {
  for (const language of LANGS) {
    const biz = business(language);
    const { customer } = customers.save(biz, { name: CUSTOMER });
    const names = ["aged extra long grain basmati rice", "toor dal", "sugar", "sunflower oil", "wheat flour", "rock salt"];
    const stocked = names.map((name) => taxedItem(biz, name));
    for (const count of [1, 6]) {
      const invoice = invoices.draft(biz, { customerId: customer.id, lines: stocked.slice(0, count).map((item) => ({ itemId: item.id, quantity: 1000, rate: 1234.5 })) });
      const text = gate.buildReadback(biz, invoice, language);
      onePiece(text, `bill ${language} lines=${count}`);
      assert.ok(text.includes(gst.rupeesText(invoice.totals.totalPaise)), `${language}: total in ${text}`);
      assert.equal(gate.buildReadback(biz, invoice, language), text, "deterministic");
    }
  }
});

test("the payment read-back with its question, the item-tax read-back and the rule and usual-quantity questions are one piece each", () => {
  for (const language of LANGS) {
    const receipt = `${khata.receiptReadback(language, { name: CUSTOMER, amountPaise: 12345675, mode: "upi", invoice: true })} ${khataPhrases.payment_question[language]()}`;
    onePiece(receipt, `receipt ${language}`);
    assert.ok(receipt.includes(CUSTOMER.split(" ")[0]));

    const tax = itemTax.readback({ item: VENDOR, hsn: "10063020", gstRate: 18, salePrice: 123456.5, unitWord: "kg" }, language);
    onePiece(tax, `item tax ${language}`);
    assert.ok(tax.includes("123456.5"));

    for (const [kind, params, question] of [
      ["prefer_vendor", { name: VENDOR }, registry.phrase("rule_question", language)],
      ["avoid_vendor", { name: VENDOR }, registry.phrase("rule_question", language)],
      ["max_price", { item: ITEM[language], unit: "kg", price: 123456 }, registry.phrase("rule_question", language)],
      ["usual_quantity", { item: ITEM[language], quantity: 123456, unit: "kg" }, registry.phrase("rule_question", language)],
      ["reorder_level", { item: ITEM[language], level: 123456, unit: "kg" }, stockSay.line("level_question", language)],
    ]) {
      onePiece(`${rules.buildRule(kind, params).sentence[language]} ${question}`, `rule ${kind} ${language}`);
    }

    const usual = `${registry.phrase("usual_quantity_offer", language, { item: ITEM[language], quantity: "123456", unit: "kg" })} ${registry.phrase("usual_quantity_question", language)}`;
    onePiece(usual, `usual quantity ${language}`);

    const item = { name: ITEM["en-IN"], name_native: null, unit: "kg" };
    onePiece(reorder.question(item, 12.5, 123456, "kg", language), `reorder question ${language}`);
  }
});

test("outcome lines with their hand-back, and every narrator line, are one piece each", () => {
  for (const language of LANGS) {
    const hand = outcome.HAND_BACK[language];
    const outcomes = [
      `${registry.phrase("approval_approved", language)} ${registry.phrase("order_created", language, { po: "PO-2026-27-000123", sim: true })}`,
      registry.phrase("approval_rejected", language),
      sellPhrases.invoice_issued[language]({ number: "INV/2026-27/000123", total: "123456.75", pay: true }),
      khataPhrases.payment_recorded[language]({ name: CUSTOMER, amount: khata.spokenRupees(12345675, language), left: khata.spokenRupees(98765432, language) }),
      registry.phrase("rule_kept", language),
    ];
    for (const line of outcomes) onePiece(`${line} ${hand}`, `outcome ${language}`);

    const v = { count: 123, name: VENDOR, vendor: VENDOR, price: "123456.5", unit: "kg", sim: true, po: "PO-2026-27-000123", amount: "123456.75", kind: "negotiation" };
    for (const [key, byLanguage] of Object.entries(narrator.LINES)) onePiece(byLanguage[language](v), `narrator ${key} ${language}`);
    for (const [key, byLanguage] of Object.entries(narrator.VARIANTS)) for (const line of byLanguage[language] ?? []) onePiece(line(v), `narrator variant ${key} ${language}`);
  }
});
