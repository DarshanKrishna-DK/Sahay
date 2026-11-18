'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { WEIGHTS, scoreVendor, comparableListedPrice, rankVendors, rankDeals } = require('../src/procurement/scoring');
const { parseListingPage } = require('../src/discovery/indiamart');

const requirement = { quantity: 200, unit: 'kg', target_price: 100, max_price: null, city: 'Bengaluru' };
const vendor = (fields = {}) => ({
  listed_price: 100, listed_unit: 'kg', city: 'Bengaluru', phone: '+91-8000000000',
  moq: 100, moq_unit: 'kg', availability: 'In stock', ...fields,
});

test('weights are price 35, locality 25, MOQ 20, availability 10, contactability 10', () => {
  assert.deepEqual({ ...WEIGHTS }, { price: 35, locality: 25, moq: 20, availability: 10, contactability: 10 });
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b), 100);
});

test('a vendor that meets everything scores 100 with nothing assumed', () => {
  assert.deepEqual(scoreVendor(vendor(), requirement), {
    score: 100,
    breakdown: { price: 1, locality: 1, moq: 1, availability: 1, contactability: 1 },
    assumed: {},
    flags: [],
  });
});

test('price: full at or under target, zero from 30% over, linear between', () => {
  const price = (listed) => scoreVendor(vendor({ listed_price: listed }), requirement).breakdown.price;
  assert.equal(price(80), 1);
  assert.equal(price(100), 1);
  assert.equal(price(115), 0.5);
  assert.equal(price(130), 0);
  assert.equal(price(500), 0);
});

test('price: falls back to the owner maximum when there is no target', () => {
  const result = scoreVendor(vendor({ listed_price: 115 }), { ...requirement, target_price: null, max_price: 100 });
  assert.equal(result.breakdown.price, 0.5);
  assert.equal(result.assumed.price, undefined);
});

test('price: every unknown is named; an unknown price scores low, never neutral', () => {
  const unpriced = scoreVendor(vendor({ listed_price: null, listed_unit: null }), requirement);
  assert.equal(unpriced.breakdown.price, 0.15);
  assert.equal(unpriced.assumed.price, 'price_not_listed');

  const noReference = scoreVendor(vendor(), { ...requirement, target_price: null });
  assert.equal(noReference.breakdown.price, 0.6);
  assert.equal(noReference.assumed.price, 'no_price_to_compare_against');

  // Rs 60 per bag against a per-kg target: the bag size is not stated, so the price per kg is unknown
  const perBag = scoreVendor(vendor({ listed_price: 60, listed_unit: 'bag' }), requirement);
  assert.equal(perBag.breakdown.price, 0.15);
  assert.equal(perBag.assumed.price, 'listed_unit_not_comparable');
  assert.ok(perBag.flags.includes('price_not_comparable'));

  // not comparable is unknown even when there is no owner price to compare against
  const perBagNoReference = scoreVendor(vendor({ listed_price: 60, listed_unit: 'bag' }), { ...requirement, target_price: null });
  assert.equal(perBagNoReference.breakdown.price, 0.15);
  assert.ok(perBagNoReference.flags.includes('price_not_comparable'));

  const noUnit = scoreVendor(vendor({ listed_price: 60, listed_unit: null }), requirement);
  assert.equal(noUnit.assumed.price, 'listed_unit_not_comparable');
  assert.equal(noUnit.breakdown.price, 0.15);
});

