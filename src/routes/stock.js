"use strict";

/**
 * Stock REST for the browser (contract STK), mounted by one line in server.js. Every route needs
 * the browser session cookie; the business comes only from it (auth.requireSession), never from
 * the request. Errors are {code, message, say?} through the app's error handler.
 *
 *   GET  /api/stock                       {items:[{...item, on_hand, level, level_source, low}], moves:[last 50], proposals:[open]}
 *   POST /api/orders/:id/delivered        the "goods arrived" button -> order delivered, stock in (once)
 *   POST /api/stock/reorders/:id/decision {decision:"yes"|"no"} the owner's tap on "buy more?";
 *                                         yes saves the need and starts the vendor search, never an order
 */

const express = require("express");
const auth = require("../auth");
const repo = require("../db/repo");
const stock = require("../stock");
const reorder = require("../stock/reorder");
const delivery = require("../stock/delivery");
const { stockToolError } = require("../tools/stock");
const { ToolError } = require("../tools/errors");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function languageOf(businessId) {
  return repo.getBusiness(businessId)?.language;
}

/** A stock error as {code, message, say} with its status, through the app's error handler. */
function fail(req, err) {
  return stockToolError(err, languageOf(req.auth.businessId));
}

function liveSessionId(businessId) {
  return require("../agora/narrator").liveCall(businessId)?.sessionId ?? null;
}

function createStockRouter() {
  const router = express.Router();
  const json = express.json({ limit: "8kb" });

  router.get(
    "/api/stock",
    auth.requireSession,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      res.json({ ...stock.summary(businessId), proposals: reorder.listOpen(businessId) });
    }),
  );

  router.post(
    "/api/orders/:id/delivered",
    auth.requireSession,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      let r;
      try {
        r = delivery.markDelivered(businessId, req.params.id, { sessionId: liveSessionId(businessId), actor: "owner" });
      } catch (err) {
        throw fail(req, err);
      }
      res.json({
        orderId: r.order.id,
        poNumber: r.order.po_number,
        status: r.order.status,
        simulated: Boolean(r.order.simulated),
        item: r.item,
        added: r.added,
        on_hand: r.on_hand,
        alreadyDelivered: r.alreadyDelivered,
      });
    }),
  );

  router.post(
    "/api/stock/reorders/:id/decision",
    json,
    auth.requireSession,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const sessionId = liveSessionId(businessId);
      let decided;
      try {
        decided = reorder.decide(businessId, req.params.id, req.body?.decision, { via: "button", sessionId });
      } catch (err) {
        throw fail(req, err);
      }
      const out = { proposalId: decided.proposalId, status: decided.status, requirementId: decided.requirement?.id ?? null };
      if (decided.status !== "accepted" || decided.requirement.quantity == null) return res.json({ ...out, sourcingStarted: false });
      // The tap IS the owner's yes to looking for sellers: the search starts here, through the same tool.
      try {
        const ctx = { businessId, sessionId, agentId: null, actor: "owner", toolScope: "owner" };
        const started = await require("../tools/registry").callTool(ctx, "start_sourcing", { requirementId: decided.requirement.id });
        res.json({ ...out, sourcingStarted: true, jobId: started.jobId });
      } catch (err) {
        res.json({ ...out, sourcingStarted: false, sourcingError: { code: err?.code ?? "INTERNAL", say: err instanceof ToolError ? err.say : undefined } });
      }
    }),
  );

  return router;
}

module.exports = { createStockRouter };
