// Landing v3: the hero point cloud (public/js/landing/gather.js) and the story stage
// (public/js/landing/story.js). Only their pure halves run here (no DOM). public/ is browser ESM
// inside a CommonJS package, so each file is loaded from its text as a data: module.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LANDING = path.join(__dirname, "..", "public", "js", "landing");
const load = (file) => {
  const source = fs.readFileSync(path.join(LANDING, file), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
};

test("gather: 8-15k points on a laptop, 2-4k on a phone", async () => {
  const G = await load("gather.js");
  for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [1000, 640]]) {
    const n = G.pointCount({ width: w, height: h });
    assert.ok(n >= 8000 && n <= 15000, `${w}x${h} -> ${n}`);
  }
  for (const [w, h] of [[360, 380], [390, 460], [430, 640], [600, 900]]) {
    const n = G.pointCount({ width: w, height: h });
    assert.ok(n >= 2000 && n <= 4000, `${w}x${h} -> ${n}`);
  }
  assert.ok(G.pointCount({ width: 1280, height: 800, coarse: true }) <= 4000, "a touch tablet gets the phone budget");
  assert.equal(G.pointCount({ width: 0, height: 0 }), 2000, "an unsized canvas starts at the floor");
});

test("gather: the orb's shell is on the unit sphere and the seeded source repeats", async () => {
  const G = await load("gather.js");
  const s = G.fibonacciSphere(500);
  for (let i = 0; i < 500; i++) {
    const r = Math.hypot(s[i * 3], s[i * 3 + 1], s[i * 3 + 2]);
    assert.ok(Math.abs(r - 1) < 1e-5, `point ${i} radius ${r}`);
  }
  const a = G.mulberry32(7), b = G.mulberry32(7);
  for (let i = 0; i < 20; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test("gather: the rupee glyph is centred and its points stay on the strokes", async () => {
  const G = await load("gather.js");
  const lines = G.rupeePolylines();
  assert.equal(lines.length, 5, "two bars, bowl, foot, leg");
  const all = lines.flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9, "centred in x");
  assert.ok(Math.abs(Math.min(...ys) + Math.max(...ys)) < 1e-9, "centred in y");
  const pts = G.sampleStrokes(lines, 3000, G.mulberry32(1), 0.1);
  // Distance from each sample to the nearest stroke segment is at most half the stroke width.
  const segs = lines.flatMap((l) => l.slice(1).map((p, i) => [l[i], p]));
  const distSeg = (x, y, [[x0, y0], [x1, y1]]) => {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L));
    return Math.hypot(x - (x0 + u * dx), y - (y0 + u * dy));
  };
  for (let i = 0; i < 3000; i++) {
    const d = Math.min(...segs.map((s) => distSeg(pts[i * 3], pts[i * 3 + 1], s)));
    assert.ok(d <= 0.0501, `sample ${i} is ${d} off the strokes`);
    assert.ok(Math.abs(pts[i * 3 + 2]) <= 0.25);
  }
});

test("gather: the loop drifts, gathers into the orb, becomes the rupee sign, and repeats", async () => {
  const G = await load("gather.js");
  assert.deepEqual(G.CYCLE.map((p) => p.name), ["swarm", "orb", "rupee"]);
  assert.equal(G.phaseAt(0).name, "swarm");
  assert.equal(G.phaseAt(3).name, "orb");
  assert.equal(G.phaseAt(3).prev, "swarm");
  assert.equal(G.phaseAt(10).name, "rupee");
  assert.equal(G.phaseAt(G.CYCLE_SECONDS + 0.1).name, "swarm");
  assert.equal(G.phaseAt(-0.1).name, "rupee", "wraps backwards too");
  assert.ok(Math.abs(G.phaseAt(3).elapsed - 0.4) < 1e-9);
});

