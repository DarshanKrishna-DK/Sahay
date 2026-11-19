// Edge orb: the glass half-disc on the right edge fans out a semicircle of bubble links.
// Keyboard: Enter/Space opens and focuses the first bubble, arrow keys move around the arc,
// Escape closes and returns focus; a tap or click outside closes it.

export function initEdgeOrb() {
  const wrap = document.getElementById("edge-orb");
  const toggle = document.getElementById("edge-orb-toggle");
  const menu = document.getElementById("edge-orb-menu");
  if (!wrap || !toggle || !menu) return;
  const bubbles = [...menu.querySelectorAll(".edge-bubble")];

  function setOpen(open, { focus = true } = {}) {
    wrap.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      menu.removeAttribute("inert");
      if (focus) bubbles[0]?.focus({ preventScroll: true });
    } else {
      menu.setAttribute("inert", "");
      if (focus && wrap.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    }
  }
  const isOpen = () => wrap.classList.contains("is-open");

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  wrap.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    const i = bubbles.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      bubbles[(i + 1) % bubbles.length].focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      bubbles[(i - 1 + bubbles.length) % bubbles.length].focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !wrap.contains(e.target)) setOpen(false, { focus: false });
  });
  wrap.addEventListener("focusout", (e) => {
    if (isOpen() && e.relatedTarget && !wrap.contains(e.relatedTarget)) setOpen(false, { focus: false });
  });
}
