// Toasts for owner-facing moments (an order placed, a bill issued, money received...), drawn by
// sileo 0.1.6 (public/vendor/sileo-0.1.6, a React island bundled once by `npm run build:sileo`).
//
//   notify({ tone, title, body, icon, speakKey?, action?, id?, duration? }) -> id
//     tone      success | info | warning | error | action  (meaning also carried by the icon)
//     title     short words in the owner's language (already translated by the caller)
//     body      one or two sentences, any script; shown when the toast opens
//     icon      a dom.js icon name
//     speakKey  a /api/speak key ("order:<id>"): adds the round read-aloud button (speak.js)
//     action    { label, icon?, href?, newTab? | run() }: one button, e.g. "See stock"
//     id        de-duplicates: the same id within two minutes is not shown twice (the button
//               path and the live event of the same moment); replace: true updates it instead
//     duration  ms on screen; null keeps it until dismiss(id)
//
// Every toast is also announced in our own live region (polite; errors assertive), so screen
// readers hear the owner's words once. Placement (app-toast.css) keeps toasts under the top
// strip (the "automated assistant" notice stays visible), away from the bottom pill nav and the
// edge orb, at most three at a time. Theme follows the tokens; reduced motion is honoured.
// If the island cannot load, a plain stack (.toast) shows the same text: never silence.

