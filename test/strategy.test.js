'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const strategy = require('../src/negotiation/strategy');

const {
  priceTick, reservationPrice, softCeiling, openingOffer, nextBuyerOffer, shouldAccept, shouldWalkAway, buyerMove,
  createVendorSim, vendorSimAsk, vendorSimSchedule, vendorSimMove,
} = strategy;

const rounds = (maxRounds) => Array.from({ length: maxRounds }, (_, i) => i + 1);

test('price tick: whole rupees for everyday prices, finer steps for cheap items, coarser for dear ones', () => {
  assert.equal(priceTick(60), 1);
  assert.equal(priceTick(50), 1);
  assert.equal(priceTick(1999), 1);
  assert.equal(priceTick(25000), 10);
  assert.equal(priceTick(12), 0.5);
  assert.equal(priceTick(4.2), 0.1);
  assert.equal(priceTick(0.4), 0.01);
  assert.throws(() => priceTick(0), RangeError);
});

test('reservation price is the owner maximum when stated, otherwise the listed (market) price', () => {
  assert.equal(reservationPrice({ ownerMax: 90, marketEvidence: 60 }), 90, 'a listing below the owner max does not lower the hard ceiling');
  assert.equal(reservationPrice({ ownerMax: 80, marketEvidence: 95 }), 80);
  assert.equal(reservationPrice({ ownerMax: 80 }), 80);
  assert.equal(reservationPrice({ marketEvidence: 72 }), 72, 'without an owner max the listed price is the ceiling');
});

test('reservation price cannot be formed without any ceiling, or from a bad figure', () => {
  assert.throws(() => reservationPrice({}), RangeError);
  assert.throws(() => reservationPrice(), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: 0 }), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: 80, marketEvidence: -1 }), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: '80' }), RangeError);
});

test('soft ceiling: the buyer concedes toward the market price first, never past the reservation', () => {
  assert.equal(softCeiling({ reservation: 90, marketEvidence: 60 }), 60);
  assert.equal(softCeiling({ reservation: 80, marketEvidence: 95 }), 80);
  assert.equal(softCeiling({ reservation: 80 }), 80);
});

test('opening offer leaves room under the market price or the reservation, whichever is lower', () => {
  assert.equal(openingOffer({ reservation: 80 }), 68); // 15% under
  assert.equal(openingOffer({ reservation: 80, target: 60 }), 60); // the owner's lower target
  assert.equal(openingOffer({ reservation: 80, target: 79 }), 68); // a target near the ceiling still anchors lower
  assert.equal(openingOffer({ reservation: 80, anchorDiscount: 0 }), 80);
  assert.equal(openingOffer({ reservation: 90, marketEvidence: 60 }), 51, 'anchored on the listing, not on a generous owner max');
  assert.equal(openingOffer({ reservation: 90, marketEvidence: 60.7, tick: 1 }), 51, 'rounded down to the price tick');
  assert.throws(() => openingOffer({ reservation: 80, anchorDiscount: 1 }), RangeError);
  assert.throws(() => openingOffer({ target: 60 }), RangeError);
});

test('buyer offers rise from the opening offer to the soft ceiling by the second-last round, then to the reservation', () => {
  const at = (round) => nextBuyerOffer({ round, maxRounds: 5, open: 51, ceiling: 60, reservation: 90, tick: 1 });
  assert.deepEqual(rounds(5).map(at), [51, 52, 55, 60, 90]);
  assert.equal(strategy.DEFAULT_BETA, 1.5);
  assert.equal(strategy.nextOffer, nextBuyerOffer);
  // no separate ceiling: the curve ends at the reservation
  assert.deepEqual(rounds(5).map((round) => nextBuyerOffer({ round, maxRounds: 5, open: 51, reservation: 60, tick: 1 })), [51, 52, 55, 60, 60]);
});

test('beta above 1 concedes later than linear (Boulware), below 1 earlier', () => {
  const mid = (beta) => nextBuyerOffer({ round: 2, maxRounds: 4, open: 60, reservation: 80, beta });
  assert.equal(mid(1), 70);
  assert.ok(mid(2) < 70);
  assert.ok(mid(0.5) > 70);
});

