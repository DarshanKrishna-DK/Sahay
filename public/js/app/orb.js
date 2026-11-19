// The agent orb: the biggest thing on the Talk screen. A button (tap = start or end the call)
// holding a thinking orb (thinking-orbs 0.3.2 via thinking-orb.js) whose animation follows the
// agent: breathing when idle, a rolling wave while it listens, scrambling bands while it thinks,
// a scanning globe while it finds sellers, plaited strands while it bargains, a sash while it
// composes a bill, a wiring constellation while connecting. A thin ring and voice ripples sit
// around it; the ring swells with the live voice level (mic or Sahay), straight from the call.

import { h } from "./dom.js";
import { onLevels } from "./call.js";
import { createThinkingOrb } from "./thinking-orb.js";

export function createOrb({ onPress }) {
  const torb = createThinkingOrb({ size: 240, state: "idle" });
  const el = h("button", { class: "orb", type: "button", dataset: { state: "idle", agent: "idle" } },
    h("span", { class: "orb-halo", "aria-hidden": "true" }),
    h("span", { class: "orb-ripple r1", "aria-hidden": "true" }),
    h("span", { class: "orb-ripple r2", "aria-hidden": "true" }),
    h("span", { class: "orb-ring", "aria-hidden": "true" }),
    h("span", { class: "orb-canvas", "aria-hidden": "true" }, torb.el));
  el.addEventListener("click", () => onPress());

  // The canvas follows the button's size (set in CSS with clamp()).
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    const px = Math.round(el.clientWidth * 0.8);
    if (px > 0) torb.setSize(px);
  }) : null;
  if (ro) ro.observe(el);

  let level = 0;
  let raf = 0;
  const off = onLevels(({ mic, agent }) => {
    const st = el.dataset.state;
    const target = st === "speaking" ? Math.min(1, agent * 1.4) : st === "listening" ? Math.min(1, mic * 1.6) : 0;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      level += (target - level) * 0.5;
      el.style.setProperty("--level", level.toFixed(3));
    });
  });

  return {
    el,
    /** set(callState, label, working, agentState) */
    set(state, label, working, agentState) {
      el.dataset.state = state;
      el.dataset.working = working ? "true" : "false";
      el.dataset.agent = agentState || "idle";
      el.setAttribute("aria-label", label);
      torb.set(state === "error" ? "idle" : agentState || "idle");
    },
    destroy() { off(); if (ro) ro.disconnect(); torb.destroy(); },
  };
}
