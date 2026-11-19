// The agent orb: the biggest thing on the Talk screen. A button (tap = start or end the call)
// whose look follows the agent: idle, connecting, listening (breathes with your voice),
// thinking (an arc turns), speaking (ripples with Sahay's voice), working (satellites orbit
// while sourcing or bargaining runs), error. Levels come straight from the call, not the store.

import { h, svgEl } from "./dom.js";
import { onLevels } from "./call.js";

export function createOrb({ onPress }) {
  const ring = svgEl("svg", { class: "orb-arc", viewBox: "0 0 200 200", "aria-hidden": "true" });
  ring.append(svgEl("circle", { cx: 100, cy: 100, r: 94, fill: "none", "stroke-width": 3, "stroke-linecap": "round", "stroke-dasharray": "120 470" }));
  const el = h("button", { class: "orb", type: "button", dataset: { state: "idle" } },
    h("span", { class: "orb-ripple r1", "aria-hidden": "true" }),
    h("span", { class: "orb-ripple r2", "aria-hidden": "true" }),
    h("span", { class: "orb-ripple r3", "aria-hidden": "true" }),
    h("span", { class: "orb-halo", "aria-hidden": "true" }),
    ring,
    h("span", { class: "orb-core", "aria-hidden": "true" }, h("span", { class: "orb-shine" })),
    h("span", { class: "orb-sats", "aria-hidden": "true" }, h("i"), h("i"), h("i")));
  el.addEventListener("click", () => onPress());

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
    /** set(state, label, working) */
    set(state, label, working) {
      el.dataset.state = state;
      el.dataset.working = working ? "true" : "false";
      el.setAttribute("aria-label", label);
    },
    destroy() { off(); },
  };
}
