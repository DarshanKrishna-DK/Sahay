// The landing keeps its own stylesheet (public/css/landing.css) but every colour, shape and motion
// token it shares with the app must carry exactly the app's value (public/css/tokens.css), and the
// landing's buttons use the app's button classes (public/css/components.css).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = path.join(__dirname, "..", "public", "css");
const PUBLIC = path.join(__dirname, "..", "public");

/** Custom properties declared in the first `:root { ... }` block, values with whitespace normalised. */
function rootTokens(file) {
  const text = fs.readFileSync(path.join(CSS, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(text);
  assert.ok(block, `${file} has a :root block`);
  const out = new Map();
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].replace(/\s+/g, " ").trim().toLowerCase());
  return out;
}

/** The value with every var(--x) replaced by --x's own (resolved) value from the same file. */
function resolve(map, name, seen = new Set()) {
  if (seen.has(name)) return map.get(name);
  seen.add(name);
  return (map.get(name) ?? "").replace(/var\((--[a-z0-9-]+)\)/g, (all, ref) => (map.has(ref) ? resolve(map, ref, seen) : all));
}

test("landing tokens that share a name with the app's tokens carry the same value", (t) => {
  if (!fs.existsSync(path.join(CSS, "tokens.css"))) { t.skip("tokens.css not in this tree"); return; }
  const app = rootTokens("tokens.css");
  const landing = rootTokens("landing.css");
  const shared = [...landing.keys()].filter((k) => app.has(k));
  for (const must of ["--bg", "--surface", "--surface-2", "--text", "--muted", "--pink", "--pink-hover", "--pink-press", "--pink-edge", "--on-pink", "--line", "--line-strong", "--shadow", "--r-card", "--btn"]) {
    assert.ok(shared.includes(must), `landing declares ${must}`);
  }
  for (const k of shared) {
    const mine = resolve(landing, k), theirs = resolve(app, k);
    assert.equal(mine, theirs, `${k}: landing ${mine} vs app ${theirs}`);
  }
});

test("the landing has no lime, neon glow or glass blur left", () => {
  const css = fs.readFileSync(path.join(CSS, "landing.css"), "utf8");
  assert.doesNotMatch(css, /lime|#B6F23C|182,\s*242,\s*60|backdrop-filter/i);
  assert.doesNotMatch(css, /background-clip:\s*text/i, "no gradient text");
  const js = fs.readFileSync(path.join(PUBLIC, "js", "landing", "gather.js"), "utf8");
  assert.doesNotMatch(js, /"lighter"|182, 242, 60/, "the point cloud draws without additive glow");
});

test("landing buttons use the app's button classes", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const buttons = [...html.matchAll(/<a class="(btn [^"]+)"/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 4, "nav, hero primary, hero secondary, floating start");
  for (const c of buttons) assert.match(c, /^btn (btn-primary|btn-secondary)\b/, c);
  assert.doesNotMatch(html, /btn-lime|btn-outline|btn-big|btn-glass/);
});

test("landing buttons are KrowdKraft's key-cap: label then a trailing arrow, lip shadow, sheen, sink on press", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.doesNotMatch(html, /btn-edge|btn-front/, "no pushable layers");
  for (const m of html.matchAll(/<a class="btn [^"]+"[^>]*>([\s\S]*?)<\/a>/g)) {
    assert.match(m[1], /^<span[^>]*>[^<]+<\/span><svg class="btn-ico"/, "label first, then the trailing icon");
  }
  const css = fs.readFileSync(path.join(CSS, "landing.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]*\.btn[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const rule = (sel) => { const r = rules.find((x) => x.sel === sel); assert.ok(r, `${sel} rule`); return r.body; };
  const base = rule(".btn");
  assert.match(base, /min-height:\s*52px/);
  assert.match(base, /font-weight:\s*600/);
  assert.match(base, /border-radius:\s*var\(--btn-radius\)/);
  assert.match(base, /border-bottom-color:\s*var\(--key-border-low\)/);
  assert.match(base, /box-shadow:\s*var\(--key-depth\)/);
  assert.match(css, /--btn-radius:\s*14px/);
  assert.match(css, /--key-depth:[^;]*0 3px 0 #060405/, "a 3px hard lip");
  assert.match(rule(".btn::before"), /opacity:\s*0/);
  assert.match(rule(".btn:hover::before"), /opacity:\s*1/, "sheen on hover");
  const primary = rule(".btn-primary");
  assert.match(primary, /background:\s*var\(--key-pink-face\)/);
  assert.match(primary, /color:\s*var\(--on-pink\)/);
  assert.match(css, /--key-pink-face:\s*linear-gradient\([^;]*var\(--pink\)/);
  assert.match(rule(".btn-primary:active"), /inset/, "press sinks");
  assert.match(rule(".btn-secondary:active"), /var\(--key-depth-press\)/);
  for (const r of rules.filter((x) => /\.btn/.test(x.sel))) assert.doesNotMatch(r.body, /transform/, `${r.sel}: nothing moves`);
});
