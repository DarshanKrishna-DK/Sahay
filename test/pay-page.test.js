"use strict";

/**
 * public/js/pay.js (the /pay/<token> page) run against public/pay.html's element ids with a
 * minimal fake DOM: a purchase-order token keeps the purchase-order wording and its way back to
 * Buy; an invoice token shows the shop as merchant and the customer as buyer, in the shop's
 * language, with no link into the owner's app, and ends on "Paid. Thank you." once the server has
 * verified the payment. No owner-only PDF link is ever on a customer's page.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "public", "pay.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(ROOT, "public", "js", "pay.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "public", "css", "pay.css"), "utf8");
const IDS = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/**
 * Load the page with GET /api/pay/<token> answering `data` (and POST .../verify answering `verified`);
 * resolves to the elements once rendered. `pay()` presses Pay: the fake Razorpay Checkout succeeds
 * at once and the page posts the signature to the server.
 */
async function load(data, { verified = null, fail = null, token = null, uiLang = null } = {}) {
  const elements = {};
  for (const id of IDS) {
    const attrs = {};
    const listeners = {};
    elements[id] = {
      id, textContent: "", hidden: /\shidden[\s>]/.test(HTML.slice(HTML.indexOf(`id="${id}"`)).split(">")[0] + ">"), disabled: true, className: "",
      href: (HTML.slice(HTML.indexOf(`id="${id}"`)).match(/^id="[^"]+"[^>]*?href="([^"]+)"/) || [])[1] || "",
      setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k],
      addEventListener(type, fn) { listeners[type] = fn; }, listeners,
      focused: false, focus() { this.focused = true; },
    };
  }
  const html = { lang: "en", setAttribute(k, v) { this[k] = v; } };
  const document = { getElementById: (id) => elements[id] ?? null, documentElement: html, title: "" };
  let rendered;
  const done = new Promise((resolve) => { rendered = resolve; });
  const requests = [];
  const fetch = async (url, opts = {}) => {
    requests.push({ url, method: opts.method || "GET" });
    if (fail && !String(url).endsWith("/verify")) {
      if (fail.network) throw new TypeError("Failed to fetch");
      return { ok: false, status: fail.status, json: async () => fail.body };
    }
    const body = String(url).endsWith("/verify") ? verified : data;
    return { ok: true, status: 200, json: async () => body };
  };
  class Razorpay {
    constructor(options) { this.options = options; }
    on() {}
    open() { this.options.handler({ razorpay_payment_id: "pay_TESTONLY1", razorpay_order_id: this.options.order_id, razorpay_signature: "0".repeat(64) }); }
  }
  const saved = { "sahay-ui-lang": uiLang };
  const localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
  const context = { window: { Razorpay, localStorage }, document, location: { pathname: "/pay/" + (token || ((data.kind === "invoice" ? "inv_" : "") + "A".repeat(22))) }, fetch, Intl, console };
  vm.createContext(context);
  vm.runInContext(SCRIPT, context);
  // fetch -> json -> render run on microtasks.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  rendered();
  await done;
  const pay = async () => { elements.pay.listeners.click(); await settle(); };
  return { el: elements, html, document, pay, requests, saved };
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

test("an invoice token: the shop is the merchant, the customer the buyer, a bill in the chosen language (Hindi here), no link into the owner's app, no simulated label", async () => {
  const { el, html } = await load(INVOICE, { uiLang: "hi" });
  assert.equal(html.lang, "hi");
  assert.equal(el.title.textContent, "बिल का भुगतान");
  assert.equal(el.po.textContent, "बिल INV/2026-27/0001");
  assert.equal(el["label-vendor"].textContent, "दुकान");
  assert.equal(el.vendor.textContent, "Asha Kirana");
  assert.equal(el["label-buyer"].textContent, "ग्राहक");
  assert.equal(el.buyer.textContent, "Ramesh Traders");
  assert.equal(el.item.textContent, "50 kg basmati rice");
  assert.equal(el.sim.hidden, true, "a real shop's bill is never called a simulated vendor");
  assert.equal(el.back.hidden, true, "the customer has no Sahay app: no way back into it");
  assert.equal(el["done-back"].hidden, true);
  assert.equal(el.thanks.hidden, true, "not paid yet");
  assert.match(el["banner-text"].textContent, /Razorpay/);
  assert.doesNotMatch(Object.values(el).map((e) => e.textContent).join(" "), /purchase order|simulated/i);
});

test("an invoice page in Kannada and English says bill, ಬಿಲ್ and Bill", async () => {
  const kn = await load({ ...INVOICE, language: "kn-IN" }, { uiLang: "kn" });
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

test("a purchase order still goes back to Buy after checkout, and never shows the bill's thank-you", async () => {
  const page = await load(PO, { verified: { status: "paid" } });
  assert.equal(page.el.back.hidden, false);
  assert.equal(page.el.back.href, "/app#/buy");
  await page.pay();
  assert.equal(page.el.status.textContent, "Paid and verified (Razorpay test mode). Order SAHAY/2026/0001 is marked paid.");
  assert.equal(page.el["done-back"].hidden, false, "the owner's way home after checkout");
  assert.equal(page.el["done-back-link"].href, "/app#/buy");
  assert.equal(page.el.thanks.hidden, true);
  assert.equal(page.el.details.hidden, false);
});

test("an invoice paid and verified ends on 'Paid. Thank you.' with the shop, bill number and amount, in the chosen language", async () => {
  const page = await load(INVOICE, { uiLang: "hi", verified: { status: "paid", number: "INV/2026-27/0001", already: false } });
  await page.pay();
  assert.deepEqual(page.requests.map((r) => [r.method, r.url.replace(/inv_A+/, "inv_x")]), [["GET", "/api/pay/inv_x"], ["POST", "/api/pay/inv_x/verify"]]);
  const { el } = page;
  assert.equal(el.thanks.hidden, false);
  assert.equal(el["thanks-title"].textContent, "भुगतान हो गया। धन्यवाद।");
  assert.equal(el["thanks-title"].focused, true, "focus moves to the thank-you so it is announced");
  assert.equal(el["thanks-label-shop"].textContent, "दुकान");
  assert.equal(el["thanks-shop"].textContent, "Asha Kirana");
  assert.equal(el["thanks-label-bill"].textContent, "बिल");
  assert.equal(el["thanks-bill"].textContent, "INV/2026-27/0001");
  assert.equal(el["thanks-label-amount"].textContent, "चुकाई गई रकम");
  assert.equal(el["thanks-amount-row"].hidden, false);
  assert.match(el["thanks-amount"].textContent, /4,725/);
  assert.equal(el.pay.hidden, true);
  assert.equal(el.details.hidden, true, "the bill's pay details give way to the thank-you");
  assert.equal(el.back.hidden, true);
  assert.equal(el["done-back"].hidden, true, "no link into the owner's app after paying either");
});

test("an invoice thank-you in English and Kannada; a part payment does not say thank-you for the whole bill", async () => {
  const en = await load({ ...INVOICE, language: "en-IN" }, { verified: { status: "paid" } });
  await en.pay();
  assert.equal(en.el["thanks-title"].textContent, "Paid. Thank you.");
  assert.equal(en.el["thanks-label-shop"].textContent, "Shop");
  assert.equal(en.el["thanks-label-bill"].textContent, "Bill");
  assert.equal(en.el["thanks-amount"].textContent, "₹4,725.00");
  const kn = await load({ ...INVOICE, language: "kn-IN" }, { uiLang: "kn", verified: { status: "paid" } });
  await kn.pay();
  assert.equal(kn.el["thanks-title"].textContent, "ಪಾವತಿ ಆಯಿತು. ಧನ್ಯವಾದಗಳು.");
  assert.equal(kn.el["thanks-label-shop"].textContent, "ಅಂಗಡಿ");
  const part = await load({ ...INVOICE, language: "en-IN" }, { verified: { status: "part_paid" } });
  await part.pay();
  assert.equal(part.el.thanks.hidden, true);
  assert.equal(part.el.status.textContent, "The payment was recorded; bill INV/2026-27/0001 still has money due.");
  assert.equal(part.el["done-back"].hidden, true);
});

test("an invoice link opened again after paying shows the thank-you without an amount (nothing is open)", async () => {
  const { el } = await load({ ...INVOICE, language: "en-IN", paid: true, amount: 0, amountPaise: 0 });
  assert.equal(el.thanks.hidden, false);
  assert.equal(el["thanks-bill"].textContent, "INV/2026-27/0001");
  assert.equal(el["thanks-label-amount"].hidden, true);
  assert.equal(el["thanks-amount-row"].hidden, true);
  assert.equal(el.back.hidden, true);
});

test("the customer's page never links to the owner-only bill PDF", () => {
  // No string in the page or its script names the bill PDF (comments may explain why it is absent).
  assert.doesNotMatch(HTML + SCRIPT, /["'][^"'\n]*(\/api\/invoices|\.pdf)[^"'\n]*["']/i);
  assert.doesNotMatch(SCRIPT, /pdfUrl|pdf_url|\.download\b|download=/i);
  const sell = fs.readFileSync(path.join(ROOT, "src", "sell", "checkout.js"), "utf8");
  const page = /function checkoutForToken[\s\S]*?\n}\n/.exec(sell)[0];
  assert.doesNotMatch(page, /pdf/i, "the public pay data exposes no PDF URL, so the page offers no download");
});

test("an invoice page never shows the simulated-vendor label, even if the data said simulated, and [hidden] wins over the label's own display", async () => {
  // E2E 2026-11-19 (ce5d22b): ".sim { display: inline-block }" beat the hidden attribute, so the
  // label showed on a customer's bill although the API sent simulated:false. 331269c added the rule below.
  assert.match(CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  const { el } = await load({ ...INVOICE, simulated: true });
  assert.equal(el.sim.hidden, true, "a customer's bill has no vendor to label");
});

const stateOf = (page) => page.el["pay-root"].getAttribute("data-state");

test("every pay state is named on the page root: ready, verifying ends on paid (order) or thanks (bill)", async () => {
  const po = await load(PO, { verified: { status: "paid" } });
  assert.equal(stateOf(po), "ready");
  assert.equal(po.el["pay-root"].getAttribute("data-kind"), "order");
  assert.equal(po.el["amount-block"].hidden, false);
  assert.equal(po.el.skeleton.hidden, true, "the loading skeleton gives way to the order");
  await po.pay();
  assert.equal(stateOf(po), "paid");
  const bill = await load(INVOICE, { verified: { status: "paid" } });
  assert.equal(bill.el["pay-root"].getAttribute("data-kind"), "bill");
  await bill.pay();
  assert.equal(stateOf(bill), "thanks");
  const part = await load(INVOICE, { verified: { status: "part_paid" } });
  await part.pay();
  assert.equal(stateOf(part), "partial");
});

test("an expired bill link says so in the visitor's words, with no pay button and no way into the owner's app", async () => {
  const page = await load(INVOICE, { token: "inv_" + "B".repeat(22), fail: { status: 410, body: { code: "PAY_LINK_EXPIRED", message: "expired" } } });
  assert.equal(stateOf(page), "expired");
  assert.equal(page.el.problem.hidden, false);
  assert.equal(page.el["problem-title"].textContent, "This payment link has expired");
  assert.equal(page.el["problem-text"].textContent, "Ask the shop for a new payment link.");
  assert.equal(page.el["problem-title"].focused, true);
  assert.equal(page.el.pay.hidden, true);
  assert.equal(page.el.back.hidden, true, "a bill link never links into Sahay");
  assert.equal(page.el.retry.hidden, true, "nothing to retry on an expired link");
});

test("an unknown order link is 'not valid' with the way back to Buy; a network failure offers Try again", async () => {
  const bad = await load(PO, { token: "Z".repeat(22), fail: { status: 404, body: { code: "PAY_LINK_INVALID" } } });
  assert.equal(stateOf(bad), "invalid");
  assert.equal(bad.el["problem-title"].textContent, "This payment link is not valid");
  assert.equal(bad.el.back.hidden, false);
  assert.equal(bad.el.back.href, "/app#/buy");
  const down = await load(PO, { fail: { network: true } });
  assert.equal(stateOf(down), "error");
  assert.equal(down.el.retry.hidden, false);
  const limited = await load(PO, { fail: { status: 429, body: { code: "RATE_LIMITED" } } });
  assert.equal(stateOf(limited), "limit");
});

test("the pay page uses the v5 tokens and its own sheet: no inline style block, no lime, marigold or saffron", () => {
  assert.doesNotMatch(HTML, /<style/i, "styles live in /css/pay.css (self only under PAY_CSP)");
  assert.match(HTML, /href="\/css\/tokens\.css"/);
  assert.doesNotMatch(HTML, /tokens-v3/);
  assert.match(HTML, /href="\/css\/pay\.css"/);
  assert.match(HTML, /https:\/\/fonts\.googleapis\.com\/css2\?family=Manrope/, "v5 fonts load from Google Fonts (allowed in PAY_CSP)");
  assert.doesNotMatch(CSS + SCRIPT, /#FFB020|#FF7A1A|marigold|saffron|#1f6f5c|#B6F23C|--lime|--piano/i);
  assert.match(SCRIPT, /theme: \{ color: "#F2CFC6" \}/);
  assert.match(HTML, /<span class="pay-btn-front">/, "the pink pill Pay button");
  assert.doesNotMatch(HTML + CSS, /pay-btn-edge|translateY/, "the owner's flat pill: no edge, no press-down");
  assert.match(CSS, /\.pay-btn-front \{[^}]*white-space: nowrap/, "the Pay word never wraps");
  for (const s of ["Pay with Razorpay", "Razorpay से भुगतान करें", "Razorpay ಮೂಲಕ ಪಾವತಿಸಿ"]) assert.ok(SCRIPT.includes(`pay: "${s}"`), s);
});

test("v4: English by default whatever the shop's language; the small switch changes the words and is kept on the device", async () => {
  const page = await load(INVOICE); // the shop speaks Hindi
  assert.equal(page.html.lang, "en");
  assert.equal(page.el.title.textContent, "Pay your bill");
  assert.equal(page.el["lang-en"].getAttribute("aria-pressed"), "true");
  page.el["lang-kn"].listeners.click();
  assert.equal(page.html.lang, "kn");
  assert.equal(page.el.title.textContent, "ಬಿಲ್ ಪಾವತಿ");
  assert.equal(page.el["lang-kn"].getAttribute("aria-pressed"), "true");
  assert.equal(page.saved["sahay-ui-lang"], "kn");
  const po = await load(PO, { uiLang: "hi" });
  assert.equal(po.el.title.textContent, "खरीद ऑर्डर का भुगतान");
  assert.match(po.el["sim-text"].textContent, /simulated vendor/, "the simulated label keeps the English words in every language");
  assert.equal(po.el.back.href, "/app#/buy");
});

test("v4: the real Sahay logo, not an invented mark", () => {
  assert.match(HTML, /class="brand-mark"><img class="brand-img" src="\/assets\/brand\/sahay-mark-128\.png"/);
  assert.match(HTML, /href="\/assets\/brand\/favicon-32\.png"/);
  assert.doesNotMatch(HTML, /pay-logo|sahay-mark-72/);
});