test('buyer concessions are monotonic and never exceed the reservation or the owner maximum', () => {
  for (const ownerMax of [0.5, 48, 80, 61999.99]) {
    for (const marketEvidence of [null, ownerMax * 0.6, ownerMax * 0.9, ownerMax * 1.4]) {
      const reservation = reservationPrice({ ownerMax, marketEvidence });
      const ceiling = softCeiling({ reservation, marketEvidence });
      assert.ok(reservation <= ownerMax);
      for (const tick of [0.01, priceTick(ceiling)]) {
        for (const target of [null, ownerMax * 0.5, ownerMax * 2]) {
          const open = openingOffer({ target, reservation, marketEvidence, tick });
          for (const beta of [0.5, 1, 1.5, 4]) {
            for (const maxRounds of [2, 3, 6, 10]) {
              let previous = 0;
              for (const round of [...rounds(maxRounds), maxRounds + 1, maxRounds + 5]) {
                const offer = nextBuyerOffer({ round, maxRounds, open, reservation, ceiling, beta, tick });
                assert.ok(offer >= previous, `round ${round}: ${offer} dropped below ${previous}`);
                assert.ok(offer <= reservation, `round ${round}: ${offer} is above the reservation ${reservation}`);
                assert.ok(offer <= ownerMax, `round ${round}: ${offer} is above the owner maximum ${ownerMax}`);
                if (round < maxRounds) assert.ok(offer <= ceiling, `round ${round}: ${offer} is above the soft ceiling ${ceiling} before the last round`);
                previous = offer;
              }
              assert.equal(nextBuyerOffer({ round: 1, maxRounds, open, reservation, ceiling, beta, tick }), open);
              assert.equal(nextBuyerOffer({ round: maxRounds, maxRounds, open, reservation, ceiling, beta, tick }), reservation);
            }
          }
        }
      }
    }
  }
});

test('nextBuyerOffer rejects inputs that would break its guarantees', () => {
  const ok = { round: 1, maxRounds: 6, open: 60, reservation: 80 };
  assert.throws(() => nextBuyerOffer({ ...ok, open: 81 }), /open \(81\) is above reservation \(80\)/);
  assert.throws(() => nextBuyerOffer({ ...ok, ceiling: 81 }), /ceiling/);
  assert.throws(() => nextBuyerOffer({ ...ok, ceiling: 59 }), /ceiling/);
  assert.throws(() => nextBuyerOffer({ ...ok, round: 0 }), RangeError);
  assert.throws(() => nextBuyerOffer({ ...ok, round: 1.5 }), RangeError);
  assert.throws(() => nextBuyerOffer({ ...ok, maxRounds: 1 }), RangeError);
  assert.throws(() => nextBuyerOffer({ ...ok, beta: 0 }), RangeError);
  assert.throws(() => nextBuyerOffer({ ...ok, reservation: null }), RangeError);
  assert.throws(() => nextBuyerOffer({ ...ok, open: Number.NaN }), RangeError);
});

test('shouldAccept: yes when the ask is at or under the offer, never above the reservation', () => {
  assert.equal(shouldAccept({ vendorAsk: 66, reservation: 80, buyerOffer: 67.2 }), true);
  assert.equal(shouldAccept({ vendorAsk: 67.2, reservation: 80, buyerOffer: 67.2 }), true);
  assert.equal(shouldAccept({ vendorAsk: 75, reservation: 80, buyerOffer: 67.2 }), false, 'under the ceiling but above the offer: keep countering');
  assert.equal(shouldAccept({ vendorAsk: 75, reservation: 80 }), true, 'with no offer in play the ceiling alone decides');
  assert.equal(shouldAccept({ vendorAsk: 80, reservation: 80 }), true);
  assert.equal(shouldAccept({ vendorAsk: 80.01, reservation: 80 }), false);
  assert.equal(shouldAccept({ vendorAsk: 80.01, reservation: 80, buyerOffer: 90 }), false, 'an offer above the ceiling cannot unlock it');
  assert.throws(() => shouldAccept({ vendorAsk: null, reservation: 80 }), RangeError);
});

