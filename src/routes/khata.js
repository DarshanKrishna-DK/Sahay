"use strict";

/**
 * Khata REST for the browser (contract SELL, the khata parts). Mounted with one line in server.js.
 * The tenant is always req.auth.businessId from the signed HttpOnly cookie (auth.requireSession);
 * no handler reads a business id from a body, a query or a path, and a customer or invoice id from
 * the request is looked up inside that business only. Errors answer `{code, message, say?}`
 * through the app's error handler.
 *
 *   POST /api/receipts               {customer_id, amount, mode: cash|upi, invoice_id?, note?}
 *                                    -> 201 {receipt, owed}  (the owner's button: the press confirms)
 *   POST /api/customers/:id/remind   {language?} -> 200 {customer, amount, text, shareUrl, telegram}
 *
 * GET /api/sell (SELL's handler) gets `owed` and `receipts` from khata.summary(businessId).
 * Creating the router also starts the khata's invoice.paid listener (Razorpay test payment ->
 * receipt), once per process.
 */

const express = require("express");
const auth = require("../auth");
const limits = require("../limits");
const repo = require("../db/repo");
const khata = require("../sell/khata");
const { khataToolError } = require("../tools/khata");

const LANGS = ["hi-IN", "kn-IN", "en-IN"];
/** Reminders send a Telegram copy: at most this many per business per minute. */
const REMIND_PER_MINUTE = 10;
const MINUTE = 60 * 1000;

class KhataRouteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "KhataRouteError";
    this.status = status;
    this.code = code;
  }
}

/** The business's language, for the spoken line on an error. */
const languageOf = (businessId) => repo.getBusiness(businessId)?.language;

/** A khata or Sell error as `{code, message, say}` with its own status; anything else goes to the app handler. */
function sendError(err, req, res, next) {
  if (err?.name === "KhataError" || err?.name === "SellError" || err?.name === "KhataRouteError") {
    const toolError = khataToolError(err, languageOf(req.auth?.businessId));
    if (err.status === 429) res.set("Retry-After", String(MINUTE / 1000));
    return res.status(err.status ?? toolError.status).json({ code: err.code, message: err.message, say: toolError.say });
  }
  return next(err);
}

/** Run a handler; its khata errors answer here, anything else goes on to the app's handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => sendError(err, req, res, next));

function optionalId(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 64) throw new KhataRouteError(400, "INVALID", `${name} is an id.`);
  return value;
}

function createKhataRouter() {
  khata.start();
  const router = express.Router();
  const json = express.json({ limit: "4kb" });

  router.post(
    "/api/receipts",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const body = req.body ?? {};
      const customerId = optionalId(body.customer_id, "customer_id");
      if (!customerId) throw new KhataRouteError(400, "INVALID", "customer_id is required.");
      if (body.mode === "razorpay_test") throw new KhataRouteError(400, "INVALID_MODE", "razorpay_test receipts come only from a verified checkout.");
      const receipt = khata.recordReceipt(
        businessId,
        { customerId, amount: body.amount, mode: body.mode, invoiceId: optionalId(body.invoice_id, "invoice_id"), note: body.note },
        { sessionId: null },
      );
      res.status(201).json({ receipt, owed: khata.toRupees(Math.max(khata.balancePaise(businessId, customerId), 0)) });
    }),
  );

  router.post(
    "/api/customers/:id/remind",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      if (!limits.allow(`remind:biz:${businessId}`, REMIND_PER_MINUTE, MINUTE)) {
        throw new KhataRouteError(429, "RATE_LIMITED", "Too many reminders. Wait a minute and try again.");
      }
      const language = LANGS.includes(req.body?.language) ? req.body.language : languageOf(businessId);
      const out = await khata.remind(businessId, req.params.id, { language, actor: "owner" });
      res.json({
        customer: { id: out.customer.id, name: out.customer.name, phone: out.customer.phone ?? null },
        amount: out.amount,
        days: out.days,
        text: out.text,
        shareUrl: out.shareUrl,
        telegram: out.telegram,
      });
    }),
  );

  return router;
}

module.exports = { createKhataRouter, REMIND_PER_MINUTE };
