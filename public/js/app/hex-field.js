// HexField: the page background. A true hex lattice of small lime dots, faded at the viewport edges,
// drawn ONCE into a fixed canvas at the device pixel ratio (capped at 2) and redrawn only when the
// viewport size, DPR or theme changes. Static: no animation loop, nothing to pause. The canvas is a
// sibling of the app (never inside a filtered/transformed ancestor), so every glass surface blurs it.
// Colour, alpha, pitch and dot size come from tokens-v3.css (--hex-rgb, --hex-alpha, --hex-pitch, --hex-dot).

import { hexLattice } from "./shell-geometry.js";

export function createHexField() {
  const canvas = document.createElement("canvas");
  canvas.className = "hex-field";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  let key = "";
  let raf = 0;

  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const num = (name, fallback) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const rgb = (cs.getPropertyValue("--hex-rgb") || "182, 242, 60").trim();
    return { rgb, alpha: num("--hex-alpha", 0.2), pitch: num("--hex-pitch", 22), dot: num("--hex-dot", 1.15) };
  }

  function draw() {
    raf = 0;
    if (!ctx) return;
    const w = document.documentElement.clientWidth || window.innerWidth;
    // Large-viewport height so mobile URL-bar show/hide never forces a redraw.
    const h = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tk = tokens();
    const next = [w, h, dpr, tk.rgb, tk.alpha, tk.pitch, tk.dot].join("|");
    if (next === key) return;
    key = next;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Snap each centre to the device pixel grid so dots stay round and crisp at 1, 1.25, 1.5, 2.
    const snap = (v) => Math.round(v * dpr) / dpr;
    const buckets = new Map();
    // No fade on the left from 600px: the sidebar floats there and its glass must show the dots.
    const edges = { l: w < 600, r: true, t: true, b: true };
    for (const p of hexLattice(w, h, tk.pitch, 0.12, edges)) {
      const a = Math.round(p.a * 10) / 10;
      if (!buckets.has(a)) buckets.set(a, []);
      buckets.get(a).push(p);
    }
    for (const [a, pts] of buckets) {
      ctx.fillStyle = `rgba(${tk.rgb}, ${(tk.alpha * a).toFixed(3)})`;
      ctx.beginPath();
      for (const p of pts) {
        const x = snap(p.x), y = snap(p.y);
        ctx.moveTo(x + tk.dot, y);
        ctx.arc(x, y, tk.dot, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(schedule, 120); }, { passive: true });
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", schedule); } catch { /* old browser */ }
  // DPR changes (moving the window to another screen, zoom).
  const watchDpr = () => {
    try {
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", () => { schedule(); watchDpr(); }, { once: true });
    } catch { /* old browser */ }
  };
  watchDpr();
  schedule();
  return { el: canvas, redraw: () => { key = ""; schedule(); } };
}
