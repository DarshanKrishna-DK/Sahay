// CallDock: while a call is live (or starting, or just dropped) and the owner is on another screen,
// a small glass capsule with the mini orb (agent state), one line of what is happening, mute and
// End (its own red control, D12). Tapping the capsule goes to Sahay home without touching the call
// (D11). Placement: W1's shell slot `dockSlot` (phone: on the dock's orb notch; tablet and
// 1024-1279: bottom-right; 1280+: top of the agent column); without a shell it floats itself.
// States: connecting, safer route, listening, thinking, speaking, muted, reconnecting, dropped
// (+ call again), ending.

import { h, icon, fill, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { subscribe } from "./store.js";
import { call, inCall, busy, endCall, setMuted, startCall } from "./call.js";
import { runningJobs, agentState } from "./activity.js";
import { createMiniOrb } from "./orb.js";
import { orbView, endedKind } from "./home-model.js";

const HOME = /^#?\/?(sahay|talk)?(\/.*)?$/;
export const onHome = () => HOME.test(location.hash || "");

let dock = null;

/** Mount the dock once (talk.js does this at load). Idempotent. */
export function mountCallDock() {
  if (dock) return dock;
  dock = createCallDock();
  const place = (slot) => {
    if (slot) { dock.el.classList.add("is-slotted"); slot.append(dock.el); } else document.body.append(dock.el);
  };
  import("./shell.js").then((m) => place(m && m.slots && m.slots.dockSlot)).catch(() => place(null));
  subscribe(() => dock.update());
  window.addEventListener("hashchange", () => dock.update());
  window.addEventListener("online", () => dock.update());
  window.addEventListener("offline", () => dock.update());
  return dock;
}

function createCallDock() {
  const orb = createMiniOrb(36);
  const line = h("span", { class: "sh-dock-line" });
  const go = h("button", { class: "sh-dock-go", type: "button", on: { click: () => { location.hash = "#/sahay"; } } }, orb.el, line);
  const actions = h("div", { class: "sh-dock-actions" });
  const el = h("aside", { class: "glass glass-rim sh-calldock", hidden: true, dataset: { state: "idle" } }, go, actions);
  let dismissedEnd = null;

  function update() {
    const dropped = call.status === "idle" && call.ended && endedKind(call.ended.reason) !== "ended" && call.ended !== dismissedEnd;
    const show = !onHome() && (inCall() || busy() || dropped);
    el.hidden = !show;
    if (!show) return;
    el.setAttribute("aria-label", t("home.dock"));
    const v = orbView({ status: call.status, agentState: call.agentState, mode: call.mode, route: call.route, error: call.error, ended: call.ended, online: navigator.onLine !== false, working: runningJobs().length > 0, muted: call.muted });
    el.dataset.state = v.state;
    el.dataset.tone = v.tone;
    orb.set(v.visual, agentState());
    fill(line, scripted("span", t(v.key), { class: "sh-dock-words" }));
    go.setAttribute("aria-label", `${t(v.key)}. ${t("home.dockOpen")}`);
    const parts = [];
    if (dropped) {
      parts.push(h("button", { class: "keycap keycap-sm keycap-primary sh-dock-again", type: "button", on: { click: () => startCall(call.mode === "text" ? "text" : "voice") } }, icon("refresh", 22), h("span", { text: t("home.callAgain") })));
      parts.push(h("button", { class: "icon-btn", type: "button", "aria-label": t("close"), dataset: { tip: t("close") }, on: { click: () => { dismissedEnd = call.ended; update(); } } }, icon("x", 22)));
    } else {
      if (inCall() && !(call.mode === "text" && call.micless)) {
        parts.push(h("button", {
          class: "icon-btn sh-dock-mute", type: "button", "aria-pressed": String(call.muted),
          "aria-label": call.muted ? t("home.unmuteLong") : t("home.muteLong"), dataset: { tip: call.muted ? t("home.unmute") : t("home.mute") },
          on: { click: () => setMuted(!call.muted) },
        }, icon(call.muted ? "micOff" : "mic", 22)));
      }
      if (call.status !== "ending") {
        parts.push(h("button", { class: "keycap keycap-sm keycap-danger sh-dock-end", type: "button", "aria-label": inCall() ? t("home.endLong") : t("home.cancel"), on: { click: () => endCall() } },
          icon("phoneOff", 22), h("span", { text: inCall() ? t("home.end") : t("home.cancel") })));
      }
    }
    fill(actions, ...parts);
  }
  return { el, update };
}
