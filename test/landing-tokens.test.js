// Landing v7 (the yugaantar.org look in its own colours, docs/superpowers/plans/2026-11-20-ui-v7-brief.md):
// the landing keeps its own stylesheet (public/css/landing.css), but every token it shares with the app
// (public/css/tokens.css) carries exactly the app's value; square shapes, pixel borders and hard shadows;
// Jersey 10 / Amarna with Hindi and Kannada in their own faces; the nine-section structure; only true
// numbers; and the footer kept from commit 1425810.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const CSS = path.join(PUBLIC, "css");
const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const cssAll = fs.readFileSync(path.join(CSS, "landing.css"), "utf8");
// The v7 part of the sheet; the kept footer (scoped to .site-foot) follows it.
const FOOT_AT = cssAll.indexOf("/* ---- Footer: kept exactly as commit 1425810");
const css = cssAll.slice(0, FOOT_AT).replace(/\/\*[\s\S]*?\*\//g, "");

/** Custom properties declared in the first `:root { ... }` block, values with whitespace normalised. */
function rootTokens(text) {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(text.replace(/\/\*[\s\S]*?\*\//g, ""));
  assert.ok(block, "a :root block");
  const out = new Map();
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].replace(/\s+/g, " ").trim().toLowerCase());
  return out;
}
/** The value with every var(--x) replaced by --x's own (resolved) value from the same map. */
function resolve(map, name, seen = new Set()) {
  if (seen.has(name)) return map.get(name);
  seen.add(name);
  return (map.get(name) ?? "").replace(/var\((--[a-z0-9-]+)\)/g, (all, ref) => (map.has(ref) ? resolve(map, ref, seen) : all));
}
/** Body of the first rule whose selector list is exactly `sel`. */
function rule(sel) {
  const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].trim() === sel);
  assert.ok(m, `${sel} rule`);
  return m[2];
}

test("v7 tokens carry the brief's measured values, and any name shared with the app carries the app's value", (t) => {
  const landing = rootTokens(cssAll);
  const brief = {
    "--navy": "#0b1f4b", "--deep": "#061431", "--card": "#112a60", "--card-2": "#0f2753", "--line": "#2b4c8a",
    "--cream": "#f3f1e2", "--muted": "#a7b6d6", "--lime": "#a8e27c", "--on-lime": "#0b1f4b", "--blue": "#1c61a1",
    "--blue-2": "#2481aa", "--sky": "#133d7e", "--moon": "#e3eda6", "--gold": "#d9a520", "--paper-ink": "#0f2753",
    "--radius": "0", "--bevel": "0 0 0 2px var(--line), 2px 2px 0 0 var(--deep)", "--card-shadow": "4px 4px 0 0 var(--deep)",
  };
  for (const [k, v] of Object.entries(brief)) assert.equal(landing.get(k), v, k);
  if (!fs.existsSync(path.join(CSS, "tokens.css"))) { t.skip("tokens.css not in this tree"); return; }
  const app = rootTokens(fs.readFileSync(path.join(CSS, "tokens.css"), "utf8"));
  const shared = [...landing.keys()].filter((k) => app.has(k));
  for (const must of ["--navy", "--deep", "--card", "--card-2", "--cream", "--paper", "--paper-2", "--paper-ink", "--lime", "--lime-hover", "--muted", "--line", "--scrim"]) {
    assert.ok(shared.includes(must), `landing declares ${must}`);
  }
  for (const k of shared) assert.equal(resolve(landing, k), resolve(app, k), k);
});

