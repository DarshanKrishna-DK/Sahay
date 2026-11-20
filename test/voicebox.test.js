"use strict";

/**
 * public/js/app/voicebox.js: Sahay's agent figure (the counter voice box). DOM-free: the module is
 * loaded as data, the browser pieces are passed in as small fakes through `env`. Also checks the
 * built art (public/figures/voicebox/voicebox.svg + .css) against what the module expects.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/voicebox.js"))}`);
const ART = read("public/figures/voicebox/voicebox.svg");
const CSS = read("public/figures/voicebox/voicebox.css");

function fakeElement(tag = "div") {
  const attrs = new Map();
  const props = new Map();
  const el = {
    tag,
    className: "",
    dataset: {},
    children: [],
    removed: false,
    style: { setProperty: (k, v) => props.set(k, v), get: (k) => props.get(k) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    append: (...nodes) => el.children.push(...nodes),
    remove: () => { el.removed = true; },
  };
  return el;
}

function fakeEnv({ fail = false, observer = false } = {}) {
  const head = fakeElement("head");
  const listeners = new Map();
  const frames = [];
  let cancelled = 0;
  let observerCallback = null;
  const needle = fakeElement("g");
  const env = {
    document: {
      head,
      hidden: false,
      createElement: (tag) => fakeElement(tag),
      querySelector: () => null,
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    },
    fetch: async () => (fail ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => ART }),
    matchMedia: undefined,
    IntersectionObserver: observer
      ? class { constructor(cb) { observerCallback = cb; } observe() {} disconnect() { observerCallback = null; } }
      : undefined,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { cancelled++; },
    parseSvg: (text) => {
      env.parsedText = text;
      return { querySelector: (sel) => (sel === '[data-part="needle"]' ? needle : null) };
    },
  };
  return {
    env,
    head,
    needle,
    frames,
    get cancelled() { return cancelled; },
    see: (on) => observerCallback?.([{ isIntersecting: on }]),
    run(seconds, fps = 60) {
      let t = 1000;
      for (let i = 0; i < seconds * fps; i++) {
        const fn = frames.shift();
        if (!fn) return i;
        t += 1000 / fps;
        fn(t);
      }
      return seconds * fps;
    },
  };
}

const angleOf = (el) => Number(/rotate\((-?[\d.]+) /.exec(el.getAttribute("transform"))[1]);

test("voicebox: six states in a fixed order, each with its own still pose", async () => {
  const V = await load();
  assert.deepEqual([...V.STATES], ["idle", "listening", "thinking", "speaking", "waiting", "trouble"]);
  assert.ok(Object.isFrozen(V.STATES));
  for (const s of V.STATES) {
    const pose = V.stillPose(s);
    assert.ok(pose.needle >= V.NEEDLE.drop && pose.needle <= V.NEEDLE.top, `${s}: needle on the dial`);
  }
  assert.equal(V.stillPose("idle").needle, V.NEEDLE.rest, "idle: needle at rest");
  assert.ok(V.stillPose("trouble").needle < V.NEEDLE.rest, "trouble: the needle drops past rest");
  assert.equal(V.stillPose("trouble").lamp, "amber");
  assert.equal(V.stillPose("waiting").lamp, "steady");
  assert.equal(V.stillPose("listening").ripple, "in");
  assert.equal(V.stillPose("speaking").ripple, "out");
  assert.throws(() => V.stillPose("dancing"), TypeError);
});

test("voicebox: the needle follows the level, sweeps while thinking and settles calmly", async () => {
  const V = await load();
  assert.ok(V.needleTarget("listening", 0, 1) > V.needleTarget("listening", 0, 0.2));
  assert.ok(V.needleTarget("speaking", 0, 0.9) > V.needleTarget("speaking", 0, 0.1));
  assert.equal(V.needleTarget("listening", 0, 7), V.needleTarget("listening", 0, 1), "level is clamped");
  assert.equal(V.clampLevel(NaN), 0);
  assert.equal(V.clampLevel(-2), 0);
  const sweep = [0, 0.9, 1.8, 2.7].map((t) => V.needleTarget("thinking", t));
  assert.ok(sweep.every((a) => Math.abs(a) <= 30.001), "thinking stays within a gentle arc");
  assert.ok(new Set(sweep.map((a) => a.toFixed(1))).size > 2, "thinking moves");
  assert.equal(V.needleTarget("waiting", 5), V.stillPose("waiting").needle);

  const s = { a: V.NEEDLE.rest, v: 0 };
  let peak = s.a;
  let settledAt = null;
  for (let i = 0; i < 60 * 4 && settledAt === null; i++) {
    if (V.needleStep(s, 0, 1 / 60)) settledAt = i / 60;
    peak = Math.max(peak, s.a);
  }
  assert.ok(settledAt !== null && settledAt < 3, "settles within 3 s");
  assert.equal(s.a, 0);
  assert.ok(peak < 0.15 * (0 - V.NEEDLE.rest), "overshoot stays small");

  const up = V.levelStep(0, 1, 0.05);
  const down = 1 - V.levelStep(1, 0, 0.05);
  assert.ok(up > down, "the meter rises faster than it falls");
});

test("voicebox art: one static SVG with the needle at rest, three ripples, a lamp, and one engraved word", async () => {
  const V = await load();
  assert.ok(ART.startsWith("<svg"), "an SVG fragment");
  assert.ok(Buffer.byteLength(ART) < 250 * 1024, "under 250 KB");
  assert.ok(!/<script|<style|\sstyle=|\son\w+=/i.test(ART), "no script, style or handlers (strict CSP)");
  assert.ok(!/(fill|stroke)="#/i.test(ART), "no colours typed into the art");
  assert.match(ART, new RegExp(`data-part="needle" transform="rotate\\(${V.NEEDLE.rest} ${V.NEEDLE.pivot[0]} ${V.NEEDLE.pivot[1]}\\)"`));
  assert.equal((ART.match(/class="vbx-ripple"/g) || []).length, 3);
  assert.match(ART, /class="vbx-lamp"/);
  const words = [...ART.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(words, ["SAHAY"], "the only text is the engraved label");
  for (const m of ART.matchAll(/\sid="([^"]+)"/g)) assert.ok(m[1].startsWith("vbx-"), `id ${m[1]} is namespaced`);
  for (const s of ["listening", "thinking", "speaking", "waiting", "trouble", "idle"]) assert.match(CSS, new RegExp(`data-state="${s}"`), `css styles ${s}`);
  assert.match(CSS, /prefers-reduced-motion: reduce/);
  assert.match(CSS, /data-motion="on"/, "animations only while motion is on");
});

test("voicebox: API shape; reduced motion shows still poses and never asks for frames", async () => {
  const V = await load();
  const f = fakeEnv();
  const box = V.createVoicebox({ size: 96, reduced: true, svgUrl: "/test/a.svg", env: f.env });
  assert.deepEqual(Object.keys(box).sort(), ["destroy", "el", "ready", "setLevel", "setState", "state"]);
  assert.equal(typeof box.setState, "function");
  assert.equal(typeof box.setLevel, "function");
  assert.equal(typeof box.destroy, "function");
  assert.equal(box.el.className, "vbx");
  assert.equal(box.el.dataset.detail, "low", "96 px drops the hairline texture");
  assert.equal(box.el.style.width, "96px");
  assert.equal(box.el.getAttribute("aria-hidden"), "true", "decorative unless labelled");
  assert.equal(f.head.children.length, 1, "links its stylesheet once");
  await box.ready;
  assert.equal(box.el.dataset.load, "ready");
  assert.match(f.env.parsedText, /id="vbx\d+-grille"/, "ids are made unique per instance");
  for (const s of V.STATES) {
    box.setState(s);
    box.setLevel(0.9);
    assert.equal(box.el.dataset.state, s);
    assert.equal(box.state, s);
    assert.equal(box.el.dataset.motion, "off");
    assert.ok(Math.abs(angleOf(f.needle) - V.stillPose(s).needle) < 0.01, `${s}: still needle`);
  }
  assert.equal(f.frames.length, 0, "no animation frames under reduced motion");
  assert.throws(() => box.setState("dancing"), TypeError);
  box.destroy();
  assert.equal(box.el.removed, true);
});

test("voicebox: with motion on, the needle eases toward its target and stops off screen", async () => {
  const V = await load();
  const f = fakeEnv({ observer: true });
  const box = V.createVoicebox({ size: 200, reduced: false, label: "Sahay", svgUrl: "/test/b.svg", env: f.env });
  await box.ready;
  assert.equal(box.el.dataset.detail, "full");
  assert.equal(box.el.getAttribute("aria-label"), "Sahay");
  assert.equal(box.el.dataset.motion, "off", "nothing runs before it is on screen");
  f.see(true);
  assert.equal(box.el.dataset.motion, "on");
  box.setState("trouble");
  f.run(0.1);
  const early = angleOf(f.needle);
  assert.ok(early < V.NEEDLE.rest && early > V.NEEDLE.drop, "eases, does not jump");
  f.run(4);
  assert.equal(angleOf(f.needle), V.NEEDLE.drop, "settles at the drop");
  assert.equal(f.frames.length, 0, "a settled still state stops asking for frames");
  box.setState("listening");
  box.setLevel(1);
  f.run(1);
  assert.ok(angleOf(f.needle) > V.NEEDLE.rest + 20, "listening: the needle follows the mic level");
  assert.ok(Number(box.el.style.get("--vbx-level")) > 0.9);
  const before = f.cancelled;
  f.see(false);
  assert.equal(box.el.dataset.motion, "off");
  assert.ok(f.cancelled > before, "off screen cancels the frame loop");
  box.destroy();
});

test("voicebox: art that cannot load is an error, not a fallback", async () => {
  const V = await load();
  const f = fakeEnv({ fail: true });
  const box = V.createVoicebox({ reduced: true, svgUrl: "/test/missing.svg", env: f.env });
  await assert.rejects(box.ready, /HTTP 404/);
  assert.equal(box.el.dataset.load, "error");
  box.destroy();
});
