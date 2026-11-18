/* Landing page interactions. Everything here is enhancement: the page is
   complete and readable with JavaScript disabled. */

/* --- Reveal on scroll ---------------------------------------------------- */

const reveals = document.querySelectorAll(".reveal");
const revealAll = () => reveals.forEach((el) => el.classList.add("in"));

if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealAll();
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));

  // Safety net. A reveal animation must never be the reason content is
  // invisible - to a printer, a full-page screenshot, a crawler, or anyone
  // who lands mid-page via an anchor. After a few seconds, show everything.
  setTimeout(revealAll, 4000);
  addEventListener("beforeprint", revealAll);
}

/* --- Hero: the negotiation, typed out ------------------------------------
   This is a real exchange from a recorded Sahay negotiation, replayed. It is
   the clearest way to show what the product does without asking anyone to
   imagine it. Static markup is written in immediately for no-JS and for
   crawlers; the animation only re-renders it.                              */

const SCRIPT = [
  ["agent", "Namaste. I am an automated assistant calling on behalf of Ravi Garments in Bengaluru. Do you supply 180 GSM round neck cotton t-shirts?"],
  ["vendor", "Yes, we make round neck cotton t-shirts. How many pieces do you need?"],
  ["agent", "Five hundred pieces, delivered to Bengaluru. What is your rate for that quantity?"],
  ["vendor", "For five hundred pieces in 180 GSM, our rate is two hundred and ten rupees per piece."],
  ["agent", "The buyer is working to one hundred and eighty. Is there any room on that rate?"],
  ["vendor", "Okay, for you I can do one eighty-five. Minimum three hundred pieces, delivery in eight days."],
  ["agent", "One eighty-five a piece, three hundred minimum, eight days. Thank you, the owner will review and confirm."],
];

const host = document.getElementById("call-demo");

function renderLine([who, text], immediate) {
  const el = document.createElement("div");
  el.className = `utter ${who}`;
  const lbl = document.createElement("div");
  lbl.className = "lbl";
  lbl.textContent = who === "agent" ? "Sahay" : "Surabhi Globals";
  const p = document.createElement("p");
  p.textContent = text;
  el.append(lbl, p);
  if (immediate) el.style.animation = "none";
  host.appendChild(el);
  return el;
}

if (host) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Every line is rendered immediately and staggered in with CSS delay rather
  // than being held hidden. Hiding them would reserve a block of empty space
  // above the fold and leave the card blank in a screenshot, a print, or for
  // anyone who arrives while the sequence is still playing.
  SCRIPT.forEach((line, i) => {
    const el = renderLine(line, reduced);
    if (!reduced) el.style.animationDelay = `${0.25 + i * 0.32}s`;
  });
}
