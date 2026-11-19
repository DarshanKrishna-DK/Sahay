// Scroll story: Lenis smooth scroll feeding GSAP ScrollTrigger, one pinned, scrubbed scene per
// step. Everything is created inside gsap.matchMedia so a visitor who asks for reduced motion
// (now or later) gets the static page: every element already sits in its final state in CSS.

const SVG_NS = "http://www.w3.org/2000/svg";

/** The voice wave in step 1: bars of fixed, speech-like heights (drawn even without motion). */
function buildWave() {
  const svg = document.querySelector(".say-wave");
  if (!svg || svg.childElementCount) return;
  const bars = 36;
  for (let i = 0; i < bars; i++) {
    const h = 10 + Math.abs(Math.sin(i * 0.9) * 30 + Math.sin(i * 0.37) * 22);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(i * (240 / bars) + 1.5));
    rect.setAttribute("y", String(40 - h / 2));
    rect.setAttribute("width", "3.4");
    rect.setAttribute("height", String(h.toFixed(1)));
    rect.setAttribute("rx", "1.7");
    svg.append(rect);
  }
}

const inr = new Intl.NumberFormat("en-IN");

export function initMotion({ reducedQuery }) {
  buildWave();
  const { gsap, ScrollTrigger, Lenis } = window;
  if (!gsap || !ScrollTrigger) {
    document.documentElement.classList.add("motion-off");
    return null;
  }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  const mm = gsap.matchMedia();
  mm.add({ motion: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 900px)" }, (ctx) => {
    const { motion, wide } = ctx.conditions;
    if (!motion) return undefined;
    document.documentElement.classList.add("motion-on");

    // Lenis drives the scroll; ScrollTrigger reads it every frame (Lenis README, GSAP ScrollTrigger).
    let lenis = null;
    let tick = null;
    if (Lenis) {
      lenis = new Lenis({ lerp: 0.11 });
      lenis.on("scroll", ScrollTrigger.update);
      tick = (time) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    hero();
    const pinEnd = wide ? "+=130%" : "+=95%";
    const pinned = (id) => gsap.timeline({
      defaults: { ease: "power3.out", duration: 1 },
      scrollTrigger: { trigger: `#${id}`, start: "top top", end: pinEnd, pin: true, scrub: 0.7, anticipatePin: 1 },
    });
    sayScene(pinned("say"));
    findScene(pinned("find"));
    bargainScene(pinned("bargain"));
    yesScene(pinned("yes"));
    learnScene(pinned("learn"));
    finale();
    railFill();

    return () => {
      document.documentElement.classList.remove("motion-on");
      if (tick) gsap.ticker.remove(tick);
      lenis?.destroy();
    };
  });

  // ---------------------------------------------------------------------------------------
  function hero() {
    const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
    intro
      .from(".hero .orb", { scale: 0.55, opacity: 0, duration: 1.4 })
      .from(".hero .orbit-glyph", { scale: 0, opacity: 0, stagger: 0.12, duration: 0.8 }, "-=1")
      .from(".hero-line", { y: 36, opacity: 0, stagger: 0.12, duration: 1 }, "-=1.1")
      .from([".hero-sub", ".hero-actions", ".scroll-cue"], { y: 24, opacity: 0, stagger: 0.1, duration: 0.9 }, "-=0.8");

    gsap.timeline({
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.5 },
    })
      .to(".hero-orb-wrap", { scale: 0.62, yPercent: -18, opacity: 0.25, ease: "none" }, 0)
      .to(".hero-copy", { y: -80, opacity: 0, ease: "none" }, 0)
      .to(".scroll-cue", { opacity: 0, ease: "none", duration: 0.3 }, 0);
  }

  function copyIn(tl, id) {
    tl.from(`#${id} .beat-step`, { x: -30, opacity: 0, duration: 0.5 }, 0)
      .from(`#${id} h2`, { y: 40, opacity: 0, duration: 0.6 }, 0.05)
      .from(`#${id} .beat-body`, { y: 30, opacity: 0, duration: 0.6 }, 0.15)
      .from(`#${id} .example-tag`, { opacity: 0, duration: 0.4 }, 0.2);
  }

  function draw(tl, targets, at, duration = 1) {
    tl.fromTo(targets, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration, ease: "none" }, at);
  }

  function sayScene(tl) {
    copyIn(tl, "say");
    tl.from(".say-mic", { scale: 0, opacity: 0, duration: 0.5 }, 0.2)
      .from(".say-wave rect", { scaleY: 0.08, transformOrigin: "50% 50%", stagger: { each: 0.02, from: "center" }, duration: 0.6 }, 0.3)
      .from(".say-bubble", { y: 30, opacity: 0, scale: 0.9, duration: 0.6 }, 0.8)
      .to(".say-wave rect", { scaleY: 0.08, opacity: 0.35, transformOrigin: "50% 50%", stagger: { each: 0.015, from: "edges" }, duration: 0.6 }, 1.5)
      .from(".need-blob", { scale: 0.4, opacity: 0, borderRadius: "50%", duration: 0.9 }, 1.7)
      .from(".need-head", { y: 14, opacity: 0, duration: 0.4 }, 2.2)
      .from(".need-field", { x: -24, opacity: 0, stagger: 0.18, duration: 0.5 }, 2.3)
      .to({}, { duration: 0.5 });
  }

  function findScene(tl) {
    copyIn(tl, "find");
    draw(tl, ".city-outline", 0.1, 1.1);
    draw(tl, ".city-river", 0.4, 1);
    tl.from(".city-road", { opacity: 0, duration: 0.6 }, 0.6)
      .from(".city-name", { opacity: 0, y: 10, duration: 0.4 }, 0.8)
      .from(".shop-pin", { scale: 0, opacity: 0, duration: 0.5, ease: "back.out(2)" }, 1)
      .from(".seller", {
        opacity: 0, scale: 0.3, rotation: (i) => [-14, 12, -8][i],
        x: (i) => [-160, 180, 120][i], y: (i) => [-120, -140, 160][i],
        stagger: 0.25, duration: 0.8,
      }, 1.3);
    draw(tl, ".seller-line", 1.6, 0.9);
    tl.to({}, { duration: 0.5 });
  }

  function bargainScene(tl) {
    copyIn(tl, "bargain");
    tl.from(".talk-sahay", { y: 24, opacity: 0, scale: 0.92, duration: 0.6 }, 0.2)
      .from(".ladder-key", { opacity: 0, duration: 0.4 }, 0.5);
    // One turn at a time: 62 (seller), 50 (Sahay), 58, 53, 56, then the deal at 55. Each line
    // joins a new price to the same side's previous one, so the two sides visibly converge.
    const rungs = gsap.utils.toArray(".scene-bargain .rung");
    rungs.forEach((rung, i) => {
      const at = 0.8 + i * 0.45;
      const lines = document.querySelectorAll(`.ladder-lines line[data-at="${i}"]`);
      if (lines.length) draw(tl, lines, at - 0.2, 0.3);
      tl.from(rung, { scale: 0.2, opacity: 0, duration: 0.35, ease: rung.classList.contains("deal") ? "back.out(2.2)" : "back.out(1.8)" }, at);
    });
    tl.from(".deal-glow", { opacity: 0, scale: 0.5, duration: 0.5 }, 0.8 + rungs.length * 0.45)
      .to({}, { duration: 0.5 });
  }

  function yesScene(tl) {
    copyIn(tl, "yes");
    tl.from(".yes-card", { y: 120, opacity: 0, scale: 0.88, duration: 0.9 }, 0.2);
    gsap.utils.toArray(".yes-num").forEach((el, i) => {
      const target = Number(el.dataset.count);
      const prefix = el.dataset.prefix ?? "";
      const counter = { v: 0 };
      tl.to(counter, {
        v: target, duration: 0.8, ease: "power2.out",
        onUpdate: () => { el.textContent = prefix + inr.format(Math.round(counter.v)); },
      }, 0.6 + i * 0.25);
    });
    tl.from(".yes-btn", { scale: 0.3, opacity: 0, stagger: 0.15, duration: 0.5, ease: "back.out(2)" }, 1.4)
      .to(".yes-ok", { scale: 1.12, duration: 0.3, ease: "power2.out" }, 2)
      .to(".yes-ok", { scale: 1, duration: 0.3, ease: "power2.in" }, 2.3)
      .from(".yes-stamp", { scale: 1.6, opacity: 0, rotation: -14, duration: 0.5, ease: "power4.out" }, 2.4)
      .to({}, { duration: 0.5 });
  }

  function learnScene(tl) {
    copyIn(tl, "learn");
    tl.from(".mini-orb", { scale: 0, opacity: 0, duration: 0.6, ease: "back.out(1.6)" }, 0.2);
    draw(tl, ".constellation-lines path:not(.line-suggest)", 0.5, 0.8);
    tl.from(".memory:not(.m-suggest)", { scale: 0.2, opacity: 0, stagger: 0.2, duration: 0.5, ease: "back.out(1.6)" }, 0.9);
    draw(tl, ".line-suggest", 1.8, 0.5);
    tl.from(".m-suggest", { y: 70, opacity: 0, duration: 0.7 }, 2)
      .from(".suggest-ring", { scale: 0.6, opacity: 0, duration: 0.5 }, 2.4)
      .to({}, { duration: 0.5 });
  }

  function finale() {
    gsap.timeline({
      scrollTrigger: { trigger: ".finale", start: "top 75%", toggleActions: "play none none reverse" },
      defaults: { ease: "expo.out" },
    })
      .from(".finale h2", { y: 50, opacity: 0, duration: 1 })
      .from(".credit", { y: 40, opacity: 0, scale: 0.85, stagger: 0.12, duration: 0.9 }, "-=0.7")
      .from(".cta-orb", { scale: 0.5, opacity: 0, duration: 1.1 }, "-=0.6");
  }

  function railFill() {
    gsap.fromTo(".river-fill", { strokeDasharray: 1, strokeDashoffset: 1 }, {
      strokeDashoffset: 0, ease: "none",
      scrollTrigger: { trigger: "#say", endTrigger: "#learn", start: "top center", end: "bottom bottom", scrub: 0.3 },
    });
  }

  return { refresh: () => ScrollTrigger.refresh() };
}
