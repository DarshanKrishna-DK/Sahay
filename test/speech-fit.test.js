"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fitOnePiece, bytes, SPEAK_MAX_BYTES } = require("../src/agora/speech-fit");

const build = (v) => `${v.vendor} से ${v.qty} किलो, कुल ${v.total} रुपये। ऑर्डर पक्का करूँ?`;

test("a line under the limit is returned exactly as built", () => {
  const values = { vendor: "Srinidhi Foods", qty: "200", total: "20200" };
  assert.equal(fitOnePiece(build, values, ["vendor"]), build(values));
});

test("an over-long line shortens only the allowed free-text value, word by word, never a figure", () => {
  const vendor = "श्री वेंकटेश्वर एग्रो फूड्स एंड राइस मिल्स प्राइवेट लिमिटेड होलसेल डिवीज़न बेंगलुरु ".repeat(3).trim();
  const values = { vendor, qty: "123456", total: "987654.5" };
  assert.ok(bytes(build(values)) > SPEAK_MAX_BYTES);
  const text = fitOnePiece(build, values, ["vendor"]);
  assert.ok(bytes(text) <= SPEAK_MAX_BYTES, `${bytes(text)} bytes`);
  assert.match(text, /^श्री वेंकटेश्वर/);
  assert.match(text, /123456 किलो, कुल 987654\.5 रुपये। ऑर्डर पक्का करूँ\?$/);
  assert.ok(!text.includes("�"));
  // Deterministic: the same values give the same line (a stored read-back can be rebuilt and compared).
  assert.equal(fitOnePiece(build, values, ["vendor"]), text);
});

test("a single long word is cut on whole graphemes; maxBytes is honoured; nothing shortenable returns the line as built", () => {
  const solid = "क्षत्रिय".repeat(40);
  const text = fitOnePiece((v) => `${v.name}: 5 रुपये।`, { name: solid }, ["name"], { maxBytes: 200 });
  assert.ok(bytes(text) <= 200);
  assert.ok(/^(क्षत्रिय)+/u.test(text.split(":")[0]) || text.startsWith("क्ष"));
  const fixed = "९".repeat(300);
  assert.equal(fitOnePiece((v) => v.n, { n: fixed }, []), fixed);
});
