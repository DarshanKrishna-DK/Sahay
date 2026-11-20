// Hero point cloud (concept from the owner's reference, gather.be-of-dao.com; no code or assets
// copied): lime points drift, gather into Sahay's orb, then into a rupee sign, and back. HUD
// trackers (DOM, mono labels) follow single points and name real story beats; hairlines join them.
// Canvas 2D only. Paused when off screen or the tab is hidden; one still orb under reduced motion.
// The top half of this file is pure (no DOM) so node:test can check it.

export const LIMITS = Object.freeze({ wide: [8000, 15000], narrow: [2000, 4000] });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** How many points to draw for a canvas of this CSS size: 8-15k on laptops, 2-4k on phones. */
export function pointCount({ width, height, coarse = false }) {
  const narrow = coarse || width < 700;
  const [lo, hi] = narrow ? LIMITS.narrow : LIMITS.wide;
  const n = Math.round((Math.max(0, width) * Math.max(0, height)) / (narrow ? 90 : 95));
  return clamp(n, lo, hi);
}

/** Small seeded random source (mulberry32), so the cloud looks the same on every visit. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n points evenly spread on a unit sphere (Fibonacci lattice), as x,y,z triples. */
export function fibonacciSphere(n) {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}

/** The rupee sign as centre lines (x right, y down, roughly -0.75..0.75): two bars, the bowl, the leg. */
export function rupeePolylines() {
  const bowl = [];
  const cx = -0.06, cy = -0.3, r = 0.32;
  for (let k = 0; k <= 24; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 24;
    bowl.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const lines = [
    [[-0.4, -0.62], [0.44, -0.62]],
    [[-0.4, -0.33], [0.44, -0.33]],
    bowl,
    [[-0.06, 0.02], [-0.4, 0.02]],
    [[-0.36, 0.02], [0.4, 0.8]],
  ];
  // Centre the glyph on 0,0.
  const ys = lines.flat().map((p) => p[1]);
  const xs = lines.flat().map((p) => p[0]);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  return lines.map((line) => line.map(([x, y]) => [x - mx, y - my]));
}

/** n points along the polylines (uniform by length), thickened by `width`, with a little depth. */
export function sampleStrokes(lines, n, rng, width = 0.1) {
  const segs = [];
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > 0) { segs.push({ x0, y0, x1, y1, len, at: total }); total += len; }
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = rng() * total;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].at <= d) lo = mid; else hi = mid - 1; }
    const s = segs[lo];
    const u = (d - s.at) / s.len;
    const nx = -(s.y1 - s.y0) / s.len, ny = (s.x1 - s.x0) / s.len;
    const off = (rng() - 0.5) * width;
    out[i * 3] = s.x0 + (s.x1 - s.x0) * u + nx * off;
    out[i * 3 + 1] = s.y0 + (s.y1 - s.y0) * u + ny * off;
    out[i * 3 + 2] = (rng() - 0.5) * 0.5;
  }
  return out;
}

/** The loop: drift, gather into the orb, become the rupee sign, then drift again. Seconds. */
export const CYCLE = Object.freeze([
  Object.freeze({ name: "swarm", dur: 2.6 }),
  Object.freeze({ name: "orb", dur: 6.5 }),
  Object.freeze({ name: "rupee", dur: 5.2 }),
]);
export const CYCLE_SECONDS = CYCLE.reduce((s, p) => s + p.dur, 0);