test('regression (E2E 2026-11-19): a Rs 25,000/Bag listing is never ranked above per-kg listings', () => {
  // The QA run: 200 kilos of basmati, max Rs 90/kg; listings as IndiaMART showed them.
  const need = { quantity: 200, unit: 'kg', target_price: null, max_price: 90, city: 'Bengaluru' };
  const listing = (name, listed_price, listed_unit, extra = {}) => ({ name, listed_price, listed_unit, city: 'Bengaluru', phone: '+91-8000000000', moq: null, availability: null, ...extra });
  const listings = [
    listing('3comma Labs Private Limited', 25000, 'Bag'),
    listing('Babu Trading Co.', 100, 'Kg'),
    listing('Mahammed Ismail Sait', 175, 'Bag'),
    listing('Srinidhi Foods', 120, 'Kg'),
    listing('BS Foods', 60, 'Kg'),
    listing('Mithuna Foods', 92, 'Kg'),
  ];
  const scored = listings.map((v) => ({ ...v, ...scoreVendor(v, need) }));
  const ranked = rankVendors(scored, need).map((v) => v.name);
  for (const bag of ['3comma Labs Private Limited', 'Mahammed Ismail Sait']) {
    assert.ok(ranked.indexOf(bag) > ranked.indexOf('BS Foods'), `${bag} below the cheapest per-kg listing`);
    assert.ok(ranked.indexOf(bag) > ranked.indexOf('Babu Trading Co.'), `${bag} below a per-kg listing near the maximum`);
  }
  assert.equal(ranked[0], 'BS Foods');

  // the same requirement saved with a Hindi unit compares exactly the same
  const hindi = { ...need, unit: 'किलो' };
  assert.deepEqual(rankVendors(listings.map((v) => ({ ...v, ...scoreVendor(v, hindi) })), hindi).map((v) => v.name), ranked);
});

test('rankVendors breaks a score tie by comparable price, then by rating count, and keeps found order last', () => {
  const need = { unit: 'kg' };
  const vendors = [
    { name: 'bag, unknown size', score: 71.5, listed_price: 25000, listed_unit: 'bag', rating_count: 900 },
    { name: 'per kg 100', score: 71.5, listed_price: 100, listed_unit: 'kg', rating_count: 3 },
    { name: 'per tonne = 80/kg', score: 71.5, listed_price: 80000, listed_unit: 'tonne', rating_count: 1 },
    { name: 'per kg 100, more ratings', score: 71.5, listed_price: 100, listed_unit: 'kg', rating_count: 40 },
    { name: 'higher score', score: 72, listed_price: null, listed_unit: null, rating_count: null },
  ];
  assert.deepEqual(rankVendors(vendors, need).map((v) => v.name), [
    'higher score', 'per tonne = 80/kg', 'per kg 100, more ratings', 'per kg 100', 'bag, unknown size',
  ]);
  assert.equal(vendors[0].name, 'bag, unknown size', 'input left alone');
});

test('price: metric units are converted; a per-bag price only through the stated pack size', () => {
  assert.deepEqual(comparableListedPrice({ listed_price: 95000, listed_unit: 'tonne' }, 'kg'), { value: 95, basis: 'unit_converted' });
  assert.equal(scoreVendor(vendor({ listed_price: 115000, listed_unit: 'Tonne' }), requirement).breakdown.price, 0.5);

  const bagged = { listed_price: 1550, listed_unit: 'bag', pack_size: { value: 25, unit: 'kg', text: '25 kg' } };
  assert.deepEqual(comparableListedPrice(bagged, 'kg'), { value: 62, basis: 'pack_size' });
  assert.equal(comparableListedPrice({ ...bagged, pack_size: null }, 'kg'), null);
  assert.equal(comparableListedPrice({ listed_price: 1550, listed_unit: 'bag' }, 'bag').basis, 'listed');
  assert.equal(comparableListedPrice({ listed_price: null, listed_unit: 'kg' }, 'kg'), null);
  // a pack size is no help for a unit that is not a container
  assert.equal(comparableListedPrice({ listed_price: 40, listed_unit: 'piece', pack_size: { value: 1, unit: 'kg' } }, 'kg'), null);
});

test('locality: same city under either name, serves-the-city, elsewhere, unknown', () => {
  const locality = (fields, city = 'Bangalore') => scoreVendor(vendor(fields), { ...requirement, city });
  assert.equal(locality({ city: 'Bengaluru' }).breakdown.locality, 1);

  const serves = locality({ city: null, serves_city: 'Bengaluru' });
  assert.equal(serves.breakdown.locality, 0.7);
  assert.deepEqual(serves.flags, ['delivers_to_city']);
  assert.equal(serves.assumed.locality, undefined);

  assert.equal(locality({ city: 'Karnal' }).breakdown.locality, 0.35);
  assert.equal(locality({ city: 'Karnal', serves_city: 'Bengaluru' }).breakdown.locality, 0.35, 'a stated base city outranks "serves"');
  assert.equal(locality({ city: null, serves_city: 'Mysuru' }).assumed.locality, 'city_unknown');

  const unknownVendorCity = locality({ city: null });
  assert.equal(unknownVendorCity.breakdown.locality, 0.4);
  assert.equal(unknownVendorCity.assumed.locality, 'city_unknown');
  assert.equal(locality({ city: 'Bengaluru' }, null).assumed.locality, 'city_unknown');
});

