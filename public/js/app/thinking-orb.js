// Vanilla canvas wrapper for thinking-orbs 0.3.2's framework-free engine
// (public/vendor/thinking-orbs-0.3.2/, byte-identical to the npm dist). Mirrors the package's own
// React component: resolve a preset, compute a frame with MODE_FRAMES, paint it; pause when the
// canvas is off-screen or the tab is hidden; one still frame under prefers-reduced-motion.
// The presets are tuned at 64 CSS px, so the frame is computed at 64 and scaled to the size asked.

import { MODE_FRAMES, resolvePreset, paintFrame } from "/vendor/thinking-orbs-0.3.2/engine.es.js";

/** Sahay agent state -> orb state (design spec 2026-11-19, business suite). */
const AGENT_TO_ORB = {
  idle: "breathing",
  listening: "listening",
  thinking: "solving",
  searching: "searching",
  bargaining: "weaving",
  composing: "composing",
  connecting: "connecting",
  working: "working",
  speaking: "breathing",
};
const BASE = 64;

export function orbStateFor(agentState) { return AGENT_TO_ORB[agentState] || "breathing"; }

function parseTint(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || "").trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return !matchMedia("(prefers-color-scheme: light)").matches;
}

/**
 * createThinkingOrb({ size, state, color, label }) -> { el, set(agentState), setSize(px), destroy() }
 * `state` is a Sahay agent state (see AGENT_TO_ORB). `color` / `lightColor`: #rrggbb tints for the
 * dark and light themes (lime / deep olive by default, tokens --lime and --lime-800).
 * The canvas is decorative unless `label` is given (then role="img" with that name).
 */
export function createThinkingOrb({ size = 64, state = "idle", color = "#B6F23C", lightColor = "#415F04", label } = {}) {
  const el = document.createElement("canvas");
  el.className = "torb";
  if (label) { el.setAttribute("role", "img"); el.setAttribute("aria-label", label); } else el.setAttribute("aria-hidden", "true");
  const ctx = el.getContext("2d");
  // Lime reads on piano black; on the light surface the same dots wash out, so light uses deep olive.
  const tints = { dark: parseTint(color), light: parseTint(lightColor) };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let css = size;
  let agentState = state;
  let mode = null, speed = 1, opts = null, speedMul = 1;
  let raf = 0, running = false, visible = true, dark = isDark();

  function configure() {
    const r = resolvePreset(orbStateFor(agentState), BASE);
    mode = r.mode; speed = r.speed; opts = r.opts;
    speedMul = agentState === "speaking" ? 2.4 : 1;
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(css * dpr);
    el.height = Math.round(css * dpr);
    el.style.width = `${css}px`;
    el.style.height = `${css}px`;
  }
  function paint(tSec) {
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = (css / BASE) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, BASE, BASE);
    paintFrame(ctx, MODE_FRAMES[mode](BASE, tSec, opts), dark, dark ? tints.dark : tints.light);
  }
  const now = () => (performance.now() / 1000) * speed * speedMul;
  const loop = () => { paint(now()); if (running) raf = requestAnimationFrame(loop); };
  function start() {
    if (running || reduced.matches || !visible || document.visibilityState === "hidden") return;
    running = true; raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function redraw() { stop(); paint(reduced.matches ? 0.6 : now()); start(); }

  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); })
    : null;
  if (io) io.observe(el);
  const onVis = () => { if (document.visibilityState === "hidden") stop(); else start(); };
  document.addEventListener("visibilitychange", onVis);
  const onTheme = () => { dark = isDark(); redraw(); };
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", onTheme);
  reduced.addEventListener("change", redraw);

  configure(); resize(); redraw();

  return {
    el,
    /** Switch to another agent state; the canvas gives a short fade so the change reads. */
    set(next) {
      if (!next || next === agentState) return;
      agentState = next;
      configure();
      el.classList.remove("torb-swap"); void el.offsetWidth; el.classList.add("torb-swap");
      redraw();
    },
    setSize(px) { if (px && px !== css) { css = px; resize(); redraw(); } },
    get state() { return agentState; },
    destroy() {
      stop(); if (io) io.disconnect(); mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onTheme); reduced.removeEventListener("change", redraw);
    },
  };
}
