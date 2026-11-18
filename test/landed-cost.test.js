'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeLandedCost, normaliseUnit, unitRatio, UnitMismatchError } = require('../src/procurement/landed-cost');

const requirement = { quantity: 200, unit: 'kg' };

test('landed cost is goods plus freight', () => {
  const result = computeLandedCost({ unit_price: 70, unit: 'kg', freight: 500 }, requirement);
  assert.deepEqual(result, {
    landed_cost: 14500, goods_cost: 14000, freight: 500, unit_price: 70, unit: 'kg', quantity: 200, flags: [],
  });
});

test('a quoted freight of zero is a real figure, not an unknown', () => {
  const result = computeLandedCost({ unit_price: 70, unit: 'kg', freight: 0 }, requirement);
  assert.equal(result.landed_cost, 14000);
  assert.deepEqual(result.flags, []);
});

test('unknown freight gives a null landed cost and a flag, never goods + 0', () => {
  for (const freight of [null, undefined]) {
    const result = computeLandedCost({ unit_price: 70, unit: 'kg', freight }, requirement);
    assert.equal(result.landed_cost, null);
    assert.equal(result.freight, null);
    assert.equal(result.goods_cost, 14000);
    assert.deepEqual(result.flags, ['freight_unknown']);
  }
});

test('different spellings of one unit are the same unit', () => {
  const result = computeLandedCost({ unit_price: 70, unit: 'Kilogram', freight: 0 }, { quantity: 200, unit: ' KGs ' });
  assert.equal(result.landed_cost, 14000);
  assert.deepEqual(result.flags, []);
});

test('an exact metric conversion is applied and flagged', () => {
  const perTonne = computeLandedCost({ unit_price: 69000, unit: 'Tonne', freight: 1000 }, requirement);
  assert.equal(perTonne.unit_price, 69);
  assert.equal(perTonne.goods_cost, 13800);
  assert.equal(perTonne.landed_cost, 14800);
  assert.deepEqual(perTonne.flags, ['unit_converted']);

  const perKg = computeLandedCost({ unit_price: 70, unit: 'kg', freight: 0 }, { quantity: 2, unit: 'quintal' });
  assert.equal(perKg.unit_price, 7000);
  assert.equal(perKg.landed_cost, 14000);
});

test('a converted rate keeps its precision until the total', () => {
  const result = computeLandedCost({ unit_price: 51555, unit: 'tonne', freight: 0 }, requirement);
  assert.equal(result.goods_cost, 10311); // 51.555 x 200, not 51.56 x 200
  assert.equal(result.unit_price, 51.555);
});

test('units with no exact relationship throw instead of multiplying', () => {
  assert.throws(
    () => computeLandedCost({ unit_price: 1550, unit: 'Bag', freight: 0 }, requirement),
    (err) => err instanceof UnitMismatchError && err.code === 'unit_mismatch' && err.quoteUnit === 'bag' && err.requirementUnit === 'kg',
  );
  assert.throws(() => computeLandedCost({ unit_price: 90, unit: 'litre', freight: 0 }, requirement), UnitMismatchError);
  // the mismatch is reported even when other figures are missing
  assert.throws(() => computeLandedCost({ unit_price: null, unit: 'piece' }, requirement), UnitMismatchError);
});

test('a missing unit, price or quantity gives null totals and says which is missing', () => {
  const noUnit = computeLandedCost({ unit_price: 70, unit: null, freight: 0 }, requirement);
  assert.deepEqual([noUnit.landed_cost, noUnit.goods_cost, noUnit.unit_price], [null, null, null]);
  assert.deepEqual(noUnit.flags, ['unit_unknown']);

  const noPrice = computeLandedCost({ unit_price: null, unit: 'kg', freight: 300 }, requirement);
  assert.deepEqual([noPrice.landed_cost, noPrice.goods_cost], [null, null]);
  assert.deepEqual(noPrice.flags, ['price_unknown']);

  const noQuantity = computeLandedCost({ unit_price: 70, unit: 'kg', freight: 300 }, { quantity: null, unit: 'kg' });
  assert.deepEqual([noQuantity.landed_cost, noQuantity.goods_cost, noQuantity.unit_price], [null, null, 70]);
  assert.deepEqual(noQuantity.flags, ['quantity_unknown']);

  const nothing = computeLandedCost({ unit_price: null, unit: null }, { quantity: null, unit: null });
  assert.deepEqual(nothing.flags, ['unit_unknown', 'price_unknown', 'quantity_unknown', 'freight_unknown']);
});

test('corrupt figures are rejected, not treated as unknown', () => {
  const ok = { unit_price: 70, unit: 'kg', freight: 0 };
  assert.throws(() => computeLandedCost({ ...ok, freight: -1 }, requirement), TypeError);
  assert.throws(() => computeLandedCost({ ...ok, unit_price: Number.NaN }, requirement), TypeError);
  assert.throws(() => computeLandedCost({ ...ok, unit_price: '70' }, requirement), TypeError);
  assert.throws(() => computeLandedCost({ ...ok, unit_price: 0 }, requirement), TypeError);
  assert.throws(() => computeLandedCost(ok, { quantity: 0, unit: 'kg' }), TypeError);
  assert.throws(() => computeLandedCost(ok, { quantity: Infinity, unit: 'kg' }), TypeError);
});

test('totals are rounded to paise', () => {
  const result = computeLandedCost({ unit_price: 33.333, unit: 'kg', freight: 0.014 }, { quantity: 3, unit: 'kg' });
  assert.equal(result.goods_cost, 100);
  assert.equal(result.landed_cost, 100.01);
});

test('normaliseUnit maps listing spellings and keeps unknown units as written', () => {
  assert.equal(normaliseUnit('Kg'), 'kg');
  assert.equal(normaliseUnit('Kilogram'), 'kg');
  assert.equal(normaliseUnit('pcs'), 'piece');
  assert.equal(normaliseUnit('Ton'), 'tonne');
  assert.equal(normaliseUnit('Metric  Ton'), 'tonne');
  assert.equal(normaliseUnit('Packet'), 'packet');
  assert.equal(normaliseUnit('Sq Ft'), 'sq ft');
  assert.equal(normaliseUnit('  '), null);
  assert.equal(normaliseUnit(null), null);
  assert.equal(normaliseUnit(undefined), null);
});

test('unitRatio knows exact metric relationships only', () => {
  assert.equal(unitRatio('tonne', 'kg'), 1000);
  assert.equal(unitRatio('kg', 'tonne'), 0.001);
  assert.equal(unitRatio('quintal', 'kg'), 100);
  assert.equal(unitRatio('litre', 'ml'), 1000);
  assert.equal(unitRatio('Bag', 'bags'), 1);
  assert.equal(unitRatio('bag', 'kg'), null);
  assert.equal(unitRatio('kg', 'litre'), null);
  assert.equal(unitRatio(null, 'kg'), null);
  assert.equal(unitRatio('kg', undefined), null);
});
