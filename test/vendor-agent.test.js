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
  const turn = (round, buyerOffer = null) => vendorAgent.vendorTurn({ policy, round, buyerOffer, language: "hi-IN", unitSpoken: "किलो", scope: "neg_t1" });
  const opens = vendorAgent.VENDOR_LINES.open["hi-IN"].map((line) => line({ price: "65", unit: "किलो" }));

  const first = turn(1);
  assert.deepEqual({ ...first, text: undefined }, { action: "counter", price: 65, final: false, text: undefined });
  assert.ok(opens.includes(first.text), first.text);
  for (const round of [2, 3, 4]) {
    const t = turn(round, 40);
    assert.equal(t.final, false, `round ${round} is not final`);
    assert.doesNotMatch(t.text, /आख़िरी|अंतिम/, "an earlier ask is never called final");
  }
  const last = turn(5, 40);
  assert.equal(last.final, true);
  assert.equal(last.price, policy.floor);
  assert.match(last.text, /आख़िरी भाव/);
  const accepted = turn(4, 55);
  assert.deepEqual({ ...accepted, text: undefined }, { action: "accept", price: 55, final: false, text: undefined });
  assert.match(accepted.text, /55 रुपये प्रति किलो/);
  assert.match(vendorAgent.vendorTurn({ policy, round: 1, buyerOffer: null, language: "en-IN", unitSpoken: "kilogram" }).text, /65 rupees per kilogram/);
});

test("Track POLISH: the simulated vendor bargains like a wholesaler in varied lines, with only its own price in them and in its own script", () => {
  const { isNativeScript } = require("../src/agora/script");
  for (const [key, byLanguage] of Object.entries(vendorAgent.VENDOR_LINES)) {
    for (const [language, lines] of Object.entries(byLanguage)) {
      assert.ok(lines.length >= 2, `${key} ${language} has several phrasings`);
      for (const line of lines) {
        const text = line({ price: "57", unit: language === "en-IN" ? "kilogram" : language === "kn-IN" ? "ಕೆಜಿ" : "किलो" });
        assert.deepEqual(text.match(/\d+/g), ["57"], `${key} ${language}: only the price is a number: ${text}`);
        if (language !== "en-IN") assert.ok(isNativeScript(text, language), text);
        const callsFinal = /आख़िरी|ಕೊನೆಯ|final|last price/i.test(text);
        assert.equal(callsFinal, key === "final", `${key} ${language}: "final" only in final lines: ${text}`);
      }
    }
  }
  // Five rounds of one negotiation do not repeat the same sentence shape twice in a row.
  const policy = vendorAgent.vendorPolicy(60);
  const texts = [1, 2, 3, 4].map((round) => vendorAgent.vendorTurn({ policy, round, buyerOffer: 40, language: "hi-IN", unitSpoken: "किलो", scope: "neg_vary" }).text);
  for (let i = 2; i < texts.length; i++) assert.notEqual(texts[i].replace(/\d+/g, "#"), texts[i - 1].replace(/\d+/g, "#"));
  const prompt = vendorAgent.vendorPrompt({ language: "hi-IN", item: "rice", quantity: 100, unit: "kg", unitSpoken: "किलो", schedule: [65, 61, 57, 55, 54], floor: 54 });
  assert.match(prompt, /wholesale trader/);
  assert.match(prompt, /SIMULATED vendor/);
});
