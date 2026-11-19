"use strict";

/**
 * Sell REST for the browser (contract SELL). Mounted with one line in server.js, before the
 * purchase pay router so an invoice pay token ("inv_...") is answered here.
 * The tenant is always req.auth.businessId from the signed HttpOnly cookie (auth.requireSession);
 * no handler reads a business id from a body, a query or a path; an invoice or customer id from
 * the request is looked up inside that business only. Errors answer `{code, message, say?}`.
 *
 *   GET  /api/sell                    -> {settings, customers[], invoices[], approvals[], receipts[], owed[]}
 *   POST /api/sell/settings           {gst_scheme?, gstin?, state?, address?, invoice_prefix?} -> {settings}
 *   POST /api/customers               {name, phone?, gstin?, state?, address?} -> 201 {customer, created}
 *   POST /api/invoices/:id/decision   {decision: "approve"|"reject"} (the ✓ / ✕ on the bill's Yes card)
 *                                     -> {status, invoice, problems?}
 *   GET  /api/invoices/:id/pdf        -> application/pdf (issued invoices only)
 * Public (the token is the payer's only credential):
 *   GET  /api/pay/:token              -> the invoice pay page data (tokens "inv_" + 22 chars; others pass on)
 *   POST /api/pay/:token/verify       -> {status, number, already}
 */

const express = require("express");
const auth = require("../auth");
const limits = require("../limits");
const repo = require("../db/repo");
const settings = require("../sell/settings");
const customers = require("../sell/customers");
const invoices = require("../sell/invoices");
const gate = require("../sell/gate");
const checkout = require("../sell/checkout");
const invoicePdf = require("../sell/invoice-pdf");
const { invoiceView, khata } = require("../sell/view");
const { sellToolError } = require("../tools/sell");

const MINUTE = 60 * 1000;
const PAY_LIMIT = { max: 60, windowMs: 10 * MINUTE };
const WRITE_LIMIT = { max: 60, windowMs: MINUTE };

class SellRouteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SellRouteError";
    this.status = status;
    this.code = code;
  }
}

const languageOf = (businessId) => (businessId ? repo.getBusiness(businessId)?.language : undefined);

/** A Sell error as `{code, message, say}` with its status; anything unknown goes to the app's handler. */
function sendError(err, req, res, next) {
  if (err?.name === "SellRouteError") {
    if (err.status === 429) res.set("Retry-After", String(PAY_LIMIT.windowMs / 1000));
    return res.status(err.status).json({ code: err.code, message: err.message });
  }
  if (["SellError", "GstError", "StockError", "PaymentError", "ApprovalError"].includes(err?.name)) {
    const toolError = sellToolError(err, languageOf(req.auth?.businessId));
    const status = err.status ?? toolError.status;
    return res.status(status).json({ code: err.code, message: err.message, ...(toolError.say ? { say: toolError.say } : {}) });
  }
  return next(err);
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => sendError(err, req, res, next));

function limit(key, { max, windowMs }) {
  if (!limits.allow(key, max, windowMs)) throw new SellRouteError(429, "RATE_LIMITED", "Too many requests. Wait a few minutes and try again.");
}

function body(req) {
  const value = req.body ?? {};
  if (typeof value !== "object" || Array.isArray(value)) throw new SellRouteError(400, "INVALID", "The body is a JSON object.");
  return value;
}

/** Copy only these keys; each must be a string (or absent). */
function textFields(source, keys) {
  const out = {};
  for (const key of keys) {
    const v = source[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.length > 300) throw new SellRouteError(400, "INVALID", `${key} is text of at most 300 characters.`);
    out[key] = v;
  }
  return out;
}

/** Everything the Sell screen shows, for this business only. */
function sellState(businessId) {
  const k = khata();
  const { owed = [], receipts = [] } = typeof k?.summary === "function" ? k.summary(businessId) : {};
  return {
    settings: settings.get(businessId),
    customers: customers.list(businessId),
    invoices: invoices.list(businessId).map((invoice) => invoiceView(businessId, invoice)),
    approvals: gate.listApprovals(businessId, { status: "pending" }).map(gate.view),
    receipts,
    owed,
  };
}

