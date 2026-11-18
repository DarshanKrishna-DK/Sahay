'use strict';

/**
 * Landed cost: what the order actually costs the owner (goods plus freight), and the unit
 * handling every money comparison depends on.
 *
 * Units come from ./units (the one unit table); normaliseUnit and unitRatio are re-exported
 * for the modules that already import them from here.
 *
 * Nothing here guesses. An unknown figure produces a null total and a flag naming what is
 * missing; units that cannot be reconciled exactly throw.
 */

const { normaliseUnit, unitRatio } = require('./units');

class UnitMismatchError extends Error {
  constructor(quoteUnit, requirementUnit) {
    super(`Rate is per ${quoteUnit} but the requirement is in ${requirementUnit}; these cannot be converted exactly`);
    this.name = 'UnitMismatchError';
    this.code = 'unit_mismatch';
    this.quoteUnit = quoteUnit;
    this.requirementUnit = requirementUnit;
  }
}

const round2 = (n) => Number(n.toFixed(2));

/** Null stays null (unknown); anything else must be a real number in range, or the data is corrupt. */
function knownNumber(value, name, { allowZero }) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (value === 0 && !allowZero)) {
    throw new TypeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} number or null, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {{unit_price: number|null, unit: string|null, freight?: number|null}} quote
 * @param {{quantity: number|null, unit: string|null}} requirement
 * @returns {{landed_cost: number|null, goods_cost: number|null, freight: number|null,
 *   unit_price: number|null, unit: string|null, quantity: number|null, flags: string[]}}
 *   `unit_price` is per requirement unit. `landed_cost` is null whenever any input is unknown;
 *   `flags` says which: price_unknown, quantity_unknown, unit_unknown, freight_unknown.
 *   `unit_converted` marks an exact metric conversion (a per-tonne rate against a kg requirement).
 * @throws {UnitMismatchError} when the two units have no exact relationship (bag against kg).
 */
function computeLandedCost(quote, requirement) {
  const quotedPrice = knownNumber(quote.unit_price, 'quote.unit_price', { allowZero: false });
  const freight = knownNumber(quote.freight, 'quote.freight', { allowZero: true });
  const quantity = knownNumber(requirement.quantity, 'requirement.quantity', { allowZero: false });
  const quoteUnit = normaliseUnit(quote.unit);
  const unit = normaliseUnit(requirement.unit);
  const flags = [];

  // Kept unrounded until the total, so a per-tonne rate does not lose paise when spread over kg.
  let unitPrice = null;
  if (!quoteUnit || !unit) {
    flags.push('unit_unknown');
  } else {
    const ratio = unitRatio(quoteUnit, unit);
    if (ratio == null) throw new UnitMismatchError(quoteUnit, unit);
    if (ratio !== 1) flags.push('unit_converted');
    if (quotedPrice != null) unitPrice = quotedPrice / ratio;
  }
  if (quotedPrice == null) flags.push('price_unknown');
  if (quantity == null) flags.push('quantity_unknown');
  if (freight == null) flags.push('freight_unknown');

  const goodsCost = unitPrice != null && quantity != null ? round2(unitPrice * quantity) : null;
  const landedCost = goodsCost != null && freight != null ? round2(goodsCost + freight) : null;
  return {
    landed_cost: landedCost,
    goods_cost: goodsCost,
    freight,
    unit_price: unitPrice == null ? null : Number(unitPrice.toFixed(4)),
    unit,
    quantity,
    flags,
  };
}

module.exports = { computeLandedCost, normaliseUnit, unitRatio, UnitMismatchError };
