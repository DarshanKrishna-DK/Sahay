// Fig 1 live: the bargaining balance. One loop moves the weights, swings the beam like a real
// pendulum and turns the dial, all from ./model.js; the readout is read from where the parts are.
import { iso, lineOnTop, translateAlong } from "../iso-kit.js";
import { GEO } from "./geo.js";
import * as M from "./model.js";

export const META = {
  fig: 1,
  css: false,
  words: {
    title: { en: "Bargaining balance", hi: "मोलभाव का तराज़ू", kn: "ಚೌಕಾಸಿಯ ತಕ್ಕಡಿ" },
    hint: { en: "Tap for the next round", hi: "अगले दौर के लिए दबाएँ", kn: "ಮುಂದಿನ ಸುತ್ತಿಗೆ ಒತ್ತಿ" },
    caption: {
      en: "Example. Left pan: the seller's ask. Right pan: Sahay's offer. Each weight is five rupees. The heavier side goes down; when ask and offer meet, the beam hangs level and the dial reads the agreed price.",
      hi: "उदाहरण। बायाँ पलड़ा: विक्रेता का दाम। दायाँ पलड़ा: सहाय का दाम। हर बाट पाँच रुपये का है। भारी पलड़ा नीचे जाता है; दोनों दाम मिलते ही डंडी सीधी हो जाती है और डायल तय दाम दिखाता है।",
      kn: "ಉದಾಹರಣೆ. ಎಡ ತಟ್ಟೆ: ಮಾರಾಟಗಾರರ ಬೆಲೆ. ಬಲ ತಟ್ಟೆ: ಸಹಾಯ್ ಬೆಲೆ. ಪ್ರತಿ ತೂಕ ಐದು ರೂಪಾಯಿ. ಭಾರದ ತಟ್ಟೆ ಕೆಳಗೆ ಹೋಗುತ್ತದೆ; ಎರಡು ಬೆಲೆ ಸೇರಿದಾಗ ದಂಡ ಸಮವಾಗುತ್ತದೆ, ಡಯಲ್ ಒಪ್ಪಿದ ಬೆಲೆ ತೋರಿಸುತ್ತದೆ.",
    },
    label: {
      en: "Bargaining balance, example. Arrow keys step through the rounds.",
      hi: "मोलभाव का तराज़ू, उदाहरण। तीर वाली कुंजियों से दौर बदलें।",
      kn: "ಚೌಕಾಸಿಯ ತಕ್ಕಡಿ, ಉದಾಹರಣೆ. ಬಾಣದ ಕೀಲಿಗಳಿಂದ ಸುತ್ತು ಬದಲಿಸಿ.",
    },
    round: { en: "Round {n} of {of}", hi: "दौर {n}/{of}", kn: "ಸುತ್ತು {n}/{of}" },
    asks: { en: "asks ₹{v}", hi: "माँग ₹{v}", kn: "ಕೇಳಿಕೆ ₹{v}" },
    offers: { en: "offers ₹{v}", hi: "ऑफ़र ₹{v}", kn: "ಕೊಡುಗೆ ₹{v}" },
    agreed: { en: "Agreed ₹{v} a kg · level", hi: "तय ₹{v} किलो · बराबर", kn: "ಒಪ್ಪಿದ ಬೆಲೆ ₹{v} ಕಿಲೋ · ಸಮ" },
    settling: { en: "Meeting at ₹{v}", hi: "₹{v} पर मिल रहे हैं", kn: "₹{v}ಕ್ಕೆ ಸೇರುತ್ತಿದೆ" },
  },
};

const word = (key, lang, vars = {}) => {
  const entry = META.words[key];
  const text = entry ? entry[lang] ?? entry.en : "";
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
};

const { P, pivot: PIVOT, arm: ARM, dial: DIAL, disc: DISC } = GEO;
const LAST = M.ROUNDS.length - 1;
const RESUME_MS = 3600;
const STAGGER = 0.22;      // seconds between weights going on or off
const LEVEL = 0.15 * Math.PI / 180;

