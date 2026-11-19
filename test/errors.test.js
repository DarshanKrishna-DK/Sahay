"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ToolError, toToolError, sayFor } = require("../src/tools/errors");

const typed = (name, code, message = "detail for the log") => Object.assign(new Error(message), { name, code });

test("every code the voice-approval gate, the cost caps and payments throw maps to a spoken line and a status", () => {
  const expected = {
    READBACK_NOT_SPOKEN: [409, "no_voice_evidence"],
    READBACK_NOT_HEARD: [409, "no_voice_evidence"],
    EVIDENCE_UNORDERED: [409, "no_voice_evidence"],
    NO_ANSWER_YET: [409, "not_affirmative"],
    ANSWER_DURING_READBACK: [409, "not_affirmative"],
    READBACK_SUPERSEDED: [409, "not_affirmative"],
    BUSY: [503, "busy"],
    RAZORPAY_RATE_LIMITED: [503, "payment_failed"],
    RAZORPAY_UNREACHABLE: [502, "payment_failed"],
    RAZORPAY_LIVE_KEY: [503, "payment_failed"],
    ORDER_ALREADY_PAID: [409, "already_paid"],
    PAY_LINK_INVALID: [404, "payment_link_unavailable"],
    PAY_LINK_EXPIRED: [410, "payment_link_unavailable"],
    PAYMENT_SIGNATURE_INVALID: [400, "payment_unverified"],
    ILLEGAL_TRANSITION: [409, "order_step_not_allowed"],
  };
  for (const [code, [status, line]] of Object.entries(expected)) {
    for (const language of ["hi-IN", "kn-IN", "en-IN"]) {
      const mapped = toToolError(typed("ApprovalError", code), language);
      assert.equal(mapped.code, code);
      assert.equal(mapped.status, status, code);
      assert.equal(mapped.say, sayFor(line, language), `${code} ${language}`);
      assert.equal(mapped.message, "detail for the log", "the original message stays for the log");
    }
  }
});

test("spoken lines are in the language's own script", () => {
  for (const line of ["busy", "already_paid", "payment_link_unavailable", "payment_unverified", "order_step_not_allowed"]) {
    assert.match(sayFor(line, "hi-IN"), /^[\p{Script=Devanagari}\p{P}\p{Join_Control}\s]+$/u, line);
    assert.match(sayFor(line, "kn-IN"), /^[\p{Script=Kannada}\p{P}\p{Join_Control}\s]+$/u, line);
  }
});

test("an unknown error becomes INTERNAL with a generic line, never its own message as speech", () => {
  const mapped = toToolError(new Error("SQLITE_CONSTRAINT: secret detail"), "hi-IN");
  assert.equal(mapped.code, "INTERNAL");
  assert.equal(mapped.status, 500);
  assert.equal(mapped.say, sayFor("internal", "hi-IN"));
  assert.doesNotMatch(mapped.say, /SQLITE/);
  const unknownCode = toToolError(typed("Whatever", "NOT_A_KNOWN_CODE"), "en-IN");
  assert.equal(unknownCode.code, "INTERNAL");
  const already = new ToolError("BUSY", "x");
  assert.equal(toToolError(already), already);
  assert.equal(already.status, 503);
});
