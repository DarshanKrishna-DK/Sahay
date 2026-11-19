"use strict";

/**
 * public/js/app/sell-kit.js readButton: cards whose key the server reads aloud (src/agent/speak.js)
 * use only the server's sentence; the device voice is kept for the cards the server has no key for.
 * Checked from the sources (the module needs a browser).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const kindsOf = (source, pattern) => {
  const m = pattern.exec(source);
  assert.ok(m, `pattern ${pattern} found`);
  return m[1].split("|").sort();
};

// Whole-screen keys (no id) and card kinds ("<kind>:<id>"), as each side writes its pattern.
const SERVER_SCREENS = /const KEY = \/\^\(\?:\(([a-z|]+)\)\|/;
const SERVER_KINDS = /const KEY = \/\^\(\?:\([a-z|]+\)\|\(([a-z|]+)\):/;
const BROWSER_SCREENS = /const SERVER_KEY = \/\^\(\?:\(\?:([a-z|]+)\)\|/;
const BROWSER_KINDS = /const SERVER_KEY = \/\^\(\?:\(\?:[a-z|]+\)\|\(\?:([a-z|]+)\):/;

test("the browser's list of server read-aloud keys is the server's own list", () => {
  const server = kindsOf(read("src/agent/speak.js"), SERVER_KINDS);
  const browser = kindsOf(read("public/js/app/sell-kit.js"), BROWSER_KINDS);
  assert.deepEqual(browser, server);
  for (const kind of ["invoice", "item", "owed"]) assert.ok(server.includes(kind), kind);
  const screens = kindsOf(read("src/agent/speak.js"), SERVER_SCREENS);
  assert.deepEqual(kindsOf(read("public/js/app/sell-kit.js"), BROWSER_SCREENS), screens);
  assert.deepEqual(screens, ["customers", "khata", "now"], "the Sell screen's customer list and the Money header are read by the server (E2E 2026-11-19 and regress: they were 404)");
});

test("cards with a server key pass no device sentence; the device voice is only a fallback for keys the server does not know", () => {
  const server = kindsOf(read("src/agent/speak.js"), SERVER_KINDS);
  const screens = kindsOf(read("src/agent/speak.js"), SERVER_SCREENS);
  const calls = [];
  for (const file of ["money.js", "sell.js", "stock.js"]) {
    const source = read(`public/js/app/${file}`);
    for (const m of source.matchAll(/readButton\(([`"])([a-z]+)(:?)[^`"]*\1(\s*[,)])/g)) calls.push({ file, kind: m[2], hasId: m[3] === ":", sentence: m[4].trim() === "," });
  }
  assert.ok(calls.length >= 6, `found ${calls.length} read buttons`);
  for (const c of calls) {
    if ((c.hasId && server.includes(c.kind)) || (!c.hasId && screens.includes(c.kind))) assert.equal(c.sentence, false, `${c.file}: ${c.kind} has a device sentence`);
    else assert.equal(c.sentence, true, `${c.file}: ${c.kind} has no sentence and no server key`);
  }
  const kit = read("public/js/app/sell-kit.js");
  assert.match(kit, /isServerKey\(key\) \|\| !sentence/, "a server key's failure is shown, never read by the device");
});
