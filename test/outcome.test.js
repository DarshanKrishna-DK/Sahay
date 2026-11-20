"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const outcome = require("../src/agora/outcome");
const { scriptProblems } = require("../src/agora/script");

function fakeSpeak(t, { fail = false } = {}) {
  const spoken = [];
  outcome.configure({
    speak: async (agentId, text) => {
      if (fail) throw new Error("Agora answered 503");
      spoken.push({ agentId, text });
    },
  });
  t.after(() => outcome.configure({ speak: null }));
  return spoken;
}

test("settle in a call: the server speaks the result and the model only hands back", async (t) => {
  const spoken = fakeSpeak(t);
  const out = await outcome.settle({ agentId: "AG1" }, "बिल INV/2026-27/0001 बन गया, कुल 5400 रुपये।", "hi-IN", { invoiceId: "inv_1" });
  assert.deepEqual(spoken, [{ agentId: "AG1", text: "बिल INV/2026-27/0001 बन गया, कुल 5400 रुपये। और कुछ बताइए?" }], "result and hand-back in one /speak piece");
  assert.equal(out.invoiceId, "inv_1");
  assert.equal(out.outcomeSpoken, true);
  assert.equal(out.outcome, "बिल INV/2026-27/0001 बन गया, कुल 5400 रुपये।");
  assert.equal(out.say, "", "the model says nothing on top of the server's line");
  assert.match(out.hint, /already said this result aloud/);
});

test("settle off a call, or when /speak fails: the model gets the result to say (the owner still hears it once)", async (t) => {
  const spoken = fakeSpeak(t);
  const off = await outcome.settle({ agentId: null }, "Written down.", "en-IN");
  assert.deepEqual([off.say, off.outcomeSpoken], ["Written down.", false]);
  assert.equal(spoken.length, 0);

  fakeSpeak(t, { fail: true });
  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(line));
  const failed = await outcome.settle({ agentId: "AG1" }, "ಬರೆದುಕೊಂಡೆ.", "kn-IN");
  assert.deepEqual([failed.say, failed.outcomeSpoken], ["ಬರೆದುಕೊಂಡೆ.", false]);
  assert.match(warned.join(" "), /could not speak a result/);
});

test("announce never speaks an empty line and never throws", async (t) => {
  const spoken = fakeSpeak(t);
  assert.equal(await outcome.announce({ agentId: "AG1" }, "  "), false);
  assert.equal(await outcome.announce(null, "x"), false);
  assert.equal(spoken.length, 0);
});

test("the hand-back and 'not done yet' lines are in each language's own script", () => {
  for (const language of ["hi-IN", "kn-IN", "en-IN"]) {
    for (const text of [outcome.HAND_BACK[language], outcome.notDone(language, "")]) {
      const problems = scriptProblems(text, language);
      assert.deepEqual([problems.latin.length && language !== "en-IN" ? problems.latin : [], problems.foreign], [[], false], `${language}: ${text}`);
    }
  }
  assert.equal(outcome.notDone("hi-IN", "मुझे साफ़ हाँ सुनाई नहीं दी।"), "अभी हुआ नहीं। मुझे साफ़ हाँ सुनाई नहीं दी।");
});