function createSellRouter() {
  const router = express.Router();
  const json = express.json({ limit: "16kb" });

  /* ------------------------------------------- public: invoice pay page --- */
  router.get(
    "/api/pay/:token",
    wrap(async (req, res, next) => {
      if (!checkout.isInvoiceToken(req.params.token)) return next();
      limit(`pay:ip:${req.socket?.remoteAddress ?? "unknown"}`, PAY_LIMIT);
      res.set("Cache-Control", "no-store").json(checkout.checkoutForToken(req.params.token));
    }),
  );
  router.post(
    "/api/pay/:token/verify",
    (req, res, next) => (checkout.isInvoiceToken(req.params.token) ? next() : next("route")),
    express.json({ limit: "4kb" }),
    wrap(async (req, res) => {
      limit(`pay:ip:${req.socket?.remoteAddress ?? "unknown"}`, PAY_LIMIT);
      const { status, number, already } = await checkout.verifyPayment(req.params.token, body(req));
      res.set("Cache-Control", "no-store").json({ status, number, already });
    }),
  );

  /* ------------------------------------------------ the owner's screens --- */
  router.get(
    "/api/sell",
    auth.requireSession,
    wrap(async (req, res) => res.set("Cache-Control", "no-store").json(sellState(req.auth.businessId))),
  );

  router.post(
    "/api/sell/settings",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      limit(`sell:write:${req.auth.businessId}`, WRITE_LIMIT);
      const fields = textFields(body(req), ["gst_scheme", "gstin", "state", "address", "invoice_prefix"]);
      res.json({ settings: settings.save(req.auth.businessId, fields, { sessionId: req.auth.sessionId ?? null }) });
    }),
  );

  router.post(
    "/api/customers",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      limit(`sell:write:${req.auth.businessId}`, WRITE_LIMIT);
      const fields = textFields(body(req), ["name", "phone", "gstin", "state", "address"]);
      const { customer, created } = customers.save(req.auth.businessId, fields, { sessionId: req.auth.sessionId ?? null, actor: "owner" });
      res.status(created ? 201 : 200).json({ customer, created });
    }),
  );

  router.post(
    "/api/invoices/:id/decision",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const decision = body(req).decision;
      if (decision !== "approve" && decision !== "reject") throw new SellRouteError(400, "INVALID", 'decision is "approve" or "reject".');
      const invoice = invoices.get(businessId, req.params.id);
      if (!invoice) throw new SellRouteError(404, "INVOICE_NOT_FOUND", "There is no such invoice.");
      const approval = gate.listApprovals(businessId, { status: "pending", invoice_id: invoice.id }).at(-1);
      if (!approval) throw new SellRouteError(409, "NO_PENDING_APPROVAL", "This bill is not waiting for a yes; ask Sahay to read it out first.");
      const sessionId = req.auth.sessionId ?? null;
      const decided = gate.confirmInvoice(businessId, approval.id, { decision, via: "button", sessionId });
      if (decided.invoice.status !== "issued") return res.json({ status: decided.approval.status, invoice: invoiceView(businessId, decided.invoice) });
      const { invoice: done, problems } = await gate.finishIssue(businessId, decided.invoice.id, { sessionId });
      res.json({ status: "issued", invoice: done, problems });
    }),
  );

  router.get(
    "/api/invoices/:id/pdf",
    auth.requireSession,
    wrap(async (req, res) => {
      const file = await invoicePdf.pdfPathFor(req.auth.businessId, req.params.id);
      const invoice = invoices.get(req.auth.businessId, req.params.id);
      res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${invoice.number.replaceAll("/", "-")}.pdf"` });
      res.sendFile(file);
    }),
  );

  return router;
}

module.exports = { createSellRouter, sellState };
