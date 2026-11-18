const anakin = require("./anakin");
const groq = require("./groq");
const db = require("./db");
const { config } = require("./config");
const { toPlainText } = require("./text");

const W = config.procurement.weights;

/* ------------------------------------------------------------- parsing --- */

/**
 * Turn what the owner actually said into a structured requirement.
 *
 * Deliberately tolerant: an owner types "need 200kg sona masoori under 70 a
 * kilo bangalore" and expects to be understood. Anything genuinely missing is
 * returned in `missing` so the caller can ask one conversational follow-up
 * rather than presenting a form.
 */
async function parseRequirement(business, rawText) {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = await groq.chatJSON([
    {
      role: "system",
      content:
        "You convert an Indian MSME owner's purchase request into a structured RFQ. " +
        'Return ONLY JSON: {"material":"","quantity":number|null,"unit":"kg|tonne|piece|box|litre|metre|null",' +
        '"target_price":number|null,"delivery_city":"","delivery_pincode":""|null,"needed_by":"YYYY-MM-DD"|null,' +
        '"quality_notes":""|null,"missing":["field names that are genuinely required but absent"]}. ' +
        "target_price is the per-unit price the owner wants, not the total. " +
        "Indian number words may appear: 'lakh' = 100000, 'crore' = 10000000, 'quintal' = 100 kg, 'tonne' = 1000 kg. " +
        "Treat 'material' and 'quantity' as required; everything else is optional. " +
        "Never invent a quantity or a price the owner did not state - use null.",
    },
    { role: "user", content: `Today: ${today}\nBusiness: ${business.name}, ${business.category || "small business"}, ${business.city || ""} ${business.state || "India"}\n\nOwner's request:\n${rawText}` },
  ], { temperature: 0.1 });

  // The owner's own city is a sensible default delivery point.
  if (!parsed.delivery_city && business.city) parsed.delivery_city = business.city;
  parsed.missing = (parsed.missing || []).filter((m) => ["material", "quantity"].includes(m));
  return parsed;
}

/* ----------------------------------------------------------- discovery --- */

/** Search queries aimed at Indian B2B marketplaces for this requirement. */
function discoveryQueries(rfq) {
  const where = rfq.delivery_city || "India";
  const what = rfq.material;
  return [
    `IndiaMART ${what} wholesale supplier ${where} price per ${rfq.unit || "kg"}`,
    `${what} manufacturer supplier ${where} bulk price contact number`,
    `${what} wholesale dealer distributor ${where} minimum order quantity`,
  ];
}

/**
 * Discover candidate vendors for an RFQ from live B2B listings.
 * Each search result is extracted into a structured vendor record; results
 * that carry no usable commercial detail are dropped rather than guessed at.
 */
async function discoverVendors(business, rfq, emit = () => {}) {
  emit({ phase: "searching", detail: `Searching B2B marketplaces for ${rfq.material}` });

  const seen = new Set();
  const pages = [];
  const failures = [];

  const searches = await Promise.allSettled(
    discoveryQueries(rfq).map((qy) => anakin.search(qy, 5)),
  );
  for (const s of searches) {
    if (s.status !== "fulfilled") { failures.push(s.reason?.message || String(s.reason)); continue; }
    for (const r of s.value) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      pages.push(r);
    }
  }

  if (!pages.length) {
    throw new Error(`No vendor listings found for "${rfq.material}"${failures.length ? ` (${failures[0]})` : ""}`);
  }

  emit({ phase: "extracting", detail: `Reading ${Math.min(pages.length, config.procurement.maxCandidates)} listings` });

  const candidates = [];
  for (const page of pages.slice(0, config.procurement.maxCandidates)) {
    let facts;
    try {
      facts = await groq.extract([
        {
          role: "system",
          content:
            "You extract supplier/vendor records from an Indian B2B marketplace listing page. " +
            'Return ONLY JSON: {"vendors":[{"name":"","listed_price":number|null,"listed_price_text":"",' +
            '"unit":"kg|tonne|piece|null","moq":"as stated or null","moq_value":number|null,"location":"city, state",' +
            '"phone":"as printed or null","availability":"in stock|made to order|unknown",' +
            '"certifications":[],"confidence":0-1}]}. ' +
            "Extract up to 4 distinct vendors from the page. moq_value is the numeric minimum in the same unit as the price. " +
            "Never invent a price, a phone number or an MOQ - use null. A listing with no vendor name is not a vendor.",
        },
        { role: "user", content: `Material wanted: ${rfq.material}\nSource: ${page.url}\n\nPage content:\n${(page.text || "").slice(0, 3000)}` },
      ]);
    } catch (err) {
      failures.push(`${page.url}: ${err.message}`);
      continue;
    }

    for (const v of facts.vendors || []) {
      if (!v.name) continue;
      candidates.push({ ...v, source_url: page.url });
    }
  }

  if (!candidates.length) {
    throw new Error("Listings were found but none contained usable vendor details.");
  }
  return { candidates, failures };
}

