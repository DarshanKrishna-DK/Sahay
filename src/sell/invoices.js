"use strict";

/**
 * Invoices (contract SELL): data access and drafting. Every function takes businessId first.
 *
 * A draft holds the lines the owner said; its tax is computed here in code (src/sell/gst.js) from
 * the business's settings, the items' confirmed HSN + GST rate (src/sell/item-tax.js) and the
 * customer's state. Asking for approval, issuing and numbering are in src/sell/gate.js; nothing in
 * this module can issue an invoice (and the database refuses an issue without a consumed approval).
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const gst = require("./gst");
const settings = require("./settings");
const customers = require("./customers");
const itemTax = require("./item-tax");
const { SellError } = require("./errors");
const { sameUnit } = require("../procurement/units");

const items = () => require("../stock/items");

const MAX_LINES = 50;
const STATUSES = ["draft", "pending", "issued", "part_paid", "paid", "cancelled"];
const OPEN_FOR_PAYMENT = new Set(["issued", "part_paid"]);

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") throw new SellError("BUSINESS_REQUIRED", "A business id is required.");
  return businessId;
}

/* ---------------------------------------------------------------- reads --- */

const rowOf = (businessId, invoiceId) =>
  typeof invoiceId === "string" && invoiceId ? db.prepare("SELECT * FROM invoices WHERE business_id = ? AND id = ?").get(tenant(businessId), invoiceId) ?? null : null;

const linesOf = (businessId, invoiceId) =>
  db.prepare("SELECT * FROM invoice_lines WHERE business_id = ? AND invoice_id = ? ORDER BY position").all(businessId, invoiceId);

function hydrate(businessId, row) {
  if (!row) return null;
  const lines = linesOf(businessId, row.id).map((l) => ({
    id: l.id,
    position: l.position,
    itemId: l.item_id,
    name: l.name,
    unit: l.unit,
    hsn: l.hsn,
    quantity: l.qty,
    ratePaise: l.rate_paise,
    gstRate: l.gst_rate,
    taxablePaise: l.taxable_paise,
    cgstPaise: l.cgst_paise,
    sgstPaise: l.sgst_paise,
    igstPaise: l.igst_paise,
    totalPaise: l.total_paise,
  }));
  const totals = {
    taxablePaise: row.taxable_paise,
    cgstPaise: row.cgst_paise,
    sgstPaise: row.sgst_paise,
    igstPaise: row.igst_paise,
    taxPaise: row.cgst_paise + row.sgst_paise + row.igst_paise,
    totalPaise: row.total_paise,
    total: row.total_paise / 100,
  };
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    sessionId: row.session_id,
    kind: row.kind,
    title: gst.KIND_TITLE[row.kind],
    status: row.status,
    number: row.number,
    fy: row.fy,
    seq: row.seq,
    supplierState: row.supplier_state,
    placeOfSupply: { code: row.place_of_supply, name: gst.stateName(row.place_of_supply) },
    intraState: row.intra_state === 1,
    totals,
    lines,
    supplier: row.supplier ? JSON.parse(row.supplier) : null,
    recipient: row.recipient ? JSON.parse(row.recipient) : null,
    approvalId: row.approval_id,
    pdfPath: row.pdf_path,
    razorpayOrderId: row.razorpay_order_id,
    payUrl: row.pay_url,
    payExpiresAt: row.pay_expires_at,
    createdAt: row.created_at,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
  };
}

/** One invoice with its lines, or null (another business's invoice is indistinguishable from none). */
const get = (businessId, invoiceId) => hydrate(businessId, rowOf(businessId, invoiceId));

/** Invoices of the business, oldest first. Filters: status, customer_id. */
function list(businessId, { status, customer_id: customerId } = {}) {
  const where = ["business_id = ?"];
  const params = [tenant(businessId)];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (customerId) {
    where.push("customer_id = ?");
    params.push(customerId);
  }
  return db.prepare(`SELECT * FROM invoices WHERE ${where.join(" AND ")} ORDER BY created_at, rowid`).all(...params).map((row) => hydrate(businessId, row));
}

/* ---------------------------------------------------------------- draft --- */

/**
 * Work out the lines and totals of an invoice from stored facts. `lines` are
 * [{itemId, quantity, unit?, rate?}] (rate in rupees; without it the item's sale price is used).
 * Throws when a fact is missing: GSTIN/state (settings), an item's confirmed tax, a rate.
 */
function compute(businessId, customer, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new SellError("NO_LINES", "An invoice needs at least one line.");
  if (lines.length > MAX_LINES) throw new SellError("TOO_MANY_LINES", `An invoice has at most ${MAX_LINES} lines.`);
  const supplier = settings.supplier(businessId);
  const placeOfSupply = customers.placeOfSupply(customer, supplier.stateCode);
  const prepared = lines.map((line, i) => {
    const item = items().get(businessId, line.itemId);
    if (!item) throw new SellError("ITEM_NOT_FOUND", `Line ${i + 1}: there is no such item.`, { status: 404 });
    if (line.unit != null && !sameUnit(line.unit, item.unit)) {
      throw new SellError("UNIT_MISMATCH", `${item.name} is sold in ${item.unit}, not ${line.unit}.`, { status: 409, details: { item: item.name, unit: item.unit } });
    }
    const rate = line.rate ?? item.sale_price;
    if (rate == null) throw new SellError("RATE_REQUIRED", `No price was said for ${item.name} and it has no selling price.`, { status: 409, details: { item: item.name } });
    let tax = null;
    if (supplier.kind === "tax_invoice") {
      tax = itemTax.confirmedTax(businessId, item);
      if (!tax) {
        throw new SellError("TAX_NOT_CONFIRMED", `The owner has not confirmed the HSN code and GST rate of ${item.name}.`, { status: 409, details: { item: item.name, itemId: item.id } });
      }
    }
    return { item, quantity: line.quantity, ratePaise: gst.toPaise(rate), gstRate: tax?.gstRate, hsn: tax?.hsn ?? item.hsn ?? null };
  });
  const computed = gst.computeInvoice({ kind: supplier.kind, supplierState: supplier.stateCode, placeOfSupply, lines: prepared });
  return { supplier, placeOfSupply, prepared, computed };
}

