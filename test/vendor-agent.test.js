"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const vendorAgent = require("../src/negotiation/vendor-agent");

test("vendor policy follows the negotiation's round count and its schedule ends at the floor", () => {
  const policy = vendorAgent.vendorPolicy(60);
  assert.equal(policy.simulated, true);
  assert.equal(policy.maxRounds, vendorAgent.DEFAULT_MAX_ROUNDS);
  assert.deepEqual(vendorAgent.askSchedule(policy), [65, 61, 57, 55, 54]);
  const short = vendorAgent.vendorPolicy(60, 3);
  assert.equal(vendorAgent.askSchedule(short).length, 3);
  assert.equal(vendorAgent.askSchedule(short).at(-1), short.floor);
});

test("vendor prompt carries the computed schedule and floor, forbids other numbers, and keeps 'final' for the last price only", () => {
  const policy = vendorAgent.vendorPolicy(65);
  const schedule = vendorAgent.askSchedule(policy);
  assert.equal(schedule[0], policy.anchor);
  assert.ok(schedule.every((p, i) => i === 0 || p <= schedule[i - 1]));
  const prompt = vendorAgent.vendorPrompt({ language: "hi-IN", item: "rice", quantity: 100, unit: "kg", unitSpoken: "किलो", schedule, floor: policy.floor });
  assert.match(prompt, /SIMULATED vendor/);
  assert.ok(prompt.includes(`round 1: ${schedule[0]} rupees per kg`));
  assert.ok(prompt.includes(`${policy.floor}`));
  assert.match(prompt, /Never mention any other number/);
  assert.match(prompt, new RegExp(`Only the round ${schedule.length} price \\(${schedule.at(-1)} rupees\\) is your final price`));
  assert.match(prompt, /Never call any earlier price final/);
  assert.match(prompt, /If the buyer offers at least the next price in the list \(or your current ask\), accept the buyer's offer/, "same accept rule as the loop's vendorSimMove");
  assert.doesNotMatch(prompt, /When you reach the last price in the list, say it is your final price/);
  assert.match(vendorAgent.introText("kn-IN"), /ಸಿಮ್ಯುಲೇಟೆಡ್/);
  assert.match(vendorAgent.introText("xx"), /सिम्युलेटेड विक्रेता/);
});

test("vendor turn: only the last scheduled ask is final, and an offer at or above the ask is accepted", () => {
  const policy = vendorAgent.vendorPolicy(60);
  const turn = (round, buyerOffer = null) => vendorAgent.vendorTurn({ policy, round, buyerOffer, language: "hi-IN", unitSpoken: "किलो" });

  assert.deepEqual(turn(1), { action: "counter", price: 65, final: false, text: "65 रुपये प्रति किलो लगेगा।" });
  for (const round of [2, 3, 4]) assert.equal(turn(round, 40).final, false, `round ${round} is not final`);
  const last = turn(5, 40);
  assert.equal(last.final, true);
  assert.equal(last.price, policy.floor);
  assert.match(last.text, /आख़िरी भाव/);
  assert.deepEqual(turn(4, 55), { action: "accept", price: 55, final: false, text: "ठीक है, 55 रुपये प्रति किलो में दे देंगे।" });
  assert.equal(vendorAgent.vendorTurn({ policy, round: 1, buyerOffer: null, language: "en-IN", unitSpoken: "kilogram" }).text, "It will be 65 rupees per kilogram.");
});
