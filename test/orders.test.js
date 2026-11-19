"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// A real database file in a temp folder, so purchase orders are written beside it and removed afterwards.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sahay-orders-"));
process.env.DB_FILE = path.join(TMP, "sahay.db");

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const approvals = require("../src/approvals");
const { config } = require("../src/config");
const { splitUtf8 } = require("../src/agora/agent");
const db = require("../src/db");
const orders = require("../src/orders");
const po = require("../src/orders/po");
const repo = require("../src/db/repo");

after(() => {
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function seedBusiness({ name = "Asha Stores", language = "en-IN" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language });
  return id;
}

/** A requested approval for 50 kg at 62 per kg, freight 150, landed 3250. */
function seedPendingApproval(businessId, { source = "indiamart", counterpart = "human", requirement = {}, quote = {}, vendor = {} } = {}) {
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru", ...requirement });
  const seller = repo.createVendor(businessId, { requirement_id: need.id, source, name: "Lakshmi Traders", city: "Bengaluru", ...vendor });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: seller.id, counterpart });
  const quoted = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: seller.id, negotiation_id: negotiation.id,
    unit_price: 62, unit: "kg", lead_time_days: 3, freight: 150, landed_cost: 3250, payment_terms: "50% advance", ...quote,
  });
  return { requirement: need, vendor: seller, quote: quoted, approval: approvals.requestApproval(businessId, quoted.id).approval };
}

/** Approved by voice the only way there is: the server spoke the read-back and the owner's next turn is a yes. */
function seedApproved(businessId, options) {
  const seeded = seedPendingApproval(businessId, options);
  const { readback, id } = seeded.approval;
  approvals.recordReadbackSpoken(businessId, id, { agentId: "AG-orders", text: readback });
  const history = [
    ...splitUtf8(readback).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 10 + i })),
    { role: "user", content: "yes go ahead", metadata: { source: "asr" }, turn_id: 20 },
  ];
  approvals.confirmApproval(businessId, id, { decision: "approve", via: "voice", agentId: "AG-orders", history });
  return seeded;
}

async function seedOrder(businessId, options) {
  const seeded = seedApproved(businessId, options);
  return { ...seeded, order: await orders.createOrder(businessId, seeded.approval.id) };
}

const refuses = (code) => (err) => err.code === code;
const auditTypes = (businessId) => repo.listAudit(businessId).map((row) => row.type);

/* -------------------------------------------------------- the gate --- */

test("an order without an approval is refused", async () => {
  const businessId = seedBusiness();
  const { approval } = seedPendingApproval(businessId);

  await assert.rejects(orders.createOrder(businessId, approval.id), refuses("NOT_APPROVED"), "approval still pending");
  await assert.rejects(orders.createOrder(businessId, "apr_does_not_exist"), refuses("APPROVAL_NOT_FOUND"));
  await assert.rejects(orders.createOrder(businessId, undefined), refuses("APPROVAL_NOT_FOUND"));

  assert.deepEqual(repo.listOrders(businessId), []);
  assert.equal(repo.getApproval(businessId, approval.id).status, "pending");
  assert.ok(!auditTypes(businessId).includes("order.created"));
});

test("a rejected approval cannot become an order", async () => {
  const businessId = seedBusiness();
  const { approval } = seedPendingApproval(businessId);
  approvals.confirmApproval(businessId, approval.id, { decision: "reject", via: "button" });
  await assert.rejects(orders.createOrder(businessId, approval.id), refuses("NOT_APPROVED"));
  assert.deepEqual(repo.listOrders(businessId), []);
});

test("an approval from another business is refused and stays usable by its owner", async () => {
  const owner = seedBusiness({ name: "Owner" });
  const other = seedBusiness({ name: "Other" });
  const { approval } = seedApproved(owner);

  await assert.rejects(orders.createOrder(other, approval.id), refuses("APPROVAL_NOT_FOUND"));
  assert.deepEqual(repo.listOrders(other), []);
  assert.deepEqual(repo.listOrders(owner), []);
  assert.equal(repo.getApproval(owner, approval.id).status, "approved", "the failed attempt must not consume it");
  assert.deepEqual(repo.listAudit(other), []);

  const order = await orders.createOrder(owner, approval.id);
  assert.equal(order.business_id, owner);
});

