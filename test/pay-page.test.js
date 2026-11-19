"use strict";

/**
 * public/js/pay.js (the /pay/<token> page) run against public/pay.html's element ids with a
 * minimal fake DOM: a purchase-order token keeps the purchase-order wording; an invoice token
 * shows the shop as merchant and the customer as buyer, in the shop's language, and goes back to
 * the Sell screen.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "public", "pay.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(ROOT, "public", "js", "pay.js"), "utf8");
const IDS = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

/** Load the page with GET /api/pay/<token> answering `data`; resolves to the elements once rendered. */
async function load(data) {
  const elements = {};
  for (const id of IDS) {
    const attrs = {};
    elements[id] = {
      id, textContent: "", hidden: /\shidden[\s>]/.test(HTML.slice(HTML.indexOf(`id="${id}"`)).split(">")[0] + ">"), disabled: true, className: "",
      href: (HTML.slice(HTML.indexOf(`id="${id}"`)).match(/^id="[^"]+"[^>]*?href="([^"]+)"/) || [])[1] || "",
      setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], addEventListener() {},
    };
  }
  const html = { lang: "en", setAttribute(k, v) { this[k] = v; } };
  const document = { getElementById: (id) => elements[id] ?? null, documentElement: html, title: "" };
  let rendered;
  const done = new Promise((resolve) => { rendered = resolve; });
  const fetch = async () => ({ ok: true, json: async () => data });
  const context = { window: {}, document, location: { pathname: "/pay/" + (data.kind === "invoice" ? "inv_" : "") + "A".repeat(22) }, fetch, Intl, console };
  vm.createContext(context);
  vm.runInContext(SCRIPT, context);
  // fetch -> json -> render run on microtasks.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  rendered();
  await done;
  return { el: elements, html, document };
}

const PO = { testMode: true, keyId: "rzp_test_x", razorpayOrderId: "order_X", amountPaise: 310000, amount: 3100, currency: "INR", poNumber: "SAHAY/2026/0001", buyer: "Asha Kirana", vendor: "BS Foods", simulated: true, item: "rice", quantity: 50, unit: "kg", description: "d", orderStatus: "confirmed", paid: false };
const INVOICE = { kind: "invoice", testMode: true, keyId: "rzp_test_x", razorpayOrderId: "order_Y", amountPaise: 472500, amount: 4725, currency: "INR", invoiceNumber: "INV/2026-27/0001", poNumber: "INV/2026-27/0001", merchant: "Asha Kirana", vendor: "Asha Kirana", buyer: "Ramesh Traders", simulated: false, item: "50 kg basmati rice", quantity: "", unit: "", description: "d", invoiceStatus: "issued", orderStatus: "issued", paid: false, language: "hi-IN" };

test("a purchase-order token keeps the purchase-order wording, the simulated vendor label and the way back to Buy", async () => {
  const { el } = await load(PO);
  assert.equal(el.title.textContent, "Payment for a purchase order");
  assert.equal(el.po.textContent, "Purchase order SAHAY/2026/0001");
  assert.equal(el.vendor.textContent, "BS Foods");
  assert.equal(el.buyer.textContent, "Asha Kirana");
  assert.equal(el["label-vendor"].textContent, "Supplier");
  assert.equal(el.sim.hidden, false, "a simulated vendor is labelled");
  assert.equal(el.back.href, "/app#/buy");
  assert.equal(el.details.hidden, false);
});

test("an invoice token: the shop is the merchant, the customer the buyer, a bill in the shop's language, back to Sell, no simulated label", async () => {
  const { el, html } = await load(INVOICE);
  assert.equal(html.lang, "hi");
  assert.equal(el.title.textContent, "बिल का भुगतान");
  assert.equal(el.po.textContent, "बिल INV/2026-27/0001");
  assert.equal(el["label-vendor"].textContent, "दुकान");
  assert.equal(el.vendor.textContent, "Asha Kirana");
  assert.equal(el["label-buyer"].textContent, "ग्राहक");
  assert.equal(el.buyer.textContent, "Ramesh Traders");
  assert.equal(el.item.textContent, "50 kg basmati rice");
  assert.equal(el.sim.hidden, true, "a real shop's bill is never called a simulated vendor");
  assert.equal(el.back.href, "/app#/sell");
  assert.equal(el["done-back-link"].href, "/app#/sell");
  assert.match(el.banner.textContent, /Razorpay/);
  assert.doesNotMatch(Object.values(el).map((e) => e.textContent).join(" "), /purchase order|simulated/i);
});

test("an invoice page in Kannada and English says bill, ಬಿಲ್ and Bill", async () => {
  const kn = await load({ ...INVOICE, language: "kn-IN" });
  assert.equal(kn.el.po.textContent, "ಬಿಲ್ INV/2026-27/0001");
  assert.equal(kn.html.lang, "kn");
  const en = await load({ ...INVOICE, language: "en-IN" });
  assert.equal(en.el.po.textContent, "Bill INV/2026-27/0001");
  assert.equal(en.el.title.textContent, "Pay your bill");
  assert.equal(en.el["label-vendor"].textContent, "Shop");
  assert.equal(en.el["label-buyer"].textContent, "Customer");
  const paid = await load({ ...INVOICE, language: "en-IN", paid: true });
  assert.equal(paid.el.pay.hidden, true);
  assert.equal(paid.el.status.textContent, "This bill is paid (Razorpay test mode).");
});
