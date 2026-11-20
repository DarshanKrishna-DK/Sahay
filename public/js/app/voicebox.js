// Sahay's agent figure: a small counter "voice box" (shop radio / intercom), drawn with the
// anatomy kit by scripts/figures/voicebox/build.mjs into /figures/voicebox/voicebox.svg + .css.
//
//   const box = createVoicebox({ size: 200 });
//   host.append(box.el);
//   box.setState("listening");   // idle | listening | thinking | speaking | waiting | trouble
//   box.setLevel(0.6);           // mic or voice level 0..1 (listening / speaking)
//   box.destroy();
//
// Motion is CSS (lamp, grille ripples) plus one rAF loop for the dial needle and the level. Both
// run only while the figure is on screen, the tab is visible and reduced motion is off; otherwise
// each state shows its still pose. No imports and no DOM access at load, so node:test can load it.

export const STATES = Object.freeze(["idle", "listening", "thinking", "speaking", "waiting", "trouble"]);
export const SVG_URL = "/figures/voicebox/voicebox.svg";
export const CSS_URL = "/figures/voicebox/voicebox.css";

/** The dial, in degrees clockwise from straight up on the dial face (matches the build). */
export const NEEDLE = Object.freeze({ rest: -52, top: 52, drop: -61, pivot: Object.freeze([27, -47.5]) });
const SPAN = NEEDLE.top - NEEDLE.rest;

/** Small sizes hide hairline texture (mesh holes, faint grooves) so the figure stays crisp. */
export const LOW_DETAIL_BELOW = 140;

export function isState(state) {
  return STATES.includes(state);
}

