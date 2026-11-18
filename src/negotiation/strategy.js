'use strict';

/**
 * Negotiation numbers, computed in code so the language model only phrases them.
 * Pure functions: no I/O, no clock, no randomness.
 *
 * The buyer curve is the time-dependent concession tactic from maha-rk/pact (MIT),
 * backend/pact/negotiation/concession.py:
 *
 *     offer(round) = open + (reservation - open) * t^beta,   t = (round - 1) / (maxRounds - 1)
 *
 * with the offer clamped to the reservation price on the last round. As in pact, beta > 1 is
 * Boulware (hold firm, concede late), beta = 1 is linear and beta < 1 concedes early; pact's
 * default is 2. All prices are per unit, in the requirement's unit.
 *
 * "Accept" here means "agreed, pending the owner's approval". Nothing in this module can place
 * an order; the approval gate does that.
 */

const DEFAULT_BETA = 2;

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

/** Buyer prices round down and vendor prices round up, so rounding never crosses a limit. */
const floorPaise = (n) => Math.floor(n * 100 + 1e-9) / 100;
const ceilPaise = (n) => Math.ceil(n * 100 - 1e-9) / 100;

/**
 * The most the buyer will pay: the lower of the owner's maximum and the best price seen in the
 * market (pact: reservation = min(budget ceiling, market floor)). Never above the owner's maximum.
 */
function reservationPrice({ ownerMax = null, marketEvidence = null } = {}) {
  const limits = [];
  if (ownerMax != null) limits.push(requirePrice(ownerMax, 'ownerMax'));
  if (marketEvidence != null) limits.push(requirePrice(marketEvidence, 'marketEvidence'));
  if (!limits.length) throw new RangeError('reservationPrice needs the owner\'s maximum price or market evidence; with neither there is no ceiling to negotiate under');
  return floorPaise(Math.min(...limits));
}

/**
 * Where the buyer starts: the owner's target if that is lower, otherwise `anchorDiscount`
 * under the reservation price, so there is always room to concede.
 */
function openingOffer({ target = null, reservation, anchorDiscount = 0.15 }) {
  requirePrice(reservation, 'reservation');
  requireFraction(anchorDiscount, 'anchorDiscount');
  const anchored = reservation * (1 - anchorDiscount);
  const open = floorPaise(target == null ? anchored : Math.min(requirePrice(target, 'target'), anchored));
  return Math.min(reservation, Math.max(open, 0.01)); // a sub-paisa price would round down to nothing
}

/**
 * The buyer's offer for this round. Never decreases from one round to the next, never exceeds
 * `reservation`, and equals it from the last round on.
 */
function nextBuyerOffer({ round, maxRounds, open, reservation, beta = DEFAULT_BETA }) {
  requireRound(round, maxRounds);
  requirePrice(open, 'open');
  requirePrice(reservation, 'reservation');
  requirePrice(beta, 'beta');
  if (open > reservation) throw new RangeError(`open (${open}) is above reservation (${reservation}); a buyer opens at or below the ceiling`);
  if (round >= maxRounds) return reservation;
  const t = (round - 1) / (maxRounds - 1);
  return Math.min(reservation, floorPaise(open + (reservation - open) * t ** beta));
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
 * One buyer turn: accept the ask, walk away, or counter with this round's offer.
 * @returns {{action: 'accept'|'walk_away'|'counter', price: number|null, reason: string}}
 */
function buyerMove({ round, maxRounds, open, reservation, beta = DEFAULT_BETA, vendorAsk = null, vendorSaysFinal = false, askHistory = [] }) {
  const offer = nextBuyerOffer({ round, maxRounds, open, reservation, beta });
  if (vendorAsk != null && shouldAccept({ vendorAsk, reservation, buyerOffer: offer })) {
    return { action: 'accept', price: vendorAsk, reason: 'ask_within_offer' };
  }
  const { walk, reason } = shouldWalkAway({ round, maxRounds, reservation, vendorAsk, vendorSaysFinal, askHistory });
  if (walk) return { action: 'walk_away', price: null, reason };
  return { action: 'counter', price: offer, reason: 'concession_curve' };
}

/**
 * Pricing policy for the simulated vendor: anchor above the basis price, concede a fixed share
 * of the remaining gap each round, never go below a private floor. `basisPrice` is a real figure
 * (the listing price the simulation is modelled on); everything derived from it is simulated and
 * says so.
 */
function createVendorSim({ basisPrice, anchorMarkup = 0.08, floorDiscount = 0.12, step = 0.15 }) {
  requirePrice(basisPrice, 'basisPrice');
  requireFraction(anchorMarkup, 'anchorMarkup');
  requireFraction(floorDiscount, 'floorDiscount');
  requireFraction(step, 'step');
  return Object.freeze({
    simulated: true,
    anchor: ceilPaise(basisPrice * (1 + anchorMarkup)),
    floor: ceilPaise(basisPrice * (1 - floorDiscount)),
    step,
  });
}

/** The simulated vendor's ask for a round: the anchor in round 1, then small steps toward the floor. */
function vendorSimAsk(policy, round) {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`round must be an integer of at least 1, got ${JSON.stringify(round)}`);
  const ask = policy.floor + (policy.anchor - policy.floor) * (1 - policy.step) ** (round - 1);
  return Math.max(policy.floor, ceilPaise(ask));
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
  reservationPrice,
  openingOffer,
  nextBuyerOffer,
  nextOffer: nextBuyerOffer, // the name architecture.md uses for the same function
  shouldAccept,
  shouldWalkAway,
  buyerMove,
  createVendorSim,
  vendorSimAsk,
  vendorSimMove,
};