test("type: Jersey 10 display, Amarna body and HUD; Hindi and Kannada in their own faces, never uppercase", () => {
  const fonts = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(html);
  assert.ok(fonts, "one Google Fonts stylesheet");
  for (const f of ["Jersey+10", "Amarna", "Jaini+Purva", "Hind", "Baloo+Tamma+2", "Noto+Sans+Kannada"]) assert.match(fonts[1], new RegExp(`family=${f.replace(/\+/g, "\\+")}[:&]`), f);
  assert.match(css, /--f-display:\s*"Jersey 10"/);
  assert.match(css, /--f-body:\s*"Amarna"/);
  assert.match(css, /:lang\(hi\)\s*\{\s*--f-display:\s*"Jaini Purva"[^}]*--f-body:\s*"Hind"/);
  assert.match(css, /:lang\(kn\)\s*\{\s*--f-display:\s*"Baloo Tamma 2"[^}]*--f-body:\s*"Noto Sans Kannada"/);
  assert.match(css, /:lang\(hi\), :lang\(kn\)\s*\{\s*letter-spacing:\s*0 !important;\s*text-transform:\s*none !important;/);
  const hud = rule(".hud");
  assert.match(hud, /600 12px/);
  assert.match(hud, /letter-spacing:\s*\.14em/);
  assert.match(hud, /text-transform:\s*uppercase/);
});

test("square and pixel: no rounded corners but the moon, no blur, and the only soft shadow is the moon's halo", () => {
  for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) assert.match(m[1].trim(), /^(0|50%|var\(--radius\))$/, m[0]);
  assert.doesNotMatch(css, /backdrop-filter|blur\(/);
  // A shadow layer is "[inset] x y [blur [spread]] [colour]": it is soft when its third length is not 0.
  const softLayer = (layer) => {
    const lengths = layer.replace(/^\s*inset\s+/, "").replace(/(rgba?|var)\([^)]*\)|#[0-9a-f]+/gi, "").trim().split(/\s+/).filter((x) => /^-?[\d.]+(px)?$/.test(x));
    return lengths.length >= 3 && parseFloat(lengths[2]) !== 0;
  };
  for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const shadow = /(?:^|;)\s*box-shadow:\s*([^;]+)/.exec(r[2]);
    if (!shadow) continue;
    const layers = shadow[1].split(/,(?![^(]*\))/);
    if (layers.some(softLayer)) assert.equal(r[1].trim(), ".moon", `soft shadow on ${r[1].trim()}`);
  }
});

