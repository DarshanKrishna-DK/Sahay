"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  // No Razorpay keys: this test must never reach Razorpay (a .env on the machine would otherwise be read).
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
});

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const express = require("express");

const auth = require("../src/auth");
const limits = require("../src/limits");
const repo = require("../src/db/repo");
const { splitUtf8 } = require("../src/agora/agent");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const customers = require("../src/sell/customers");
const invoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const gate = require("../src/sell/gate");
const { createSellRouter } = require("../src/routes/sell");

beforeEach(() => limits.reset());

const validGstin = (first14) => first14 + gst.checksumChar(first14);

function business(name = "Asha Stores") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language: "en-IN" });
  return id;
}

const cookieFor = (businessId) =>
  `${auth.COOKIE_NAME}=${auth.signSession({ businessId, sessionId: repo.newId("web"), scope: "browser", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

async function withApp(t) {
  const app = express();
  app.use(createSellRouter());
  // stands in for the purchase pay router mounted after this one
  app.get("/api/pay/:token", (_req, res) => res.status(404).json({ code: "PAY_LINK_INVALID", message: "purchase router" }));
  app.use((err, _req, res, _next) => res.status(500).json({ code: "INTERNAL", message: err.message }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { cookie, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, type, json: type.includes("json") ? await res.json() : null, buffer: type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : null };
  };
}

/** A shop with a confirmed item and a bill the server has put to the owner (pending approval). */
function pendingBill() {
  const biz = business();
  settings.save(biz, { gstin: validGstin("29AAPFU0939F1Z") });
  const text = itemTax.readback({ item: "basmati rice", hsn: "1006", gstRate: 5, unitWord: "kg" }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: "basmati rice", unit: "kg", hsn: "1006", gstRate: 5, agentId: "AG", text });
  const history = [
    ...splitUtf8(text).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 1 + i })),
    { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: 9 },
  ];
  const { item } = itemTax.confirm(biz, { agentId: "AG", history });
  const { customer } = customers.save(biz, { name: "Ramesh Traders", phone: "9845012345" });
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: item.id, quantity: 50, rate: 95 }] });
  const { approval } = gate.requestInvoiceApproval(biz, invoice.id);
  return { biz, invoice, approval, customer };
}

test("every owner route needs the session cookie", async (t) => {
  const call = await withApp(t);
  for (const [method, path] of [["GET", "/api/sell"], ["POST", "/api/sell/settings"], ["POST", "/api/customers"], ["POST", "/api/invoices/inv_x/decision"], ["GET", "/api/invoices/inv_x/pdf"]]) {
    assert.equal((await call(method, path, { body: method === "POST" ? {} : undefined })).status, 401, `${method} ${path}`);
  }
});

test("GET /api/sell shows only this business; a business id in the body is ignored", async (t) => {
  const call = await withApp(t);
  const { biz, invoice, approval } = pendingBill();
  const other = business("Other Shop");
  const mine = await call("GET", "/api/sell", { cookie: cookieFor(biz) });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.invoices.length, 1);
  assert.equal(mine.json.invoices[0].id, invoice.id);
  assert.equal(mine.json.invoices[0].status, "pending");
  assert.equal(mine.json.approvals[0].approvalId, approval.id);
  assert.equal(mine.json.settings.gstScheme, "regular");
  assert.ok(Array.isArray(mine.json.owed) && Array.isArray(mine.json.receipts));
  const theirs = await call("GET", "/api/sell", { cookie: cookieFor(other) });
  assert.deepEqual([theirs.json.invoices, theirs.json.customers], [[], []]);
  const added = await call("POST", "/api/customers", { cookie: cookieFor(other), body: { name: "Suresh", business_id: biz, businessId: biz } });
  assert.equal(added.status, 201);
  assert.equal(customers.findByName(biz, "Suresh"), null);
  assert.ok(customers.findByName(other, "Suresh"));
});

test("the ✓ issues only the bill that waits for a yes, of this business; ✕ sends it back to draft", async (t) => {
  const call = await withApp(t);
  const { biz, invoice } = pendingBill();
  const other = business("Other Shop");
  assert.equal((await call("POST", `/api/invoices/${invoice.id}/decision`, { cookie: cookieFor(other), body: { decision: "approve" } })).status, 404);
  assert.equal((await call("POST", `/api/invoices/${invoice.id}/decision`, { cookie: cookieFor(biz), body: { decision: "maybe" } })).status, 400);
  // no PDF before the yes
  const early = await call("GET", `/api/invoices/${invoice.id}/pdf`, { cookie: cookieFor(biz) });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, "INVOICE_NOT_ISSUED");

  const ok = await call("POST", `/api/invoices/${invoice.id}/decision`, { cookie: cookieFor(biz), body: { decision: "approve" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, "issued");
  assert.equal(ok.json.invoice.number, `INV/${gst.financialYear()}/0001`);
  assert.equal(ok.json.invoice.pdfUrl, `/api/invoices/${invoice.id}/pdf`);
  // no Razorpay keys in this test: the pay link is reported as a problem, never faked
  assert.equal(ok.json.invoice.payUrl, null);
  assert.equal(ok.json.problems[0].code, "RAZORPAY_NOT_CONFIGURED");

  const again = await call("POST", `/api/invoices/${invoice.id}/decision`, { cookie: cookieFor(biz), body: { decision: "approve" } });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "NO_PENDING_APPROVAL");

  const pdf = await call("GET", `/api/invoices/${invoice.id}/pdf`, { cookie: cookieFor(biz) });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
  assert.equal((await call("GET", `/api/invoices/${invoice.id}/pdf`, { cookie: cookieFor(other) })).status, 404);

  const second = pendingBill();
  const no = await call("POST", `/api/invoices/${second.invoice.id}/decision`, { cookie: cookieFor(second.biz), body: { decision: "reject" } });
  assert.equal(no.json.status, "rejected");
  assert.equal(no.json.invoice.status, "draft");
});

test("settings route validates the GSTIN and answers with a spoken line", async (t) => {
  const call = await withApp(t);
  const biz = business();
  const bad = await call("POST", "/api/sell/settings", { cookie: cookieFor(biz), body: { gstin: "29AAPFU0939F1ZZ" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "GSTIN_INVALID");
  assert.ok(bad.json.say);
  const good = await call("POST", "/api/sell/settings", { cookie: cookieFor(biz), body: { gst_scheme: "composition", gstin: validGstin("29AAPFU0939F1Z"), address: "Market Road" } });
  assert.equal(good.status, 200);
  assert.equal(good.json.settings.kind, "bill_of_supply");
});

test("pay routes: an invoice token is answered here, any other token passes on to the purchase pay router", async (t) => {
  const call = await withApp(t);
  const purchase = await call("GET", "/api/pay/AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(purchase.json.message, "purchase router");
  const unknown = await call("GET", `/api/pay/inv_${"B".repeat(22)}`);
  assert.equal(unknown.json.code, "RAZORPAY_NOT_CONFIGURED"); // refused before any lookup without test keys
});
