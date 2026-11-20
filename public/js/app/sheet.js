// Sheet, Drawer and Modal: one modal dialog primitive placed per size (spec 6.3). Phone: bottom sheet
// over the dock (swipe down closes); phone landscape: right drawer; tablet: centred bottom sheet;
// laptop: centred modal. `place` forces one ("sheet" | "drawer" | "modal"); `kind: "yes"` follows the
// Yes card rules (1024-1279 drawer). Esc, the scrim and Close dismiss; focus stays inside and goes back
// to the opener. Title row: title, read-aloud (speakKey), close. States: busy, error, closing.
//
// openSheet({ title, body, opener, speakKey, place, kind, onClose, footer, label, closeLabel })
//   -> { el, setBody(nodes), setFooter(nodes), setBusy(bool, text?), setError(text|null), close(), isOpen() }
// closeSheet(restoreFocus = true) closes the open one.

import { h, icon, fill } from "./dom.js";
import { t } from "./i18n.js";
import { sizeClass } from "./shell-geometry.js";
import { speakButton } from "./speak.js";

let current = null;

function host() {
  return document.querySelector(".sheet-host") || document.body;
}

export function placeFor(kind = "other", w = window.innerWidth, hgt = window.innerHeight) {
  const s = sizeClass(w, hgt);
  if (s === "phone") return "sheet";
  if (s === "phoneLand") return "drawer";
  if (s === "tablet") return "sheet";
  if (kind === "yes") return "drawer";
  return "modal";
}

export function openSheet({ title, body, opener, speakKey, place, kind = "other", onClose, footer, label, closeLabel } = {}) {
  closeSheet(false);
  const where = place || placeFor(kind);
  const titleId = `sheet-title-${Date.now().toString(36)}`;
  // closeLabel: a worded close ("Later" on a Yes card, spec 6.3); otherwise the round X.
  const close = closeLabel
    ? h("button", { class: "chip sheet-close sheet-later", type: "button" }, icon("clock", 20), h("span", { text: closeLabel }))
    : h("button", { class: "icon-btn sheet-close tip-below tip-end", type: "button", "aria-label": t("close"), dataset: { tip: t("close") } }, icon("x", 24));
  const content = h("div", { class: "sheet-body" });
  const foot = h("div", { class: "sheet-foot" });
  const errBox = h("div", { class: "sheet-error", role: "alert" });
  const busy = h("span", { class: "sheet-busy", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { class: "sheet-busy-text" }));
  const head = h("div", { class: "sheet-head" },
    h("h2", { class: "sheet-title", id: titleId, text: title || "" }),
    speakKey ? h("span", { class: "card-speak" }, speakButton(speakKey, { size: "md" })) : null,
    close);
  const grip = h("span", { class: "sheet-grip", "aria-hidden": "true" });
  const panel = h("div", {
    class: "sheet glass glass-rim", role: "dialog", "aria-modal": "true",
    "aria-labelledby": title ? titleId : undefined, "aria-label": !title ? label : undefined, tabindex: "-1",
  }, grip, head, busy, errBox, content, foot);
  const scrim = h("div", { class: "sheet-scrim" });
  const root = h("div", { class: "sheet-root", dataset: { place: where } }, scrim, panel);
  fill(content, ...(Array.isArray(body) ? body : [body]));
  if (footer) fill(foot, ...(Array.isArray(footer) ? footer : [footer]));
  host().append(root);
  requestAnimationFrame(() => { root.classList.add("is-open"); panel.focus({ preventScroll: true }); });

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button:not([disabled]), a[href], input:not([hidden]):not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", () => closeSheet());
  scrim.addEventListener("click", () => closeSheet());

  // Swipe down on the grip or the title row closes a bottom sheet (never starts on a button).
  if (where === "sheet") {
    let startY = null, dy = 0;
    const down = (e) => {
      if ((e.button !== undefined && e.button !== 0) || (e.target.closest && e.target.closest("button, a"))) return;
      startY = e.clientY; dy = 0;
      panel.classList.add("is-dragging");
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    };
    const move = (e) => { if (startY === null) return; dy = Math.max(0, e.clientY - startY); panel.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      if (startY === null) return;
      startY = null;
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      if (dy > 90) closeSheet();
    };
    for (const zone of [grip, head]) {
      zone.style.touchAction = "none";
      zone.addEventListener("pointerdown", down);
      zone.addEventListener("pointermove", move);
      zone.addEventListener("pointerup", up);
      zone.addEventListener("pointercancel", up);
    }
  }

  const handle = {
    el: panel,
    setBody: (b) => fill(content, ...(Array.isArray(b) ? b : [b])),
    setFooter: (b) => fill(foot, ...(Array.isArray(b) ? b : [b])),
    setBusy(on, text) {
      if (on) panel.setAttribute("aria-busy", "true"); else panel.removeAttribute("aria-busy");
      busy.querySelector(".sheet-busy-text").textContent = on ? (text || t("shell.saving")) : "";
    },
    setError(text) {
      if (!text) { errBox.replaceChildren(); return; }
      errBox.replaceChildren(h("p", { class: "error-line error-box" }, icon("alert", 20), h("span", { text })));
    },
    close: () => { if (current && current.root === root) closeSheet(); },
    isOpen: () => Boolean(current && current.root === root),
  };
  current = { root, opener, onKey, content, onClose };
  return handle;
}

export function closeSheet(restore = true) {
  if (!current) return;
  const { root, opener, onKey, onClose } = current;
  current = null;
  document.removeEventListener("keydown", onKey, true);
  root.classList.remove("is-open");
  root.classList.add("is-closing");
  setTimeout(() => root.remove(), 200);
  if (restore && opener && opener.isConnected) opener.focus();
  if (onClose) { try { onClose(); } catch (err) { console.error(err); } }
}

export function sheetOpen() { return Boolean(current); }