import { h, icon, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { speakButton } from "./speak.js";

const ISLAND = "/vendor/sileo-0.1.6/sileo-island.js";
const TONES = new Set(["success", "info", "warning", "error", "action"]);
const DURATION = { success: 6500, info: 6500, action: 8000, warning: 9000, error: 11000 };
const STICKY_MS = 10 * 60 * 1000;
const maxOnScreen = () => (phone.matches ? 1 : 3); // a phone toast stays clear of the edge orb
const SEEN_MS = 2 * 60 * 1000;
const ICON_FOR = { success: "checkCircle", info: "info", action: "spark", warning: "alert", error: "alert" };

const phone = matchMedia("(max-width: 760px)");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const position = () => (phone.matches ? "top-center" : "top-right");

let island = null;      // the loaded module
let loading = null;     // its import() promise
let failed = false;
let host = null;
let handle = null;
let polite = null;
let assertive = null;
let fallback = null;
const queue = [];
const seen = new Map();   // id -> time shown
const onScreen = new Map(); // id -> expiry time (ms)

function ensureDom() {
  if (host) return;
  host = h("div", { class: "toast-host" });
  polite = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  assertive = h("div", { class: "sr-only", role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
  document.body.append(host, polite, assertive);
}

function load() {
  if (island || failed) return Promise.resolve(island);
  if (!loading) {
    ensureDom();
    loading = import(ISLAND).then((mod) => {
      island = mod;
      island.setReducedMotion(reduce.matches);
      handle = island.mount(host, { position: position(), options: { roundness: 18 } });
      while (queue.length) show(queue.shift());
      return island;
    }).catch((err) => {
      failed = true;
      console.error("Toasts could not load; showing plain notices instead.", err);
      while (queue.length) show(queue.shift());
      return null;
    });
  }
  return loading;
}

reduce.addEventListener("change", () => { if (island) island.setReducedMotion(reduce.matches); });
phone.addEventListener("change", () => { if (handle) handle.render({ position: position(), options: { roundness: 18 } }); });

/** Announce once in the right live region (cleared first so the same words are read again). */
function announce(text, urgent) {
  ensureDom();
  const region = urgent ? assertive : polite;
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = text; });
}

function actionControl(action, dismissIt) {
  if (!action || !action.label) return null;
  const content = [action.icon ? icon(action.icon, 20) : null, h("span", { text: action.label })];
  if (action.href) {
    const external = action.newTab || (/^https?:/i.test(action.href) && !action.href.startsWith(location.origin));
    return h("a", { class: "btn btn-ghost btn-sm toast-act", href: action.href, "data-sileo-button": "",
      target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined,
      on: { click: () => { if (!external) dismissIt(); } } }, ...content);
  }
  return h("button", { class: "btn btn-ghost btn-sm toast-act", type: "button", "data-sileo-button": "",
    on: { click: (e) => { e.stopPropagation(); try { action.run(); } finally { dismissIt(); } } } }, ...content);
}

function bodyNode(n, dismissIt) {
  const tools = [];
  if (n.speakKey) {
    const sp = speakButton(n.speakKey, { size: "sm" });
    sp.setAttribute("data-sileo-button", "");
    tools.push(sp);
  }
  const act = actionControl(n.action, dismissIt);
  if (act) tools.push(act);
  return h("div", { class: "toast-body" },
    n.body ? scripted("p", n.body, { class: "toast-text" }) : null,
    tools.length ? h("div", { class: "toast-tools" }, ...tools) : null);
}

function prune(now) {
  for (const [id, until] of onScreen) if (until <= now) onScreen.delete(id);
  for (const [id, at] of seen) if (now - at > SEEN_MS) seen.delete(id);
}

function show(n) {
  const dismissIt = () => dismiss(n.id);
  if (island) {
    const now = Date.now();
    prune(now);
    if (!onScreen.has(n.id)) {
      const live = [...onScreen.keys()];
      while (live.length >= maxOnScreen()) { const old = live.shift(); island.toast.dismiss(old); onScreen.delete(old); }
    }
    const ms = n.duration === null ? STICKY_MS : n.duration;
    onScreen.set(n.id, now + ms);
    island.toast[n.tone]({
      id: n.id,
      title: n.title,
      description: n.body || n.speakKey || n.action ? bodyNode(n, dismissIt) : undefined,
      icon: icon(n.icon || ICON_FOR[n.tone], 18),
      position: position(),
      duration: ms,
      autopilot: { expand: 150, collapse: Math.max(1500, ms - 1500) },
    });
    return;
  }
  // Plain notices when the island is unavailable (same words, same tools).
  if (!fallback) { fallback = h("div", { class: "toast-fallback" }); host.append(fallback); }
  const old = fallback.querySelector(`[data-id="${CSS.escape(n.id)}"]`);
  if (old) old.remove();
  while (fallback.children.length >= maxOnScreen()) fallback.firstElementChild.remove();
  const el = h("div", { class: `toast toast-${n.tone}`, dataset: { id: n.id } },
    h("span", { class: "toast-ico", "aria-hidden": "true" }, icon(n.icon || ICON_FOR[n.tone], 22)),
    h("div", { class: "toast-main" }, scripted("p", n.title, { class: "toast-title" }), bodyNode(n, dismissIt)),
    h("button", { class: "btn btn-ghost btn-sm toast-x", type: "button", "aria-label": t("close"), on: { click: dismissIt } }, icon("x", 18)));
  fallback.append(el);
  if (n.duration !== null) setTimeout(() => el.remove(), n.duration);
}

let seq = 0;

/** Show one toast (see the header). Returns its id. */
export function notify({ tone = "info", title, body = "", icon: ic, speakKey, action, id, duration, replace = false } = {}) {
  if (!title) return null;
  const tn = TONES.has(tone) ? tone : "info";
  const key = id ? String(id) : `toast-${Date.now().toString(36)}-${++seq}`;
  const now = Date.now();
  prune(now);
  if (id && seen.has(key) && !replace) return key; // this moment was already shown
  seen.set(key, now);
  const n = { tone: tn, title: String(title), body: body ? String(body) : "", icon: ic, speakKey, action, id: key,
    duration: duration === null ? null : (typeof duration === "number" ? duration : DURATION[tn]) };
  announce(n.body ? `${n.title}. ${n.body}` : n.title, tn === "error");
  if (island || failed) show(n);
  else { queue.push(n); load(); }
  return key;
}

/** Remove a toast now (the offline notice when the internet is back). */
export function dismiss(id) {
  if (!id) return;
  onScreen.delete(String(id));
  if (island) island.toast.dismiss(String(id));
  const el = fallback && fallback.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (el) el.remove();
}

/** Has this id been shown recently (button path and live event share an id)? */
export const shownRecently = (id) => { prune(Date.now()); return seen.has(String(id)); };

/** Start loading the island early (after boot), so the first toast does not wait for it. */
export function preloadToasts() { load(); }
