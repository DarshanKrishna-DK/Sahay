"use strict";

/**
 * public/js/app/waiting.js + yes-card.js + public/css/app-waiting.css (W3 of UI v3), checked from the
 * sources (the modules need a browser): the contract other packages import, the four button
 * routes, auto-open only from the model's spoken signal, no old Yes-card markup or palette left,
 * and a reduced-motion branch for every animation.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const WAITING = read("public/js/app/waiting.js");
const SHIM = read("public/js/app/yes-card.js");
const CSS = read("public/css/app-waiting.css");

test("waiting.js exports the contract W1, W2 and W4 code against", () => {
  for (const name of ["waitingItems", "renderCard", "openTray", "onCount", "typedYesHint", "attachShell", "waitingCount"]) {
    assert.match(WAITING, new RegExp(`export (?:function|const) ${name}\\b`), name);
  }
  assert.match(SHIM, /export function createYesLayer\(/, "old main.js mount point kept");
  assert.match(SHIM, /from "\.\/waiting\.js"/, "the shim renders nothing itself");
  assert.doesNotMatch(SHIM, /\bh\(|class:/, "no markup in the shim");
});

test("every kind posts to its own existing decision route through the existing store calls", () => {
  assert.match(WAITING, /api\.decideApproval\(p\.id, word\)/, "POST /api/approvals/:id/decision");
  assert.match(WAITING, /decideInvoice\(p\.id, word\)/, "POST /api/invoices/:id/decision");
  assert.match(WAITING, /decideReorder\(c\.data\.itemId, word\)/, "POST /api/stock/reorders/:id/decision");
  assert.match(WAITING, /decideRule\(p\.id, word\)/, "POST /api/agent/rules/:id/decision");
  assert.match(WAITING, /model\.tapFailed\(key, \{ status: err && err\.status, code: err && err\.code, say: err && err\.say \}\)/, "the server's say reaches the card");
});

test("a card opens by itself only on the model's spoken signal (D7)", () => {
  const calls = [...WAITING.matchAll(/\bautoOpen\(/g)].length;
  assert.equal(calls, 2, "one definition and one call");
  assert.match(WAITING, /for \(const s of model\.takeSignals\(\)\) if \(s\.type === "open"\) autoOpen\(s\.key\);/);
  assert.match(WAITING, /#\/waiting/, "the #/waiting route opens the tray");
  assert.match(WAITING, /sahay:open-tray/, "the shell's open-tray event opens the tray");
});

test("no old Yes-card markup, classes or palette remain", () => {
  for (const src of [WAITING, SHIM, CSS]) {
    assert.doesNotMatch(src, /yes-layer|yes-card|yes-mini|yes-placing|data-yes|marigold|saffron|#FFB020|#FF7A1A/i);
  }
  assert.doesNotMatch(CSS, /#[0-9a-f]{3,8}\b/i, "tokens only, no raw hex");
});

test("simulated vendor and test mode are labelled on the card", () => {
  assert.match(WAITING, /v\.simulated \? pill\(t\("simulated"\), "robot", "sim"\)/);
  assert.match(WAITING, /"wt\.payLong"/);
});

test("every animation in app-waiting.css has a reduced-motion branch", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const cut = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(cut > 0, "has a reduced-motion block");
  const main = css.slice(0, cut);
  const reduced = css.slice(cut);
  const animated = [...main.matchAll(/([^{}]+)\{[^{}]*animation:\s*(?!none)[a-z-]+/g)].map((m) => m[1].trim().split(",")[0].trim());
  assert.ok(animated.length >= 2, "found the animated rules");
  for (const sel of animated) assert.ok(reduced.includes(sel), `${sel} stops under reduced motion`);
});

test("QA 2026-11-20 fixes stay in: drawer fits the screen, Yes / No in the sheet footer, read-back clamp, route change closes the tray", () => {
  assert.match(CSS, /\.sheet-root\[data-place="drawer"\] \.sheet:has\(\.wt-sheet\) \{ width: min\(420px, 55vw\);[^}]*max-width: calc\(100vw - 16px\)/);
  assert.match(CSS, /\.sheet-root\[data-place="drawer"\]\.is-open \.sheet:has\(\.wt-sheet\) \{ transform: none; \}/);
  assert.match(WAITING, /footer: sheetFoot \? \[sheetFoot\] : undefined/, "Yes / No go to the sheet footer");
  assert.match(WAITING, /actionsOut: Boolean\(onFoot\)/, "and leave the card body in the sheet");
  assert.match(WAITING, /closeLabel: t\("wt\.later"\)/, "the sheet's close says Later");
  assert.match(CSS, /\.yc-heard-text\.is-clamped \{[^}]*line-clamp: 3/);
  assert.match(WAITING, /"wt\.readMore"/);
  assert.match(CSS, /\.yc \.pill-sim > span \{ white-space: normal; overflow: visible; text-overflow: clip;/, "simulated vendor label never truncated");
  assert.match(CSS, /\.yc-title:focus, \.yc-title:focus-visible \{ outline: none; box-shadow: none; \}/);
  assert.match(WAITING, /location\.hash !== sheetRoute && typeof sheetApi\.close === "function"\) sheetApi\.close\(\)/, "another route closes the tray");
});