test("gather: labels sit beside the cloud and never leave the canvas", async () => {
  const G = await load("gather.js");
  for (const [w, h, mode, slots] of [[1440, 900, "wide", "wide"], [1000, 720, "wide", "wide"], [768, 520, "narrow", "mid"], [360, 380, "narrow", "phone"]]) {
    const lay = G.layoutFor(w, h, mode, mode === "wide" ? 88 : 74);
    assert.ok(lay.R > 40 && lay.cx - lay.R >= 0 && lay.cx + lay.R <= w, `${w}x${h} cloud inside`);
    const bounds = { x0: 8, y0: 80, x1: w - 8, y1: h - 8 };
    for (const [key, slot] of Object.entries(G.SLOTS[slots])) {
      const size = { w: 210, h: 52 };
      const at = G.placeTag(slot, lay, size, bounds);
      assert.ok(at.x >= 8 && at.x + size.w <= w - 8, `${slots}.${key} x inside at ${w}`);
      assert.ok(at.y >= 80 && at.y + size.h <= h - 8, `${slots}.${key} y inside at ${w}x${h}`);
    }
  }
  assert.deepEqual(Object.keys(G.SLOTS.phone), ["seller", "stock"], "phones show two trackers");
  assert.deepEqual(G.nearestOnRect(0, 0, { x: 10, y: 10, w: 5, h: 5 }), { x: 10, y: 10 });
  assert.deepEqual(G.nearestOnRect(12, 30, { x: 10, y: 10, w: 5, h: 5 }), { x: 12, y: 15 });
  assert.deepEqual([-1, -0.2, 0.3, 0.9].map(G.bucketFor), [0, 1, 2, 3]);
});

test("story: chapters cross-dissolve at each seam, the first and last hold at the ends", async () => {
  const S = await load("story.js");
  const n = 8;
  const start = S.chapterFrames(0, n);
  assert.equal(start[0].opacity, 1);
  assert.ok(start.slice(1).every((f) => f.opacity === 0));
  assert.equal(start[0].current, true);
  const end = S.chapterFrames(1, n);
  assert.equal(end[n - 1].opacity, 1);
  assert.ok(end.slice(0, -1).every((f) => f.opacity === 0));
  // At a seam two neighbours share the screen half and half; never a blank frame.
  const seam = S.chapterFrames(3 / n, n);
  assert.ok(Math.abs(seam[2].opacity - 0.5) < 1e-9 && Math.abs(seam[3].opacity - 0.5) < 1e-9);
  for (let k = 0; k <= 400; k++) {
    const frames = S.chapterFrames(k / 400, n);
    const total = frames.reduce((s, f) => s + f.opacity, 0);
    assert.ok(total >= 0.999, `progress ${k / 400}: something is on screen (${total})`);
    assert.equal(frames.filter((f) => f.current).length, 1);
    assert.ok(frames.every((f) => f.local >= 0 && f.local <= 1));
  }
  // Mid-slot: only that chapter, fully.
  const mid = S.chapterFrames(4.5 / n, n);
  assert.equal(mid[4].opacity, 1);
  assert.equal(mid[4].current, true);
});

test("story: a rail jump lands in the middle of the chapter's slot", async () => {
  const S = await load("story.js");
  const n = 8, vh = 800, height = n * 0.9 * vh + vh, top = 1200;
  const y = S.chapterScrollTop(top, height, vh, 2, n);
  const p = (y - top) / (height - vh);
  const frames = S.chapterFrames(p, n);
  assert.equal(frames[2].current, true);
  assert.equal(frames[2].opacity, 1);
});

test("gather: relayout before the first resize is a no-op, after it the cloud draws (DOM stubs)", async () => {
  const G = await load("gather.js");
  const saved = {};
  for (const k of ["matchMedia", "ResizeObserver", "IntersectionObserver", "document", "getComputedStyle", "window", "devicePixelRatio", "requestAnimationFrame", "cancelAnimationFrame"]) saved[k] = globalThis[k];
  const mq = (matches) => ({ matches, addEventListener() {} });
  const observers = [];
  globalThis.matchMedia = (q) => mq(/reduce/.test(q));
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} };
  globalThis.IntersectionObserver = class { constructor() {} observe() {} };
  globalThis.document = { visibilityState: "visible", addEventListener() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => (name === "--gather-mode" ? "wide" : name === "--safe-top" ? "88" : "") });
  globalThis.devicePixelRatio = 1;
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  let calls = 0;
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => { calls++; }), set: (target, key, v) => { target[key] = v; return true; } });
  const canvas = { getContext: () => ctx, width: 0, height: 0 };
  const host = {
    dataset: {},
    querySelector: () => canvas,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ width: 1440, height: 900, left: 0, top: 0 }),
    addEventListener() {},
  };
  try {
    const handle = G.initGather(host, { reducedQuery: mq(true) });
    assert.doesNotThrow(() => handle.relayout(), "no layout yet: nothing to do");
    assert.equal(calls, 0, "nothing drawn before the canvas is measured");
    observers[0].cb([]); // the first resize measures the canvas
    assert.equal(host.dataset.state, "ready");
    assert.equal(host.dataset.mode, "wide");
    assert.ok(calls > 0, "drawn after the first resize");
    assert.doesNotThrow(() => handle.relayout());
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
});
