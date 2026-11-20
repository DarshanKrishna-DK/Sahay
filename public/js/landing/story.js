// The story: a sticky stage whose chapters cross-dissolve with scroll (technique from
// oso95/scroll-world, MIT: scroll progress per chapter, smoothstep seams, a small translate of
// the copy; no video). Native scroll only, never hijacked. On phones, short screens and under
// reduced motion the chapters stay in normal flow, complete and static (the CSS default).
// The top half is pure so node:test can check it.

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const smooth = (x) => { const v = clamp(x); return v * v * (3 - 2 * v); };

/** Scroll distance per chapter, as a share of the viewport height (the CSS uses the same). */
export const SLOT = 0.9;
/** Half-width of the cross-dissolve at each seam, in chapters. */
export const FADE = 0.14;

/**
 * For overall progress p (0..1) through n chapters: each chapter's opacity, its local progress
 * (0 entering .. 1 leaving) and whether it is the current one. The first chapter is fully shown
 * at the start and the last at the end; neighbours cross at each seam.
 */
export function chapterFrames(p, n, fade = FADE) {
  const c = clamp(p) * n;
  const out = [];
  let best = 0, bestO = -1;
  for (let i = 0; i < n; i++) {
    const fin = i === 0 ? 1 : smooth((c - (i - fade)) / (2 * fade));
    const fout = i === n - 1 ? 1 : smooth((i + 1 + fade - c) / (2 * fade));
    const o = Math.min(fin, fout);
    out.push({ opacity: o, local: clamp(c - i), current: false });
    if (o > bestO) { bestO = o; best = i; }
  }
  out[best].current = true;
  return out;
}

/** Scroll position that shows chapter i settled (the middle of its slot). */
export function chapterScrollTop(trackTop, trackHeight, viewH, i, n) {
  const run = Math.max(0, trackHeight - viewH);
  return trackTop + run * ((i + 0.5) / n);
}

// ---------------------------------------------------------------------------------------------
// DOM part

/**
 * @param {Element} story  the .story section
 * @param {{ reducedQuery: MediaQueryList, figures?: { cards: any[] }, scrollTo?: (y:number, o?:{immediate?:boolean})=>void }} opts
 */
export function initStory(story, { reducedQuery, figures, scrollTo }) {
  const track = story.querySelector(".story-track");
  const chapters = [...story.querySelectorAll(".chapter")];
  const rail = story.querySelector(".story-rail");
  const railLinks = [...rail.querySelectorAll("a[data-ch]")];
  const railFill = rail.querySelector(".rail-fill");
  const n = chapters.length;
  const stagedQuery = matchMedia("(min-width: 1000px) and (min-height: 620px)");
  let staged = false, raf = 0, current = -1;

  // Which chapter holds each figure card, so only the shown figure plays.
  const cardChapter = new Map();
  for (const card of figures?.cards ?? []) cardChapter.set(card, chapters.findIndex((ch) => ch.contains(card.card)));

  const go = (y) => (scrollTo ? scrollTo(y) : window.scrollTo({ top: y, behavior: reducedQuery.matches ? "auto" : "smooth" }));

  function metrics() {
    const r = track.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height, vh: window.innerHeight };
  }

  function setStaged(on) {
    staged = on;
    story.classList.toggle("is-staged", on);
    story.style.setProperty("--n", String(n));
    if (!on) {
      current = -1;
      for (const ch of chapters) { ch.style.removeProperty("--o"); ch.style.removeProperty("--l"); ch.classList.remove("is-current"); }
      for (const a of railLinks) { a.classList.remove("is-current"); a.removeAttribute("aria-current"); }
      // Back to the loader's own on-screen tracking.
      for (const card of figures?.cards ?? []) { const r = card.card.getBoundingClientRect(); card.onScreen = r.bottom > 0 && r.top < innerHeight; card.sync(); }
      return;
    }
    update();
  }

  function update() {
    raf = 0;
    if (!staged) return;
    const m = metrics();
    const run = Math.max(1, m.height - m.vh);
    const p = clamp((window.scrollY - m.top) / run);
    const frames = chapterFrames(p, n);
    const inView = window.scrollY + m.vh > m.top && window.scrollY < m.top + m.height;
    frames.forEach((f, i) => {
      const ch = chapters[i];
      ch.style.setProperty("--o", f.opacity.toFixed(3));
      ch.style.setProperty("--l", f.local.toFixed(3));
      ch.classList.toggle("is-shown", f.opacity > 0.5);
      if (f.current && current !== i) {
        current = i;
        chapters.forEach((c, k) => c.classList.toggle("is-current", k === i));
        railLinks.forEach((a, k) => {
          a.classList.toggle("is-current", k === i);
          if (k === i) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current");
        });
      }
    });
    railFill.style.transform = `scaleY(${p.toFixed(4)})`;
    for (const [card, i] of cardChapter) {
      const on = inView && frames[i]?.opacity > 0.5;
      if (card.onScreen !== on) { card.onScreen = on; card.sync(); }
    }
  }
  const request = () => { if (staged && !raf) raf = requestAnimationFrame(update); };

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);

  // Rail links and keyboard focus inside a hidden chapter jump the scroll to that chapter.
  railLinks.forEach((a, i) => a.addEventListener("click", (e) => {
    if (!staged) return;
    e.preventDefault();
    const m = metrics();
    go(chapterScrollTop(m.top, m.height, m.vh, i, n));
  }));
  story.addEventListener("focusin", (e) => {
    if (!staged) return;
    const i = chapters.findIndex((ch) => ch.contains(e.target));
    if (i < 0 || i === current) return;
    const m = metrics();
    const y = chapterScrollTop(m.top, m.height, m.vh, i, n);
    if (scrollTo) scrollTo(y, { immediate: true }); else window.scrollTo({ top: y, behavior: "auto" });
  });

  const decide = () => setStaged(stagedQuery.matches && !reducedQuery.matches);
  stagedQuery.addEventListener?.("change", decide);
  reducedQuery.addEventListener?.("change", decide);
  decide();
  return { refresh: request };
}
