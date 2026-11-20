"use strict";

/**
 * scripts/brain-e2e.js offline (--fixture): the whole procurement path through the tool registry,
 * with IndiaMART answered from the recorded page and Agora's REST boundary faked in process.
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("need -> discovery -> shortlist -> simulated negotiation -> quote -> refused without a yes -> owner yes -> one order", () => {
  // test/_env.js blanks every real key in the child too (Agora is faked; the script sets voice ids).
  const out = execFileSync(process.execPath, ["--require", path.join(__dirname, "_env.js"), path.join(__dirname, "..", "scripts", "brain-e2e.js"), "--fixture"], {
    encoding: "utf8",
    env: { ...process.env, DB_FILE: ":memory:" },
    timeout: 60000,
  });
  assert.match(out, /discovery":"recorded IndiaMART page \(offline\)"/);
  assert.match(out, /IndiaMART listings stored: [1-9]/);
  assert.match(out, /vendor \(simulated vendor\): Hello, I am a simulated vendor/);
  assert.match(out, /tool create_order -> REFUSED NOT_APPROVED/);
  assert.match(out, /tool confirm_approval -> REFUSED NO_VOICE_EVIDENCE/);
  assert.match(out, /approvals pending after the refusals: 1/);
  assert.match(out, /order created: \{"po":"[^"]+","status":"confirmed"/);
  assert.match(out, /orders for this deal: 1/);
  assert.match(out, /get_business_facts -> say: Past purchases were from .+\(simulated vendor\)/);
  assert.match(out, /RESULT: need -> discovery -> shortlist -> negotiation -> quote -> approval gate -> owner yes -> order: complete/);
  assert.doesNotMatch(out, /FAILED/);
});
