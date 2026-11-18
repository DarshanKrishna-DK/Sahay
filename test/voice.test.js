'use strict';

/**
 * public/js/voice.js is a browser ES module. Its pure helpers are tested from the real source:
 * the one import (./api.js, which needs a browser) is replaced by an empty object and the rest
 * is loaded as a data: module. Nothing at module level touches the DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadVoice() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'voice.js'), 'utf8');
  const importLine = /^import \* as api from "\.\/api\.js";$/m;
  assert.match(source, importLine, 'voice.js still imports api.js the way this test expects');
  const patched = source.replace(importLine, 'const api = {};');
  return import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
}

const turn = (role, turnNo, time, text) => ({ role, turnNo, time, text });
const texts = (turns) => turns.map((t) => t.text);

test('orderTurns: by turn id, owner before Sahay within a turn, the server-spoken disclosure first', async () => {
  const { orderTurns } = await loadVoice();
  // As the E2E run saw them: the "search done" narration listed before the "search started" reply.
  const shuffled = [
    turn('agent', 3, 1700000033000, 'खोज पूरी हुई, 10 विक्रेता मिले'),
    turn('agent', 2, 1700000033000, 'इंडियामार्ट पर खोजना शुरू कर दिया है'),
    turn('owner', 2, 1700000030000, 'मुझे 200 किलो बासमती चावल चाहिए'),
    turn('agent', 0, 1700000001000, 'नमस्ते, मैं सहाय हूँ, स्वचालित सहायक'),
    turn('owner', 1, 1700000010000, 'हाँ'),
    turn('agent', 1, 1700000011000, 'बताइए'),
  ];
  assert.deepEqual(texts(orderTurns(shuffled)), [
    'नमस्ते, मैं सहाय हूँ, स्वचालित सहायक',
    'हाँ',
    'बताइए',
    'मुझे 200 किलो बासमती चावल चाहिए',
    'इंडियामार्ट पर खोजना शुरू कर दिया है',
    'खोज पूरी हुई, 10 विक्रेता मिले',
  ]);
  assert.equal(shuffled[0].text, 'खोज पूरी हुई, 10 विक्रेता मिले', 'the input array is left alone');
});

test('orderTurns: without turn ids it orders by time, and keeps the toolkit order for equal or missing times', async () => {
  const { orderTurns } = await loadVoice();
  const turns = [
    turn('agent', null, 3000, 'third'),
    turn('owner', 7, 1000, 'first'),
    turn('agent', null, null, 'no time, after timed ones'),
    turn('agent', null, 2000, 'second'),
  ];
  assert.deepEqual(texts(orderTurns(turns)), ['first', 'second', 'third', 'no time, after timed ones']);
  assert.deepEqual(orderTurns([]), []);
  const same = [turn('agent', null, 5, 'a'), turn('agent', null, 5, 'b')];
  assert.deepEqual(texts(orderTurns(same)), ['a', 'b']);
});
