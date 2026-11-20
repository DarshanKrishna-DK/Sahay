// Small DOM toolkit for the app: element builder, inline SVG icons, formatting helpers.
// All text goes in through textContent; nothing from the server is ever parsed as HTML.

import { scriptOf } from "../voice.js";

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = String(v);
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style") el.setAttribute("style", v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Rebuild `el` only when `key` changed since the last call (keeps focus and running animations). */
export function patch(el, key, build) {
  if (el.__key === key) return false;
  el.__key = key;
  const out = build();
  fill(el, ...(Array.isArray(out) ? out : [out]));
  return true;
}

/** Text with the right lang attribute so Devanagari and Kannada use their Noto faces. */
export function scripted(tag, text, props = {}) {
  const sc = scriptOf(text);
  return h(tag, { ...props, lang: sc === "hi" ? "hi" : sc === "kn" ? "kn" : props.lang, text });
}

/* ---------------------------------------------------------------- icons -- */
// 24px stroke icons (paths drawn for this app, Lucide-style geometry).
const ICONS = {
  mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  micOff: ["M2 2l20 20", "M18.9 13.9A7 7 0 0 0 19 12v-2", "M5 10v2a7 7 0 0 0 12 5", "M15 9.3V5a3 3 0 0 0-5.7-1.3", "M9 9v3a3 3 0 0 0 5.1 2.1", "M12 19v3"],
  keyboard: ["M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z", "M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10"],
  plus: ["M12 5v14M5 12h14"],
  check: ["M20 6L9 17l-5-5"],
  x: ["M18 6L6 18M6 6l12 12"],
  pause: ["M9 5v14M15 5v14"],
  speaker: ["M11 5L6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  phoneOff: ["M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.7c.1.8.3 1.6.6 2.4a2 2 0 0 1-.5 2.1L8.9 9.5", "M22 2L2 22"],
  talk: ["M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"],
  river: ["M4 19c4 0 4-6 8-6s4-6 8-6", "M4 19h.01M12 13h.01M20 7h.01"],
  receipt: ["M5 2v20l2.5-1.5L10 22l2-1.5 2 1.5 2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5z", "M9 8h6M9 12h6M9 16h4"],
  spark: ["M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z", "M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 3"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  ear: ["M6 8.5a6 6 0 1 1 12 0c0 6-6 6-6 10a3.5 3.5 0 0 1-6.5 1.5", "M9 9a3 3 0 1 1 6 0c0 2-2 3-2 3"],
  handshake: ["M11 17l-1.5 1.5a2 2 0 0 1-2.8-2.8L10 12.4", "M13 7l2-2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L14 18", "M3 11l4-4 3 1 3-2", "M14 18l-3-3"],
  doc: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6M8 13h8M8 17h5"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5M12 15V3"],
  rupee: ["M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  alert: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 8v4M12 16h.01"],
  wifi: ["M2 8.8a15 15 0 0 1 20 0", "M5 12.5a10 10 0 0 1 14 0", "M8.5 16a5 5 0 0 1 7 0", "M12 19.5h.01"],
  store: ["M3 9l1.5-5h15L21 9", "M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z", "M5 13v8h14v-8"],
  robot: ["M12 8V4H8", "M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M9 13v2M15 13v2"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"],
  gauge: ["M12 14l4-4", "M3.3 19a10 10 0 1 1 17.4 0z"],
  turtle: ["M3 15h18", "M5 15a7 7 0 0 1 14 0", "M7 15v3M17 15v3", "M19 13l2-1"],
  heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"],
  ban: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M4.9 4.9l14.2 14.2"],
  box: ["M21 8l-9-5-9 5v8l9 5 9-5z", "M3 8l9 5 9-5M12 13v8"],
  tag: ["M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z", "M7 7h.01"],
  arrowLeft: ["M19 12H5M12 19l-7-7 7-7"],
  arrowRight: ["M5 12h14M12 5l7 7-7 7"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  pin: ["M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  refresh: ["M21 12a9 9 0 0 1-15.5 6.2L3 16", "M3 12a9 9 0 0 1 15.5-6.2L21 8", "M21 3v5h-5M3 21v-5h5"],
  headphones: ["M3 18v-6a9 9 0 0 1 18 0v6", "M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"],
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6M10 14L21 3"],
  chevronUp: ["M6 15l6-6 6 6"],
  truck: ["M1 3h15v13H1z", "M16 8h4l3 3v5h-7z", "M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  // Business suite (v2): auth, buy / sell / stock / money.
  fingerprint: ["M12 10a2 2 0 0 0-2 2c0 1-.1 2.5-.3 4", "M14 13.1c0 2.4 0 6.4-1 8.9", "M17.3 21c.1-.6.4-2.3.5-3", "M2 12a10 10 0 0 1 18-6", "M2 16h.01", "M21.8 16c.2-2 .1-5.4 0-6", "M5 19.5c.5-1.5 1-4.5 1-7.5a6 6 0 0 1 .3-2", "M8.7 22c.2-.7.4-1.3.6-2", "M9 6.8a6 6 0 0 1 9 5.2v2"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M6 11h12a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a1 1 0 0 1 1-1z", "M12 15v3"],
  phone: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"],
  backspace: ["M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z", "M18 9l-6 6M12 9l6 6"],
  cart: ["M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6", "M9 21h.01M18 21h.01"],
  share: ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "M16 6l-4-4-4 4", "M12 2v13"],
  wallet: ["M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  cash: ["M2 6h20v12H2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 12h.01M18 12h.01"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4M12 8h.01"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  jar: ["M8 2h8", "M9 2v3a4 4 0 0 1-3 4v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a4 4 0 0 1-3-4V2", "M6 14h12"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  moneyIn: ["M17 7L7 17", "M17 17H7V7"],
  checkCircle: ["M22 11.1V12a10 10 0 1 1-5.9-9.1", "M22 4L12 14l-3-3"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  key: ["M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z", "M12 11v11M12 17h3M12 20h2"],
  // v3 shell and primitives.
  sahay: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8.5 12h.01M12 8.5h.01M15.5 12h.01M12 15.5h.01M12 12h.01"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 18l6-6-6-6"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  languages: ["M4 5h8M8 3v2M5.5 5c.6 3.4 2.8 6 6 7.5", "M10.5 5c-.7 3.6-3 6.4-6.5 8", "M13 21l4.5-10L22 21M14.5 17.5h6"],
  star: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"],
  wifiOff: ["M2 2l20 20", "M8.5 16.4a5 5 0 0 1 7 0", "M2 8.8a15 15 0 0 1 4.2-2.7", "M10.7 5.1A15 15 0 0 1 22 8.8", "M16.8 10.7a10 10 0 0 1 2.2 1.6", "M5 12.5a10 10 0 0 1 5.2-2.7", "M12 19.5h.01"],
  stop: ["M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
  minus: ["M5 12h14"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4M8 2v4M3 10h18"],
  sliders: ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3", "M1 14h6M9 8h6M17 16h6"],
  copy: ["M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  home: ["M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
};

/** Every icon name, for modules that check before asking (icon(name) draws nothing for an unknown name). */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

export function icon(name, size = 24, extraClass) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (extraClass) svg.setAttribute("class", extraClass);
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  return el;
}

/* ----------------------------------------------------------- formatting -- */

export function pick(o, ...keys) {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
export function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
export function parseMaybeJson(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}
export const asArray = (v) => (Array.isArray(v) ? v : []);

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
/** "₹11,000" or "₹55.5" (Indian grouping, no trailing .00). */
export function rupees(v) {
  const n = num(v);
  if (n === null) return null;
  return `₹${Number.isInteger(n) ? inr0.format(n) : inr2.format(n)}`;
}
export function amount(v) {
  const n = num(v);
  return n === null ? null : inr2.format(n);
}

export function toDate(ts) {
  if (ts === null || ts === undefined || ts === "") return null;
  const d = typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Only http(s) links or same-origin paths ever become an href. */
export function safeUrl(u) {
  if (typeof u !== "string" || !u) return null;
  try {
    const url = new URL(u, location.origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch { return null; }
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
