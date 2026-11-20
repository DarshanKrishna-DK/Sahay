// Small shared pieces of the Buy and Stock screens (UI v3), built on W1's component classes
// (public/css/README-v3.md section 2): keycap buttons, the talk chip, pills, state views, error
// lines, skeletons. Screen layout lives in app-buy.css and app-stock.css.

import { h, icon } from "./dom.js";
import { t, when, lang } from "./i18n.js";
import { clockOptions } from "./buy-model.js";
import { itemInLang } from "./stock-model.js";
import { stock } from "./store-sell.js";
import "./buy-i18n.js";
import { inCall, sendText } from "./call.js";
import { stateView as baseState } from "./empty.js";

/** Link a stylesheet once (app.html may already link it). */
export function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href }));
}

/**
 * Talk to Sahay from this screen (D11): with no call, a voice call starts in place with the
 * screen's hint; on a live call a prompt goes in as typed words (a request, never a yes).
 */
export function talkHere({ hint = null, prompt = null } = {}) {
  if (prompt && inCall()) { Promise.resolve(sendText(prompt)).catch(() => {}); return; }
  document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint } }));
}

/** The talk chip of a screen header ("बोलें"): mic + one word; starts the call here. */
export function talkChip({ word = t("b3.talk"), label, hint, prompt, cls = "" } = {}) {
  return h("button", {
    class: `chip chip-talk${cls ? ` ${cls}` : ""}`, type: "button", "aria-label": label && label !== word ? label : undefined,
    on: { click: () => talkHere({ hint, prompt }) },
  }, icon("mic", 22), h("span", { text: word }));
}

const TONE = { lime: "primary", glass: "secondary", coral: "danger", ghost: "ghost" };
/**
 * A keycap with an icon and one word. tone: "lime" (primary), "glass" (secondary), "coral"
 * (danger), "ghost". size: "lg" 64 | "md" 56 | "sm" 48. busy: spinner in place of the icon.
 * `href` makes it a link (external opens a new tab without an opener).
 */
export function btn({ icon: ic, word, label, tone = "glass", busy = false, onClick, href, size = "md", cls = "", external = false, disabled = false } = {}) {
  const inner = [
    busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : ic ? icon(ic, size === "lg" ? 26 : 22) : null,
    h("span", { text: word }),
  ];
  const klass = `keycap keycap-${TONE[tone] || tone} keycap-${size}${cls ? ` ${cls}` : ""}`;
  const aria = label && label !== word ? label : undefined;
  if (href) return h("a", { class: klass, href, target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined, "aria-label": aria }, ...inner);
  return h("button", {
    class: klass, type: "button", "aria-label": aria,
    "aria-busy": busy ? "true" : undefined, disabled: busy || disabled ? true : undefined, on: onClick ? { click: onClick } : undefined,
  }, ...inner);
}

/** "simulated vendor": at every vendor mention that is one (rule 4). */
export const simPill = () => h("span", { class: "pill pill-sim" }, icon("robot", 16), h("span", { text: t("simulated") }));
/** "test mode": on every pay link (Razorpay test mode only, rule 7). */
export const testPill = () => h("span", { class: "pill pill-test" }, icon("shield", 16), h("span", { text: t("b3.testMode") }));

/**
 * The designed state of a panel. kind "empty" | "error" | "missing" use W1's state view (icon, one
 * title, one sentence, one action). kind "loading" draws a skeleton in the panel's own shape
 * (`skeleton()`) over a status line, so the panel does not jump when the data arrives.
 */
export function stateView({ kind, icon: ic, title, text, action, skeleton, compact = false }) {
  if (kind === "loading") {
    return h("div", { class: `state state-loading x3-loading${compact ? " state-compact" : ""}`, role: "status", "aria-busy": "true" },
      skeleton ? h("div", { class: "x3-skel-wrap", "aria-hidden": "true" }, skeleton()) : null,
      h("p", { class: "x3-loading-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: title })));
  }
  return baseState({ kind, icon: ic || (kind === "missing" ? "info" : undefined), title, text, action, compact });
}

/** A skeleton block; shape is a W1 class (skel-line, skel-block, skel-circle, skel-card) plus ours. */
export const skel = (shape, cls = "") => h("span", { class: `skel ${shape}${cls ? ` ${cls}` : ""}` });

/** Words for a failed button: the server's own words when it sent some. */
export function errorWords(err, fallback = "s3.err.save") {
  if (!err) return t(fallback);
  if (err.status === 404 && /route|HTTP 404/i.test(err.message || "")) return t("s3.err.notReady");
  if (err.status === 409) return err.say || t("s3.err.gone");
  if (err.status === 0) return t("err.network");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || t(fallback);
}

/** One line that says something went wrong (alert icon + the words). */
export const errLine = (text) => h("p", { class: "error-line", role: "alert" }, icon("alert", 20), h("span", { text }));

/** A paper's punch notches sit on its tear line, whatever height the content above it has. */
const notchObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => { for (const e of entries) placeNotch(e.target); }) : null;
function placeNotch(paperEl) {
  const perf = paperEl.querySelector(":scope > .perforation");
  if (!perf || !paperEl.isConnected) return;
  const y = perf.offsetTop + perf.offsetHeight / 2;
  if (y > 0) paperEl.style.setProperty("--notch-y", `${Math.round(y)}px`);
}
export function alignNotches(root) {
  requestAnimationFrame(() => {
    for (const p of root.querySelectorAll(".paper")) {
      placeNotch(p);
      if (notchObserver && !p.__notch) { p.__notch = true; notchObserver.observe(p); }
    }
  });
}

const DAY_TIME = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
/** A date (and time) for the owner's screen: native month, 24-hour clock on hi / kn screens. */
export function dateTime(d, opts = DAY_TIME) { return d ? when(d, clockOptions(lang(), opts)) : ""; }
/** Just the time ("14:10" on hi / kn, "2:10 pm" in English). */
export const timeOnly = (d) => dateTime(d, { hour: "numeric", minute: "2-digit" });
/** A said item name in the screen's script when stock knows the same item in it (stock-model itemInLang). */
export const itemWords = (text) => itemInLang(text, [...stock.items.values()], lang());
