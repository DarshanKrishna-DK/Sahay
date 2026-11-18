const db = require("./db");
const procurement = require("./procurement");
const negotiator = require("./negotiator");
const { config } = require("./config");

/**
 * The procurement cycle, end to end.
 *
 * Stage 1 requirement -> 2 discover + score -> 3 negotiate -> 4 rank deals.
 * Stage 5 (order + payment) is deliberately NOT here: it only ever runs after
 * the owner has explicitly picked a deal.
 *
 * `emit` streams stage events so both the dashboard (over SSE) and the Telegram
 * bot can narrate what is happening while it happens.
 */
async function runRFQ(business, rfqInput, { emit = () => {}, channel, negotiate = true } = {}) {
  /* ---- Stage 1 · requirement ---------------------------------------- */
  let rfqId;
  if (rfqInput.id) {
    rfqId = rfqInput.id;
  } else {
    emit({ stage: "requirement", detail: "Understanding what you need" });
    const parsed = rfqInput.parsed || await procurement.parseRequirement(business, rfqInput.text);
    if (parsed.missing?.length) {
      return { needsInput: true, missing: parsed.missing, parsed };
    }
    rfqId = db.createRFQ({
      business_id: business.id, material: parsed.material, quantity: parsed.quantity,
      unit: parsed.unit, target_price: parsed.target_price, delivery_city: parsed.delivery_city,
      delivery_pincode: parsed.delivery_pincode, needed_by: parsed.needed_by,
      quality_notes: parsed.quality_notes, raw_request: rfqInput.text,
    });
    db.audit(business.id, "rfq_created", { rfqId, material: parsed.material, quantity: parsed.quantity });
  }

  const rfq = db.getRFQ(business.id, rfqId);
  emit({ stage: "requirement_ready", rfq });

  /* ---- Stage 2 · discovery + scoring --------------------------------- */
  db.setRFQStatus(business.id, rfq.id, "discovering");
  emit({ stage: "discovery", detail: `Finding suppliers for ${rfq.material}` });

  const { candidates, failures } = await procurement.discoverVendors(business, rfq, (p) => emit({ stage: "discovery", ...p }));
  const vendors = procurement.scoreAndShortlist(business, rfq, candidates);
  const shortlist = vendors.filter((v) => v.shortlisted);

  emit({
    stage: "shortlist",
    detail: `${shortlist.length} of ${vendors.length} suppliers shortlisted`,
    vendors: shortlist.map((v) => ({
      id: v.id, name: v.name, listed_price: v.listed_price, location: v.location,
      moq: v.moq, score: v.score, reason: v.reason, phone: v.phone,
    })),
  });

  if (!negotiate) {
    db.setRFQStatus(business.id, rfq.id, "shortlisted");
    return { rfq, vendors, shortlist, deals: [], discoveryFailures: failures };
  }

  /* ---- Stage 3 · negotiation ----------------------------------------- */
  db.setRFQStatus(business.id, rfq.id, "negotiating");
  const callable = shortlist.filter((v) => v.phone && !v.do_not_call);

  if (!callable.length) {
    db.setRFQStatus(business.id, rfq.id, "shortlisted");
    return {
      rfq, vendors, shortlist, deals: [], discoveryFailures: failures,
      warning: "None of the shortlisted suppliers published a contact number, so there was nobody to negotiate with. "
        + "Add a vendor contact manually to negotiate.",
    };
  }

  emit({ stage: "negotiation", detail: `Negotiating with ${callable.length} supplier(s) over ${channel || config.procurement.channel}` });
  const results = await negotiator.negotiateAll(business, rfq, callable, {
    channel, emit: (p) => emit({ stage: "negotiation", ...p }),
  });

  /* ---- Stage 4 · rank the deals -------------------------------------- */
  emit({ stage: "ranking", detail: "Comparing landed costs" });
  const deals = await procurement.rankDeals(business, rfq);
  db.setRFQStatus(business.id, rfq.id, deals.length ? "quoted" : "no_quotes");

  emit({ stage: "deals", detail: `${deals.length} deal(s) ready`, deals });

  return {
    rfq, vendors, shortlist, deals,
    negotiations: results.map((r) => ({ vendor: r.vendor.name, ok: r.ok, error: r.error })),
    discoveryFailures: failures,
  };
}

module.exports = { runRFQ };
