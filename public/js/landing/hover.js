// Hover motion for a mouse or trackpad only: magnetic buttons lean toward the pointer, bubbles
// tilt in 3D. Nothing here runs on touch screens or when the visitor asks for reduced motion.
// With GSAP present the moves go through gsap (it keeps x/y, scale and rotationX/Y apart, so a
// hover never fights a scroll animation of the same element); without it, CSS variables do.

const MAX_PULL = 0.28; // share of the pointer offset a magnetic button follows
const MAX_TILT = 9;    // degrees

export function initHover({ reducedQuery }) {
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const allowed = () => fine.matches && !reducedQuery.matches;
  const gsap = window.gsap;

  function move(el, vars, cssVars) {
    if (gsap) gsap.to(el, { ...vars, duration: 0.3, ease: "power3.out", overwrite: "auto" });
    else for (const [k, v] of Object.entries(cssVars)) el.style.setProperty(k, v);
  }

  for (const el of document.querySelectorAll(".magnetic")) {
    el.addEventListener("pointermove", (e) => {
      if (!allowed()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * MAX_PULL;
      const y = (e.clientY - (r.top + r.height / 2)) * MAX_PULL;
      move(el, { x, y }, { "--mx": `${x.toFixed(1)}px`, "--my": `${y.toFixed(1)}px` });
    });
    el.addEventListener("pointerleave", () => move(el, { x: 0, y: 0 }, { "--mx": "0px", "--my": "0px" }));
  }

  for (const el of document.querySelectorAll(".tilt")) {
    el.addEventListener("pointermove", (e) => {
      if (!allowed()) return;
      const r = el.getBoundingClientRect();
      const ry = ((e.clientX - r.left) / r.width - 0.5) * MAX_TILT * 2;
      const rx = -((e.clientY - r.top) / r.height - 0.5) * MAX_TILT * 2;
      move(el, { rotationX: rx, rotationY: ry, transformPerspective: 700 }, { "--rx": `${rx.toFixed(2)}deg`, "--ry": `${ry.toFixed(2)}deg` });
    });
    el.addEventListener("pointerleave", () => move(el, { rotationX: 0, rotationY: 0 }, { "--rx": "0deg", "--ry": "0deg" }));
  }
}
