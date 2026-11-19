// Edge orb: a glass half-disc on the right edge. Tap fans out a semicircle of bubble buttons
// (Talk, Type, New need, Approve with count, Pause). Each bubble is an icon plus one word;
// a long press shows the word large and says it with the device voice when one exists for
// the owner's language. Esc or a tap outside closes; arrow keys move between bubbles.

import { h, icon } from "./dom.js";
import { t, lang } from "./i18n.js";
import { pendingApprovals } from "./store.js";
import { call, inCall, textSupported } from "./call.js";

const ITEMS = [
  { id: "talk", icon: "mic", word: "edge.talk", aria: "edge.talk" },
  { id: "type", icon: "keyboard", word: "edge.type", aria: "edge.type" },
  { id: "need", icon: "plus", word: "edge.need", aria: "edge.needLong" },
  { id: "approve", icon: "check", word: "edge.approve", aria: "edge.approve" },
  { id: "pause", icon: "pause", word: "edge.pause", aria: "edge.pauseLong" },
];
// Angles in degrees, 0 = right, 90 = up: the fan opens to the left of the orb.
const ANGLES = [112, 146, 180, 214, 248];

export function createEdgeOrb({ onAction }) {
  const fanId = "edge-fan";
  const trigger = h("button", {
    class: "edge-trigger", type: "button", "aria-expanded": "false", "aria-controls": fanId,
  }, h("span", { class: "edge-core", "aria-hidden": "true" }), h("span", { class: "edge-count", hidden: true, "aria-hidden": "true" }));
  const bubbles = ITEMS.map((it, i) => {
    const b = h("button", { class: "edge-bubble", type: "button", dataset: { id: it.id }, style: `--a:${ANGLES[i]}deg;--i:${i}` },
      h("span", { class: "eb-ico" }, icon(it.icon, 26), it.id === "approve" ? h("span", { class: "eb-badge", hidden: true }) : null),
      h("span", { class: "eb-word" }),
      it.id === "type" ? h("span", { class: "eb-soon", hidden: true }) : null);
    return b;
  });
  const big = h("div", { class: "edge-bigword", "aria-hidden": "true", hidden: true });
  const fan = h("div", { class: "edge-fan", id: fanId, hidden: true }, ...bubbles);
  const root = h("div", { class: "edge" }, fan, trigger, big);
  let open = false;

  function setOpen(next, { focus = true } = {}) {
    if (open === next) return;
    open = next;
    root.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? t("edge.close") : t("edge.open"));
    trigger.dataset.tip = open ? t("edge.close") : t("edge.open");
    if (open) {
      fan.hidden = false;
      requestAnimationFrame(() => {
        root.classList.add("is-fanned");
        if (focus) { const first = bubbles.find((b) => b.getAttribute("aria-disabled") !== "true") || bubbles[0]; first.focus(); }
      });
    } else {
      root.classList.remove("is-fanned");
      setTimeout(() => { if (!open) fan.hidden = true; }, 220);
      if (focus) trigger.focus();
    }
  }

  trigger.addEventListener("click", () => setOpen(!open));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); return; }
    if (!open) return;
    const i = bubbles.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); bubbles[(i + 1) % bubbles.length].focus(); }
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); bubbles[(i - 1 + bubbles.length) % bubbles.length].focus(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (open && !root.contains(e.target)) setOpen(false, { focus: false });
  });

  // Long press: say the word.
  for (const b of bubbles) {
    let timer = 0;
    let longPressed = false;
    b.addEventListener("pointerdown", () => {
      longPressed = false;
      timer = setTimeout(() => { longPressed = true; sayWord(b); }, 550);
    });
    const cancel = () => clearTimeout(timer);
    b.addEventListener("pointerup", cancel);
    b.addEventListener("pointerleave", cancel);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      if (longPressed) { e.preventDefault(); longPressed = false; return; }
      if (b.getAttribute("aria-disabled") === "true") { sayWord(b); return; }
      setOpen(false, { focus: false });
      onAction(b.dataset.id);
    });
  }

  function sayWord(b) {
    const word = b.getAttribute("aria-label") || "";
    big.textContent = word;
    big.hidden = false;
    clearTimeout(big.__t);
    big.__t = setTimeout(() => { big.hidden = true; }, 1600);
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const want = { hi: "hi", kn: "kn", en: "en" }[lang()];
      const voice = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(want));
      if (!voice) return; // no device voice for this language: the large word is the answer
      const u = new SpeechSynthesisUtterance(word);
      u.voice = voice; u.lang = voice.lang;
      synth.cancel(); synth.speak(u);
    } catch { /* speech not available */ }
  }

  function update() {
    const pending = pendingApprovals().length;
    const live = inCall();
    const text = textSupported();
    const count = trigger.querySelector(".edge-count");
    count.hidden = pending === 0;
    count.textContent = pending ? String(pending) : "";
    trigger.setAttribute("aria-label", open ? t("edge.close") : (pending ? `${t("edge.open")}, ${t("yes.pending", { n: pending })}` : t("edge.open")));
    trigger.dataset.tip = open ? t("edge.close") : t("edge.open");
    root.dataset.call = call.status;
    for (const b of bubbles) {
      const it = ITEMS.find((x) => x.id === b.dataset.id);
      b.querySelector(".eb-word").textContent = t(it.word);
      let disabled = false;
      let label = t(it.aria);
      if (it.id === "type" && !text) { disabled = true; label = `${t(it.aria)}, ${t("talk.typeSoon")}`; }
      if (it.id === "approve") {
        const badge = b.querySelector(".eb-badge");
        badge.hidden = pending === 0;
        badge.textContent = pending ? String(pending) : "";
        if (!pending) { disabled = true; label = `${t(it.aria)}, ${t("edge.noApprovals")}`; } else label = `${t(it.aria)}, ${t("yes.pending", { n: pending })}`;
      }
      if (it.id === "pause" && !live) { disabled = true; label = `${t(it.aria)}, ${t("edge.notInCall")}`; }
      if (it.id === "talk" && live && call.mode === "voice") b.dataset.active = "true"; else delete b.dataset.active;
      const soon = b.querySelector(".eb-soon");
      if (soon) { soon.hidden = text; soon.textContent = t("edge.soon"); }
      b.setAttribute("aria-label", label);
      b.dataset.tip = label;
      if (disabled) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    }
  }

  return { el: root, update, close: () => setOpen(false, { focus: false }) };
}