/** The screen matrix that turns the beam (drawn level) about the pivot in its own plane. */
function beamMatrix(theta) {
  const o = iso([0, 0, 0], P);
  const ex = iso([1, 0, 0], P).map((v, i) => v - o[i]);
  const ez = iso([0, 0, 1], P).map((v, i) => v - o[i]);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // R acts on (x, z): x' = c x - s z, z' = s x + c z.  Screen M = E R E^-1, E = [ex ez].
  const det = ex[0] * ez[1] - ez[0] * ex[1];
  const inv = [[ez[1] / det, -ez[0] / det], [-ex[1] / det, ex[0] / det]];
  const ER = [[ex[0] * c + ez[0] * s, -ex[0] * s + ez[0] * c], [ex[1] * c + ez[1] * s, -ex[1] * s + ez[1] * c]];
  const m = [
    [ER[0][0] * inv[0][0] + ER[0][1] * inv[1][0], ER[0][0] * inv[0][1] + ER[0][1] * inv[1][1]],
    [ER[1][0] * inv[0][0] + ER[1][1] * inv[1][0], ER[1][0] * inv[0][1] + ER[1][1] * inv[1][1]],
  ];
  const [px, py] = iso(PIVOT, P);
  const e = px - (m[0][0] * px + m[0][1] * py);
  const f = py - (m[1][0] * px + m[1][1] * py);
  const r = (v) => Math.round(v * 10000) / 10000;
  return `matrix(${r(m[0][0])} ${r(m[1][0])} ${r(m[0][1])} ${r(m[1][1])} ${r(e)} ${r(f)})`;
}

function needleAt(price) {
  const a = M.dialAngle(price);
  const [x, y] = DIAL.at;
  return lineOnTop([x - Math.sin(a) * 3.2, y + Math.cos(a) * 3.2], [x + Math.sin(a) * (DIAL.r - 4), y - Math.cos(a) * (DIAL.r - 4)], DIAL.top + 0.2, P);
}

