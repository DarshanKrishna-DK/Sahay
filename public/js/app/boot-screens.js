// Boot screens (spec 3.1 row 55): what shows before the app is ready, over the hex field.
//   bootSplash()                         loading: the Sahay orb connecting, "Opening your Sahay"
//   bootError({ err, onRetry, onLogin }) error + Try again; a 401/403 is "session expired" + Log in
// The automated-assistant notice is on both. Shell (main.js) mounts the returned element.

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";
import "./me-strings.js";

const notice = () => h("p", { class: "pill boot-notice", role: "note" }, icon("robot", 18), h("span", { text: t("notice.long") }));

/** -> { el, destroy() } */
export function bootSplash() {
  const orb = createThinkingOrb({ size: 96, state: "connecting" });
  const el = h("div", { class: "boot boot-loading", role: "status", "aria-busy": "true" },
    h("span", { class: "boot-orb", "aria-hidden": "true" }, orb.el),
    h("p", { class: "boot-title", text: t("boot3.loading") }),
    notice());
  return { el, destroy: () => orb.destroy() };
}

/** Plain words for a boot failure (the server's own sentence when it sent one). */
export function bootErrorText(err) {
  if (!err || err.status === 0) return t("err.network");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || t("err.network");
}

export const isSessionEnded = (err) => Boolean(err && (err.status === 401 || err.status === 403));

/** -> { el, destroy() } */
export function bootError({ err, onRetry, onLogin } = {}) {
  const ended = isSessionEnded(err);
  const el = h("div", { class: `boot boot-error${ended ? " is-ended" : ""}`, role: "alert" },
    h("span", { class: "boot-mark", "aria-hidden": "true" }, icon(ended ? "lock" : "wifiOff", 40)),
    h("p", { class: "boot-title", text: ended ? t("boot3.expired") : t("boot3.error") }),
    h("p", { class: "boot-text", text: ended ? t("boot3.expiredText") : bootErrorText(err) }),
    ended && onLogin
      ? h("button", { class: "keycap keycap-primary keycap-lg", type: "button", on: { click: onLogin } }, icon("key", 24), h("span", { text: t("au.login") }))
      : h("button", { class: "keycap keycap-primary keycap-lg", type: "button", on: { click: () => onRetry && onRetry() } }, icon("refresh", 24), h("span", { text: t("retry") })),
    notice());
  return { el, destroy() {} };
}