test('MOQ: feasible, negotiable, infeasible, and each unknown named', () => {
  const moq = (fields, req = requirement) => scoreVendor(vendor(fields), req);
  assert.equal(moq({ moq: 200 }).breakdown.moq, 1);
  assert.equal(moq({ moq: 300 }).breakdown.moq, 0.4);

  const tooBig = moq({ moq: 301 });
  assert.equal(tooBig.breakdown.moq, 0);
  assert.deepEqual(tooBig.flags, ['moq_exceeds_quantity']);

  assert.equal(moq({ moq: 1, moq_unit: 'tonne' }).breakdown.moq, 0, '1 tonne is 1000 kg, above 200 kg');
  assert.equal(moq({ moq: 1, moq_unit: 'quintal' }).breakdown.moq, 1);

  const notStated = moq({ moq: null });
  assert.equal(notStated.breakdown.moq, 0.6);
  assert.equal(notStated.assumed.moq, 'moq_not_stated');
  assert.equal(moq({ moq: 5 }, { ...requirement, quantity: null }).assumed.moq, 'quantity_not_set');
  assert.equal(moq({ moq: 5, moq_unit: 'bag' }).assumed.moq, 'moq_unit_not_comparable');
  assert.equal(moq({ moq: 5, moq_unit: null, listed_unit: null, listed_price: null }).assumed.moq, 'moq_unit_not_comparable');
});

test('availability and contactability', () => {
  assert.equal(scoreVendor(vendor({ availability: 'Made to order' }), requirement).breakdown.availability, 0.6);
  const silent = scoreVendor(vendor({ availability: null, phone: null }), requirement);
  assert.equal(silent.breakdown.availability, 0.35);
  assert.equal(silent.assumed.availability, 'availability_not_stated');
  assert.equal(silent.breakdown.contactability, 0.2);
  assert.deepEqual(silent.flags, ['no_phone']);
});

test('a vendor with every field null still scores, with every assumption listed', () => {
  const empty = { listed_price: null, listed_unit: null, city: null, phone: null, moq: null, availability: null };
  assert.deepEqual(scoreVendor(empty, requirement), {
    score: 32.75, // 0.15*35 + 0.4*25 + 0.6*20 + 0.35*10 + 0.2*10
    breakdown: { price: 0.15, locality: 0.4, moq: 0.6, availability: 0.35, contactability: 0.2 },
    assumed: { price: 'price_not_listed', locality: 'city_unknown', moq: 'moq_not_stated', availability: 'availability_not_stated' },
    flags: ['no_phone'],
  });
});

test('scores a vendor read from the recorded IndiaMART page', () => {
  // Recorded real page (see test/indiamart.test.js), not invented data.
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'indiamart-bengaluru-basmati-rice.html'), 'utf8');
  const { vendors } = parseListingPage(html, 'https://dir.indiamart.com/bengaluru/basmati-rice.html');
  const listed = vendors.find((v) => v.listed_price === 100 && v.listed_unit === 'kg' && v.city === 'Bengaluru' && v.phone);
  assert.ok(listed, 'the recorded page has a Bengaluru seller listed at Rs 100/kg');

  const result = scoreVendor(listed, { ...requirement, city: 'Bangalore' });
  assert.equal(result.score, 85.5); // 35 + 25 + 0.6*20 + 0.35*10 + 10: IndiaMART states no MOQ or stock
  assert.deepEqual(result.assumed, { moq: 'moq_not_stated', availability: 'availability_not_stated' });

  // a seller the page lists as serving Bengaluru from elsewhere, at Rs 60/kg against a Rs 100 target
  const serving = vendors.find((v) => v.serves_city === 'Bengaluru' && v.listed_price === 60);
  assert.ok(serving, 'the recorded page has a "Deals in Bengaluru" seller listed at Rs 60/kg');
  const servingResult = scoreVendor(serving, { ...requirement, city: 'Bangalore' });
  assert.equal(servingResult.score, 78); // 35 + 0.7*25 + 0.6*20 + 0.35*10 + 10
  assert.deepEqual(servingResult.flags, ['delivers_to_city']);
});

