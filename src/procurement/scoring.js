'use strict';

/**
 * Vendor scoring and deal ranking. Both are decided in code from recorded data; no model is
 * asked for an order or a number.
 */

const { computeLandedCost, normaliseUnit, unitRatio, UnitMismatchError } = require('./landed-cost');
const { sameCity } = require('../discovery/slug');

/**
 * Points out of 100. Cheapest does not simply win: a low rate from a vendor far away, with a
 * minimum above the order and no phone number, is not a deal an MSME can use.
 */
const WEIGHTS = Object.freeze({ price: 35, locality: 25, moq: 20, availability: 10, contactability: 10 });

/** A price per one of these can be turned into a per-kg price only if the listing states the size. */
const CONTAINER_UNITS = new Set(['bag', 'box', 'pack', 'packet']);

const round2 = (n) => Number(n.toFixed(2));
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * The vendor's listed price per `unit`, or null when the listing gives no honest way to get
 * there. Exact metric conversions are applied; a per-bag price is converted only through the
 * pack size the listing itself states.
 * @returns {{value: number, basis: 'listed'|'unit_converted'|'pack_size'}|null}
 */
function comparableListedPrice(vendor, unit) {
  if (vendor.listed_price == null) return null;
  const listedUnit = normaliseUnit(vendor.listed_unit);
  const ratio = unitRatio(listedUnit, unit);
  if (ratio != null) return { value: vendor.listed_price / ratio, basis: ratio === 1 ? 'listed' : 'unit_converted' };
  if (CONTAINER_UNITS.has(listedUnit) && vendor.pack_size) {
    const packRatio = unitRatio(vendor.pack_size.unit, unit);
    if (packRatio != null) return { value: vendor.listed_price / (vendor.pack_size.value * packRatio), basis: 'pack_size' };
  }
  return null;
}

/**
 * Each scorer returns { value: 0..1, assumed?, flag? }. `assumed` names why a neutral value
 * stands in for a measurement (the data was missing or not comparable); `flag` marks a hard
 * fact the shortlist should know about.
 */
function scorePrice(vendor, requirement) {
  if (vendor.listed_price == null) return { value: 0.15, assumed: 'price_not_listed' }; // worth asking, but ranks low
  const reference = requirement.target_price ?? requirement.max_price;
  if (reference == null) return { value: 0.6, assumed: 'no_price_to_compare_against' };
  const comparable = comparableListedPrice(vendor, requirement.unit);
  if (!comparable) return { value: 0.6, assumed: 'listed_unit_not_comparable' };
  // At or under the reference scores full; 30% over scores zero.
  return { value: clamp01((1.3 - comparable.value / reference) / 0.3) };
}

function scoreLocality(vendor, requirement) {
  if (vendor.city && requirement.city) return { value: sameCity(vendor.city, requirement.city) ? 1 : 0.35 };
  // Based somewhere unstated, but the listing says the seller serves this city ("Deals in Bengaluru").
  if (sameCity(vendor.serves_city, requirement.city)) return { value: 0.7, flag: 'delivers_to_city' };
  return { value: 0.4, assumed: 'city_unknown' };
}

function scoreMoq(vendor, requirement) {
  if (vendor.moq == null) return { value: 0.6, assumed: 'moq_not_stated' };
  if (requirement.quantity == null) return { value: 0.6, assumed: 'quantity_not_set' };
  const ratio = unitRatio(vendor.moq_unit ?? vendor.listed_unit, requirement.unit);
  if (ratio == null) return { value: 0.6, assumed: 'moq_unit_not_comparable' };
  const moq = vendor.moq * ratio;
  if (moq <= requirement.quantity) return { value: 1 };
  if (moq <= requirement.quantity * 1.5) return { value: 0.4 }; // close enough to negotiate down
  return { value: 0, flag: 'moq_exceeds_quantity' };
}

function scoreAvailability(vendor) {
  const text = String(vendor.availability ?? '').toLowerCase();
  if (text.includes('in stock')) return { value: 1 };
  if (text.includes('order')) return { value: 0.6 }; // made to order
  return { value: 0.35, assumed: 'availability_not_stated' };
}

function scoreContactability(vendor) {
  return vendor.phone ? { value: 1 } : { value: 0.2, flag: 'no_phone' };
}