export function clampLevel(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** What each state looks like when nothing moves (reduced motion): needle angle and lamp. */
export function stillPose(state) {
  if (!isState(state)) throw new TypeError(`voicebox: unknown state "${state}"`);
  switch (state) {
    case "idle": return { needle: NEEDLE.rest, lamp: "soft", ripple: "none" };
    case "listening": return { needle: NEEDLE.rest + SPAN * 0.35, lamp: "on", ripple: "in" };
    case "thinking": return { needle: 0, lamp: "half", ripple: "none" };
    case "speaking": return { needle: NEEDLE.rest + SPAN * 0.6, lamp: "on", ripple: "out" };
    case "waiting": return { needle: 0, lamp: "steady", ripple: "none" };
    case "trouble": return { needle: NEEDLE.drop, lamp: "amber", ripple: "none" };
  }
  return null;
}

/** Where the needle heads at time t (s) with the smoothed level, while motion is on. */
export function needleTarget(state, t = 0, level = 0) {
  const l = clampLevel(level);
  switch (state) {
    case "listening": return NEEDLE.rest + SPAN * (0.06 + 0.8 * l);
    case "speaking": return NEEDLE.rest + SPAN * (0.2 + 0.7 * l);
    case "thinking": return 30 * Math.sin((2 * Math.PI * t) / 3.6);
    default: return stillPose(state).needle;
  }
}

/** A calm spring for the needle (a little overshoot, settles in about a second). */
export function needleStep(s, target, dt) {
  const stiff = 70;
  const drag = 2 * Math.sqrt(stiff) * 0.72;
  const n = 4;
  for (let i = 0; i < n; i++) {
    s.v += ((target - s.a) * stiff - s.v * drag) * (dt / n);
    s.a += s.v * (dt / n);
  }
  if (Math.abs(target - s.a) < 0.02 && Math.abs(s.v) < 0.02) {
    s.a = target;
    s.v = 0;
    return true;
  }
  return false;
}

/** The level follows the input quickly up and slowly down, like a meter. */
export function levelStep(current, target, dt) {
  const tau = target > current ? 0.06 : 0.32;
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(target - next) < 0.002 ? target : next;
}

const ALWAYS_MOVING = new Set(["listening", "thinking", "speaking"]);
let svgText = null;
let instances = 0;

function defaults() {
  const g = globalThis;
  return {
    document: g.document,
    fetch: g.fetch?.bind(g),
    matchMedia: g.matchMedia?.bind(g),
    IntersectionObserver: g.IntersectionObserver,
    requestAnimationFrame: g.requestAnimationFrame?.bind(g),
    cancelAnimationFrame: g.cancelAnimationFrame?.bind(g),
    parseSvg: (text, doc) => {
      const parsed = new g.DOMParser().parseFromString(text, "image/svg+xml").documentElement;
      if (!parsed || parsed.nodeName !== "svg") throw new Error("voicebox: the art is not an SVG");
      return doc.importNode(parsed, true);
    },
  };
}

function loadArt(env, url) {
  if (url === SVG_URL && svgText) return svgText;
  const p = env.fetch(url, { credentials: "same-origin" }).then((res) => {
    if (!res.ok) throw new Error(`voicebox: art HTTP ${res.status}`);
    return res.text();
  });
  if (url === SVG_URL) svgText = p.catch((err) => { svgText = null; throw err; });
  return p;
}

function ensureCss(doc, href) {
  if (!href || !doc.head || doc.querySelector(`link[data-voicebox-css]`)) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-voicebox-css", "");
  doc.head.append(link);
}

/**
 * createVoicebox({ size = 200, reduced, label, svgUrl, cssUrl, env })
 *   size     px, square (96 to 240 look right)
 *   reduced  true/false forces the still poses; omitted, follows prefers-reduced-motion
 *   label    accessible name; omitted, the figure is decorative (aria-hidden)
 *   env      test seam: { document, fetch, matchMedia, IntersectionObserver, requestAnimationFrame,
 *            cancelAnimationFrame, parseSvg }
 * Returns { el, setState(state), setLevel(n), destroy(), ready, get state() }.
 * `ready` rejects (and el gets data-load="error") if the art cannot load. No fallback art.
 */
export function createVoicebox({ size = 200, reduced, label, svgUrl = SVG_URL, cssUrl = CSS_URL, env } = {}) {
  const E = { ...defaults(), ...env };
  const doc = E.document;
  if (!doc) throw new Error("voicebox: needs a document");
  const px = Math.max(48, Math.round(Number(size) || 200));
  const id = ++instances;

  const el = doc.createElement("div");
  el.className = "vbx";
  el.dataset.state = "idle";
  el.dataset.motion = "off";
  el.dataset.load = "loading";
  el.dataset.detail = px < LOW_DETAIL_BELOW ? "low" : "full";
  el.style.width = `${px}px`;
  el.style.height = `${px}px`;
  if (label) {
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
  } else {
    el.setAttribute("aria-hidden", "true");
  }
  ensureCss(doc, cssUrl);

  let state = "idle";
  let needle = null;
  const dial = { a: NEEDLE.rest, v: 0 };
  let level = 0;
  let levelTarget = 0;
  let shownLevel = -1;
  let clock = 0;
  let last = 0;
  let frame = 0;
  let onScreen = !E.IntersectionObserver; // without an observer, assume visible
  let tabHidden = Boolean(doc.hidden);
  let destroyed = false;

  const query = typeof reduced === "boolean" || !E.matchMedia ? null : E.matchMedia("(prefers-reduced-motion: reduce)");
  const isReduced = () => (typeof reduced === "boolean" ? reduced : Boolean(query?.matches));
  const moving = () => !destroyed && onScreen && !tabHidden && !isReduced();

  const writeNeedle = () => {
    if (needle) needle.setAttribute("transform", `rotate(${Math.round(dial.a * 100) / 100} ${NEEDLE.pivot[0]} ${NEEDLE.pivot[1]})`);
  };
  const writeLevel = (v) => {
    const r = Math.round(v * 100) / 100;
    if (r === shownLevel) return;
    shownLevel = r;
    el.style.setProperty("--vbx-level", String(r));
  };

  function still() {
    // Reduced motion: jump to the state's pose; no loop, no level.
    const pose = stillPose(state);
    dial.a = pose.needle;
    dial.v = 0;
    level = 0;
    writeLevel(0);
    writeNeedle();
  }

  function tick(now) {
    frame = 0;
    if (!moving()) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    level = levelStep(level, ALWAYS_MOVING.has(state) && state !== "thinking" ? levelTarget : 0, dt);
    writeLevel(level);
    const settled = needleStep(dial, needleTarget(state, clock, level), dt);
    writeNeedle();
    const busy = !settled || ALWAYS_MOVING.has(state) || level !== 0;
    if (busy) frame = E.requestAnimationFrame(tick);
  }

  function sync() {
    const on = moving();
    el.dataset.motion = on ? "on" : "off";
    if (isReduced()) {
      if (frame) E.cancelAnimationFrame?.(frame);
      frame = 0;
      still();
      return;
    }
    if (on && !frame && E.requestAnimationFrame) {
      last = 0;
      frame = E.requestAnimationFrame(tick);
    } else if (!on && frame) {
      E.cancelAnimationFrame?.(frame);
      frame = 0;
    }
  }

  const io = E.IntersectionObserver
    ? new E.IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        sync();
      }, { rootMargin: "80px 0px" })
    : null;
  io?.observe(el);
  const onVisibility = () => { tabHidden = Boolean(doc.hidden); sync(); };
  doc.addEventListener?.("visibilitychange", onVisibility);
  const onReduced = () => sync();
  query?.addEventListener?.("change", onReduced);

  const ready = Promise.resolve()
    .then(() => loadArt(E, svgUrl))
    .then((text) => {
      if (destroyed) return;
      const unique = text.replace(/id="vbx-/g, `id="vbx${id}-`).replace(/url\(#vbx-/g, `url(#vbx${id}-`);
      const art = E.parseSvg(unique, doc);
      needle = art.querySelector('[data-part="needle"]');
      if (!needle) throw new Error("voicebox: the art has no needle");
      el.append(art);
      el.dataset.load = "ready";
      if (isReduced()) still();
      else writeNeedle();
    })
    .catch((err) => {
      el.dataset.load = "error";
      throw err;
    });
  ready.catch(() => {}); // callers may await ready; an unobserved failure is already on data-load

  sync();

  return {
    el,
    ready,
    get state() { return state; },
    setState(next) {
      if (!isState(next)) throw new TypeError(`voicebox: unknown state "${next}"`);
      if (destroyed) return;
      state = next;
      el.dataset.state = next;
      if (next !== "listening" && next !== "speaking") levelTarget = 0;
      sync();
    },
    setLevel(n) {
      if (destroyed) return;
      levelTarget = clampLevel(n);
      if (!isReduced()) sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame) E.cancelAnimationFrame?.(frame);
      frame = 0;
      io?.disconnect();
      doc.removeEventListener?.("visibilitychange", onVisibility);
      query?.removeEventListener?.("change", onReduced);
      el.dataset.motion = "off";
      el.remove();
    },
  };
}