/* ------------------------------------------------------------------ rankDeals --- */

const quote = (id, fields = {}) => ({
  id, vendor_id: `v_${id}`, unit_price: 70, unit: 'kg', freight: 0, moq: null, lead_time_days: null, confidence: 0.9, simulated: false, ...fields,
});
const order = (deals) => deals.map((d) => d.id);

test('rankDeals orders by landed cost, not by headline rate', () => {
  const deals = rankDeals([
    quote('cheap_rate_far', { unit_price: 68, freight: 1200 }), // 14,800 landed
    quote('dearer_rate_near', { unit_price: 71, freight: 100 }), // 14,300 landed
  ], requirement);
  assert.deepEqual(order(deals), ['dearer_rate_near', 'cheap_rate_far']);
  assert.deepEqual(deals.map((d) => d.rank), [1, 2]);
  assert.deepEqual(deals.map((d) => d.landed_cost), [14300, 14800]);
  assert.equal(deals[0].reason, 'Lowest landed cost: landed ₹14,300 (₹71/kg x 200 kg + ₹100 freight).');
  assert.equal(deals[1].reason, '₹500 more than the best deal: landed ₹14,800 (₹68/kg x 200 kg + ₹1,200 freight).');
});

test('rankDeals never treats unknown freight as zero', () => {
  const deals = rankDeals([
    quote('no_freight_quoted', { unit_price: 60, freight: null }), // goods 12,000, landed unknown
    quote('fully_costed', { unit_price: 70, freight: 500 }),
  ], requirement);
  assert.deepEqual(order(deals), ['fully_costed', 'no_freight_quoted']);
  assert.equal(deals[1].landed_cost, null);
  assert.equal(deals[1].goods_cost, 12000);
  assert.equal(deals[1].status, 'freight_unknown');
  assert.ok(deals[1].flags.includes('freight_unknown'));
  assert.equal(deals[1].reason, 'Freight not quoted, so landed cost is unknown: goods alone ₹12,000 (₹60/kg x 200 kg).');
});

test('rankDeals demotes quotes that break a policy below every clean quote', () => {
  const now = new Date('2026-11-19T06:00:00Z');
  const deals = rankDeals([
    quote('over_max', { unit_price: 50, moq: null }),
    quote('moq_too_big', { unit_price: 40, moq: 500 }),
    quote('too_slow', { unit_price: 41, lead_time_days: 10 }),
    quote('clean', { unit_price: 45, lead_time_days: 2 }),
    quote('clean_no_freight', { unit_price: 44, freight: null }),
  ], { ...requirement, max_price: 48, delivery_by: '2026-11-22' }, { now });

  assert.deepEqual(order(deals), ['clean', 'clean_no_freight', 'moq_too_big', 'too_slow', 'over_max']);
  assert.deepEqual(deals.map((d) => d.status), ['ranked', 'freight_unknown', 'demoted', 'demoted', 'demoted']);
  assert.equal(deals[2].reason, 'Demoted: minimum order 500 kg is above your 200 kg; landed ₹8,000 (₹40/kg x 200 kg + no freight charge).');
  assert.equal(deals[3].reason, 'Demoted: 10 days lead time misses delivery by 2026-11-22; landed ₹8,200 (₹41/kg x 200 kg + no freight charge).');
  assert.equal(deals[4].reason, 'Demoted: ₹50/kg is above your maximum of ₹48/kg; landed ₹10,000 (₹50/kg x 200 kg + no freight charge).');
});

test('rankDeals: lead time is judged against the delivery date from "now"', () => {
  const now = new Date('2026-11-19T06:00:00Z');
  const req = { ...requirement, delivery_by: '2026-11-22' };
  const flagsFor = (days) => rankDeals([quote('q', { lead_time_days: days })], req, { now })[0].flags;
  assert.deepEqual(flagsFor(3), []); // arrives on the 22nd
  assert.deepEqual(flagsFor(4), ['misses_delivery_date']);
  assert.throws(() => rankDeals([quote('q', { lead_time_days: 1 })], { ...requirement, delivery_by: 'soon' }, { now }), TypeError);
});

