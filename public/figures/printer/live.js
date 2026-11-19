// Fig 2 live: "Your yes". One loop springs the stamp, lifts the feed brake, feeds the paper,
// turns the platen wheel and steps the counter, all from ./model.js. The paper never moves
// before the die is on the YES plate; the readout is read from where the parts are.
import { iso, lineOnTop, pathOf, slabOf, translateAlong } from "../iso-kit.js";
import { GEO } from "./geo.js";
import * as M from "./model.js";

export const META = {
  fig: 2,
  css: false,
  words: {
    title: { en: "Your yes", hi: "आपकी हाँ", kn: "ನಿಮ್ಮ ಹೌದು" },
    hint: { en: "Press the stamp", hi: "मुहर दबाएँ", kn: "ಮುದ್ರೆ ಒತ್ತಿ" },
    caption: {
      en: "Example. The printer's feed stays braked until the stamp lands on YES; only then does one invoice feed out and the counter step by one. Hovering is only a maybe: the stamp dips and nothing prints.",
      hi: "उदाहरण। जब तक मुहर YES पर नहीं पड़ती, प्रिंटर का कागज़ ब्रेक से रुका रहता है; तभी एक बिल निकलता है और गिनती एक बढ़ती है। सिर्फ़ ऊपर ले जाना 'शायद' है: मुहर झुकती है, कुछ नहीं छपता।",
      kn: "ಉದಾಹರಣೆ. ಮುದ್ರೆ YES ಮೇಲೆ ಬೀಳುವವರೆಗೆ ಪ್ರಿಂಟರ್‌ನ ಕಾಗದ ಬ್ರೇಕ್‌ನಿಂದ ನಿಂತಿರುತ್ತದೆ; ಆಗ ಮಾತ್ರ ಒಂದು ಬಿಲ್ ಹೊರಬರುತ್ತದೆ, ಎಣಿಕೆ ಒಂದು ಹೆಚ್ಚುತ್ತದೆ. ಸುಮ್ಮನೆ ಮೇಲೆ ತಂದರೆ ಅದು 'ಬಹುಶಃ' ಮಾತ್ರ: ಮುದ್ರೆ ಇಳಿಯುತ್ತದೆ, ಏನೂ ಮುದ್ರಣವಾಗುವುದಿಲ್ಲ.",
    },
    label: {
      en: "Receipt printer with a YES stamp, example. Space or Enter presses the stamp and prints one invoice; Down arrow only dips it.",
      hi: "YES मुहर वाला रसीद प्रिंटर, उदाहरण। स्पेस या एंटर से मुहर दबती है और एक बिल छपता है; नीचे वाला तीर उसे सिर्फ़ झुकाता है।",
      kn: "YES ಮುದ್ರೆಯ ರಸೀದಿ ಪ್ರಿಂಟರ್, ಉದಾಹರಣೆ. ಸ್ಪೇಸ್ ಅಥವಾ ಎಂಟರ್ ಮುದ್ರೆ ಒತ್ತಿ ಒಂದು ಬಿಲ್ ಮುದ್ರಿಸುತ್ತದೆ; ಕೆಳಗಿನ ಬಾಣ ಅದನ್ನು ಇಳಿಸುತ್ತದೆ ಮಾತ್ರ.",
    },
    waiting: { en: "Waiting for your yes", hi: "आपकी हाँ का इंतज़ार", kn: "ನಿಮ್ಮ ಹೌದುಗಾಗಿ ಕಾಯುತ್ತಿದೆ" },
    maybe: { en: "Not a yes yet", hi: "अभी हाँ नहीं", kn: "ಇನ್ನೂ ಹೌದು ಅಲ್ಲ" },
    yes: { en: "Yes · brake lifts", hi: "हाँ · ब्रेक हटा", kn: "ಹೌದು · ಬ್ರೇಕ್ ಸಡಿಲ" },
    printing: { en: "Printing", hi: "छप रहा है", kn: "ಮುದ್ರಿಸುತ್ತಿದೆ" },
    issued: { en: "Issued", hi: "जारी", kn: "ನೀಡಲಾಗಿದೆ" },
    tearing: { en: "Torn off", hi: "फाड़ लिया", kn: "ಹರಿದು ತೆಗೆಯಲಾಗಿದೆ" },
    count: { en: "invoices {n}", hi: "बिल {n}", kn: "ಬಿಲ್ {n}" },
  },
};

const word = (key, lang, vars = {}) => {
  const entry = META.words[key];
  const text = entry ? entry[lang] ?? entry.en : "";
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
};

const { P, top: TOP, paper: PAPER, coil: COIL, counter: COUNTER, wheel: WHEEL } = GEO;
const RESUME_MS = 3600;
const TAU = Math.PI * 2;