/* ------------------------------------------------------------- scoring --- */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Score one vendor against the requirement.
 *
 * The weights encode a real procurement judgement rather than just "cheapest
 * wins": a rock-bottom rate from a vendor 900 km away with a 500 kg minimum
 * and no phone number is not a deal an MSME can actually use.
 */
function scoreVendor(rfq, v) {
  const breakdown = {};

  // Price - relative to target if given, else scored later against the field.
  if (v.listed_price != null && rfq.target_price) {
    const ratio = v.listed_price / rfq.target_price;
    // At or under target scores full; 30% over target scores zero.
    breakdown.price = Math.max(0, Math.min(1, (1.3 - ratio) / 0.3));
  } else if (v.listed_price != null) {
    breakdown.price = 0.6; // priced, but nothing to compare against yet
  } else {
    breakdown.price = 0.15; // unpriced listings are worth calling, but rank low
  }

  // Locality - same city is ideal, same state acceptable.
  const want = norm(rfq.delivery_city);
  const got = norm(v.location);
  if (!want || !got) breakdown.locality = 0.4;
  else if (got.includes(want) || want.includes(got)) breakdown.locality = 1;
  else breakdown.locality = 0.35;

  // MOQ feasibility - a minimum above what the owner wants is disqualifying.
  if (v.moq_value == null || !rfq.quantity) breakdown.moq = 0.6;
  else if (v.moq_value <= rfq.quantity) breakdown.moq = 1;
  else if (v.moq_value <= rfq.quantity * 1.5) breakdown.moq = 0.4; // negotiable
  else breakdown.moq = 0;

  const avail = String(v.availability || "").toLowerCase();
  breakdown.availability = avail.includes("in stock") ? 1 : avail.includes("order") ? 0.6 : 0.35;

  breakdown.contactability = v.phone ? 1 : 0.2;

  const score = Object.entries(W).reduce((n, [k, w]) => n + (breakdown[k] ?? 0) * w, 0);
  return { score: Number(score.toFixed(4)), breakdown };
}

function shortlistReason(rfq, v, breakdown) {
  const bits = [];
  if (v.listed_price != null && rfq.target_price) {
    const d = ((v.listed_price - rfq.target_price) / rfq.target_price) * 100;
    bits.push(d <= 0 ? `${Math.abs(d).toFixed(0)}% under your target` : `${d.toFixed(0)}% over target`);
  } else if (v.listed_price != null) bits.push(`listed at ${v.listed_price_text || v.listed_price}`);
  else bits.push("rate not published, worth asking");

  if (breakdown.locality === 1) bits.push(`based in ${v.location}`);
  else if (v.location) bits.push(`ships from ${v.location}`);

  if (breakdown.moq === 0) bits.push(`MOQ ${v.moq} exceeds your quantity`);
  else if (v.moq) bits.push(`MOQ ${v.moq}`);

  if (!v.phone) bits.push("no number published");
  return bits.join(" · ");
}

/**
 * Score every candidate, persist them all, and shortlist the best few.
 * Vendors with no phone number are kept on record but cannot be negotiated
 * with, so they never displace a contactable vendor from the shortlist.
 */