test('rankDeals keeps a quote it cannot cost, last, and says why', () => {
  const deals = rankDeals([
    quote('per_bag', { unit_price: 1500, unit: 'bag' }),
    quote('no_rate', { unit_price: null }),
    quote('no_unit', { unit: null }),
    quote('costed'),
  ], requirement);
  assert.equal(deals.length, 4, 'no quote is dropped');
  assert.equal(deals[0].id, 'costed');
  assert.deepEqual(deals.slice(1).map((d) => d.status), ['unrankable', 'unrankable', 'unrankable']);
  const reason = Object.fromEntries(deals.map((d) => [d.id, d.reason]));
  assert.equal(reason.per_bag, 'Cannot be compared: quoted per bag but you asked in kg.');
  assert.equal(reason.no_rate, 'Cannot be compared: no rate was quoted.');
  assert.equal(reason.no_unit, 'Cannot be compared: the unit of the rate was not stated.');
  assert.ok(deals.find((d) => d.id === 'per_bag').flags.includes('unit_mismatch'));
});

test('rankDeals without a quantity still orders by comparable unit price', () => {
  const deals = rankDeals([quote('b', { unit_price: 72 }), quote('a', { unit_price: 69000, unit: 'tonne' })], { ...requirement, quantity: null });
  assert.deepEqual(order(deals), ['a', 'b']);
  assert.equal(deals[0].reason, 'Cannot be compared: the quantity is not set.');
});

test('rankDeals converts a per-tonne rate and shows the rate as quoted', () => {
  const deals = rankDeals([quote('per_tonne', { unit_price: 69000, unit: 'Tonne', freight: 400 }), quote('per_kg', { unit_price: 70 })], requirement);
  assert.deepEqual(order(deals), ['per_kg', 'per_tonne']);
  assert.equal(deals[1].comparable_unit_price, 69);
  assert.equal(deals[1].reason, '₹200 more than the best deal: landed ₹14,200 (₹69/kg x 200 kg + ₹400 freight, quoted as ₹69,000 per tonne).');
});

test('rankDeals labels a simulated vendor in the record and in the reason', () => {
  const deals = rankDeals([quote('sim', { unit_price: 60, simulated: 1 }), quote('real', { simulated: 0 })], requirement);
  assert.equal(deals[0].simulated, true);
  assert.match(deals[0].reason, /^Simulated vendor\. Lowest landed cost: /);
  assert.equal(deals[1].simulated, false);
  assert.doesNotMatch(deals[1].reason, /simulated/i);
});

test('rankDeals refuses a quote that does not say whether its vendor is simulated', () => {
  const unlabelled = quote('q7');
  delete unlabelled.simulated;
  assert.throws(() => rankDeals([unlabelled], requirement), /quote q7 does not say whether its vendor is simulated/);
  assert.throws(() => rankDeals([quote('q8', { simulated: 'no' })], requirement), TypeError);
});

test('rankDeals: ties fall to shorter lead time, then higher confidence, then id', () => {
  const deals = rankDeals([
    quote('d', { lead_time_days: null, confidence: null }),
    quote('c', { lead_time_days: 5, confidence: 0.5 }),
    quote('b', { lead_time_days: 5, confidence: 0.9 }),
    quote('a', { lead_time_days: 2, confidence: 0.1 }),
    quote('e', { lead_time_days: null, confidence: null }),
  ], requirement);
  assert.deepEqual(order(deals), ['a', 'b', 'c', 'd', 'e']);
  assert.match(deals[1].reason, /^Same landed cost as the best deal: /);
});

test('rankDeals recomputes landed cost, gives one-line reasons, and leaves its input alone', () => {
  const stale = quote('stale', { unit_price: 70, freight: 500, landed_cost: 1 });
  const input = [stale];
  const deals = rankDeals(input, requirement);
  assert.equal(deals[0].landed_cost, 14500);
  assert.equal(stale.landed_cost, 1);
  assert.equal(stale.rank, undefined);
  for (const deal of deals) assert.doesNotMatch(deal.reason, /\n/);
  assert.deepEqual(rankDeals([], requirement), []);
  assert.throws(() => rankDeals(null, requirement), TypeError);
});

test('rankDeals rejects corrupt figures rather than ranking them', () => {
  assert.throws(() => rankDeals([quote('q', { freight: -5 })], requirement), TypeError);
});