/** Vertical coil spring from z0 to z1, split into the half behind its axis and the half in front. */
function coilPaths(cx, cy, z0, z1) {
  const count = Math.round(COIL.turns * 18);
  const back = [];
  const front = [];
  let run = [];
  let near = null;
  const { sinA, cosA } = { sinA: Math.sin((P.azimuth * Math.PI) / 180), cosA: Math.cos((P.azimuth * Math.PI) / 180) };
  for (let i = 0; i <= count; i++) {
    const share = i / count;
    const angle = share * COIL.turns * TAU;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const facing = c * cosA + s * sinA > 0;
    const flat = iso([cx + COIL.r * c, cy + COIL.r * s, z0 + (z1 - z0) * share], P);
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(pathOf(run));
  return { back: back.join(""), front: front.join("") };
}

function needleAt(angle) {
  const { x, y, r, top } = COUNTER;
  return lineOnTop([x - Math.sin(angle) * 1.2, y + Math.cos(angle) * 1.2], [x + Math.sin(angle) * (r - 2.6), y - Math.cos(angle) * (r - 2.6)], top, P);
}

/** Point on the platen wheel's outer face (axis +y, u = +x, v = +z). */
function wheelPoint(r, angle) {
  const [ox, oy, oz] = WHEEL.o;
  return iso([ox + r * Math.cos(angle), oy + WHEEL.t, oz + r * Math.sin(angle)], P);
}

export function mount(stage, { readout, lang: startLang = "en", reduced: startReduced = false }) {
  const svg = stage.querySelector("svg");
  const stampParts = [...svg.querySelectorAll('[data-move="stamp"]')];
  const brakeParts = [...svg.querySelectorAll('[data-move="brake"]')];
  const coils = [0, 1].map((i) => ({
    back: svg.querySelector(`[data-coil="${i}"][data-half="back"]`),
    front: svg.querySelector(`[data-coil="${i}"][data-half="front"]`),
  }));
  const paper = svg.querySelector('[data-part="paper"]');
  const print = svg.querySelector('[data-part="print"]');
  const sheet = Object.fromEntries([...paper.querySelectorAll("[data-paper]")].map((el) => [el.dataset.paper, el]));
  const needle = svg.querySelector('[data-part="needle"]');
  const mark = svg.querySelector('[data-part="wheel-mark"]');
  // Painter's order: items carry their settled key and a depth lift per share of their piece's
  // travel (the stamp's stroke, the brake's lift); re-sorted only when the order changes.
  const layer = svg.querySelector("[data-items]");
  const items = [...layer.children].map((el) => ({ el, k: Number(el.dataset.k), piece: el.dataset.piece, lift: Number(el.dataset.lift || 0) }));
  let order = items.map((_, i) => i).join(",");
  function resort() {
    if (!GEO.resort) return;
    const share = { stamp: s.stamp.x, brake: s.gate };
    const keyed = items.map((it, i) => ({ i, key: it.k + (it.piece ? it.lift * share[it.piece] : 0) }));
    keyed.sort((a, b) => a.key - b.key);
    const next = keyed.map((e) => e.i).join(",");
    if (next === order) return;
    order = next;
    const frag = document.createDocumentFragment();
    for (const e of keyed) frag.append(items[e.i].el);
    layer.append(frag);
  }

  let lang = startLang;
  let reduced = startReduced;
  let playing = false;
  let frame = 0;
  let last = 0;
  let tourClock = 0;
  let touring = !reduced;
  let tourPress = false;
  let idleTimer = 0;
  let s = M.still(GEO.still.count);
  const shown = { needle: M.counterAngle(s.count), wheel: M.wheelAngle(s) };
  let lastText = "";
  let drawn = {};

  const set = (el, name, value) => { if (el && el.getAttribute(name) !== value) el.setAttribute(name, value); };

  function draw() {
    const x = s.stamp.x;
    if (drawn.x !== x || drawn.gate !== s.gate) resort();
    if (drawn.x !== x) {
      const t = x > 0 ? translateAlong(P, [0, 0, -M.STROKE * x]) : "";
      for (const el of stampParts) if (t) set(el, "transform", t); else el.removeAttribute("transform");
      COIL.springs.forEach(([cx, cy], i) => {
        const c = coilPaths(cx, cy, COIL.z0, COIL.z1 - M.STROKE * x);
        set(coils[i].back, "d", c.back);
        set(coils[i].front, "d", c.front);
      });
      drawn.x = x;
    }
    if (drawn.gate !== s.gate) {
      const t = s.gate > 0 ? translateAlong(P, [0, 0, M.BRAKE_LIFT * s.gate]) : "";
      for (const el of brakeParts) if (t) set(el, "transform", t); else el.removeAttribute("transform");
      drawn.gate = s.gate;
    }
    const sheetNow = M.paperOf(s);
    const key = `${sheetNow.feed}|${sheetNow.lift}|${sheetNow.alpha}`;
    if (drawn.paper !== key) {
      const z0 = TOP + sheetNow.lift;
      const paths = slabOf(PAPER.plan, z0, M.LIP + sheetNow.feed, P, 2);
      set(sheet.fill, "d", paths.fill);
      paths.shades.forEach((d, i) => set(sheet[`shade${i}`], "d", d));
      set(sheet.top, "d", paths.top);
      set(sheet.crease, "d", paths.crease);
      set(sheet.outline, "d", paths.outline);
      set(print, "transform", translateAlong(P, [0, 0, sheetNow.feed + sheetNow.lift]));
      if (sheetNow.alpha < 1) set(paper, "opacity", sheetNow.alpha.toFixed(3)); else paper.removeAttribute("opacity");
      drawn.paper = key;
    }
    if (drawn.needle !== shown.needle) { set(needle, "d", needleAt(shown.needle)); drawn.needle = shown.needle; }
    if (drawn.wheel !== shown.wheel) {
      set(mark, "d", pathOf([wheelPoint(WHEEL.hub, shown.wheel), wheelPoint(WHEEL.r - 1.6, shown.wheel)]));
      drawn.wheel = shown.wheel;
    }
    writeReadout();
  }

  function writeReadout() {
    const text = `${word(s.phase, lang)} · ${word("count", lang, { n: s.count })}`;
    if (text !== lastText) { readout.textContent = text; lastText = text; }
  }

  /** Needle and wheel follow the model with a short critically damped lag (no jumps). */
  function follow(dt) {
    const wantNeedle = unwrap(shown.needle, M.counterAngle(s.count));
    const wantWheel = M.wheelAngle(s);
    if (reduced) { shown.needle = wantNeedle; shown.wheel = wantWheel; return false; }
    const a = 1 - Math.exp(-dt / 0.16);
    shown.needle += (wantNeedle - shown.needle) * a;
    shown.wheel += (wantWheel - shown.wheel) * (1 - Math.exp(-dt / 0.05));
    if (Math.abs(wantNeedle - shown.needle) < 1e-3) shown.needle = wantNeedle;
    if (Math.abs(wantWheel - shown.wheel) < 1e-3) shown.wheel = wantWheel;
    return shown.needle !== wantNeedle || shown.wheel !== wantWheel;
  }
  const unwrap = (from, to) => to + Math.round((from - to) / TAU) * TAU;

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    if (touring) {
      tourClock += dt;
      const t = M.tourAt(tourClock);
      s = M.hover(s, t.maybe);
      if (t.press && !tourPress) s = M.press(s);
      tourPress = t.press;
    }
    s = M.step(s, dt, false);
    const lagging = follow(dt);
    draw();
    const done = !touring && !lagging && M.settled(s);
    frame = playing && !done ? requestAnimationFrame(tick) : 0;
  }

  function kick() {
    if (reduced) { draw(); return; }
    if (playing && !frame) { last = 0; frame = requestAnimationFrame(tick); }
  }

  function takeOver() {
    touring = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (reduced || !playing) return;
      touring = true;
      tourClock = 0;
      tourPress = false;
      s = M.release(s);
      kick();
    }, RESUME_MS);
  }

  function doPress() {
    takeOver();
    if (reduced) { s = M.issueNow(s); follow(0); draw(); return; }
    s = M.press(s);
    kick();
  }
  function doHover(on) {
    if (reduced) return;
    takeOver();
    if (s.maybe === on) return;
    s = M.hover(s, on);
    kick();
  }

  const onMove = (event) => { if (event.pointerType !== "touch") doHover(true); };
  const onLeave = (event) => { if (event.pointerType !== "touch") doHover(false); };
  const onDown = (event) => { if (event.button === 0) doPress(); };
  const onKey = (event) => {
    if (event.key === " " || event.key === "Enter") doPress();
    else if (event.key === "ArrowDown") doHover(true);
    else if (event.key === "ArrowUp" || event.key === "Escape") { takeOver(); s = M.release(s); kick(); }
    else return;
    event.preventDefault();
  };
  const onKeyUp = (event) => { if (event.key === "ArrowDown") doHover(false); };

  // A press control: the stage is a button, and the readout (phase and count, which change only
  // on discrete events, never per frame) is a polite live region.
  stage.setAttribute("role", "button");
  readout.setAttribute("aria-live", "polite");
  stage.style.touchAction = "pan-y";
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);

  draw();

  return {
    play() {
      if (reduced) return;
      playing = true;
      if (!touring) takeOver();
      kick();
    },
    pause() { playing = false; if (frame) cancelAnimationFrame(frame); frame = 0; clearTimeout(idleTimer); },
    setReduced(next) {
      if (next === reduced) return;
      reduced = next;
      if (reduced) {
        this.pause();
        touring = false;
        s = M.still(Math.max(1, s.count));
        follow(0);
        draw();
      } else {
        touring = true;
        tourClock = 0;
        tourPress = false;
        draw();
      }
    },
    setLanguage(next) { lang = next; lastText = ""; writeReadout(); },
    destroy() {
      this.pause();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
    },
  };
}