export function mount(stage, { readout, lang: startLang = "en", reduced: startReduced = false }) {
  const svg = stage.querySelector("svg");
  const beam = svg.querySelector('[data-part="beam"]');
  const needle = svg.querySelector('[data-part="needle"]');
  const pans = { ask: svg.querySelector('[data-part="pan-ask"]'), offer: svg.querySelector('[data-part="pan-offer"]') };
  const slots = {
    ask: [...pans.ask.querySelectorAll("[data-disc]")],
    offer: [...pans.offer.querySelectorAll("[data-disc]")],
  };

  let lang = startLang;
  let reduced = startReduced;
  let playing = false;
  let frame = 0;
  let last = 0;
  let clock = 0;
  let tourClock = 0;
  let touring = true;
  let idleTimer = 0;
  let round = reduced ? LAST : 0;
  let lastText = "";
  // Disc presence 0..1 per slot, with the time each is allowed to start changing.
  const disc = { ask: slots.ask.map(() => ({ p: 0, want: 0, at: 0 })), offer: slots.offer.map(() => ({ p: 0, want: 0, at: 0 })) };
  const swing = { x: 0, v: 0 };
  const dial = { x: M.ROUNDS[round].ask, v: 0 };

  function target(kind) { return M.discsFor(M.ROUNDS[round][kind]); }

  /** Schedules weights on or off in a real order: off from the top down, on from the bottom up. */
  function schedule() {
    for (const kind of ["ask", "offer"]) {
      const want = target(kind);
      const list = disc[kind];
      const changes = [];
      for (let i = 0; i < list.length; i++) {
        const w = i < want ? 1 : 0;
        if (w !== list[i].want) changes.push(i);
      }
      const removing = changes.length && list[changes[0]].want === 1;
      if (removing) changes.reverse();
      changes.forEach((i, n) => { list[i].want = i < want ? 1 : 0; list[i].at = clock + n * STAGGER; });
    }
  }

  function snap() {
    for (const kind of ["ask", "offer"]) {
      const want = target(kind);
      disc[kind].forEach((d, i) => { d.want = d.p = i < want ? 1 : 0; d.at = 0; });
    }
    swing.x = M.tiltFor(M.ROUNDS[round].ask, M.ROUNDS[round].offer);
    swing.v = 0;
    dial.x = M.ROUNDS[round].ask;
    dial.v = 0;
  }

  const load = (kind) => disc[kind].reduce((sum, d) => sum + d.p, 0) * M.DISC_RUPEES;

  function draw() {
    for (const kind of ["ask", "offer"]) {
      disc[kind].forEach((d, i) => {
        const el = slots[kind][i];
        const lift = (1 - d.p) * 10;
        const o = Math.round(d.p * 100) / 100;
        el.setAttribute("opacity", String(o));
        if (lift > 0.01) el.setAttribute("transform", translateAlong(P, [0, 0, lift])); else el.removeAttribute("transform");
      });
    }
    beam.setAttribute("transform", beamMatrix(swing.x));
    const c = Math.cos(swing.x);
    const s = Math.sin(swing.x);
    pans.ask.setAttribute("transform", translateAlong(P, [ARM - ARM * c, 0, -ARM * s]));
    pans.offer.setAttribute("transform", translateAlong(P, [ARM * c - ARM, 0, ARM * s]));
    needle.setAttribute("d", needleAt(dial.x));
    writeReadout();
  }

  function writeReadout() {
    const r = M.ROUNDS[round];
    const settled = Math.abs(swing.x - M.tiltFor(r.ask, r.offer)) < LEVEL && Math.abs(swing.v) < 0.01
      && disc.ask.every((d) => d.p === d.want) && disc.offer.every((d) => d.p === d.want);
    let text;
    if (M.isAgreed(r)) text = settled ? word("agreed", lang, { v: r.ask }) : word("settling", lang, { v: r.ask });
    else text = `${word("round", lang, { n: round + 1, of: M.ROUNDS.length })} · ${word("asks", lang, { v: r.ask })} · ${word("offers", lang, { v: r.offer })}`;
    if (text !== lastText) { readout.textContent = text; lastText = text; }
  }

  function describe() {
    const r = M.ROUNDS[round];
    stage.setAttribute("aria-valuenow", String(round + 1));
    stage.setAttribute("aria-valuetext", M.isAgreed(r)
      ? word("agreed", lang, { v: r.ask })
      : `${word("round", lang, { n: round + 1, of: M.ROUNDS.length })}, ${word("asks", lang, { v: r.ask })}, ${word("offers", lang, { v: r.offer })}`);
  }

  function setRound(next) {
    const n = M.clamp(next, 0, LAST);
    if (n === round) return;
    round = n;
    if (reduced) snap(); else schedule();
    describe();
    kick();
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    if (touring) {
      tourClock += dt;
      const r = M.tourRound(tourClock);
      if (r !== round) { round = r; schedule(); describe(); }
    }
    let moving = false;
    for (const kind of ["ask", "offer"]) {
      for (const d of disc[kind]) {
        if (d.p === d.want || clock < d.at) { if (d.p !== d.want) moving = true; continue; }
        d.p += (d.want - d.p) * (1 - Math.exp(-dt / 0.09));
        if (Math.abs(d.want - d.p) < 0.004) d.p = d.want;
        moving = true;
      }
    }
    const settledBeam = M.swingStep(swing, M.tiltFor(load("ask"), load("offer")), dt);
    // The dial follows the rupees on the seller's pan with a critically damped needle.
    const w = 1 / 0.22;
    for (let i = 0; i < 4; i++) { dial.v += (w * w * (load("ask") - dial.x) - 2 * w * dial.v) * (dt / 4); dial.x += dial.v * (dt / 4); }
    if (Math.abs(load("ask") - dial.x) < 1e-3 && Math.abs(dial.v) < 1e-3) { dial.x = load("ask"); dial.v = 0; }
    draw();
    const done = !touring && !moving && settledBeam && dial.v === 0;
    frame = playing && !done ? requestAnimationFrame(tick) : 0;
  }

  function kick() {
    if (reduced) { draw(); return; }
    if (playing && !frame) { last = 0; frame = requestAnimationFrame(tick); }
  }

  function takeOver() {
    touring = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!reduced) { touring = true; tourClock = round * M.ROUND_SECONDS; kick(); } }, RESUME_MS);
  }

  const onMove = (event) => {
    if (event.pointerType === "touch") return;
    const box = stage.getBoundingClientRect();
    const share = M.clamp((event.clientX - box.left) / box.width, 0, 0.999);
    takeOver();
    setRound(Math.floor(share * M.ROUNDS.length));
  };
  const onClick = () => { takeOver(); setRound(round === LAST ? 0 : round + 1); };
  const onKey = (event) => {
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = round + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = round - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = LAST;
    if (event.key === " " || event.key === "Enter") next = round === LAST ? 0 : round + 1;
    if (next === null) return;
    event.preventDefault();
    takeOver();
    setRound(next);
  };
  stage.setAttribute("role", "slider");
  stage.setAttribute("aria-valuemin", "1");
  stage.setAttribute("aria-valuemax", String(M.ROUNDS.length));
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("click", onClick);
  stage.addEventListener("keydown", onKey);

  snap();
  draw();
  describe();

  return {
    play() { if (reduced) return; playing = true; kick(); },
    pause() { playing = false; if (frame) cancelAnimationFrame(frame); frame = 0; },
    setReduced(next) {
      if (next === reduced) return;
      reduced = next;
      if (reduced) { this.pause(); touring = false; clearTimeout(idleTimer); round = LAST; snap(); draw(); describe(); }
      else { touring = true; tourClock = 0; round = 0; snap(); draw(); describe(); }
    },
    setLanguage(next) { lang = next; lastText = ""; writeReadout(); describe(); },
    destroy() {
      this.pause();
      clearTimeout(idleTimer);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("click", onClick);
      stage.removeEventListener("keydown", onKey);
    },
  };
}