test("an approval is consumed exactly once", async () => {
  const businessId = seedBusiness();
  const { approval } = seedApproved(businessId);

  const first = await orders.createOrder(businessId, approval.id);
  await assert.rejects(orders.createOrder(businessId, approval.id), refuses("APPROVAL_CONSUMED"));
  assert.deepEqual(repo.listOrders(businessId).map((order) => order.id), [first.id]);
  assert.equal(repo.getApproval(businessId, approval.id).status, "consumed");
  assert.equal(auditTypes(businessId).filter((type) => type === "order.created").length, 1);
});

test("two simultaneous orders on one approval produce one order", async () => {
  const businessId = seedBusiness();
  const { approval } = seedApproved(businessId);
  const results = await Promise.allSettled([orders.createOrder(businessId, approval.id), orders.createOrder(businessId, approval.id)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "APPROVAL_CONSUMED");
  assert.equal(repo.listOrders(businessId).length, 1);
});

test("an approval for a deal that has since changed is refused", async () => {
  const businessId = seedBusiness();
  const { approval, requirement, quote } = seedApproved(businessId);
  repo.updateRequirement(businessId, requirement.id, { quantity: 500 });
  repo.setQuoteLandedCost(businessId, quote.id, 500 * 62 + 150);

  await assert.rejects(orders.createOrder(businessId, approval.id), refuses("APPROVAL_STALE"));
  assert.deepEqual(repo.listOrders(businessId), []);
  assert.equal(repo.getApproval(businessId, approval.id).status, "approved");
});

/* ------------------------------------------------------ happy path --- */

test("an approved deal becomes an order with a sequential PO number, a PDF on disk and an audit row", async () => {
  const businessId = seedBusiness();
  const session = repo.createSession(businessId, { kind: "owner" });
  const first = seedApproved(businessId);
  const second = seedApproved(businessId);

  const order = await orders.createOrder(businessId, first.approval.id, { sessionId: session.id });
  assert.match(order.id, /^ord_/);
  assert.equal(order.status, "confirmed");
  assert.equal(order.amount, 3250, "the amount the owner approved");
  assert.equal(order.currency, "INR");
  assert.equal(order.quote_id, first.quote.id);
  assert.equal(order.approval_id, first.approval.id);
  assert.equal(order.simulated, false);

  const [, year, code, sequence] = /^SAHAY\/(\d{4})\/([0-9A-F]{4,})-(\d{4})$/.exec(order.po_number);
  assert.ok(Math.abs(Number(year) - new Date().getFullYear()) <= 1);
  const next = await orders.createOrder(businessId, second.approval.id);
  assert.equal(next.po_number, `SAHAY/${year}/${code}-${String(Number(sequence) + 1).padStart(4, "0")}`);

  assert.equal(order.pdf_path, path.join(config.poDir, `${order.po_number.replaceAll("/", "-")}.pdf`));
  assert.equal(path.dirname(order.pdf_path), path.join(TMP, "po"));
  const pdf = fs.readFileSync(order.pdf_path);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdf.length > 1500);
  assert.deepEqual(fs.readdirSync(config.poDir).filter((name) => name.endsWith(".part")), [], "no half-written files");

  const created = repo.listAudit(businessId, { type: "order.created" })[0];
  assert.equal(created.actor, "system");
  assert.equal(created.session_id, session.id);
  assert.deepEqual(created.detail, {
    orderId: order.id, poNumber: order.po_number, approvalId: first.approval.id, quoteId: first.quote.id,
    vendor: "Lakshmi Traders", simulated: false, amount: 3250, currency: "INR", status: "confirmed",
  });
});

/* ------------------------------------------------- purchase order --- */