test('shouldWalkAway: only above the reservation, on a final ask, spent rounds or a stalled vendor', () => {
  const base = { round: 2, maxRounds: 6, reservation: 80 };
  assert.deepEqual(shouldWalkAway({ ...base, vendorAsk: 95 }), { walk: false, reason: null });
  assert.deepEqual(shouldWalkAway({ ...base, vendorAsk: 95, vendorSaysFinal: true }), { walk: true, reason: 'final_ask_above_reservation' });
  assert.deepEqual(shouldWalkAway({ ...base, round: 6, vendorAsk: 81 }), { walk: true, reason: 'max_rounds_reached' });
  assert.deepEqual(shouldWalkAway({ ...base, round: 4, vendorAsk: 95, askHistory: [99, 95, 95, 95] }), { walk: true, reason: 'vendor_not_moving' });
  assert.deepEqual(shouldWalkAway({ ...base, round: 4, vendorAsk: 95, askHistory: [99, 97, 95, 95] }), { walk: false, reason: null });

  // an acceptable ask is never walked away from
  assert.equal(shouldWalkAway({ ...base, round: 6, vendorAsk: 80, vendorSaysFinal: true, askHistory: [80, 80, 80] }).walk, false);
  // no price named yet: stay until the rounds are gone
  assert.equal(shouldWalkAway({ ...base, vendorAsk: null }).walk, false);
  assert.deepEqual(shouldWalkAway({ ...base, round: 7, vendorAsk: null }), { walk: true, reason: 'max_rounds_reached' });
});

test('buyerMove counters along the curve, accepts within it, and walks away past the ceiling', () => {
  const base = { maxRounds: 6, open: 60, reservation: 80, beta: 2 };
  assert.deepEqual(buyerMove({ ...base, round: 1 }), { action: 'counter', price: 60, reason: 'concession_curve' });
  assert.deepEqual(buyerMove({ ...base, round: 3, vendorAsk: 90 }), { action: 'counter', price: 65, reason: 'concession_curve' });
  assert.deepEqual(buyerMove({ ...base, round: 4, vendorAsk: 71 }), { action: 'accept', price: 71, reason: 'ask_within_offer' });
  assert.deepEqual(buyerMove({ ...base, round: 6, vendorAsk: 80 }), { action: 'accept', price: 80, reason: 'ask_within_offer' });
  assert.deepEqual(buyerMove({ ...base, round: 6, vendorAsk: 85 }), { action: 'walk_away', price: null, reason: 'max_rounds_reached' });
  assert.deepEqual(buyerMove({ ...base, round: 2, vendorAsk: 85, vendorSaysFinal: true }), { action: 'walk_away', price: null, reason: 'final_ask_above_reservation' });
});

test('regression (E2E r2): a final ask within the owner maximum is accepted, never walked away from', () => {
  // live run: owner max 90, BS Foods listed 60; the vendor called 64.8 "final" in round 1
  const reservation = reservationPrice({ ownerMax: 90, marketEvidence: 60 });
  const move = buyerMove({ round: 1, maxRounds: 5, open: 51, ceiling: 60, reservation, tick: 1, vendorAsk: 64.8, vendorSaysFinal: true });
  assert.deepEqual(move, { action: 'accept', price: 64.8, reason: 'final_ask_within_reservation' });
});

test('regression (E2E r2): an ask a few paise over the listed price but under the owner max is not walked away from on the last round', () => {
  const reservation = reservationPrice({ ownerMax: 90, marketEvidence: 60 });
  const move = buyerMove({ round: 5, maxRounds: 5, open: 51, ceiling: 60, reservation, tick: 1, vendorAsk: 60.17, askHistory: [64.8, 64.8, 63, 61.47, 60.17] });
  assert.deepEqual(move, { action: 'accept', price: 60.17, reason: 'ask_within_offer' });
});

