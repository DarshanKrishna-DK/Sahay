"use strict";

/**
 * What the Sell screen and the event stream show of an invoice: the stored invoice plus its
 * customer, PDF URL, pay URL and WhatsApp share URL. The share URL comes from KHATA's helper
 * (src/sell/khata.js shareUrl) when that module is present; otherwise it is null, never invented.
 */

const customers = require("./customers");

function khata() {
  try {
    return require("./khata");
  } catch (err) {
    if (err?.code === "MODULE_NOT_FOUND" && String(err.message).includes("khata")) return null;
    throw err;
  }
}

function invoiceView(businessId, invoice) {
  if (!invoice) return null;
  const customer = customers.get(businessId, invoice.customerId);
  const issued = Boolean(invoice.number);
  const { pdfPath: _pdf, razorpayOrderId: _rzp, businessId: _biz, ...rest } = invoice;
  const helper = khata()?.shareUrl;
  return {
    ...rest,
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, gstin: customer.gstin, state_code: customer.state_code } : null,
    pdfUrl: issued && invoice.pdfPath ? `/api/invoices/${encodeURIComponent(invoice.id)}/pdf` : null,
    payUrl: issued ? invoice.payUrl ?? null : null,
    shareUrl: issued && typeof helper === "function" ? helper(businessId, invoice) ?? null : null,
  };
}

module.exports = { invoiceView, khata };
