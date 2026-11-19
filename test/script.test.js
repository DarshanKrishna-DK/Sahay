"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { scriptProblems, isNativeScript } = require("../src/agora/script");

test("a Hindi line in Devanagari with digits, a PO number and Razorpay is clean", () => {
  assert.ok(isNativeScript("ऑर्डर SAHAY/2026/0001 का भुगतान बाकी है, 11000 रुपये। Razorpay टेस्ट मोड।", "hi-IN"));
  assert.ok(isNativeScript("ಆರ್ಡರ್ SAHAY/2026/0001 ಪಾವತಿ ಬಾಕಿ ಇದೆ, 11000 ರೂಪಾಯಿ.", "kn-IN"));
});

test("E2E r3: Latin inside Hindi ('मनzoor') and Kannada ('Bengaluruಗೆ') is caught", () => {
  assert.deepEqual(scriptProblems("इसे मनzoor करें?", "hi-IN").latin, ["zoor"]);
  assert.deepEqual(scriptProblems("ಸರಿ, 200 ಕೆಜಿ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬರೆದುಕೊಂಡೆ, Bengaluruಗೆ.", "kn-IN").latin, ["Bengaluru"]);
});

test("E2E r3: a Devanagari word inside Kannada ('जानकारी') is caught, and Kannada inside Hindi", () => {
  assert.equal(scriptProblems("ನಾನು ಈ जानकारी ಉಳಿಸಿ ಕೇಳುತ್ತಿದ್ದೇನೆ.", "kn-IN").foreign, true);
  assert.equal(scriptProblems("मैं ಬೆಂಗಳೂರು के लिए देख रही हूँ।", "hi-IN").foreign, true);
  assert.equal(scriptProblems("ಬೆಂಗಳೂರಿಗೆ ಡೆಲಿವರಿ.", "kn-IN").foreign, false);
});

test("names passed as allowed stay as written, longest first; nothing else is excused", () => {
  const text = "सबसे अच्छे BS Foods Pvt. Ltd., 60 रुपये प्रति किलो, cotton भी।";
  assert.deepEqual(scriptProblems(text, "hi-IN", { allow: ["BS Foods Pvt. Ltd.", "BS Foods", null, ""] }).latin, ["cotton"]);
  assert.equal(isNativeScript("BS Foods से बात बनी।", "hi-IN", { allow: ["BS Foods"] }), true);
  assert.equal(isNativeScript("BS Foods से बात बनी।", "hi-IN"), false);
});

test("English has no script rule here", () => {
  assert.ok(isNativeScript("The order SAHAY/2026/0001 is placed.", "en-IN"));
  assert.ok(isNativeScript("anything", "xx-YY"));
});