const SCORERS = { price: scorePrice, locality: scoreLocality, moq: scoreMoq, availability: scoreAvailability, contactability: scoreContactability };

/**
 * @param {object} vendor      a vendors row or a discovery result (listed_price, listed_unit,
 *   pack_size?, city, serves_city?, moq?, moq_unit?, availability?, phone)
 * @param {object} requirement a requirements row (quantity, unit, target_price, max_price, city)
 * @returns {{score: number, breakdown: Record<string, number>, assumed: Record<string, string>, flags: string[]}}
 *   `score` is 0..100; `breakdown` is each component's 0..1 value before weighting.
 */
function scoreVendor(vendor, requirement) {
  const breakdown = {};
  const assumed = {};
  const flags = [];
  let score = 0;
  for (const [component, scorer] of Object.entries(SCORERS)) {
    const result = scorer(vendor, requirement);
    breakdown[component] = round2(result.value);
    if (result.assumed) assumed[component] = result.assumed;
    if (result.flag) flags.push(result.flag);
    score += result.value * WEIGHTS[component];
  }
  return { score: round2(score), breakdown, assumed, flags };
}

/* ------------------------------------------------------------------ deal ranking --- */

const POLICY_FLAGS = ['over_max_price', 'moq_exceeds_quantity', 'misses_delivery_date'];

/** Best first. A quote that breaks a policy never outranks one that does not, whatever its price. */
const STATUS_ORDER = ['ranked', 'freight_unknown', 'demoted', 'unrankable'];

const rupees = (n) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const amount = (n, unit) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}`;

function arrivesAfter(now, leadTimeDays, deliveryBy) {
  const due = new Date(`${String(deliveryBy).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(due.getTime())) throw new TypeError(`requirement.delivery_by is not a date: ${JSON.stringify(deliveryBy)}`);
  return now.getTime() + leadTimeDays * 86_400_000 > due.getTime();
}

function assessDeal(quote, requirement, now) {
  if (quote.simulated !== true && quote.simulated !== false && quote.simulated !== 1 && quote.simulated !== 0) {
    throw new TypeError(`rankDeals: quote ${quote.id ?? '(no id)'} does not say whether its vendor is simulated`);
  }
  let cost;
  try {
    cost = computeLandedCost(quote, requirement);
  } catch (err) {
    if (!(err instanceof UnitMismatchError)) throw err;
    cost = { landed_cost: null, goods_cost: null, unit_price: null, flags: ['unit_mismatch'] };
  }
  const flags = [...cost.flags];

  if (requirement.max_price != null && cost.unit_price != null && cost.unit_price > requirement.max_price) flags.push('over_max_price');
  const moqRatio = quote.moq == null || requirement.quantity == null ? null : unitRatio(quote.unit, requirement.unit);
  if (moqRatio != null && quote.moq * moqRatio > requirement.quantity) flags.push('moq_exceeds_quantity');
  if (requirement.delivery_by && quote.lead_time_days != null && arrivesAfter(now, quote.lead_time_days, requirement.delivery_by)) {
    flags.push('misses_delivery_date');
  }

  let status = 'ranked';
  if (cost.goods_cost == null) status = 'unrankable';
  else if (flags.some((f) => POLICY_FLAGS.includes(f))) status = 'demoted';
  else if (cost.landed_cost == null) status = 'freight_unknown';

  return {
    ...quote,
    simulated: Boolean(quote.simulated),
    landed_cost: cost.landed_cost,
    goods_cost: cost.goods_cost,
    comparable_unit_price: cost.unit_price,
    flags,
    status,
  };
}

/** Unknown values sort after known ones. */
const ascending = (a, b) => (a ?? Infinity) - (b ?? Infinity) || 0;
const descending = (a, b) => (b ?? -Infinity) - (a ?? -Infinity) || 0;