test('the buyer never counters at or above the vendor ask', () => {
  for (const vendorAsk of [40, 51, 52.5, 55, 59, 60, 61, 64.8, 89, 95]) {
    for (const round of rounds(5)) {
      const move = buyerMove({ round, maxRounds: 5, open: 51, ceiling: 60, reservation: 90, tick: 1, vendorAsk });
      if (move.action === 'counter') assert.ok(move.price < vendorAsk, `round ${round}: countered ${move.price} against an ask of ${vendorAsk}`);
      if (move.action === 'accept') assert.equal(move.price, vendorAsk, 'accepts the ask itself, never a higher figure');
    }
  }
});

test('simulated vendor: anchors above the listing, concedes in believable whole-rupee steps, ends at its floor', () => {
  const policy = createVendorSim({ basisPrice: 60 });
  assert.deepEqual(policy, { simulated: true, anchor: 65, floor: 54, maxRounds: 5, tick: 1 });
  assert.ok(Object.isFrozen(policy));
  assert.deepEqual(vendorSimSchedule(policy), [65, 61, 57, 55, 54]);

  const dear = createVendorSim({ basisPrice: 100 });
  assert.deepEqual(vendorSimSchedule(dear), [108, 101, 95, 92, 90]);

  for (const basisPrice of [0.4, 4.2, 12, 60, 100, 999, 25000]) {
    const p = createVendorSim({ basisPrice });
    const asks = vendorSimSchedule(p);
    assert.equal(asks[0], p.anchor, 'opens at the anchor');
    assert.ok(p.anchor > basisPrice, 'the anchor is above the listing');
    assert.ok(p.floor < basisPrice, 'the floor is below the listing');
    assert.equal(asks.at(-1), p.floor, 'the last scheduled ask is the floor');
    for (let i = 1; i < asks.length; i++) assert.ok(asks[i] <= asks[i - 1], `basis ${basisPrice}: ask rose from ${asks[i - 1]} to ${asks[i]}`);
    assert.equal(vendorSimAsk(p, 10_000), p.floor);
  }
  assert.throws(() => vendorSimAsk(policy, 0), RangeError);
  assert.throws(() => createVendorSim({ basisPrice: null }), RangeError);
  assert.throws(() => createVendorSim({ basisPrice: 100, floorDiscount: 1 }), RangeError);
  assert.throws(() => createVendorSim({ basisPrice: 100, maxRounds: 1 }), RangeError);
});

test('every simulated vendor move is labelled simulated and priced at or above the floor', () => {
  const policy = createVendorSim({ basisPrice: 100 });
  assert.deepEqual(vendorSimMove({ policy, round: 1 }), { simulated: true, action: 'counter', price: 108 });
  assert.deepEqual(vendorSimMove({ policy, round: 1, buyerOffer: 70 }), { simulated: true, action: 'counter', price: 108 });
  assert.deepEqual(vendorSimMove({ policy, round: 1, buyerOffer: 110 }), { simulated: true, action: 'accept', price: 110 });
  for (const round of rounds(50)) {
    for (const buyerOffer of [null, 1, 89.99, 90, 95, 200]) {
      const move = vendorSimMove({ policy, round, buyerOffer });
      assert.equal(move.simulated, true);
      assert.ok(move.price >= policy.floor, `round ${round}, offer ${buyerOffer}: ${move.price} is below the floor`);
    }
  }
});

/**
 * The deterministic loop the server plays in "loop" mode: vendor speaks its ask for the round
 * (or accepts the buyer's last counter), then the buyer answers with buyerMove.
 */
