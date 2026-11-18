'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const strategy = require('../src/negotiation/strategy');

const {
  reservationPrice, openingOffer, nextBuyerOffer, shouldAccept, shouldWalkAway, buyerMove,
  createVendorSim, vendorSimAsk, vendorSimMove,
} = strategy;

const rounds = (maxRounds) => Array.from({ length: maxRounds }, (_, i) => i + 1);

test('reservation price is the lower of the owner maximum and the market evidence', () => {
  assert.equal(reservationPrice({ ownerMax: 80, marketEvidence: 72 }), 72);
  assert.equal(reservationPrice({ ownerMax: 80, marketEvidence: 95 }), 80);
  assert.equal(reservationPrice({ ownerMax: 80 }), 80);
  assert.equal(reservationPrice({ marketEvidence: 72 }), 72);
});

test('reservation price cannot be formed without any ceiling, or from a bad figure', () => {
  assert.throws(() => reservationPrice({}), RangeError);
  assert.throws(() => reservationPrice(), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: 0 }), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: 80, marketEvidence: -1 }), RangeError);
  assert.throws(() => reservationPrice({ ownerMax: '80' }), RangeError);
});

test('opening offer leaves room under the reservation price', () => {
  assert.equal(openingOffer({ reservation: 80 }), 68); // 15% under
  assert.equal(openingOffer({ reservation: 80, target: 60 }), 60); // the owner's lower target
  assert.equal(openingOffer({ reservation: 80, target: 79 }), 68); // a target near the ceiling still anchors lower
  assert.equal(openingOffer({ reservation: 80, anchorDiscount: 0 }), 80);
  assert.throws(() => openingOffer({ reservation: 80, anchorDiscount: 1 }), RangeError);
  assert.throws(() => openingOffer({ target: 60 }), RangeError);
});

test('buyer offers follow the pact curve: open + (reservation - open) * t^beta', () => {
  const at = (round) => nextBuyerOffer({ round, maxRounds: 6, open: 60, reservation: 80 });
  assert.deepEqual(rounds(6).map(at), [60, 60.8, 63.2, 67.2, 72.8, 80]);
  assert.equal(strategy.DEFAULT_BETA, 2);
  assert.equal(strategy.nextOffer, nextBuyerOffer);
});

test('beta above 1 concedes later than linear (Boulware), below 1 earlier', () => {
  const mid = (beta) => nextBuyerOffer({ round: 3, maxRounds: 5, open: 60, reservation: 80, beta });
  assert.equal(mid(1), 70);
  assert.ok(mid(2) < 70);
  assert.ok(mid(0.5) > 70);
});

test('buyer concessions are monotonic and never exceed the reservation or the owner maximum', () => {
  for (const ownerMax of [0.5, 48, 80, 61999.99]) {
    for (const marketEvidence of [null, ownerMax * 0.9, ownerMax * 1.4]) {
      const reservation = reservationPrice({ ownerMax, marketEvidence });
      assert.ok(reservation <= ownerMax);
      for (const target of [null, ownerMax * 0.5, ownerMax * 2]) {
        const open = openingOffer({ target, reservation });
        for (const beta of [0.5, 1, 2, 4]) {
          for (const maxRounds of [2, 3, 6, 10]) {
            let previous = 0;
            for (const round of [...rounds(maxRounds), maxRounds + 1, maxRounds + 5]) {
              const offer = nextBuyerOffer({ round, maxRounds, open, reservation, beta });
              assert.ok(offer >= previous, `round ${round}: ${offer} dropped below ${previous}`);
              assert.ok(offer <= reservation, `round ${round}: ${offer} is above the reservation ${reservation}`);
              assert.ok(offer <= ownerMax, `round ${round}: ${offer} is above the owner maximum ${ownerMax}`);
              previous = offer;
            }
            assert.equal(nextBuyerOffer({ round: 1, maxRounds, open, reservation, beta }), open);
            assert.equal(nextBuyerOffer({ round: maxRounds, maxRounds, open, reservation, beta }), reservation);
          }
        }
      }
    }
  }
});

test('nextBuyerOffer rejects inputs that would break its guarantees', () => {
  const ok = { round: 1, maxRounds: 6, open: 60, reservation: 80 };
  assert.throws(() => nextBuyerOffer({ ...ok, open: 81 }), /open \(81\) is above reservation \(80\)/);
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
  const base = { maxRounds: 6, open: 60, reservation: 80 };
  assert.deepEqual(buyerMove({ ...base, round: 1 }), { action: 'counter', price: 60, reason: 'concession_curve' });
  assert.deepEqual(buyerMove({ ...base, round: 3, vendorAsk: 90 }), { action: 'counter', price: 63.2, reason: 'concession_curve' });
  assert.deepEqual(buyerMove({ ...base, round: 4, vendorAsk: 67 }), { action: 'accept', price: 67, reason: 'ask_within_offer' });
  assert.deepEqual(buyerMove({ ...base, round: 6, vendorAsk: 80 }), { action: 'accept', price: 80, reason: 'ask_within_offer' });
  assert.deepEqual(buyerMove({ ...base, round: 6, vendorAsk: 85 }), { action: 'walk_away', price: null, reason: 'max_rounds_reached' });
  assert.deepEqual(buyerMove({ ...base, round: 2, vendorAsk: 85, vendorSaysFinal: true }), { action: 'walk_away', price: null, reason: 'final_ask_above_reservation' });
});