function scoreAndShortlist(business, rfq, candidates) {
  const scored = candidates.map((v) => {
    const { score, breakdown } = scoreVendor(rfq, v);
    return { ...v, score, breakdown, reason: shortlistReason(rfq, v, breakdown) };
  }).sort((a, b) => b.score - a.score);

  const callable = scored.filter((v) => v.phone && v.moq !== undefined);
  const chosen = new Set((callable.length ? callable : scored)
    .slice(0, config.procurement.shortlistSize).map((v) => v));

  const saved = scored.map((v) => {
    const shortlisted = chosen.has(v);
    const id = db.addVendor({
      business_id: business.id, rfq_id: rfq.id, name: v.name,
      listed_price: v.listed_price, listed_price_text: v.listed_price_text, unit: v.unit || rfq.unit,
      moq: v.moq, moq_value: v.moq_value, location: v.location, phone: v.phone,
      source_url: v.source_url, availability: v.availability, certifications: v.certifications,
      score: v.score, score_breakdown: v.breakdown, shortlist_reason: v.reason, shortlisted,
    });
    return { id, ...v, shortlisted };
  });

  db.audit(business.id, "vendors_discovered", {
    rfq: rfq.id, found: saved.length, shortlisted: saved.filter((v) => v.shortlisted).length,
  });
  return saved;
}

/* -------------------------------------------------------- deal ranking --- */

/**
 * Rank negotiated quotes by LANDED cost, not headline rate.
 *
 * This is the number that actually leaves the owner's bank account: the
 * negotiated rate times the quantity, plus whatever freight the vendor quoted.
 * A cheaper rate from further away routinely loses here, which is exactly the
 * judgement an experienced buyer makes and a price-sorted list does not.
 */
function computeLandedCost(rfq, quote) {
  if (quote.rate == null || !rfq.quantity) return null;
  const goods = quote.rate * rfq.quantity;
  const freight = quote.freight ?? 0;
  return Number((goods + freight).toFixed(2));
}

async function rankDeals(business, rfq) {
  const quotes = db.listQuotes(rfq.id).filter((q) => q.rate != null);
  if (!quotes.length) return [];

  for (const q of quotes) {
    q.landed_cost = q.landed_cost ?? computeLandedCost(rfq, q);
    q.total_cost = q.landed_cost;
  }

  const ranked = await groq.chatJSON([
    {
      role: "system",
      content:
        "You rank negotiated supplier quotes for an Indian MSME buyer. " +
        'Return ONLY JSON: {"deals":[{"quote_id":number,"rank":1,"rationale":"one sentence on why this position"}]}. ' +
        "Rank primarily on landed cost for the requested quantity, but demote a quote whose MOQ exceeds what the " +
        "buyer wants, whose lead time misses their deadline, or whose payment terms demand full advance. " +
        "Promote a quote that is only slightly costlier but materially faster or safer. " +
        "Rank every quote given, best first. Be concrete and mention the actual numbers.",
    },
    {
      role: "user",
      content: `Requirement: ${rfq.quantity ?? "?"} ${rfq.unit || ""} of ${rfq.material}, ` +
        `target ${rfq.target_price ? `₹${rfq.target_price}/${rfq.unit || "unit"}` : "not stated"}, ` +
        `deliver to ${rfq.delivery_city || "unspecified"}${rfq.needed_by ? `, needed by ${rfq.needed_by}` : ""}.\n\n` +
        `Quotes:\n${JSON.stringify(quotes.map((q) => ({
          quote_id: q.id, vendor: q.vendor_name, location: q.vendor_location,
          rate: q.rate, unit: q.unit, landed_cost: q.landed_cost, moq: q.moq,
          lead_time: q.lead_time_text || q.lead_time_days, delivery_terms: q.delivery_terms,
          payment_terms: q.payment_terms, confidence: q.confidence, caveat: q.caveat,
        })), null, 1)}`,
    },
  ], { temperature: 0.2, maxTokens: 1600 });

  const byId = new Map(quotes.map((q) => [q.id, q]));
  const out = [];
  for (const d of (ranked.deals || []).slice(0, config.procurement.shortlistSize)) {
    const q = byId.get(d.quote_id);
    if (!q) continue;
    db.setQuoteRank(q.id, d.rank, toPlainText(d.rationale), q.landed_cost);
    out.push({ ...q, rank: d.rank, rationale: toPlainText(d.rationale) });
  }
  out.sort((a, b) => a.rank - b.rank);
  db.audit(business.id, "deals_ranked", { rfq: rfq.id, count: out.length });
  return out;
}

module.exports = {
  parseRequirement, discoverVendors, scoreVendor, scoreAndShortlist,
  rankDeals, computeLandedCost,
};
