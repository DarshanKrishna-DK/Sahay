'use strict';

/**
 * Negotiation numbers, computed in code so the language model only phrases them.
 * Pure functions: no I/O, no clock, no randomness.
 *
 * Limits. The reservation price (the most the buyer will ever pay) is the owner's stated
 * maximum; without one, the vendor's listed price. The soft ceiling is the lower of the
 * reservation and the listed price: the buyer concedes toward the market first and only
 * reaches for the owner's maximum on the last round. So an ask a few paise above the listing
 * but under the owner's maximum is still agreed (E2E round 2: 60.17 against a listing of 60
 * and a maximum of 90 was walked away from), while the buyer does not hand over the owner's
 * whole budget early.
 *
 * The buyer curve is the time-dependent concession tactic from maha-rk/pact (MIT),
 * backend/pact/negotiation/concession.py:
 *
 *     offer(round) = open + (ceiling - open) * t^beta,   t = (round - 1) / (maxRounds - 2)
 *
 * reaching the soft ceiling on the second-last round and the reservation on the last. As in
 * pact, beta > 1 is Boulware (hold firm, concede late), beta = 1 is linear, beta < 1 concedes
 * early. Prices are per unit, in the requirement's unit, rounded to a spoken-friendly tick
 * (whole rupees for everyday prices): buyer prices round down, vendor prices round up, so
 * rounding never crosses a limit.
 *
 * "Accept" here means "agreed, pending the owner's approval". Nothing in this module can place
 * an order; the approval gate does that.
 */

const DEFAULT_BETA = 1.5;
const DEFAULT_MAX_ROUNDS = 5;

