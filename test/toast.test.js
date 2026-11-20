"use strict";

/**
 * Toasts (sileo 0.1.6 as a vendored React island): the bundle is committed, CSP-safe and licensed,
 * the app loads it through public/js/app/toast.js, and the owner-facing moments are wired in three
 * languages. Checked from the sources (the modules need a browser).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const SILEO = JSON.parse(read("node_modules/sileo/package.json")).version;
const VENDOR = `public/vendor/sileo-${SILEO}`;

test("the vendored island bundle exists, is one ES module with the toast API, and has no eval", () => {
  assert.ok(exists(`${VENDOR}/sileo-island.js`), "bundle committed");
  const code = read(`${VENDOR}/sileo-island.js`);
  assert.ok(!code.includes("eval("), "no eval(");
  assert.ok(!code.includes("new Function("), "no new Function(");
  assert.ok(!/\bimport\s*\(|from\s*["'][^"']+["']/.test(code.slice(0, 2000)), "no imports: everything is bundled");
  const exp = /export\{([^}]*)\}\s*;?/.exec(code);
  assert.ok(exp, "has an export list");
  const names = exp[1].split(",").map((p) => p.trim().split(/\s+as\s+/).pop()).sort();
  assert.deepEqual(names, ["mount", "setReducedMotion", "toast"]);
  assert.ok(!code.includes("sileo notification"), "SVG title patched out");
  assert.ok(code.includes('"aria-live":"off"'), "sileo's own live region is off (the app announces)");
  assert.ok(!code.includes("--sileo-spring-easing"), "no runtime <style> injection (sileo.css is linked)");
  assert.ok(!/process\.env/.test(code), "process.env replaced at build time");
});

test("the vendor folder carries sileo.css, every license and a README with the build command", () => {
  assert.equal(read(`${VENDOR}/sileo.css`), read("node_modules/sileo/dist/styles.css"));
  for (const name of ["sileo", "react", "react-dom", "scheduler", "motion", "framer-motion", "motion-dom", "motion-utils"]) {
    assert.ok(exists(`${VENDOR}/LICENSE-${name}.txt`), `LICENSE-${name}.txt`);
  }
  const readme = read(`${VENDOR}/README.txt`);
  assert.match(readme, /npm run build:sileo/);
  for (const name of ["sileo", "react", "react-dom", "motion"]) {
    const v = JSON.parse(read(`node_modules/${name}/package.json`)).version;
    assert.ok(readme.includes(`${name} ${v}`), `README names ${name} ${v}`);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:sileo"], "node scripts/build-sileo.mjs");
  assert.ok(exists("scripts/sileo-island.js") && exists("scripts/build-sileo.mjs"));
});

test("toast.js loads the island, announces in its own live regions and offers read-aloud", () => {
  const src = read("public/js/app/toast.js");
  const m = /const ISLAND = "([^"]+)"/.exec(src);
  assert.ok(m, "island path");
  assert.ok(exists(path.join("public", m[1])), `${m[1]} exists`);
  assert.match(src, /export function notify\(/);
  assert.match(src, /export function dismiss\(/);
  assert.match(src, /"aria-live": "polite"/);
  assert.match(src, /"aria-live": "assertive"/);
  assert.match(src, /import \{ speakButton \} from "\.\/speak\.js"/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /setReducedMotion/);
});
