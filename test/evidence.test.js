"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { notHeard, ownerTurns, numberHeard, unitHeard, itemHeard } = require("../src/tools/evidence");

const asr = (content, turn_id) => ({ role: "user", content, metadata: { source: "asr" }, turn_id });
const said = (content, turn_id) => ({ role: "assistant", content, metadata: { source: "llm" }, turn_id });

test("ownerTurns keeps the owner's last ASR turns, newest last, and nothing the agent said", () => {
  const contents = [asr("पहला", 1), said("ठीक है", 2), asr("दूसरा", 3), said("जी", 4), asr("तीसरा", 5), { role: "user", content: "", metadata: { source: "asr" } }];
  assert.deepEqual(ownerTurns(contents, 2), ["दूसरा", "तीसरा"]);
  assert.deepEqual(ownerTurns(null, 2), []);
});

test("ownerTurns counts a typed owner message (source message) as the owner's words, never an agent line or a command", () => {
  const typed = (content, turn_id) => ({ role: "user", content, metadata: { source: "message" }, turn_id });
  const contents = [asr("नमस्ते", 1), said("बताइए", 2), typed("मुझे 50 किलो चीनी चाहिए, बेंगलुरु", 3), { role: "user", content: "x", metadata: { source: "command" } }];
  assert.deepEqual(ownerTurns(contents, 2), ["नमस्ते", "मुझे 50 किलो चीनी चाहिए, बेंगलुरु"]);
  assert.deepEqual(notHeard(ownerTurns(contents), { item: "चीनी", quantity: 50, unit: "kg" }), [], "a typed need is borne out by the typed words (final-2 E)");
});

test("numberHeard: digits in any script must equal the quantity; number words in hi, kn and en count", () => {
  assert.equal(numberHeard("200 किलो", 200), true);
  assert.equal(numberHeard("२०० किलो", 200), true);
  assert.equal(numberHeard("೨೦೦ ಕಿಲೋ", 200), true);
  assert.equal(numberHeard("2,000 kg", 2000), true);
  assert.equal(numberHeard("200kg", 200), true);
  assert.equal(numberHeard("200 किलो", 2000), false, "a different number in digits is not this quantity");
  assert.equal(numberHeard("दो सौ किलो", 200), true);
  assert.equal(numberHeard("मुझे पांच", 5), true);
  assert.equal(numberHeard("ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ", 200), true);
  assert.equal(numberHeard("ಇಪ್ಪತ್ತೈದು ಚೀಲ", 25), true);
  assert.equal(numberHeard("two hundred kilos", 200), true);
  assert.equal(numberHeard("बासमती चावल चाहिए", 200), false);
});

test("unitHeard: the unit's own spellings, also inside a Kannada word or glued to digits", () => {
  assert.equal(unitHeard("दो सौ किलो बासमती", "kg"), true);
  assert.equal(unitHeard("ಇನ್ನೂರು ಕಿಲೋಗೆ", "kg"), true);
  assert.equal(unitHeard("200kg rice", "kg"), true);
  assert.equal(unitHeard("five bags", "bag"), true);
  assert.equal(unitHeard("मुझे पांच", "kg"), false);
  assert.equal(unitHeard("maida", "metre"), false, "a Latin word is never cut down to a unit");
});

test("itemHeard: a word of the item, in its own script or translated by the trade-word table", () => {
  assert.equal(itemHeard(["मुझे दो सौ किलो बासमती चावल चाहिए"], "बासमती चावल"), true);
  assert.equal(itemHeard(["ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿಯನ್ನು ಬೇಕು"], "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ"), true);
  assert.equal(itemHeard(["मुझे बासमती राइस चाहिए"], "basmati rice"), true, "code-mixed ASR in Devanagari, item in English");
  assert.equal(itemHeard(["मुझे चीनी चाहिए"], "basmati rice"), false);
  assert.equal(itemHeard(["मुझे ज़ज़क्स चाहिए"], "zzqx widget"), true, "an item that cannot be compared across scripts is not refused");
});

test("E2E r4 bug 4: 'मुझे पांच' cannot become a new requirement of 5 kg basmati rice", () => {
  const turns = ["मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में", "मुझे पांच"];
  assert.deepEqual(notHeard(turns, { item: "basmati rice", quantity: 5, unit: "kg" }), ["quantity", "unit"]);
});

test("notHeard accepts complete requirements in Hindi, Kannada and English, and short follow-up answers", () => {
  assert.deepEqual(notHeard(["मुझे दो सौ किलो बासमती चावल चाहिए"], { item: "बासमती चावल", quantity: 200, unit: "kg" }), []);
  assert.deepEqual(
    notHeard(["ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು, ಬೆಂಗಳೂರಿಗೆ ಡೆಲಿವರಿ ಬೇಕು."], { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", quantity: 200, unit: "kg" }),
    [],
  );
  assert.deepEqual(notHeard(["I need 200 kilos of basmati rice"], { item: "basmati rice", quantity: 200, unit: "kg" }), []);
  // The item in one turn, the amount in the answer to "how much?".
  assert.deepEqual(notHeard(["बासमती चावल चाहिए", "दो सौ किलो"], { quantity: 200, unit: "kg" }), []);
  // A correction of the amount of a requirement that already has its unit: the number alone is enough.
  assert.deepEqual(notHeard(["नहीं, तीन सौ"], { quantity: 300 }), []);
  // But a new unit must be said with its number.
  assert.deepEqual(notHeard(["नहीं, तीन सौ"], { quantity: 300, unit: "bag" }), ["quantity", "unit"]);
  assert.deepEqual(notHeard(["मुझे चीनी चाहिए"], { item: "basmati rice" }), ["item"]);
  assert.deepEqual(notHeard(["अभी बताती हूँ"], {}), [], "nothing claimed, nothing to check");
});