function requirePrice(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireFraction(value, name) {
  if (typeof value !== 'number' || !(value >= 0 && value < 1)) {
    throw new RangeError(`${name} must be a number from 0 up to (not including) 1, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireRound(round, maxRounds) {
  if (!Number.isInteger(maxRounds) || maxRounds < 2) throw new RangeError(`maxRounds must be an integer of at least 2, got ${JSON.stringify(maxRounds)}`);
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`round must be an integer of at least 1, got ${JSON.stringify(round)}`);
}

const paise = (n) => Math.round(n * 100) / 100;
const floorPaise = (n) => Math.floor(n * 100 + 1e-9) / 100;
const floorTick = (n, tick) => paise(Math.floor(n / tick + 1e-9) * tick);
const ceilTick = (n, tick) => paise(Math.ceil(n / tick - 1e-9) * tick);

/**
 * The step prices move in, so they can be said aloud: whole rupees for everyday prices,
 * half rupees or ten paise for cheap items, ten rupees for dear ones.
 */
function priceTick(price) {
  requirePrice(price, 'price');
  if (price >= 2000) return 10;
  if (price >= 50) return 1;
  if (price >= 10) return 0.5;
  if (price >= 1) return 0.1;
  return 0.01;
}

/**
 * The most the buyer will pay: the owner's maximum when stated, otherwise the market evidence
 * (the listed price). Never above the owner's maximum.
 */
function reservationPrice({ ownerMax = null, marketEvidence = null } = {}) {
  if (marketEvidence != null) requirePrice(marketEvidence, 'marketEvidence');
  if (ownerMax != null) return floorPaise(requirePrice(ownerMax, 'ownerMax'));
  if (marketEvidence != null) return floorPaise(requirePrice(marketEvidence, 'marketEvidence'));
  throw new RangeError('reservationPrice needs the owner\'s maximum price or market evidence; with neither there is no ceiling to negotiate under');
}

/** Where the buyer's concessions head before the last round: the market price, capped by the reservation. */
function softCeiling({ reservation, marketEvidence = null }) {
  requirePrice(reservation, 'reservation');
  if (marketEvidence == null) return reservation;
  return Math.min(reservation, floorPaise(requirePrice(marketEvidence, 'marketEvidence')));
}

/**
 * Where the buyer starts: the owner's target if that is lower, otherwise `anchorDiscount`
 * under the soft ceiling (the market price when known), so there is always room to concede.
 */
function openingOffer({ target = null, reservation, marketEvidence = null, anchorDiscount = 0.15, tick = 0.01 }) {
  requireFraction(anchorDiscount, 'anchorDiscount');
  requirePrice(tick, 'tick');
  const base = softCeiling({ reservation, marketEvidence });
  const anchored = floorTick(base * (1 - anchorDiscount), tick);
  const open = target == null ? anchored : Math.min(floorPaise(requirePrice(target, 'target')), anchored);
  return Math.min(reservation, Math.max(open, 0.01)); // a sub-paisa price would round down to nothing
}

/**
 * The buyer's offer for this round. Never decreases from one round to the next, stays at or
 * under `ceiling` before the last round, and equals `reservation` from the last round on.
 */
function nextBuyerOffer({ round, maxRounds, open, reservation, ceiling = reservation, beta = DEFAULT_BETA, tick = 0.01 }) {
  requireRound(round, maxRounds);
  requirePrice(open, 'open');
  requirePrice(reservation, 'reservation');
  requirePrice(ceiling, 'ceiling');
  requirePrice(beta, 'beta');
  requirePrice(tick, 'tick');
  if (open > reservation) throw new RangeError(`open (${open}) is above reservation (${reservation}); a buyer opens at or below the ceiling`);
  if (ceiling > reservation || ceiling < open) throw new RangeError(`ceiling (${ceiling}) must lie between open (${open}) and reservation (${reservation})`);
  if (round >= maxRounds) return reservation;
  const t = Math.min(1, (round - 1) / Math.max(1, maxRounds - 2));
  if (t >= 1) return ceiling;
  return Math.min(ceiling, Math.max(open, floorTick(open + (ceiling - open) * t ** beta, tick)));
}

/**
 * Take the vendor's ask? Only at or under the reservation price, and, when the buyer's offer for
 * this round is given, only once the ask has come down to it (otherwise keep countering).
 */
function shouldAccept({ vendorAsk, reservation, buyerOffer = null }) {
  requirePrice(vendorAsk, 'vendorAsk');
  requirePrice(reservation, 'reservation');
  if (vendorAsk > reservation) return false;
  return buyerOffer == null || vendorAsk <= requirePrice(buyerOffer, 'buyerOffer');
}

/**
 * Stop negotiating? An ask at or under the reservation price is never walked away from.
 * Above it, the buyer leaves when the vendor calls the ask final, when the rounds are used up,
 * or when the last `stallRounds` asks did not move.
 *
 * @param {object} args
 * @param {number|null} [args.vendorAsk]   the latest ask, null if the vendor has not named a price
 * @param {number[]} [args.askHistory]     the vendor's asks so far, oldest first, including the latest
 * @returns {{walk: boolean, reason: 'final_ask_above_reservation'|'max_rounds_reached'|'vendor_not_moving'|null}}
 */
function shouldWalkAway({ round, maxRounds, reservation, vendorAsk = null, vendorSaysFinal = false, askHistory = [], stallRounds = 3 }) {
  requireRound(round, maxRounds);
  requirePrice(reservation, 'reservation');
  const stay = { walk: false, reason: null };
  if (vendorAsk == null) return round > maxRounds ? { walk: true, reason: 'max_rounds_reached' } : stay;
  if (requirePrice(vendorAsk, 'vendorAsk') <= reservation) return stay;
  if (vendorSaysFinal) return { walk: true, reason: 'final_ask_above_reservation' };
  if (round >= maxRounds) return { walk: true, reason: 'max_rounds_reached' };
  const recent = askHistory.slice(-stallRounds);
  if (recent.length === stallRounds && recent.every((ask) => ask === recent[0])) return { walk: true, reason: 'vendor_not_moving' };
  return stay;
}

/**
 * One buyer turn: accept the ask, walk away, or counter with this round's offer. A counter is
 * always below the ask (otherwise the ask is accepted), and an accept is at the ask itself.
 * A final ask within the reservation is accepted: walking away from it would break the owner's
 * own limit, and countering a final price only invites a walk-away.
 * @returns {{action: 'accept'|'walk_away'|'counter', price: number|null, reason: string}}
 */
function buyerMove({ round, maxRounds, open, reservation, ceiling = reservation, beta = DEFAULT_BETA, tick = 0.01, vendorAsk = null, vendorSaysFinal = false, askHistory = [] }) {
  const offer = nextBuyerOffer({ round, maxRounds, open, reservation, ceiling, beta, tick });
  if (vendorAsk != null && shouldAccept({ vendorAsk, reservation, buyerOffer: offer })) {
    return { action: 'accept', price: vendorAsk, reason: 'ask_within_offer' };
  }
  if (vendorAsk != null && vendorSaysFinal && vendorAsk <= reservation) {
    return { action: 'accept', price: vendorAsk, reason: 'final_ask_within_reservation' };
  }
  const { walk, reason } = shouldWalkAway({ round, maxRounds, reservation, vendorAsk, vendorSaysFinal, askHistory });
  if (walk) return { action: 'walk_away', price: null, reason };
  return { action: 'counter', price: offer, reason: 'concession_curve' };
}

/**
 * Pricing policy for the simulated vendor: anchor above the basis price, concede quickly at
 * first and then more slowly, and reach a private floor on the last scheduled round, which is
 * the only "final" price. `basisPrice` is a real figure (the listing price the simulation is
 * modelled on); everything derived from it is simulated and says so.
 */
function createVendorSim({ basisPrice, maxRounds = DEFAULT_MAX_ROUNDS, anchorMarkup = 0.08, floorDiscount = 0.1, tick = null }) {
  requirePrice(basisPrice, 'basisPrice');
  requireRound(1, maxRounds);
  requireFraction(anchorMarkup, 'anchorMarkup');
  requireFraction(floorDiscount, 'floorDiscount');
  const step = tick ?? priceTick(basisPrice);
  requirePrice(step, 'tick');
  const floor = ceilTick(basisPrice * (1 - floorDiscount), step);
  const anchor = Math.max(floor, ceilTick(basisPrice * (1 + anchorMarkup), step));
  return Object.freeze({ simulated: true, anchor, floor, maxRounds, tick: step });
}

/**
 * The simulated vendor's ask for a round: the anchor in round 1, the floor from the last
 * scheduled round on, and in between anchor - gap * (1 - (1 - t)^2), rounded up to the tick.
 */
function vendorSimAsk(policy, round) {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`round must be an integer of at least 1, got ${JSON.stringify(round)}`);
  if (round >= policy.maxRounds) return policy.floor;
  const t = (round - 1) / (policy.maxRounds - 1);
  const ask = policy.anchor - (policy.anchor - policy.floor) * (1 - (1 - t) ** 2);
  return Math.max(policy.floor, ceilTick(ask, policy.tick));
}

/** The simulated vendor's ask for every scheduled round, 1..maxRounds. */
function vendorSimSchedule(policy) {
  return Array.from({ length: policy.maxRounds }, (_, i) => vendorSimAsk(policy, i + 1));
}

/**
 * One simulated-vendor turn: accept a buyer offer that meets this round's ask, otherwise counter
 * with the ask. The price is never below the policy floor.
 * @returns {{simulated: true, action: 'accept'|'counter', price: number}}
 */
function vendorSimMove({ policy, round, buyerOffer = null }) {
  const ask = vendorSimAsk(policy, round);
  if (buyerOffer != null && requirePrice(buyerOffer, 'buyerOffer') >= ask) {
    return { simulated: true, action: 'accept', price: buyerOffer };
  }
  return { simulated: true, action: 'counter', price: ask };
}

module.exports = {
  DEFAULT_BETA,
  DEFAULT_MAX_ROUNDS,
  priceTick,
  reservationPrice,
  softCeiling,
  openingOffer,
  nextBuyerOffer,
  nextOffer: nextBuyerOffer, // the name architecture.md uses for the same function
  shouldAccept,
  shouldWalkAway,
  buyerMove,
  createVendorSim,
  vendorSimAsk,
  vendorSimSchedule,
  vendorSimMove,
};
