// Glass bottom sheet: modal dialog that slides up, Esc / scrim / Close dismiss, focus is kept
// inside and returned to the control that opened it.

import { h, icon, fill } from "./dom.js";
import { t } from "./i18n.js";

let current = null;

export function openSheet({ title, body, opener }) {
  closeSheet(false);
  const titleId = `sheet-title-${Date.now()}`;
  const close = h("button", { class: "icon-btn sheet-close tip-below", type: "button", "aria-label": t("close"), dataset: { tip: t("close") } }, icon("x", 24));
  const content = h("div", { class: "sheet-body" });
  const panel = h("div", { class: "sheet glass", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    h("span", { class: "sheet-grip", "aria-hidden": "true" }),
    h("div", { class: "sheet-head" }, h("h2", { class: "sheet-title", id: titleId, text: title }), close),
    content);
  const scrim = h("div", { class: "sheet-scrim" });
  const root = h("div", { class: "sheet-root" }, scrim, panel);
  fill(content, ...(Array.isArray(body) ? body : [body]));
  document.body.append(root);
  requestAnimationFrame(() => { root.classList.add("is-open"); panel.focus(); });
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button:not([disabled]), a[href], input:not([hidden]), select:not([hidden]), textarea, [tabindex]:not([tabindex='-1'])")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", () => closeSheet());
  scrim.addEventListener("click", () => closeSheet());
  current = { root, opener, onKey, content };
  return { setBody: (b) => fill(content, ...(Array.isArray(b) ? b : [b])), isOpen: () => current && current.root === root };
}

export function closeSheet(restore = true) {
  if (!current) return;
  const { root, opener, onKey } = current;
  current = null;
  document.removeEventListener("keydown", onKey, true);
  root.classList.remove("is-open");
  root.classList.add("is-closing");
  setTimeout(() => root.remove(), 200);
  if (restore && opener && opener.isConnected) opener.focus();
}
