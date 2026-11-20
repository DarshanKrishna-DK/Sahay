// Small DOM toolkit for the app: element builder, inline SVG icons, formatting helpers.
// All text goes in through textContent; nothing from the server is ever parsed as HTML.

import { scriptOf } from "../voice.js";
import { ICONS } from "./icons.js";

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
// Tabler Icons outline (MIT, icons.js), drawn at stroke 1.5 on a 24 grid. Always icon + word.

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
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (extraClass) svg.setAttribute("class", extraClass);
  for (const shape of ICONS[name] || []) {
    if (typeof shape === "string") {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", shape);
      svg.appendChild(p);
    } else {
      const { tag, ...attrs } = shape;
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
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