test('simulated vendor anchors high, concedes in small steps and never goes below its floor', () => {
  const policy = createVendorSim({ basisPrice: 100 });
  assert.deepEqual(policy, { simulated: true, anchor: 108, floor: 88, step: 0.15 });
  assert.ok(Object.isFrozen(policy));

  const asks = rounds(8).map((round) => vendorSimAsk(policy, round));
  assert.equal(asks[0], 108, 'opens at the anchor, above the basis price');
  for (let i = 1; i < asks.length; i++) {
    assert.ok(asks[i] < asks[i - 1], 'each ask is lower than the last');
    assert.ok(asks[i - 1] - asks[i] <= (policy.anchor - policy.floor) * policy.step + 0.01, 'no step is larger than the first');
    assert.ok(asks[i] >= policy.floor);
  }
  assert.equal(vendorSimAsk(policy, 10_000), policy.floor);
  assert.throws(() => vendorSimAsk(policy, 0), RangeError);
  assert.throws(() => createVendorSim({ basisPrice: null }), RangeError);
  assert.throws(() => createVendorSim({ basisPrice: 100, floorDiscount: 1 }), RangeError);
});

test('every simulated vendor move is labelled simulated and priced at or above the floor', () => {
  const policy = createVendorSim({ basisPrice: 100 });
  assert.deepEqual(vendorSimMove({ policy, round: 1 }), { simulated: true, action: 'counter', price: 108 });
  assert.deepEqual(vendorSimMove({ policy, round: 1, buyerOffer: 70 }), { simulated: true, action: 'counter', price: 108 });
  assert.deepEqual(vendorSimMove({ policy, round: 1, buyerOffer: 110 }), { simulated: true, action: 'accept', price: 110 });
  for (const round of rounds(50)) {
    for (const buyerOffer of [null, 1, 87.99, 88, 95, 200]) {
      const move = vendorSimMove({ policy, round, buyerOffer });
      assert.equal(move.simulated, true);
      assert.ok(move.price >= policy.floor, `round ${round}, offer ${buyerOffer}: ${move.price} is below the floor`);
    }
  }
});

/** Plays buyer curve against the simulated vendor; returns the closing move. */
function negotiate({ ownerMax, target, basisPrice, maxRounds = 6 }) {
  const policy = createVendorSim({ basisPrice });
  const reservation = reservationPrice({ ownerMax });
  const open = openingOffer({ target, reservation });
  const askHistory = [];
  for (let round = 1; round <= maxRounds; round++) {
    const ask = vendorSimAsk(policy, round);
    askHistory.push(ask);
    const buyer = buyerMove({ round, maxRounds, open, reservation, vendorAsk: ask, askHistory });
    if (buyer.action !== 'counter') return { ...buyer, round, policy, reservation };
    const vendor = vendorSimMove({ policy, round, buyerOffer: buyer.price });
    if (vendor.action === 'accept') return { action: 'accept', price: vendor.price, round, policy, reservation };
  }
  throw new Error('negotiation ran past maxRounds without closing');
}

test('buyer against simulated vendor: a deal lands between the floor and the owner maximum', () => {
  const deal = negotiate({ ownerMax: 100, target: 85, basisPrice: 100 });
  assert.equal(deal.action, 'accept');
  assert.ok(deal.price <= 100, `agreed ${deal.price} is above the owner maximum`);
  assert.ok(deal.price >= deal.policy.floor, `agreed ${deal.price} is below the vendor floor`);
});

test('buyer against simulated vendor: walks away when the floor is above the owner maximum', () => {
  const outcome = negotiate({ ownerMax: 80, target: 70, basisPrice: 100 }); // floor 88
  assert.equal(outcome.action, 'walk_away');
  assert.equal(outcome.price, null);
});

test('buyer against simulated vendor: no outcome ever commits above the owner maximum', () => {
  for (const ownerMax of [60, 85, 90, 100, 120, 400]) {
    for (const target of [null, 50, 95]) {
      for (const maxRounds of [2, 4, 6, 9]) {
        const outcome = negotiate({ ownerMax, target, basisPrice: 100, maxRounds });
        if (outcome.action === 'accept') {
          assert.ok(outcome.price <= ownerMax, `max ${ownerMax}, target ${target}, ${maxRounds} rounds: agreed ${outcome.price}`);
          assert.ok(outcome.price >= outcome.policy.floor);
        } else {
          assert.equal(outcome.action, 'walk_away');
        }
      }
    }
  }
});
