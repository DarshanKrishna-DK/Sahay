"use strict";

/**
 * The discovery board (GET /api/discovery): for one need of the session's business, everything the
 * Buy screen shows while Sahay searches and bargains, in one read-only answer:
 * the need, the search job, the sellers found (best first, the order vendorRank counts in), the live
 * negotiations with every offer said, the ranked deals and the approval waiting for the owner.
 *
 * Read only; tenant only from the caller (the session). A seller's source is "indiamart" (a real
 * IndiaMART listing), "own_supplier" (the owner's own supplier, a real person on Telegram) or
 * "simulated" (a simulated vendor, always labelled so: rule 4).
 */

const repo = require("../db/repo");
const supplierStore = require("../db/suppliers");

const SOURCE_LABEL = { indiamart: "IndiaMART", own_supplier: "Your supplier", simulated: "Simulated vendor", human: "Vendor" };

function sourceOf(vendor, own) {
  if (own) return "own_supplier";
  if (vendor.kind === "simulated" || vendor.source === "simulated") return "simulated";
  if (vendor.source === "indiamart") return "indiamart";
  return "human";
}

function seller(registry, vendor, requirement, rank, own) {
  const summary = registry.vendorSummary(vendor, requirement, rank);
  const source = sourceOf(vendor, own);
  return {
    ...summary,
    ownSupplier: own,
    source,
    sourceLabel: SOURCE_LABEL[source],
    simulated: source === "simulated",
    itemTitle: vendor.item_title ?? null,
    avoided: false,
  };
}

function searchOf(jobs) {
  const job = jobs.filter((j) => j.kind === "sourcing").at(-1);
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    category: job.result?.category ?? null,
    scope: job.result?.scope ?? null,
    sourceUrl: job.result?.sourceUrl ?? null,
    count: job.result?.count ?? null,
    error: job.error ?? null,
    startedAt: job.created_at,
    updatedAt: job.updated_at,
    lastProgress: Array.isArray(job.progress) ? job.progress.at(-1)?.message ?? null : null,
  };
}

function negotiationOf(businessId, n) {
  const vendor = repo.getVendor(businessId, n.vendor_id);
  const turns = Array.isArray(n.transcript) ? n.transcript : [];
  const offers = turns
    .filter((t) => t.offer != null)
    .map((t) => ({ speaker: t.speaker === "vendor" ? "vendor" : "sahay", price: t.offer, unit: t.unit ?? null, round: t.round ?? null, text: t.text, at: t.ts ?? null }));
  const last = (speaker) => offers.filter((o) => o.speaker === speaker).at(-1)?.price ?? null;
  const outcome = n.outcome ?? null;
  return {
    negotiationId: n.id,
    vendorId: n.vendor_id,
    vendorName: vendor?.name ?? outcome?.vendorName ?? null,
    counterpart: n.counterpart,
    simulated: n.counterpart === "simulated",
    status: n.status,
    running: !n.ended_at,
    createdAt: n.created_at,
    endedAt: n.ended_at ?? null,
    rounds: turns.reduce((max, t) => Math.max(max, Number(t.round) || 0), 0),
    offers,
    lastVendorOffer: last("vendor"),
    lastSahayOffer: last("sahay"),
    agreed: outcome ? Boolean(outcome.agreed) : null,
    agreedPrice: outcome?.agreed ? outcome.unitPrice ?? null : null,
    quoteId: outcome?.quoteId ?? null,
    reason: outcome?.reason ?? null,
  };
}

/**
 * @param {string} businessId  from the session, never from the request
 * @param {{requirementId?: string}} [options]  default: the latest need
 * @returns {object|null} null when requirementId names no need of this business
 */
function board(businessId, { requirementId = null } = {}) {
  const registry = require("../tools/registry");
  const requirement = requirementId ? repo.getRequirement(businessId, requirementId) : repo.listRequirements(businessId).at(-1) ?? null;
  if (requirementId && !requirement) return null;
  const empty = { requirement: null, search: null, sellers: [], negotiations: [], deals: [], bestQuote: null, pendingApproval: null };
  if (!requirement) return empty;

  const jobs = repo.listJobs(businessId, { requirement_id: requirement.id });
  const own = supplierStore.supplierVendorIds(businessId, requirement.id);
  const ranked = registry.rankedVendors(businessId, requirement);
  const seen = new Set(ranked.map((v) => v.id));
  const sellers = [
    ...ranked.map((v, i) => seller(registry, v, requirement, i + 1, own.has(v.id))),
    // A seller the owner's rule avoids: listed last, unranked, never picked.
    ...repo
      .listVendors(businessId, { requirement_id: requirement.id })
      .filter((v) => !seen.has(v.id))
      .map((v) => ({ ...seller(registry, v, requirement, null, own.has(v.id)), avoided: true })),
  ];
  const deals = registry.rankedDeals(businessId, requirement.id);
  const quoteIds = new Set(repo.listQuotes(businessId, { requirement_id: requirement.id }).map((q) => q.id));
  const waiting = repo.listApprovals(businessId, { status: "pending" }).find((a) => quoteIds.has(a.quote_id));
  return {
    requirement: {
      id: requirement.id,
      item: requirement.item,
      quantity: requirement.quantity,
      unit: requirement.unit,
      city: requirement.city,
      maxPrice: requirement.max_price ?? null,
      targetPrice: requirement.target_price ?? null,
      deliveryBy: requirement.delivery_by ?? null,
      status: requirement.status,
      createdAt: requirement.created_at,
    },
    search: searchOf(jobs),
    sellers,
    negotiations: repo.listNegotiations(businessId, { requirement_id: requirement.id }).map((n) => negotiationOf(businessId, n)),
    deals,
    bestQuote: deals[0] ?? null,
    pendingApproval: waiting
      ? { approvalId: waiting.id, quoteId: waiting.quote_id, readback: waiting.readback, totalAmount: waiting.total_amount, requestedAt: waiting.requested_at, simulated: Boolean(waiting.simulated) }
      : null,
  };
}

module.exports = { board, SOURCE_LABEL };
