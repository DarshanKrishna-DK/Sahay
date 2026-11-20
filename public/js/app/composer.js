// Composer (D16): type to Sahay on the same session as the voice. A keyboard button beside the orb
// opens it; it sits above the phone keyboard while that is open. With no call, sending starts a
// typed session (mic off). During a voice call typing never mutes the mic, so the owner can still
// say the yes. A typed yes never approves (CLAUDE.md rule 3): the composer says so and puts the
// waiting card's own Yes button right under the note (W3's renderCard), or a button to open it.
// States: closed, open empty, typing, sending, failed, typed-yes note.

import { h, icon, fill } from "./dom.js";
import { t } from "./i18n.js";
import { call, inCall, sendText } from "./call.js";
import { isTypedYes } from "./home-model.js";

const MAX = 500;
let waitingMod = null;
const waiting = () => (waitingMod ||= import("./waiting.js").catch(() => null));

/** createComposer({ onOpenChange, openTray, waitingCount }) -> { el, open(), close(), isOpen(), update() } */
export function createComposer({ onOpenChange, openTray, waitingCount } = {}) {
  const input = h("textarea", { class: "sh-composer-input", id: "sh-composer-input", rows: "1", maxlength: String(MAX), enterkeyhint: "send", autocomplete: "off", spellcheck: "true" });
  const label = h("label", { class: "sr-only", for: "sh-composer-input" });
  const send = h("button", { class: "keycap keycap-md keycap-primary sh-send", type: "submit" });
  const closeBtn = h("button", { class: "icon-btn sh-composer-close", type: "button", on: { click: () => close(true) } }, icon("x", 22));
  const hint = h("p", { class: "sh-composer-hint" });
  const note = h("div", { class: "sh-composer-note", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "sh-composer-row", autocomplete: "off" }, label, input, send);
  const el = h("section", { class: "sh-composer", hidden: true, dataset: { state: "closed" } }, h("div", { class: "sh-composer-head" }, hint, closeBtn), form, note);
  let opened = false;
  let failedText = null;
  let yesShown = false;

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  async function showTypedYes() {
    yesShown = true;
    const mod = await waiting();
    const items = mod && typeof mod.waitingItems === "function" ? mod.waitingItems() : [];
    const first = items[0];
    const parts = [h("p", { class: "error-line sh-composer-yesnote" }, icon("alert", 20), h("span", { text: t("home.typedYes") }))];
    if (first && mod && typeof mod.renderCard === "function") {
      try { parts.push(mod.renderCard(first, { place: "inline" })); } catch { /* fall back to the tray button */ }
    }
    if (parts.length === 1) {
      parts.push(h("button", { class: "keycap keycap-md keycap-primary", type: "button", on: { click: () => openTray && openTray() } }, icon("check", 22), h("span", { text: t("home.openYes") })));
    }
    fill(note, ...parts);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || call.sending) return;
    failedText = null;
    yesShown = false;
    fill(note);
    const yes = isTypedYes(text) && (waitingCount ? waitingCount() > 0 : false);
    const ok = await sendText(text);
    if (ok) {
      input.value = "";
      grow();
      if (yes) await showTypedYes();
    } else {
      failedText = text;
    }
    update();
    input.focus({ preventScroll: true });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === "Escape") { e.preventDefault(); close(true); }
  });
  input.addEventListener("input", () => { grow(); if (failedText !== null) { failedText = null; } update(); });

  // Sit on top of the phone keyboard: the gap between the layout and the visual viewport.
  const vv = window.visualViewport;
  function keyboard() {
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    el.style.setProperty("--kb", `${kb}px`);
    el.dataset.kb = kb > 150 ? "open" : "closed";
  }
  if (vv) { vv.addEventListener("resize", keyboard); vv.addEventListener("scroll", keyboard); }

  function open() {
    if (!opened) { opened = true; el.hidden = false; onOpenChange && onOpenChange(true); }
    update();
    requestAnimationFrame(() => input.focus());
  }
  function close(restoreFocus) {
    if (!opened) return;
    opened = false;
    el.hidden = true;
    fill(note);
    yesShown = false;
    onOpenChange && onOpenChange(false, restoreFocus);
  }

  function update() {
    label.textContent = t("home.composer");
    closeBtn.setAttribute("aria-label", t("home.typeClose"));
    closeBtn.dataset.tip = t("home.typeClose");
    const live = inCall();
    hint.textContent = live ? (call.mode === "text" && call.micless ? "" : t("home.micStaysOn")) : t("home.typedStarts");
    hint.hidden = !hint.textContent;
    const sending = Boolean(call.sending);
    input.disabled = sending;
    send.disabled = sending || !input.value.trim();
    send.setAttribute("aria-label", sending ? t("home.sending") : t("home.send"));
    send.dataset.tip = t("home.send");
    fill(send, sending ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("send", 22));
    const failed = failedText !== null && call.sendError;
    el.dataset.state = !opened ? "closed" : sending ? "sending" : failed ? "failed" : yesShown ? "yes" : input.value.trim() ? "typing" : "empty";
    if (failed && !yesShown) fill(note, h("p", { class: "error-line sh-composer-fail", role: "alert" }, icon("alert", 20), h("span", { text: t("home.sendFail") })));
    else if (!yesShown && !failed) fill(note);
  }

  return { el, open, close, isOpen: () => opened, update };
}