function negotiate({ ownerMax = null, target = null, basisPrice, maxRounds = 5 }) {
  const policy = createVendorSim({ basisPrice, maxRounds });
  const reservation = reservationPrice({ ownerMax, marketEvidence: basisPrice });
  const ceiling = softCeiling({ reservation, marketEvidence: basisPrice });
  const tick = priceTick(ceiling);
  const open = openingOffer({ target, reservation, marketEvidence: basisPrice, tick });
  const askHistory = [];
  const trace = [];
  let lastOffer = null;
  for (let round = 1; round <= maxRounds; round++) {
    const vendor = vendorSimMove({ policy, round, buyerOffer: lastOffer });
    askHistory.push(vendor.price);
    const buyer = buyerMove({ round, maxRounds, open, reservation, ceiling, tick, vendorAsk: vendor.price, vendorSaysFinal: vendor.action === 'counter' && vendor.price <= policy.floor, askHistory });
    trace.push({ round, vendor: vendor.price, buyer: buyer.action, price: buyer.price });
    if (buyer.action === 'counter') assert.ok(buyer.price < vendor.price, 'the buyer never counters at or above the ask');
    if (buyer.action !== 'counter') return { ...buyer, round, policy, reservation, trace };
    lastOffer = buyer.price;
  }
  throw new Error('negotiation ran past maxRounds without closing');
}

test('full loop, basis 60 / owner max 90 (the live BS Foods case): agreement in round 4 at 55', () => {
  const deal = negotiate({ ownerMax: 90, basisPrice: 60 });
  assert.deepEqual(deal.trace, [
    { round: 1, vendor: 65, buyer: 'counter', price: 51 },
    { round: 2, vendor: 61, buyer: 'counter', price: 52 },
    { round: 3, vendor: 57, buyer: 'counter', price: 55 },
    { round: 4, vendor: 55, buyer: 'accept', price: 55 },
  ]);
});

test('full loop, basis 60 / no owner max: the listing is the ceiling, same agreement', () => {
  const deal = negotiate({ basisPrice: 60 });
  assert.equal(deal.action, 'accept');
  assert.equal(deal.price, 55);
  assert.equal(deal.round, 4);
  assert.equal(deal.reservation, 60);
});

test('full loop, basis 100 / owner max 90: owner max below the listing but at the vendor floor, agreement at the floor', () => {
  const deal = negotiate({ ownerMax: 90, basisPrice: 100 });
  assert.equal(deal.action, 'accept');
  assert.equal(deal.price, 90);
  assert.ok(deal.round <= 5);
});

test('full loop, basis 100 / owner max 80: the vendor floor is above the owner max, an honest walk-away', () => {
  const outcome = negotiate({ ownerMax: 80, basisPrice: 100 }); // floor 90
  assert.equal(outcome.action, 'walk_away');
  assert.equal(outcome.price, null);
  assert.equal(outcome.round, 5);
});

test('full loop: whenever the vendor floor is at or under the owner max, a deal lands within the rounds, at or under the ask and the owner max', () => {
  for (const basisPrice of [0.4, 4.2, 12, 37, 60, 100, 185, 999, 25000]) {
    for (const ownerFactor of [null, 0.8, 0.9, 0.95, 1, 1.1, 1.5, 3]) {
      for (const target of [null, basisPrice * 0.5]) {
        const ownerMax = ownerFactor == null ? null : Math.round(basisPrice * ownerFactor * 100) / 100;
        const outcome = negotiate({ ownerMax, target, basisPrice });
        const label = `basis ${basisPrice}, max ${ownerMax}, target ${target}`;
        const ceiling = ownerMax ?? basisPrice;
        if (outcome.policy.floor <= ceiling) {
          assert.equal(outcome.action, 'accept', `${label}: ${JSON.stringify(outcome.trace)}`);
          assert.ok(outcome.price <= ceiling, `${label}: agreed ${outcome.price}`);
          assert.ok(outcome.price >= outcome.policy.floor, `${label}: agreed ${outcome.price} below the floor`);
          assert.ok(outcome.round <= 5, `${label}: took ${outcome.round} rounds`);
        } else {
          assert.equal(outcome.action, 'walk_away', `${label}: ${JSON.stringify(outcome.trace)}`);
        }
      }
    }
  }
});

test('full loop: typical listings with a generous owner max agree in 3 or 4 rounds', () => {
  for (const basisPrice of [37, 60, 100, 185, 999]) {
    const deal = negotiate({ ownerMax: basisPrice * 1.5, basisPrice });
    assert.equal(deal.action, 'accept');
    assert.ok(deal.round >= 3 && deal.round <= 4, `basis ${basisPrice}: round ${deal.round} ${JSON.stringify(deal.trace)}`);
  }
});