test("buttons: square, 48px, Amarna 600 uppercase; primary lime with the pixel border and hard shadow; press drops the shadow", () => {
  const btn = rule(".btn");
  assert.match(btn, /min-height:\s*48px/);
  assert.match(btn, /border-radius:\s*0/);
  assert.match(btn, /font:\s*600 13px\/1\.2 var\(--f-hud\)/);
  assert.match(btn, /letter-spacing:\s*\.14em/);
  assert.match(btn, /text-transform:\s*uppercase/);
  const primary = rule(".btn-primary");
  assert.match(primary, /background:\s*var\(--lime\)/);
  assert.match(primary, /color:\s*var\(--on-lime\)/);
  assert.match(primary, /box-shadow:\s*var\(--bevel\)/);
  assert.match(rule(".btn-secondary"), /border:\s*1\.6px solid/);
  assert.match(rule(".btn:active"), /box-shadow:\s*0 0 0 2px var\(--line\)/, "press keeps the border, loses the shadow");
  const anchors = [...html.matchAll(/<a class="(btn [^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 4, "nav, hero primary, hero secondary, languages");
  for (const c of anchors) assert.match(c, /^btn (btn-primary|btn-secondary|btn-nav)$/, c);
  for (const sel of [".hud-link", ".popover-item", ".menu-btn", ".sq-btn"]) assert.match(rule(sel), /(min-height|height):\s*48px/, `${sel} is a 48px target`);
});

test("nine sections in Yugaantar's order, each nav link pointing at a real section", () => {
  const order = ["top", "about", "does", "how", "built", "languages", "faq"].map((id) => html.indexOf(`<section class="`) >= 0 && html.search(new RegExp(`<section[^>]* id="${id}"`)));
  for (const at of order) assert.ok(at > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in order");
  assert.ok(html.indexOf('class="nav-bar') < order[0] && html.indexOf('<footer class="site-foot">') > order.at(-1), "nav first, footer last");
  for (const m of html.matchAll(/<a class="hud-link" href="#([a-z]+)"/g)) assert.match(html, new RegExp(`<section[^>]* id="${m[1]}"`), m[1]);
  assert.match(html, /<section class="hero night"/);
  assert.match(html, /<section class="paper about"/);
  assert.match(html, /<section class="night does"/);
  assert.match(html, /<section class="paper steps"/);
  assert.match(html, /<section class="night built"/);
  assert.match(html, /<section class="night langs"/);
  assert.match(html, /<section class="paper faq"/);
});

test("every number on the page is a true count of the page itself", () => {
  const stats = [...html.matchAll(/<dt class="hud" data-i18n="(stat[A-Za-z]+)">[^<]*<\/dt><dd>(\d+)<\/dd>/g)].map((m) => [m[1], Number(m[2])]);
  const cards = (html.match(/<li class="fx-item">/g) || []).length;
  const steps = (html.match(/<li class="step">/g) || []).length;
  const langs = (html.match(/<button type="button" class="board [^"]*" data-lang="/g) || []).length;
  assert.deepEqual(Object.fromEntries(stats), { statLangs: langs, statJobs: cards, statSteps: steps, statYes: 1, statNone: 0 });
  assert.deepEqual([cards, steps, langs], [7, 4, 3]);
  assert.equal(/<p class="big-num">(\d+)<\/p>/.exec(html)[1], String(langs));
  assert.equal((html.match(/<details>/g) || []).length, 6, "FAQ 01 to 06");
});

test("pictures: every one is our art (or the brand mark), sized, pixel-crisp, lazy below the hero, with alt text", () => {
  const imgs = [...html.matchAll(/<img\b([^>]*)>/g)].map((m) => m[1]);
  const heroEnd = html.indexOf('<section class="paper about"');
  let at = 0;
  for (const attrs of imgs) {
    at = html.indexOf(attrs, at);
    const src = /src="([^"]+)"/.exec(attrs)[1];
    assert.match(src, /^\/(art|assets\/brand)\//, src);
    assert.ok(fs.existsSync(path.join(PUBLIC, src)), `${src} exists`);
    for (const s of (/srcset="([^"]+)"/.exec(attrs)?.[1] || "").split(",").map((x) => x.trim().split(" ")[0]).filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(PUBLIC, s)), `${s} exists`);
    }
    assert.match(attrs, /width="\d+" height="\d+"/, `${src} has its size`);
    assert.match(attrs, /alt="/, `${src} has alt`);
    if (at > heroEnd && !html.slice(heroEnd, at).includes("<footer")) assert.match(attrs, /loading="lazy"/, `${src} is lazy`);
  }
  for (const big of ["hero-scene", "market-model", "guidemap"]) {
    const attrs = imgs.find((a) => a.includes(`/art/${big}`));
    assert.match(attrs, /alt="Picture: [^"]+" data-i18n-attr="alt:[a-zA-Z]+"/, `${big} is described, in three languages`);
  }
  assert.doesNotMatch(css, /image-rendering:\s*(auto|smooth)/);
});

test("the footer is the one kept from commit 1425810", () => {
  assert.match(html, /<footer class="site-foot">\s*<div class="foot-card">/);
  assert.match(html, /<!-- footer-art:start \(scripts\/build-footer-art\.js\) -->\n<svg class="foot-art"/);
  assert.match(html, /<span data-i18n="footTagA">Your shop,<\/span> <span class="foot-tag-accent" data-i18n="footTagB">your yes\.<\/span>/);
  assert.match(html, /data-i18n="footDisclose">Sahay is an automated assistant\. Payments are in test mode\./);
  assert.match(html, /href="https:\/\/github\.com\/DarshanKrishna-DK\/Sahay"/);
  const foot = cssAll.slice(FOOT_AT);
  assert.match(foot, /\.site-foot \{[^}]*--pink: #F2CFC6;[^}]*background: #0F0D0E;/, "its own warm tokens, scoped");
  assert.match(foot, /\.foot-card \{[^}]*background: linear-gradient\(180deg, #1A1517, #110E0F\);/);
});
