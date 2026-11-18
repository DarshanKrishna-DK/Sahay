'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalUnit, normaliseUnit, sameUnit, unitRatio, unitWord, UNIT_CODES } = require('../src/procurement/units');

test('Hindi, Kannada and English spellings of a unit map to one canonical code', () => {
  const cases = {
    kg: ['kg', 'KG', 'Kgs', 'kilo', 'kilos', 'Kilogram', 'kilo grams', 'किलो', 'किलोग्राम', 'ಕಿಲೋ', 'ಕೆಜಿ', 'per kg', 'प्रति किलो', '/kg', 'kg.', 'किलो।'],
    piece: ['piece', 'Pieces', 'pcs', 'pc', 'nos', 'पीस', 'नग', 'ಪೀಸ್'],
    quintal: ['quintal', 'qtl', 'क्विंटल', 'ಕ್ವಿಂಟಾಲ್'],
    tonne: ['ton', 'Tonnes', 'MT', 'metric  ton', 'टन', 'ಟನ್'],
    litre: ['litre', 'liter', 'ltr', 'l', 'लीटर', 'ಲೀಟರ್'],
    g: ['g', 'gm', 'gram', 'ग्राम', 'ಗ್ರಾಂ'],
    bag: ['bag', 'Bags', 'बोरी', 'बैग', 'ಚೀಲ'],
    box: ['box', 'boxes', 'डिब्बा', 'ಬಾಕ್ಸ್'],
    dozen: ['dozen', 'दर्जन', 'ಡಜನ್'],
    metre: ['metre', 'meter', 'मीटर', 'ಮೀಟರ್'],
  };
  for (const [code, spellings] of Object.entries(cases)) {
    assert.ok(UNIT_CODES.includes(code), code);
    for (const spelling of spellings) assert.equal(canonicalUnit(spelling), code, `${spelling} -> ${code}`);
  }
});

test('zero-width joiners and decomposed text do not hide a known unit', () => {
  assert.equal(canonicalUnit('ಪೀಸ್‌ಗಳು'), 'piece');
  assert.equal(canonicalUnit('किलो'.normalize('NFD')), 'kg');
});

test('canonicalUnit refuses to guess: unknown or empty units are null', () => {
  for (const unknown of ['handful', 'sq ft', 'kilometre', 'किलोमीटर', 'ಗಾಡಿ', 'kgx', '', '   ', null, undefined]) {
    assert.equal(canonicalUnit(unknown), null, String(unknown));
  }
});

test('normaliseUnit keeps an unknown unit as written so equal unknowns still compare', () => {
  assert.equal(normaliseUnit('किलो'), 'kg');
  assert.equal(normaliseUnit('Sq Ft'), 'sq ft');
  assert.equal(normaliseUnit('  '), null);
  assert.ok(sameUnit('Sq Ft', 'sq  ft'));
  assert.ok(sameUnit('kg', 'किलो'));
  assert.ok(sameUnit('pieces', 'ಪೀಸ್'));
  assert.ok(!sameUnit('kg', 'bag'));
  assert.ok(!sameUnit(null, null), 'two missing units are not the same unit');
});

test('unitRatio converts exact metric relationships across spellings, nothing else', () => {
  assert.equal(unitRatio('टन', 'किलो'), 1000);
  assert.equal(unitRatio('Kg', 'kilos'), 1);
  assert.equal(unitRatio('क्विंटल', 'kg'), 100);
  assert.equal(unitRatio('bag', 'kg'), null);
  assert.equal(unitRatio('piece', 'dozen'), null);
  assert.equal(unitRatio('kg', 'litre'), null);
});

test('unitWord says a unit in the requested language and script', () => {
  assert.equal(unitWord('kg', 'hi-IN'), 'किलो');
  assert.equal(unitWord('kilos', 'kn-IN'), 'ಕೆಜಿ');
  assert.equal(unitWord('किलो', 'en-IN', true), 'kilograms');
  assert.equal(unitWord('kg', 'en', true, { short: true }), 'kg');
  assert.equal(unitWord('piece', 'en-IN', false), 'piece');
  assert.equal(unitWord('box', 'en-IN', true), 'boxes');
  assert.equal(unitWord('furlong', 'hi-IN'), 'furlong', 'an unknown unit is said as written');
  assert.equal(unitWord(null, 'hi-IN'), '');
});