test("the purchase order of a real quote names the vendor, the freight and the approval", async () => {
  const businessId = seedBusiness();
  const { order, approval } = await seedOrder(businessId, {
    vendor: { phone: "08047634912", source_url: "https://www.indiamart.com/lakshmi-traders/" },
    quote: { moq: 25, quoted_sentence: "62 rupees per kg, final" },
  });
  const model = po.poModel(repo.getOrderDocument(businessId, order.id));

  assert.equal(model.poNumber, order.po_number);
  assert.equal(model.simulated, false);
  assert.equal(model.notice, null);
  assert.deepEqual(model.buyer, { name: "Asha Stores", lines: ["Asha", "Bengaluru, Karnataka"] });
  assert.deepEqual(model.supplier, {
    name: "Lakshmi Traders",
    lines: ["Bengaluru", "Published enquiry number: 08047634912", "Listing: https://www.indiamart.com/lakshmi-traders/", "Quote given by a person who joined the negotiation by invite link."],
  });
  assert.deepEqual(model.line, { description: "basmati rice", quantity: "50 kg", rate: "Rs. 62.00 / kg", amount: "Rs. 3,100.00" });
  assert.equal(model.freight, "Rs. 150.00");
  assert.equal(model.total, "Rs. 3,250.00");
  assert.deepEqual(model.terms, [
    "Lead time: 3 days", "Deliver to: Bengaluru", "Vendor minimum order: 25 kg", 'As quoted: "62 rupees per kg, final"',
  ]);
  // The vendor's free-text payment terms were never read back, so they are not an agreed term (review #6).
  assert.deepEqual(model.unverified, ['Payment terms: "50% advance"']);
  assert.match(model.approval, new RegExp(`by spoken confirmation \\(approval ${approval.id}\\)`));
  assert.ok(!fs.readFileSync(order.pdf_path, "latin1").includes("simulated vendor"));
});

test("the purchase order of a simulated vendor says so on the page and in the PDF itself", async () => {
  const businessId = seedBusiness();
  const { order } = await seedOrder(businessId, { source: "simulated", counterpart: "simulated", quote: { freight: undefined, landed_cost: undefined } });
  assert.equal(order.simulated, true);
  assert.equal(order.amount, 3100);

  const model = po.poModel(repo.getOrderDocument(businessId, order.id));
  assert.equal(model.simulated, true);
  assert.equal(model.notice.title, "SIMULATED VENDOR");
  assert.match(model.notice.body, /came from a simulated vendor .* not from a real supplier/);
  assert.equal(model.supplier.name, "Lakshmi Traders (simulated vendor)");
  assert.equal(model.freight, "Not quoted - not included");
  assert.equal(model.total, "Rs. 3,100.00");
  assert.ok(fs.readFileSync(order.pdf_path, "latin1").includes("Demonstration only - simulated vendor"));

  const created = repo.listAudit(businessId, { type: "order.created" })[0].detail;
  assert.equal(created.simulated, true);
  assert.equal(created.vendorLabel, "simulated vendor");

  // A real listing whose quote came from a simulated counterpart is labelled the same way.
  const standIn = await seedOrder(seedBusiness({ name: "Second" }), { source: "indiamart", counterpart: "simulated" });
  assert.equal(standIn.order.simulated, true);
});

test("text the purchase order cannot print is refused, never printed as garbage", () => {
  const missing = [{ script: "Devanagari", pattern: /\p{Script=Devanagari}/u, candidates: [[path.join(TMP, "no-such-font.ttf")]] }];
  assert.equal(po.fontFor("Lakshmi Traders - 50 kg", missing), "Helvetica");
  assert.throws(() => po.fontFor("बासमती चावल", missing), refuses("FONT_MISSING"));
  assert.throws(() => po.fontFor("அரிசி"), refuses("UNPRINTABLE_TEXT"));
  assert.throws(() => po.poFilePath("../../etc/passwd"), refuses("INVALID_PO_NUMBER"));
});

test("when the PDF cannot be produced the order stands, the failure is reported and nothing is half-written", async () => {
  const businessId = seedBusiness();
  const { approval } = seedApproved(businessId, { requirement: { item: "அரிசி" } });

  let failure;
  await assert.rejects(orders.createOrder(businessId, approval.id), (err) => {
    failure = err;
    return err instanceof orders.OrderError && err.code === "PO_NOT_ISSUED";
  });
  assert.equal(failure.cause.code, "UNPRINTABLE_TEXT");

  const order = repo.getOrder(businessId, failure.orderId);
  assert.equal(order.status, "confirmed");
  assert.equal(order.pdf_path, null);
  assert.equal(repo.getApproval(businessId, approval.id).status, "consumed");
  assert.ok(!fs.existsSync(po.poFilePath(order.po_number)));

  const reported = repo.listAudit(businessId, { type: "error" })[0].detail;
  assert.equal(reported.scope, "order.po");
  assert.equal(reported.orderId, order.id);
  await assert.rejects(orders.issuePurchaseOrder(businessId, order.id), refuses("UNPRINTABLE_TEXT"));
});

