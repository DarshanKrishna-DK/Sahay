"use strict";

/**
 * The owner's own suppliers for the app (src/suppliers):
 *   GET    /api/suppliers                 -> { suppliers: [...] }
 *   POST   /api/suppliers                 {name, items, language?, phone?} -> 201 { supplier, deepLink, expiresAt, sentToOwner }
 *   DELETE /api/suppliers/:id             -> { removed: true }
 *   POST   /api/suppliers/:id/link-code   -> { code, deepLink, expiresAt } (a fresh Telegram start link)
 * The tenant is always req.auth.businessId from the signed session cookie (auth.requireSession);
 * no handler reads a business id from a body or query. Telegram chat ids never leave the server.
 */

const express = require("express");
const auth = require("../auth");
const repo = require("../db/repo");
const limits = require("../limits");
const suppliers = require("../suppliers");
const store = require("../db/suppliers");

const MINUTE = 60 * 1000;
const ADD_PER_10_MIN = 30;

class SupplierRouteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function text(value, name, max, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new SupplierRouteError(400, "INVALID", `${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) throw new SupplierRouteError(400, "INVALID", `${name} must be text of at most ${max} characters.`);
  return value.trim();
}

function itemsOf(value) {
  if (typeof value === "string") return text(value, "items", 400, { required: true });
  if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((x) => typeof x !== "string" || x.length > 40)) {
    throw new SupplierRouteError(400, "INVALID", "items is a list of up to 20 things the supplier sells.");
  }
  return value;
}

function createSupplierRouter() {
  const router = express.Router();
  const json = express.json({ limit: "8kb" });

  router.get("/api/suppliers", auth.requireSession, (req, res) => {
    res.set("Cache-Control", "no-store").json({ suppliers: suppliers.listSuppliers(req.auth.businessId) });
  });

  router.post(
    "/api/suppliers",
    auth.requireSession,
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      if (!limits.allow(`suppliers:add:${businessId}`, ADD_PER_10_MIN, 10 * MINUTE)) throw new SupplierRouteError(429, "RATE_LIMITED", "Too many suppliers added. Wait a few minutes.");
      const body = req.body ?? {};
      const language = text(body.language, "language", 8) ?? repo.getBusiness(businessId)?.language ?? "hi-IN";
      const out = await suppliers.addSupplier(
        businessId,
        { name: text(body.name, "name", 80, { required: true }), items: itemsOf(body.items), language, phone: text(body.phone, "phone", 16) ?? null },
        { actor: "owner" },
      );
      res.status(201).json({ supplier: out.supplier, deepLink: out.invite.deepLink, expiresAt: out.invite.expiresAt, sentToOwner: out.sentToOwner });
    }),
  );

  router.delete(
    "/api/suppliers/:id",
    auth.requireSession,
    wrap(async (req, res) => {
      if (!suppliers.removeSupplier(req.auth.businessId, req.params.id)) throw new SupplierRouteError(404, "NOT_FOUND", "No such supplier.");
      res.json({ removed: true });
    }),
  );

  router.post(
    "/api/suppliers/:id/link-code",
    auth.requireSession,
    wrap(async (req, res) => {
      if (!store.getSupplier(req.auth.businessId, req.params.id)) throw new SupplierRouteError(404, "NOT_FOUND", "No such supplier.");
      res.json(suppliers.createInvite(req.auth.businessId, req.params.id));
    }),
  );

  // Answers here, so a bad request never reaches the general error handler as an internal error.
  router.use("/api/suppliers", (err, _req, res, next) => {
    if (err instanceof SupplierRouteError) return res.status(err.status).json({ code: err.code, message: err.message });
    if (err?.name === "RepoError" && err.code === "INVALID") return res.status(400).json({ code: "INVALID", message: err.message });
    return next(err);
  });
  return router;
}

module.exports = { createSupplierRouter };
