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

test("app.html links the sileo stylesheet, then the Sahay toast theme; no new inline script", () => {
  const html = read("public/app.html");
  const a = html.indexOf(`href="/vendor/sileo-${SILEO}/sileo.css"`);
  const b = html.indexOf('href="/css/app-toast.css"');
  assert.ok(a > 0 && b > a, "sileo.css then app-toast.css");
  assert.ok(exists("public/css/app-toast.css"));
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(inline, ['<script type="importmap">'], "only the existing import map is inline");
  const css = read("public/css/app-toast.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:root\[data-theme="light"\]/);
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

test("the moments are wired: main imports them, the live events and the button paths use notify", () => {
  assert.match(read("public/js/app/main.js"), /import "\.\/moments\.js";/);
  const src = read("public/js/app/moments.js");
  for (const type of ["order.created", "invoice.issued", "receipt.recorded", "stock.low", "stock.reorder_decided", "job.started", "rule.decided", "payment.link", "followup.fired", "error"]) {
    assert.ok(src.includes(`case "${type}"`), type);
  }
  assert.match(src, /addEventListener\("offline"/);
  assert.match(src, /addEventListener\("online"/);
  assert.match(src, /call\.ended/);
  assert.match(src, /t\("simulated"\)/, "a simulated vendor is labelled in the order toast");
  assert.match(read("public/js/app/money-pad.js"), /notifyPaid\(/);
  assert.match(read("public/js/app/stock.js"), /notifyReorder\(/);
  assert.ok(!read("public/js/app/money-pad.js").includes("mpad-done"), "the old in-sheet confirmation is gone");
});

test("every toast string has English, Hindi in Devanagari and Kannada in Kannada script", () => {
  const src = read("public/js/app/moments.js");
  const rows = [...src.matchAll(/^\s*"(toast\.[\w.]+)": \[("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\],/gm)];
  assert.ok(rows.length >= 30, `found ${rows.length} rows`);
  const keys = new Set(rows.map((r) => r[1]));
  for (const [, key, en, hi, kn] of rows) {
    assert.ok(JSON.parse(en).length > 0, `${key} en`);
    assert.match(JSON.parse(hi), /[ऀ-ॿ]/, `${key} hi is Devanagari`);
    assert.match(JSON.parse(kn), /[ಀ-೿]/, `${key} kn is Kannada`);
  }
  const used = new Set();
  for (const file of ["public/js/app/moments.js", "public/js/app/stock.js"]) {
    for (const m of read(file).matchAll(/\bt\("(toast\.[\w.]+)"/g)) used.add(m[1]);
  }
  for (const m of src.matchAll(/t\(amt \? "(toast\.[\w.]+)" : "(toast\.[\w.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const k of used) assert.ok(keys.has(k), `${k} is defined`);
});