function compareDeals(a, b) {
  return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || ascending(a.landed_cost ?? a.goods_cost, b.landed_cost ?? b.goods_cost)
    || ascending(a.comparable_unit_price, b.comparable_unit_price)
    || ascending(a.lead_time_days, b.lead_time_days)
    || descending(a.confidence, b.confidence)
    || String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function costPhrase(deal, requirement) {
  const unit = normaliseUnit(requirement.unit);
  const goods = `${rupees(deal.comparable_unit_price)}/${unit} x ${amount(requirement.quantity, unit)}`;
  const quoted = deal.flags.includes('unit_converted') ? `, quoted as ${rupees(deal.unit_price)} per ${normaliseUnit(deal.unit)}` : '';
  if (deal.landed_cost == null) return `goods alone ${rupees(deal.goods_cost)} (${goods}${quoted})`;
  const freight = deal.freight === 0 ? 'no freight charge' : `${rupees(deal.freight)} freight`;
  return `landed ${rupees(deal.landed_cost)} (${goods} + ${freight}${quoted})`;
}

const POLICY_REASONS = {
  over_max_price: (deal, requirement, unit) => `${rupees(deal.comparable_unit_price)}/${unit} is above your maximum of ${rupees(requirement.max_price)}/${unit}`,
  moq_exceeds_quantity: (deal, requirement, unit) => `minimum order ${amount(deal.moq, normaliseUnit(deal.unit))} is above your ${amount(requirement.quantity, unit)}`,
  misses_delivery_date: (deal, requirement) => `${deal.lead_time_days} days lead time misses delivery by ${String(requirement.delivery_by).slice(0, 10)}`,
};

function unrankableReason(deal, requirement) {
  if (deal.flags.includes('unit_mismatch')) return `quoted per ${normaliseUnit(deal.unit)} but you asked in ${normaliseUnit(requirement.unit)}`;
  if (deal.flags.includes('price_unknown')) return 'no rate was quoted';
  if (deal.flags.includes('unit_unknown')) return 'the unit of the rate was not stated';
  return 'the quantity is not set';
}

function reasonFor(deal, best, requirement) {
  const unit = normaliseUnit(requirement.unit);
  let text;
  if (deal.status === 'unrankable') {
    text = `Cannot be compared: ${unrankableReason(deal, requirement)}.`;
  } else if (deal.status === 'demoted') {
    const why = POLICY_FLAGS.filter((f) => deal.flags.includes(f)).map((f) => POLICY_REASONS[f](deal, requirement, unit));
    text = `Demoted: ${why.join('; ')}; ${costPhrase(deal, requirement)}.`;
  } else if (deal.status === 'freight_unknown') {
    text = `Freight not quoted, so landed cost is unknown: ${costPhrase(deal, requirement)}.`;
  } else if (deal === best) {
    text = `Lowest landed cost: ${costPhrase(deal, requirement)}.`;
  } else if (deal.landed_cost === best.landed_cost) {
    text = `Same landed cost as the best deal: ${costPhrase(deal, requirement)}.`;
  } else {
    text = `${rupees(round2(deal.landed_cost - best.landed_cost))} more than the best deal: ${costPhrase(deal, requirement)}.`;
  }
  return deal.simulated ? `Simulated vendor. ${text}` : text;
}

/**
 * Order quotes by what the owner would actually pay.
 *
 * Fully costed quotes come first, cheapest landed cost first. Quotes with no freight figure
 * follow, by goods cost, labelled as such (unknown freight is never counted as zero). Quotes
 * that break a policy (above the owner's maximum, minimum order above the quantity, lead time
 * past the delivery date) are demoted below both. Quotes that cannot be costed at all come
 * last. Every quote passed in is returned; none is dropped.
 *
 * @param {object[]} quotes  quotes rows; each must carry `simulated` (boolean or 0/1)
 * @param {object} requirement
 * @param {{now?: Date}} [options]  `now` anchors the lead-time check
 * @returns {object[]} the quotes with rank, status, landed_cost, goods_cost,
 *   comparable_unit_price, flags and a one-line `reason`
 */
function rankDeals(quotes, requirement, { now = new Date() } = {}) {
  if (!Array.isArray(quotes)) throw new TypeError('rankDeals: quotes must be an array');
  const deals = quotes.map((quote) => assessDeal(quote, requirement, now)).sort(compareDeals);
  const best = deals[0]?.status === 'ranked' ? deals[0] : null;
  return deals.map((deal, index) => ({ ...deal, rank: index + 1, reason: reasonFor(deal, best, requirement) }));
}

module.exports = { WEIGHTS, scoreVendor, comparableListedPrice, rankDeals };