test("a purchase order with Devanagari text is produced when a Devanagari font is installed", async (t) => {
  try {
    po.fontFor("बासमती चावल");
  } catch (err) {
    if (err.code === "FONT_MISSING") return t.skip("no Devanagari font on this machine (assets/fonts/NotoSansDevanagari-Regular.ttf is not bundled)");
    throw err;
  }
  const businessId = seedBusiness({ language: "hi-IN" });
  const { order } = await seedOrder(businessId, { requirement: { item: "बासमती चावल" }, quote: { quoted_sentence: "बासठ रुपये किलो" } });
  assert.ok(fs.statSync(order.pdf_path).size > 1500);
});

test("issuePurchaseOrder reuses the file, rebuilds it when it is gone, and is tenant-scoped", async () => {
  const businessId = seedBusiness();
  const { order } = await seedOrder(businessId);
  assert.equal(await orders.issuePurchaseOrder(businessId, order.id), order.pdf_path);
  fs.rmSync(order.pdf_path);
  assert.equal(await orders.issuePurchaseOrder(businessId, order.id), order.pdf_path);
  assert.ok(fs.existsSync(order.pdf_path));
  await assert.rejects(orders.issuePurchaseOrder(seedBusiness({ name: "Other" }), order.id), refuses("ORDER_NOT_FOUND"));
});

/* ---------------------------------------------------- state machine --- */

test("canTransition allows exactly the moves in the table", () => {
  const states = ["confirmed", "paid", "in_transit", "delivered", "closed", "cancelled"];
  const legal = new Set([
    "confirmed>paid", "confirmed>in_transit", "confirmed>cancelled", "paid>in_transit", "paid>cancelled",
    "in_transit>delivered", "in_transit>cancelled", "delivered>closed",
  ]);
  for (const from of states) {
    for (const to of states) assert.equal(orders.canTransition(from, to), legal.has(`${from}>${to}`), `${from} -> ${to}`);
  }
  assert.equal(orders.canTransition("draft", "confirmed"), false);
  assert.equal(orders.canTransition(undefined, "paid"), false);
  assert.equal(orders.canTransition("confirmed", "toString"), false);
});

test("advanceOrder follows the table, never marks an order paid by hand and is tenant-scoped", async () => {
  const businessId = seedBusiness();
  const { order } = await seedOrder(businessId);

  assert.throws(() => orders.advanceOrder(businessId, order.id, "delivered"), refuses("ILLEGAL_TRANSITION"));
  assert.throws(() => orders.advanceOrder(businessId, order.id, "paid"), refuses("PAID_BY_PAYMENT_ONLY"));
  assert.throws(() => orders.advanceOrder(seedBusiness({ name: "Other" }), order.id, "cancelled"), refuses("ORDER_NOT_FOUND"));
  assert.equal(repo.getOrder(businessId, order.id).status, "confirmed");

  assert.equal(orders.advanceOrder(businessId, order.id, "in_transit").status, "in_transit");
  assert.equal(orders.advanceOrder(businessId, order.id, "delivered").status, "delivered");
  assert.equal(orders.advanceOrder(businessId, order.id, "closed").status, "closed");
  assert.throws(() => orders.advanceOrder(businessId, order.id, "cancelled"), refuses("ILLEGAL_TRANSITION"));
  assert.deepEqual(
    repo.listAudit(businessId, { type: "order.status" }).map((row) => `${row.detail.from}>${row.detail.to}`),
    ["confirmed>in_transit", "in_transit>delivered", "delivered>closed"],
  );
});

test("e2e r3 PO defect: mixed Latin and Indic text is split into runs, each in a font that has its glyphs", () => {
  const runs = po.fontRuns('• As quoted: "55 रुपये किलो, ठीक है।"');
  assert.deepEqual(runs.map((r) => [r.text, r.font === "Helvetica" ? "Helvetica" : r.font.script]), [
    ['• As quoted: "55 ', "Helvetica"],
    ["रुपये किलो", "Devanagari"],
    [", ", "Helvetica"],
    ["ठीक है।", "Devanagari"],
    ['"', "Helvetica"],
  ]);
  assert.deepEqual(po.fontRuns("Lakshmi Traders - 50 kg").map((r) => r.font), ["Helvetica"]);
  assert.deepEqual(po.fontRuns("ಅಕ್ಕಿ और चावल").map((r) => r.font.script), ["Kannada", "Devanagari"]);
  assert.throws(() => po.fontRuns("As quoted: அரிசி"), refuses("UNPRINTABLE_TEXT"));
});
