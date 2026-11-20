// Sahay's hero orb on the home screen: a lime thinking orb (thinking-orbs 0.3.2 through
// thinking-orb.js) seated in a polished piano-black well. One button, seven looks
// (idle, connecting, listening, thinking, speaking, working, error) set by data-visual, plus the
// richer data-state for the words next to it. The rim swells with the live voice level (the
// owner's mic while listening, Sahay's voice while speaking), straight from the call.
// The orb starts a call on the home screen; it never ends one (End is its own red button, D12).

import { h, icon } from "./dom.js";
import { onLevels } from "./call.js";
import { createThinkingOrb } from "./thinking-orb.js";

// Lime on piano black; deep olive on the light surface (tokens-v3: --lime-400 / --lime-800).
const LIME = "#B6F23C";
const LIME_ON_LIGHT = "#415F04";

/** createOrb({ onPress, size }) -> { el, set({ visual, state, label, agent, badge }), destroy() } */
export function createOrb({ onPress, size = 240 } = {}) {
  const torb = createThinkingOrb({ size: Math.round(size * 0.62), state: "idle", color: LIME, lightColor: LIME_ON_LIGHT });
  const badge = h("span", { class: "sh-orb-badge", "aria-hidden": "true", hidden: true });
  const el = h("button", { class: "sh-orb", type: "button", dataset: { visual: "idle", state: "idle" } },
    h("span", { class: "sh-orb-level", "aria-hidden": "true" }),
    h("span", { class: "sh-orb-well", "aria-hidden": "true" }),
    h("span", { class: "sh-orb-ring", "aria-hidden": "true" }),
    h("span", { class: "sh-orb-core", "aria-hidden": "true" }, torb.el),
    badge);
  el.addEventListener("click", () => onPress && onPress());

  // The canvas follows the button's rendered size (CSS sets it per size class).
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    const px = Math.round(el.clientWidth * 0.62);
    if (px > 0) torb.setSize(px);
  }) : null;
  if (ro) ro.observe(el);

  let level = 0;
  let raf = 0;
  const off = onLevels(({ mic, agent }) => {
    const v = el.dataset.visual;
    const target = v === "speaking" ? Math.min(1, agent * 1.4) : v === "listening" && el.dataset.state !== "muted" ? Math.min(1, mic * 1.6) : 0;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      level += (target - level) * 0.5;
      el.style.setProperty("--level", level.toFixed(3));
    });
  });

  let lastBadge = null;
  return {
    el,
    /**
     * visual: one of the seven looks; state: the finer state (data-state, for CSS tone);
     * agent: the thinking-orbs animation (activity.js agentState); badge: icon name or null.
     */
    set({ visual, state, label, agent, badge: b, pressable = true }) {
      el.dataset.visual = visual;
      el.dataset.state = state;
      el.setAttribute("aria-label", label);
      el.setAttribute("aria-disabled", pressable ? "false" : "true");
      torb.set(visual === "error" ? "idle" : agent || "idle");
      if (b !== lastBadge) {
        lastBadge = b;
        badge.replaceChildren(...(b ? [icon(b, 22)] : []));
        badge.hidden = !b;
      }
      if (visual !== "listening" && visual !== "speaking") { level = 0; el.style.setProperty("--level", "0"); }
    },
    destroy() { off(); if (ro) ro.disconnect(); torb.destroy(); },
  };
}

/** A small orb for the call dock: same canvas, no well, no button. */
export function createMiniOrb(size = 40) {
  const torb = createThinkingOrb({ size, state: "idle", color: LIME, lightColor: LIME_ON_LIGHT });
  const el = h("span", { class: "sh-mini-orb", "aria-hidden": "true", dataset: { visual: "idle" } }, torb.el);
  return {
    el,
    set(visual, agent) { el.dataset.visual = visual; torb.set(visual === "error" ? "idle" : agent || "idle"); },
    destroy() { torb.destroy(); },
  };
}
