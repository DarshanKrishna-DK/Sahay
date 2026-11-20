// "What Sahay does": a horizontal track of feature cards with one progress segment per card (the
// Yugaantar events carousel, our own code). Native horizontal scroll with snap; the two square arrows
// move one card; each segment fills as far as its card has come into view. The top half is pure so
// node:test can check it.

/**
 * How much of each card has been seen: 1 once the card's right edge is inside the view, 0 while its
 * left edge is still past the view's right edge, and the visible fraction in between.
 * @param {number} viewRight the scroll position plus the visible width, in the track's coordinates
 * @param {{left:number,width:number}[]} cards
 */
export function segmentFill(viewRight, cards) {
  return cards.map(({ left, width }) => {
    if (width <= 0) return 0;
    return Math.min(1, Math.max(0, (viewRight - left) / width));
  });
}

/** The scroll position one card further (dir 1) or back (dir -1), clamped to the track. */
export function nextScroll(scrollLeft, step, dir, maxScroll) {
  return Math.min(maxScroll, Math.max(0, scrollLeft + dir * step));
}

// ---- DOM ----------------------------------------------------------------------------------------
export function initCarousel(track, { progress, arrows = [], reducedQuery } = {}) {
  if (!track) return null;
  const items = [...track.querySelectorAll(".fx-item")];
  const segs = items.map(() => document.createElement("span"));
  if (progress) progress.replaceChildren(...segs);

  function measure() {
    const pad = items[0] ? items[0].offsetLeft : 0;
    return items.map((el) => ({ left: el.offsetLeft - pad, width: el.offsetWidth }));
  }
  let cards = measure();
  function update() {
    const pad = items[0] ? items[0].offsetLeft : 0;
    const viewRight = track.scrollLeft + track.clientWidth - pad;
    segmentFill(viewRight, cards).forEach((p, i) => segs[i].style.setProperty("--p", p.toFixed(3)));
    const max = track.scrollWidth - track.clientWidth;
    for (const b of arrows) {
      const dir = Number(b.dataset.fx);
      b.disabled = dir < 0 ? track.scrollLeft <= 1 : track.scrollLeft >= max - 1;
    }
  }
  for (const b of arrows) {
    b.addEventListener("click", () => {
      const step = (items[1] ? items[1].offsetLeft - items[0].offsetLeft : track.clientWidth);
      const left = nextScroll(track.scrollLeft, step, Number(b.dataset.fx), track.scrollWidth - track.clientWidth);
      track.scrollTo({ left, behavior: reducedQuery?.matches ? "auto" : "smooth" });
    });
  }
  // Keyboard: the track is focusable; the arrow keys move one card.
  track.addEventListener("keydown", (e) => {
    if (e.target !== track || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    arrows.find((b) => Number(b.dataset.fx) === (e.key === "ArrowRight" ? 1 : -1))?.click();
  });
  track.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", () => { cards = measure(); update(); });
  document.fonts?.ready.then(() => { cards = measure(); update(); });
  update();
  return { update };
}
