// Landing figures (public/figures, contract in public/figures/README.md) and the landing page's
// no-emoji rule. The figure modules are browser ES modules: load their text as data URLs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const FIG = path.join(PUBLIC, "figures");

async function load(rel) {
  let source = fs.readFileSync(path.join(FIG, rel), "utf8");
  // Inline the relative imports a live module makes (kit, geo, model), each as its own data URL.
  for (const m of [...source.matchAll(/from "(\.\.?\/[^"]+)"/g)]) {
    const target = path.posix.join(path.posix.dirname(rel), m[1]);
    const dep = fs.readFileSync(path.join(FIG, target), "utf8");
    source = source.replace(m[0], `from "data:text/javascript,${encodeURIComponent(dep)}"`);
  }
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test("balance model: the heavier pan goes down, equal pans hang level, and the last round is the agreed price", async () => {
  const M = await load("balance/model.js");
  assert.ok(M.tiltFor(65, 45) > 0, "seller's pan (left) heavier: positive tilt, left side down");
  assert.ok(M.tiltFor(45, 65) < 0);
  assert.equal(M.tiltFor(55, 55), 0);
  assert.ok(Math.abs(M.tiltFor(1000, 0)) <= M.MAX_TILT, "the stop limits the swing");
  for (let i = 1; i < M.ROUNDS.length; i++) {
    assert.ok(M.ROUNDS[i].ask <= M.ROUNDS[i - 1].ask, "the ask only comes down");
    assert.ok(M.ROUNDS[i].offer >= M.ROUNDS[i - 1].offer, "the offer only goes up");
    assert.ok(Math.abs(M.tiltFor(M.ROUNDS[i].ask, M.ROUNDS[i].offer)) < Math.abs(M.tiltFor(M.ROUNDS[i - 1].ask, M.ROUNDS[i - 1].offer)), "the beam levels round by round");
  }
  const last = M.ROUNDS.at(-1);
  assert.ok(M.isAgreed(last));
  assert.deepEqual(M.readoutOf(M.ROUNDS.length - 1), { kind: "agreed", price: 55 });
  assert.deepEqual(M.readoutOf(0), { kind: "round", number: 1, of: 3, ask: 65, offer: 45 });
  assert.equal(M.discsFor(65), 13);
  assert.throws(() => M.discsFor(62), RangeError, "only whole weights go on a pan");
  assert.equal(M.MAX_DISCS.ask, 13);
  assert.equal(M.MAX_DISCS.offer, 11);
  assert.equal(M.dialAngle(M.DIAL.min), M.DIAL.from);
  assert.equal(M.dialAngle(M.DIAL.max), M.DIAL.from + M.DIAL.span);
  assert.equal(M.dialAngle(999), M.DIAL.from + M.DIAL.span, "the needle stops at the end of the scale");
  assert.equal(M.tourRound(0), 0);
  assert.equal(M.tourRound(M.ROUND_SECONDS + 0.01), 1);
  assert.equal(M.tourRound(2 * M.ROUND_SECONDS + 0.01), 2);
  assert.equal(M.tourRound(2 * M.ROUND_SECONDS + M.AGREED_SECONDS + 0.01), 0, "the tour loops");
});

test("balance model: the beam swings past its target once and settles there", async () => {
  const M = await load("balance/model.js");
  const s = { x: 0, v: 0 };
  const target = M.tiltFor(65, 45);
  let peak = 0;
  let settled = false;
  for (let i = 0; i < 60 * 20 && !settled; i++) { settled = M.swingStep(s, target, 1 / 60); peak = Math.max(peak, s.x); }
  assert.ok(settled, "settles within 20 s");
  assert.equal(s.x, target);
  assert.ok(peak > target * 1.05, "a real balance overshoots before it settles");
  const calm = { x: 0, v: 3 };
  assert.ok(M.swingStep(calm, target, 1 / 60, true), "reduced motion jumps to the target");
  assert.equal(calm.x, target);
});

for (const name of ["balance", "printer"]) {
  test(`figure ${name}: files, still art and three-language words follow the contract`, async (t) => {
    if (!fs.existsSync(path.join(FIG, name, "live.js"))) { t.skip(`${name} not built in this tree yet`); return; }
    const svg = fs.readFileSync(path.join(FIG, name, `${name}.svg`), "utf8");
    assert.match(svg, /^<svg [^>]*class="iso-svg[^"]*"[^>]*viewBox="0 0 600 \d+"[^>]*role="img"[^>]*aria-label="[^"]+"/);
    assert.doesNotMatch(svg, /<script|<style|\son[a-z]+="|javascript:/i, "no script, style or handlers in the art");
    assert.doesNotMatch(svg, /(fill|stroke)="#|(fill|stroke):\s*#/i, "colours come from tokens");
    assert.ok(Buffer.byteLength(svg) < 250 * 1024, "under 250 KB");
    const live = await load(`${name}/live.js`);
    assert.equal(typeof live.mount, "function");
    assert.ok(Number.isInteger(live.META.fig));
    for (const key of ["title", "hint", "caption", "label"]) {
      const w = live.META.words[key];
      assert.ok(w?.en && w.hi && w.kn, `${key} in en, hi and kn`);
      assert.match(w.hi, /[ऀ-ॿ]/u, `${key} hi is Devanagari`);
      assert.match(w.kn, /[ಀ-೿]/u, `${key} kn is Kannada script`);
    }
  });
}

test("the landing page, its scripts and the figures carry no emoji: icons are SVG", () => {
  const files = [
    path.join(PUBLIC, "index.html"),
    path.join(PUBLIC, "css", "landing.css"),
    ...fs.readdirSync(path.join(PUBLIC, "js", "landing")).map((f) => path.join(PUBLIC, "js", "landing", f)),
    ...fs.readdirSync(FIG, { recursive: true }).filter((f) => /\.(js|svg|css|html)$/.test(f)).map((f) => path.join(FIG, f)),
  ];
  const emoji = /[←-⇿⌀-⏿☀-➿⬀-⯿️]|[\u{1F000}-\u{1FAFF}]/u;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const hit = text.match(emoji);
    assert.equal(hit, null, `${path.relative(PUBLIC, file)} contains ${hit && JSON.stringify(hit[0])}`);
  }
});
