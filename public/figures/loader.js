// Mounts the landing figures (contract: public/figures/README.md). Lazy: nothing is fetched until
// a card is near the viewport. Each figure plays only while on screen, the tab is visible and
// motion is allowed; under reduced motion it shows its still pose and still answers input.

const WORDS = {
  loading: { en: "Loading the drawing", hi: "चित्र आ रहा है", kn: "ಚಿತ್ರ ಬರುತ್ತಿದೆ" },
  error: {
    en: "The drawing could not load. The words beside it say the same thing.",
    hi: "चित्र नहीं खुल सका। पास लिखी बात वही बताती है।",
    kn: "ಚಿತ್ರ ತೆರೆಯಲಿಲ್ಲ. ಪಕ್ಕದ ಬರಹ ಅದೇ ವಿಷಯ ಹೇಳುತ್ತದೆ.",
  },
  fig: { en: "Fig", hi: "चित्र", kn: "ಚಿತ್ರ" },
};

const say = (entry, lang) => (entry ? entry[lang] ?? entry.en : "");

/** The card's inner markup, for pages that build it in script (the preview page). */
export function cardMarkup(name) {
  return `<div class="iso-plate">
  <div class="iso-plate-corners">
    <span class="iso-plate-corner" data-corner="fig" aria-hidden="true"></span>
    <span class="iso-plate-corner" data-corner="title"></span>
    <span class="iso-plate-corner" data-corner="hint" aria-hidden="true"></span>
    <span class="iso-plate-corner" data-corner="readout" data-readout></span>
  </div>
  <div class="iso-stage" tabindex="0"></div>
  <p class="fig-status" role="status"></p>
</div>
<figcaption class="iso-legend"><span class="iso-caption"></span></figcaption>`.replace(/\n\s*/g, "");
}

class FigureCard {
  constructor(card, ctx) {
    this.card = card;
    this.name = card.dataset.figure;
    this.ctx = ctx;
    this.stage = card.querySelector(".iso-stage");
    this.readout = card.querySelector("[data-readout]");
    this.status = card.querySelector(".fig-status");
    this.handle = null;
    this.meta = null;
    this.onScreen = false;
    this.setState("idle");
  }

  setState(state) {
    this.card.dataset.state = state;
    if (!this.status) return;
    const lang = this.ctx.lang;
    this.status.textContent = state === "loading" ? say(WORDS.loading, lang) : state === "error" ? say(WORDS.error, lang) : "";
  }

  async load() {
    if (this.card.dataset.state !== "idle") return;
    this.setState("loading");
    try {
      const base = `/figures/${this.name}/`;
      const live = await import(`${base}live.js`);
      this.meta = live.META;
      if (this.meta.css && !document.querySelector(`link[data-figure-css="${this.name}"]`)) {
        await new Promise((resolve, reject) => {
          const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${base}${this.name}.css` });
          link.dataset.figureCss = this.name;
          link.onload = resolve;
          link.onerror = () => reject(new Error("figure styles did not load"));
          document.head.append(link);
        });
      }
      const res = await fetch(`${base}${this.name}.svg`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`figure art: HTTP ${res.status}`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg.nodeName !== "svg") throw new Error("figure art is not an SVG");
      this.stage.replaceChildren(document.importNode(svg, true));
      this.label();
      this.handle = live.mount(this.stage, { readout: this.readout, lang: this.ctx.lang, reduced: this.ctx.reducedQuery.matches });
      this.setState("ready");
      this.sync();
    } catch (err) {
      this.stage.replaceChildren();
      this.setState("error");
      this.card.dataset.error = String(err?.message ?? err).slice(0, 120);
    }
  }

  label() {
    if (!this.meta) return;
    const lang = this.ctx.lang;
    const w = this.meta.words;
    const set = (sel, text) => { const el = this.card.querySelector(sel); if (el) el.textContent = text; };
    set('[data-corner="fig"]', `${say(WORDS.fig, lang)} ${this.meta.fig}`);
    set('[data-corner="title"]', say(w.title, lang));
    set('[data-corner="hint"]', say(w.hint, lang));
    set(".iso-caption", say(w.caption, lang));
    this.stage.setAttribute("aria-label", say(w.label, lang));
  }

  sync() {
    if (!this.handle) return;
    const reduced = this.ctx.reducedQuery.matches;
    this.handle.setReduced(reduced);
    const run = !reduced && this.onScreen && document.visibilityState === "visible";
    if (run) this.handle.play(); else this.handle.pause();
    this.card.dataset.motion = reduced ? "still" : run ? "playing" : "paused";
  }

  setLanguage(lang) {
    if (this.card.dataset.state === "loading" || this.card.dataset.state === "error") this.setState(this.card.dataset.state);
    this.label();
    this.handle?.setLanguage(lang);
  }
}

/** Finds every [data-figure] card under root and mounts it when it comes near the viewport. */
export function mountFigures(root, { lang = "en", reducedQuery = matchMedia("(prefers-reduced-motion: reduce)") } = {}) {
  const ctx = { lang, reducedQuery };
  const cards = [...root.querySelectorAll(".iso-figure[data-figure]")].map((el) => new FigureCard(el, ctx));
  const byEl = new Map(cards.map((c) => [c.card, c]));

  const near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { near.unobserve(e.target); byEl.get(e.target)?.load(); }
  }, { rootMargin: "600px 0px" });
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) { const c = byEl.get(e.target); if (c) { c.onScreen = e.isIntersecting; c.sync(); } }
  }, { rootMargin: "80px 0px" });
  for (const c of cards) { near.observe(c.card); seen.observe(c.card); }

  const syncAll = () => cards.forEach((c) => c.sync());
  document.addEventListener("visibilitychange", syncAll);
  reducedQuery.addEventListener?.("change", syncAll);

  return {
    setLanguage(next) { ctx.lang = next; cards.forEach((c) => c.setLanguage(next)); },
    cards,
  };
}