/**
 * Create a draft invoice, or replace the lines of a draft (invoiceId). Returns the invoice;
 * emits invoice.drafted {invoice}.
 * @param {{customerId: string, lines: {itemId, quantity, unit?, rate?}[], invoiceId?: string}} input
 */
function draft(businessId, { customerId, lines, invoiceId = null }, { sessionId = null, actor = "agent" } = {}) {
  tenant(businessId);
  const customer = customers.get(businessId, customerId);
  if (!customer) throw new SellError("CUSTOMER_NOT_FOUND", "There is no such customer.", { status: 404 });
  const { supplier, placeOfSupply, prepared, computed } = compute(businessId, customer, lines);

  return db.transaction(() => {
    const at = new Date().toISOString();
    let id = invoiceId;
    const amounts = [supplier.kind, supplier.stateCode, placeOfSupply, computed.intraState ? 1 : 0, computed.totals.taxablePaise,
      computed.totals.cgstPaise, computed.totals.sgstPaise, computed.totals.igstPaise, computed.totals.totalPaise];
    if (id) {
      const existing = rowOf(businessId, id);
      if (!existing) throw new SellError("INVOICE_NOT_FOUND", "There is no such invoice.", { status: 404 });
      if (existing.status !== "draft") throw new SellError("INVOICE_NOT_DRAFT", "Only a draft invoice can be changed.", { status: 409 });
      db.prepare("DELETE FROM invoice_lines WHERE business_id = ? AND invoice_id = ?").run(businessId, id);
      db.prepare(
        `UPDATE invoices SET customer_id = ?, kind = ?, supplier_state = ?, place_of_supply = ?, intra_state = ?, taxable_paise = ?,
           cgst_paise = ?, sgst_paise = ?, igst_paise = ?, total_paise = ? WHERE business_id = ? AND id = ?`,
      ).run(customer.id, ...amounts, businessId, id);
    } else {
      id = repo.newId("inv");
      db.prepare(
        `INSERT INTO invoices (id, business_id, customer_id, session_id, status, kind, supplier_state, place_of_supply, intra_state,
           taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, businessId, customer.id, sessionId, ...amounts, at);
    }
    const insert = db.prepare(
      `INSERT INTO invoice_lines (id, business_id, invoice_id, position, item_id, name, unit, hsn, qty, rate_paise, gst_rate,
         taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    prepared.forEach((p, i) => {
      const c = computed.lines[i];
      insert.run(repo.newId("inl"), businessId, id, i + 1, p.item.id, p.item.name, p.item.unit, p.hsn, c.quantity, c.ratePaise, c.gstRate,
        c.taxablePaise, c.cgstPaise, c.sgstPaise, c.igstPaise, c.totalPaise);
    });
    const invoice = get(businessId, id);
    events.emit(businessId, "invoice.drafted", { invoice: summary(invoice, customer) }, { sessionId, actor });
    return invoice;
  });
}

/* ---------------------------------------------------------- for others --- */

/** What the event stream and the Sell screen show of an invoice. */
function summary(invoice, customer = null) {
  const who = customer ?? null;
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status,
    kind: invoice.kind,
    customerId: invoice.customerId,
    customerName: who?.name ?? invoice.recipient?.name ?? null,
    totals: invoice.totals,
    lines: invoice.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, ratePaise: l.ratePaise, gstRate: l.gstRate, totalPaise: l.totalPaise })),
  };
}

/** The invoice's status after a payment (KHATA): issued -> part_paid | paid, part_paid -> paid. */
function setPaymentStatus(businessId, invoiceId, status) {
  if (status !== "part_paid" && status !== "paid") throw new SellError("INVALID", 'A payment status is "part_paid" or "paid".');
  const row = rowOf(businessId, invoiceId);
  if (!row) throw new SellError("INVOICE_NOT_FOUND", "There is no such invoice.", { status: 404 });
  if (row.status === status) return get(businessId, invoiceId);
  if (!OPEN_FOR_PAYMENT.has(row.status)) throw new SellError("INVOICE_NOT_PAYABLE", `An invoice that is ${row.status} takes no payment.`, { status: 409 });
  db.prepare("UPDATE invoices SET status = ?, paid_at = ? WHERE business_id = ? AND id = ? AND status = ?").run(
    status, status === "paid" ? new Date().toISOString() : null, businessId, invoiceId, row.status,
  );
  return get(businessId, invoiceId);
}

module.exports = { get, list, draft, compute, summary, setPaymentStatus, STATUSES, OPEN_FOR_PAYMENT, MAX_LINES };
