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

test("the browser's list of server read-aloud keys is the server's own list", () => {
  const server = kindsOf(read("src/agent/speak.js"), /const KEY = \/\^\(\?:now\|\(([a-z|]+)\):/);
  const browser = kindsOf(read("public/js/app/sell-kit.js"), /const SERVER_KEY = \/\^\(\?:now\|\(\?:([a-z|]+)\):/);
  assert.deepEqual(browser, server);
  for (const kind of ["invoice", "item", "owed"]) assert.ok(server.includes(kind), kind);
});

test("cards with a server key pass no device sentence; the device voice is only a fallback for keys the server does not know", () => {
  const server = kindsOf(read("src/agent/speak.js"), /const KEY = \/\^\(\?:now\|\(([a-z|]+)\):/);
  const calls = [];
  for (const file of ["money.js", "sell.js", "stock.js"]) {
    const source = read(`public/js/app/${file}`);
    for (const m of source.matchAll(/readButton\(([`"])([a-z]+)(:?)[^`"]*\1(\s*[,)])/g)) calls.push({ file, kind: m[2], hasId: m[3] === ":", sentence: m[4].trim() === "," });
  }
  assert.ok(calls.length >= 6, `found ${calls.length} read buttons`);
  for (const c of calls) {
    if (c.hasId && server.includes(c.kind)) assert.equal(c.sentence, false, `${c.file}: ${c.kind}:<id> has a device sentence`);
    else assert.equal(c.sentence, true, `${c.file}: ${c.kind} has no sentence and no server key`);
  }
  const kit = read("public/js/app/sell-kit.js");
  assert.match(kit, /isServerKey\(key\) \|\| !sentence/, "a server key's failure is shown, never read by the device");
});
