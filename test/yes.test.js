"use strict";

/**
 * public/js/app/yes.js + public/css/yes.css (W3, UI v5), checked from the sources (the module needs a
 * browser): the exports other screens use, the four decision routes through the existing store
 * calls, auto-open only from the model's fresh-spoken signal, the Needs count fed to the shell, the
 * spec 03 rules (simulated vendor as plain warn text, read-back folded, scrim does not dismiss the
 * Yes card) and the v5 style rules (tokens only, no caps, no glow, reduced motion).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const YES = read("public/js/app/yes.js");
const CSS = read("public/css/yes.css");

test("yes.js exports what Home, Sell, Stock, My Sahay and the composer use", () => {
  for (const name of ["openNeeds", "createYesCard", "needsRows", "onNeedsRows", "onCount", "waitingCount", "waitingItems", "typedYesHint"]) {
    assert.match(YES, new RegExp(`export (?:function|const) ${name}\\b`), name);
  }
});

test("every kind posts to its existing decision route; the server's say reaches the card", () => {
  assert.match(YES, /api\.decideApproval\(p\.id, word\)/);
  assert.match(YES, /decideInvoice\(p\.id, word\)/);
  assert.match(YES, /decideReorder\(c\.data\.itemId, word\)/);
  assert.match(YES, /decideRule\(p\.id, word\)/);
  assert.match(YES, /model\.tapFailed\(key, \{ status: err && err\.status, code: err && err\.code, say: err && err\.say \}\)/);
});

test("a card opens by itself only on the model's spoken signal; the shell's Needs button and #/needs open the host", () => {
  assert.equal([...YES.matchAll(/\bautoOpen\(/g)].length, 2, "one definition, one call");
  assert.match(YES, /for \(const s of model\.takeSignals\(\)\) if \(s\.type === "open"\) autoOpen\(s\.key\);/);
  assert.match(YES, /document\.addEventListener\("sahay:open-needs", \(e\) => openNeeds\(\(e && e\.detail && e\.detail\.key\) \|\| null\)\)/, "one door: shell button, #/needs and Home's Check");
  assert.match(YES, /setNeedsCount\(n\)/, "the count goes to the shell on every change");
  assert.match(YES, /window\.addEventListener\("hashchange"/, "another route closes the host");
});

test("spec 03: simulated vendor as plain warn text under the name, read-back folded, scrim does not dismiss the Yes card", () => {
  assert.match(YES, /f\.simulated \? h\("span", \{ class: "yes-sim", text: t\("simulated"\) \}\)/);
  assert.match(CSS, /\.yes-sim \{[^}]*color: var\(--warn\)/);
  assert.match(YES, /h\("details", \{ class: "yes-readout", open: openReadouts\.has\(c\.key\) \? true : undefined \}/, "closed unless the owner opened it");
  assert.match(YES, /scrimCloses: plan\.mode !== "card",/, "W1's openSheet option: the scrim never dismisses the Yes card");
  assert.doesNotMatch(YES, /sheet-scrim/, "no custom scrim handling");
  assert.doesNotMatch(YES, /wt\.sentence/, "no subtitle under the question (spec 03)");
  assert.match(YES, /yesNo\(\{/, "W1's 64px No / Yes pair");
  assert.match(YES, /t\(`wt\.foot\.\$\{c\.kind\}`\)/, "the footnote under the pair");
});

test("v5 style rules: tokens only, no caps, no glow or blur, reduced motion", () => {
  assert.doesNotMatch(CSS, /#[0-9a-f]{3,8}\b/i, "no raw hex");
  assert.doesNotMatch(CSS, /text-transform:\s*uppercase|letter-spacing:\s*\.0[5-9]em/i, "no all caps or letter-spaced labels");
  assert.doesNotMatch(CSS, /backdrop-filter|box-shadow:[^;]*(?:0 0 \d+px)|gradient\(/i, "no blur, glow or gradient");
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS, /\.yes-amount \{[^}]*font-size: 44px;[^}]*font-weight: 700;[^}]*tabular-nums/);
});