/** Which phase is on at time t (seconds), how far in, and the phase before it. */
export function phaseAt(t) {
  let x = ((t % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  for (let i = 0; i < CYCLE.length; i++) {
    if (x < CYCLE[i].dur || i === CYCLE.length - 1) {
      return { name: CYCLE[i].name, index: i, elapsed: x, prev: CYCLE[(i + CYCLE.length - 1) % CYCLE.length].name };
    }
    x -= CYCLE[i].dur;
  }
  return null;
}

/** Where the cloud sits in a canvas of w x h CSS px. `mode` comes from CSS (--gather-mode). */
export function layoutFor(w, h, mode, safeTop = 0) {
  if (mode === "wide") {
    const R = Math.max(60, Math.min(w * 0.2, h * 0.3, 330));
    return { mode, cx: w * 0.64, cy: safeTop + (h - safeTop) * 0.5, R };
  }
  const usable = Math.max(120, h - safeTop);
  const R = Math.max(50, Math.min(w * 0.34, (usable - 128) / 2, 260));
  return { mode, cx: w / 2, cy: safeTop + usable / 2, R };
}

/** Label slots around the cloud, in units of R; ax/ay say which point of the box sits on the slot. */
export const SLOTS = Object.freeze({
  wide: {
    seller: { x: 0.78, y: -0.98, ax: 0, ay: 1 },
    stock: { x: 1.2, y: 0.12, ax: 0, ay: 0.5 },
    yes: { x: 0.62, y: 1.06, ax: 0, ay: 0 },
    lang: { x: -0.8, y: -1.02, ax: 1, ay: 1 },
  },
  mid: {
    seller: { x: -1.05, y: -0.75, ax: 1, ay: 0.5 },
    stock: { x: 1.05, y: -0.45, ax: 0, ay: 0.5 },
    yes: { x: -1.05, y: 0.65, ax: 1, ay: 0.5 },
    lang: { x: 1.05, y: 0.85, ax: 0, ay: 0.5 },
  },
  phone: {
    seller: { x: 0, y: -1.14, ax: 0.5, ay: 1 },
    stock: { x: 0, y: 1.14, ax: 0.5, ay: 0 },
  },
});

/** Top-left of a w x h label for a slot, kept inside bounds {x0,y0,x1,y1}. */
export function placeTag(slot, lay, size, bounds) {
  const x = lay.cx + slot.x * lay.R - slot.ax * size.w;
  const y = lay.cy + slot.y * lay.R - slot.ay * size.h;
  return {
    x: clamp(x, bounds.x0, Math.max(bounds.x0, bounds.x1 - size.w)),
    y: clamp(y, bounds.y0, Math.max(bounds.y0, bounds.y1 - size.h)),
  };
}

/** The point of a rectangle nearest to (px, py): where a tracker's hairline meets its label. */
export function nearestOnRect(px, py, r) {
  return { x: clamp(px, r.x, r.x + r.w), y: clamp(py, r.y, r.y + r.h) };
}

/** Depth (-1 far .. 1 near) to one of four brightness buckets. */
export const bucketFor = (d) => (d < -0.45 ? 0 : d < 0.05 ? 1 : d < 0.5 ? 2 : 3);

// ---------------------------------------------------------------------------------------------
// DOM part

const RING_SHARE = 0.2;       // share of points on the orb's dotted ring
const START_AT = 1.3;         // seconds into the first drift when the page opens
const BUCKET_ALPHA = [0.2, 0.38, 0.62, 0.92];
const BUCKET_SIZE = [1.0, 1.25, 1.5, 1.8];
const LIME = "182, 242, 60";
const LIME_HI = "212, 255, 106";
const TRACK_DIRS = { seller: [0.55, -0.6, 0.58], stock: [0.85, 0.1, 0.5], yes: [0.3, 0.75, 0.58], lang: [-0.6, -0.55, 0.58] };

export function initGather(host, { reducedQuery = matchMedia("(prefers-reduced-motion: reduce)") } = {}) {
  const canvas = host.querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  if (!ctx) { host.dataset.state = "error"; return null; }

  const coarse = matchMedia("(pointer: coarse)").matches;
  const trackers = [...host.querySelectorAll(".tracker")].map((el) => ({
    key: el.dataset.track,
    reticle: el.querySelector(".reticle"),
    tag: el.querySelector(".tag"),
    idx: 0,
    rect: null,
    on: false,
  }));

  let W = 0, H = 0, dpr = 1, lay = null, slotSet = null;
  let n = 0;
  let px, py, vx, vy, orb, rup, sc, seed, stiff, delay, bucket;
  let t = START_AT, last = 0, raf = 0;
  let onScreen = false, visible = document.visibilityState === "visible";
  let phaseName = "";
  const pointer = { x: 0, y: 0, on: false };

  function build(count) {
    n = count;
    const rng = mulberry32(20261120);
    px = new Float32Array(n); py = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
    seed = new Float32Array(n); stiff = new Float32Array(n); delay = new Float32Array(n); bucket = new Uint8Array(n);
    const ringN = Math.round(n * RING_SHARE), shellN = n - ringN;
    const shell = fibonacciSphere(shellN);
    orb = new Float32Array(n * 3);
    orb.set(shell);
    for (let i = shellN; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 1.34 + (rng() - 0.5) * 0.05;
      orb[i * 3] = Math.cos(a) * rr;
      orb[i * 3 + 1] = (rng() - 0.5) * 0.03;
      orb[i * 3 + 2] = Math.sin(a) * rr;
    }
    // The glyph and the drift positions are drawn at random per index, so the shell's top-to-bottom
    // order never shows as bands when the cloud changes shape.
    rup = sampleStrokes(rupeePolylines(), n, rng, 0.1);
    sc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      sc[i * 3] = rng() * 2 - 1; sc[i * 3 + 1] = rng() * 2 - 1; sc[i * 3 + 2] = rng() * 2 - 1;
      seed[i] = rng();
      stiff[i] = 9 + rng() * 11;
      delay[i] = rng() * 0.9;
    }
    // Each tracker follows the shell point nearest to its direction (front-facing at rest).
    for (const tr of trackers) {
      const d = TRACK_DIRS[tr.key] || [0, 0, 1];
      const len = Math.hypot(...d);
      let best = 0, bestDot = -2;
      for (let i = 0; i < shellN; i++) {
        const dot = (orb[i * 3] * d[0] + orb[i * 3 + 1] * d[1] + orb[i * 3 + 2] * d[2]) / len;
        if (dot > bestDot) { bestDot = dot; best = i; }
      }
      tr.idx = best;
    }
    seedPositions();
  }

  function seedPositions() {
    if (!lay) return;
    for (let i = 0; i < n; i++) {
      if (reducedQuery.matches) { const p = orbPoint(i, 0.5); px[i] = p.x; py[i] = p.y; }
      else { px[i] = swarmX(i, t); py[i] = swarmY(i, t); }
      vx[i] = 0; vy[i] = 0;
    }
  }

  // Per-frame constants for the orb and the glyph.
  let cosA = 1, sinA = 0, cosS = 1, sinS = 0;
  const cosB = Math.cos(0.38), sinB = Math.sin(0.38);
  function frameConsts(time) {
    const a = time * 0.32;
    cosA = Math.cos(a); sinA = Math.sin(a);
    const s = Math.sin(time * 0.6) * 0.35;
    cosS = Math.cos(s); sinS = Math.sin(s);
  }
  const tmp = { x: 0, y: 0, z: 0 };
  function orbPoint(i, angle) {
    if (angle !== undefined) { cosA = Math.cos(angle); sinA = Math.sin(angle); }
    const x = orb[i * 3], y = orb[i * 3 + 1], z = orb[i * 3 + 2];
    const x1 = x * cosA + z * sinA;
    const z1 = -x * sinA + z * cosA;
    tmp.x = lay.cx + x1 * lay.R;
    tmp.y = lay.cy + (y * cosB - z1 * sinB) * lay.R;
    tmp.z = y * sinB + z1 * cosB;
    return tmp;
  }
  function rupeePoint(i) {
    const x = rup[i * 3], y = rup[i * 3 + 1], z = rup[i * 3 + 2];
    tmp.x = lay.cx + (x * cosS + z * sinS) * lay.R * 1.2;
    tmp.y = lay.cy + y * lay.R * 1.2;
    tmp.z = clamp(-x * sinS * 1.6 + z * cosS * 2, -1, 1);
    return tmp;
  }
  const swarmCx = () => (lay.mode === "wide" ? lay.cx - lay.R * 0.2 : W / 2);
  const swarmX = (i, time) => swarmCx() + sc[i * 3] * (lay.mode === "wide" ? W * 0.4 : W * 0.5) + Math.sin(time * 0.35 + seed[i] * 6.283) * lay.R * 0.14;
  const swarmY = (i, time) => lay.cy + sc[i * 3 + 1] * H * 0.5 + Math.cos(time * 0.29 + seed[i] * 9.1) * lay.R * 0.14;
  function target(name, i, time) {
    if (name === "orb") return orbPoint(i);
    if (name === "rupee") return rupeePoint(i);
    tmp.x = swarmX(i, time); tmp.y = swarmY(i, time); tmp.z = sc[i * 3 + 2];
    return tmp;
  }

  function step(dt) {
    t += dt;
    frameConsts(t);
    const ph = phaseAt(t);
    if (ph.name !== phaseName) { phaseName = ph.name; host.dataset.phase = ph.name; }
    const damp = Math.exp(-5.2 * dt);
    const jitter = ph.name === "swarm" ? 0 : 1.1;
    const rep = pointer.on ? 90 : 0, rep2 = rep * rep;
    for (let i = 0; i < n; i++) {
      const name = ph.elapsed < delay[i] ? ph.prev : ph.name;
      const p = target(name, i, t);
      const tx = p.x + Math.sin(t * 1.7 + seed[i] * 40) * jitter;
      const ty = p.y + Math.cos(t * 1.3 + seed[i] * 31) * jitter;
      bucket[i] = bucketFor(p.z);
      let ax = (tx - px[i]) * stiff[i];
      let ay = (ty - py[i]) * stiff[i];
      if (rep) {
        const dx = px[i] - pointer.x, dy = py[i] - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < rep2 && d2 > 0.01) { const f = (1 - d2 / rep2) * 2600 / Math.sqrt(d2); ax += dx * f; ay += dy * f; }
      }
      vx[i] = (vx[i] + ax * dt) * damp;
      vy[i] = (vy[i] + ay * dt) * damp;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
    }
  }

  function stillFrame() {
    t = 0;
    for (let i = 0; i < n; i++) {
      const p = orbPoint(i, 0.5);
      px[i] = p.x; py[i] = p.y; bucket[i] = bucketFor(p.z);
    }
    host.dataset.phase = "orb";
    phaseName = "";
  }

  function drawHud() {
    // Faint crosshair and tick marks through the cloud's centre (the HUD frame).
    const { cx, cy, R } = lay;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${LIME}, 0.10)`;
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.55, cy); ctx.lineTo(cx + R * 1.55, cy);
    ctx.moveTo(cx, cy - R * 1.45); ctx.lineTo(cx, cy + R * 1.45);
    for (let k = -6; k <= 6; k++) {
      if (k === 0) continue;
      const o = (k / 4) * R;
      ctx.moveTo(cx + o, cy - 4); ctx.lineTo(cx + o, cy + 4);
      ctx.moveTo(cx - 4, cy + o); ctx.lineTo(cx + 4, cy + o);
    }
    ctx.stroke();
  }

  function drawLinks() {
    const on = trackers.filter((tr) => tr.on && tr.rect);
    if (!on.length) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;
    // Hairlines between trackers, then each tracker to its label.
    ctx.strokeStyle = `rgba(${LIME_HI}, 0.16)`;
    ctx.beginPath();
    on.forEach((tr, k) => { const x = px[tr.idx], y = py[tr.idx]; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.strokeStyle = `rgba(${LIME_HI}, 0.5)`;
    ctx.beginPath();
    for (const tr of on) {
      const x = px[tr.idx], y = py[tr.idx];
      const q = nearestOnRect(x, y, tr.rect);
      ctx.moveTo(x, y); ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawHud();
    const swarm = phaseName === "swarm";
    ctx.globalCompositeOperation = "lighter";
    for (let b = 0; b < 4; b++) {
      const a = BUCKET_ALPHA[b] * (swarm ? 0.6 : 1);
      ctx.fillStyle = b === 3 ? `rgba(${LIME_HI}, ${a})` : `rgba(${LIME}, ${a})`;
      const s = BUCKET_SIZE[b];
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (bucket[i] === b) ctx.rect(px[i] - s / 2, py[i] - s / 2, s, s);
      ctx.fill();
    }
    drawLinks();
    for (const tr of trackers) {
      if (!tr.on) continue;
      tr.reticle.style.transform = `translate(${px[tr.idx].toFixed(1)}px, ${py[tr.idx].toFixed(1)}px)`;
    }
  }

  function placeTags() {
    if (!lay) return;
    const css = getComputedStyle(host);
    const safeTop = parseFloat(css.getPropertyValue("--safe-top")) || 0;
    const bounds = { x0: 8, y0: safeTop + 4, x1: W - 8, y1: H - 8 };
    for (const tr of trackers) {
      const slot = slotSet[tr.key];
      tr.on = Boolean(slot);
      tr.reticle.parentElement.hidden = !slot;
      if (!slot) { tr.rect = null; continue; }
      const size = { w: tr.tag.offsetWidth, h: tr.tag.offsetHeight };
      const at = placeTag(slot, lay, size, bounds);
      tr.rect = { x: at.x, y: at.y, w: size.w, h: size.h };
      tr.tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
    }
  }

  function resize() {
    const box = host.getBoundingClientRect();
    W = Math.max(1, Math.round(box.width));
    H = Math.max(1, Math.round(box.height));
    dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const css = getComputedStyle(host);
    const mode = css.getPropertyValue("--gather-mode").trim() || "phone";
    const safeTop = parseFloat(css.getPropertyValue("--safe-top")) || 0;
    lay = layoutFor(W, H, mode === "wide" ? "wide" : "narrow", safeTop);
    slotSet = SLOTS[mode] || SLOTS.phone;
    host.dataset.mode = mode;
    const want = pointCount({ width: W, height: H, coarse });
    if (!n || Math.abs(want - n) / n > 0.2) build(want);
    else seedPositions();
    placeTags();
    if (reducedQuery.matches) stillFrame();
    draw();
    host.dataset.state = "ready";
  }

  function loop(now) {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt);
    draw();
    schedule();
  }
  function schedule() {
    if (raf || reducedQuery.matches || !onScreen || !visible || !lay) return;
    raf = requestAnimationFrame((now) => { if (!last) last = now; loop(now); });
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
  function sync() {
    if (reducedQuery.matches) { stop(); if (lay) { stillFrame(); draw(); } return; }
    if (onScreen && visible) schedule(); else stop();
  }

  new ResizeObserver(() => resize()).observe(host);
  new IntersectionObserver((entries) => {
    for (const e of entries) onScreen = e.isIntersecting;
    sync();
  }).observe(host);
  document.addEventListener("visibilitychange", () => { visible = document.visibilityState === "visible"; sync(); });
  reducedQuery.addEventListener?.("change", () => { if (!reducedQuery.matches) seedPositions(); sync(); });

  if (!coarse) {
    const section = host.closest("section") || host;
    section.addEventListener("pointermove", (e) => {
      const r = host.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.on = !reducedQuery.matches;
    }, { passive: true });
    section.addEventListener("pointerleave", () => { pointer.on = false; });
  }

  return {
    /** Labels changed size (language switch): place them again and redraw. */
    relayout() { placeTags(); if (reducedQuery.matches) stillFrame(); draw(); },
  };
}
