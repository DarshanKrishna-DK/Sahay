// Builds the vendored sileo toast island: npm run build:sileo
//
//   scripts/sileo-island.js  --esbuild-->  public/vendor/sileo-0.1.6/sileo-island.js  (one minified ES module)
//   node_modules/sileo/dist/styles.css  -->  public/vendor/sileo-0.1.6/sileo.css
//   + the LICENSE of every package inside the bundle, and a README with versions and this command.
//
// The output is committed: the app has no build step at run time. The page's CSP allows scripts
// only from 'self', so React, react-dom, motion and sileo all live in this one file. Production
// React (process.env.NODE_ENV = "production"), target es2020, no eval.
//
// Four small source patches to sileo 0.1.6 (each must match exactly once, or the build stops):
//   1. the runtime <style> injection is removed: the app loads sileo.css with a <link>, so its own
//      overrides (public/css/app.css) are not beaten by a style tag added later;
//   2. sileo's viewport aria-live is "off": the app announces each toast in its own live region
//      (one announcement, in the owner's words, not "sileo notification Check ...");
//   3. the SVG <title>"sileo notification"</title> is removed for the same reason;
//   4. the toast root is a <div>, not a <button>: a button's children are presentational to
//      screen readers, so the read-aloud and action buttons inside a toast would be unreachable.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8"));
const SILEO = pkg("sileo").version;
const OUT = path.join(ROOT, "public", "vendor", `sileo-${SILEO}`);

const PATCHES = [
  ["runtime style injection", /__insertCSS\("(?:[^"\\]|\\.)*"\);/g, ""],
  ["viewport aria-live", /"aria-live": "polite"/g, '"aria-live": "off"'],
  ["svg title", /\/\*#__PURE__\*\/ jsx\("title", \{\s*children: "sileo notification"\s*\}\),/g, ""],
  ["toast root element", /jsxs\("button", \{\s*ref: buttonRef,\s*type: "button",/g, 'jsxs("div", { ref: buttonRef,'],
];

const patchSileo = {
  name: "patch-sileo",
  setup(b) {
    b.onLoad({ filter: /[\\/]node_modules[\\/]sileo[\\/]dist[\\/]index\.mjs$/ }, async (args) => {
      let src = await fs.promises.readFile(args.path, "utf8");
      src = src.replace(/^'use client';\s*/, "");
      for (const [what, re, to] of PATCHES) {
        const n = (src.match(re) || []).length;
        if (n !== 1) throw new Error(`sileo patch "${what}" matched ${n} times (expected 1); check the sileo version.`);
        src = src.replace(re, to);
      }
      return { contents: src, loader: "js" };
    });
  },
};

fs.mkdirSync(OUT, { recursive: true });
const result = await build({
  entryPoints: [path.join(ROOT, "scripts", "sileo-island.js")],
  outfile: path.join(OUT, "sileo-island.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  plugins: [patchSileo],
  logLevel: "warning",
});

const bundlePath = path.join(OUT, "sileo-island.js");
const code = fs.readFileSync(bundlePath, "utf8");
for (const bad of ["eval(", "new Function("]) {
  if (code.includes(bad)) throw new Error(`The bundle contains ${bad}; the page CSP forbids it.`);
}
fs.copyFileSync(path.join(ROOT, "node_modules", "sileo", "dist", "styles.css"), path.join(OUT, "sileo.css"));

// Licenses of every package that ended up in the bundle.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, "/"));
  if (m) packages.add(m[1]);
}
const lines = [];
for (const name of [...packages].sort()) {
  const dir = path.join(ROOT, "node_modules", name);
  const { version, license } = pkg(name);
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  const target = path.join(OUT, `LICENSE-${name.replace("/", "-")}.txt`);
  if (file) fs.copyFileSync(path.join(dir, file), target);
  else if (license === "MIT") {
    // sileo's npm package ships no LICENSE file; package.json says MIT. The standard MIT text:
    fs.writeFileSync(target, `${name} ${version}: license "MIT" per its package.json (the npm package ships no LICENSE file).
Source: ${(pkg(name).repository && pkg(name).repository.url) || "npm"}

MIT License

Copyright (c) the ${name} authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`);
  } else throw new Error(`No license file for ${name} (${license}).`);
  lines.push(`- ${name} ${version} (${license}): ${path.basename(target)}`);
}

const esbuildVersion = pkg("esbuild").version;
fs.writeFileSync(path.join(OUT, "README.txt"), `sileo ${SILEO} toast island for the Sahay app (public/js/app/toast.js).

Files
- sileo-island.js: one minified ES module (esbuild ${esbuildVersion}, target es2020, production React,
  no eval) bundling scripts/sileo-island.js with these packages:
${lines.join("\n")}
- sileo.css: byte copy of node_modules/sileo/dist/styles.css, loaded by public/app.html with <link>.

Rebuild (after changing scripts/sileo-island.js or a version in package.json):
  npm run build:sileo
Commit the output; there is no build step at run time. scripts/build-sileo.mjs lists the four
small patches made to sileo's source while bundling (style injection removed, its own aria-live
off, SVG title removed, toast root is a div) and stops if any of them no longer applies.
`);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (await import("node:zlib")).gzipSync(code).length;
console.log(`sileo-island.js ${kb(code.length)} (gzip ${kb(gz)}); packages: ${[...packages].sort().join(", ")}`);
