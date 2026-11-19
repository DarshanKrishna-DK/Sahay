// Read any card aloud: POST /api/speak { key } -> audio/mpeg (played here) or { spoken: true }
// (the live agent said it on the call). The client sends only a key; the server builds the
// sentence. A missing route (404 before Track B lands), a limit (429) or any failure is shown
// on the button that asked, never replaced by another voice.

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";

let audio = null;
let audioUrl = null;
let playingKey = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    if (fn.el && fn.el.__mounted && !fn.el.isConnected) { listeners.delete(fn); continue; }
    if (fn.el && fn.el.isConnected) fn.el.__mounted = true;
    fn(playingKey);
  }
}

export function stopSpeaking() {
  if (audio) { try { audio.pause(); } catch { /* ignore */ } }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audio = null; audioUrl = null; playingKey = null;
  emit();
}

export class SpeakError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** speak(key) -> "played" | "spoken"; throws SpeakError(code) with code NOT_READY | LIMIT | FAILED. */
export async function speak(key) {
  stopSpeaking();
  let res;
  try {
    res = await fetch("/api/speak", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg, application/json" },
      body: JSON.stringify({ key }),
    });
  } catch {
    throw new SpeakError("FAILED", t("err.network"));
  }
  if (res.status === 404) {
    let body = null;
    try { body = await res.json(); } catch { /* not json */ }
    // The route itself is missing (generic 404) vs the card no longer exists.
    throw new SpeakError(body && body.code && body.code !== "NOT_FOUND" ? "FAILED" : "NOT_READY", t(body && body.code && body.code !== "NOT_FOUND" ? "speak.failed" : "speak.notReady"));
  }
  if (res.status === 429) throw new SpeakError("LIMIT", t("speak.limit"));
  if (!res.ok) throw new SpeakError("FAILED", t("speak.failed"));
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await res.json().catch(() => ({}));
    if (body && body.spoken) return "spoken";
    throw new SpeakError("FAILED", t("speak.failed"));
  }
  const blob = await res.blob();
  audioUrl = URL.createObjectURL(blob);
  audio = new Audio(audioUrl);
  playingKey = key;
  emit();
  const done = () => { if (playingKey === key) stopSpeaking(); };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  try {
    await audio.play();
  } catch {
    stopSpeaking();
    throw new SpeakError("FAILED", t("speak.failed"));
  }
  return "played";
}

/**
 * A round 🔊 button for any card. States: idle -> loading -> playing | spoken | error (message
 * under the button, announced politely). Tap while playing stops.
 */
export function speakButton(key, { size = "md", label } = {}) {
  const note = h("span", { class: "speak-note", role: "status", "aria-live": "polite" });
  const btn = h("button", { class: `speak speak-${size}`, type: "button", "aria-label": label || t("speak.label"), dataset: { tip: label || t("speak.label") } }, icon("speaker", size === "sm" ? 20 : 26));
  const wrap = h("span", { class: "speak-wrap" }, btn, note);
  let busy = false;
  const sync = (pk) => {
    const playing = pk === key;
    btn.dataset.state = busy ? "loading" : playing ? "playing" : (btn.dataset.state === "error" ? "error" : "idle");
    btn.setAttribute("aria-pressed", String(playing));
    btn.setAttribute("aria-label", playing ? t("speak.stop") : (label || t("speak.label")));
  };
  sync.el = wrap;
  listeners.add(sync);
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (playingKey === key) { stopSpeaking(); return; }
    if (busy) return;
    busy = true; note.textContent = ""; btn.dataset.state = "loading";
    try {
      const how = await speak(key);
      busy = false;
      btn.dataset.state = "idle";
      if (how === "spoken") note.textContent = t("speak.onCall");
    } catch (err) {
      busy = false;
      btn.dataset.state = "error";
      note.textContent = err.message || t("speak.failed");
    }
    sync(playingKey);
  });
  sync(playingKey);
  return wrap;
}
