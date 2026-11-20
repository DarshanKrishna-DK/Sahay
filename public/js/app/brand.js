// The Sahay brand mark: the real logo (public/assets/sahay-logo.png, derivatives in
// public/assets/brand/). Never an invented mark; the lime thinking orb is the agent, not the brand.
//
//   brandMark({ size = 40, word = false, label }) -> <span class="brand-mark"> with the logo image
//     size: rendered height in px (the logo is 861x1078, so width = size * 0.8)
//     word: also show the word "Sahay" in the display face (.brand-word)
//   BRAND = { mark128, mark256, favicon32, favicon48, apple180, icon192, icon512 } (paths)
//
// Static pages (landing, pay) can use the same markup without JS:
//   <span class="brand-mark"><img src="/assets/brand/sahay-mark-128.png" srcset="/assets/brand/sahay-mark-256.png 2x"
//     width="32" height="40" alt="Sahay"></span>

import { h } from "./dom.js";
import { t } from "./i18n.js";

export const BRAND = Object.freeze({
  mark128: "/assets/brand/sahay-mark-128.png",
  mark256: "/assets/brand/sahay-mark-256.png",
  favicon32: "/assets/brand/favicon-32.png",
  favicon48: "/assets/brand/favicon-48.png",
  apple180: "/assets/brand/apple-touch-180.png",
  icon192: "/assets/brand/icon-192.png",
  icon512: "/assets/brand/icon-512.png",
});
const RATIO = 861 / 1078;

export function brandMark({ size = 40, word = false, label } = {}) {
  const w = Math.round(size * RATIO);
  const img = h("img", {
    class: "brand-img", src: BRAND.mark128, srcset: `${BRAND.mark256} 2x`,
    width: String(w), height: String(size), alt: word ? "" : (label || t("app.name")), decoding: "async",
  });
  return h("span", { class: `brand-mark${word ? " brand-with-word" : ""}` }, img,
    word ? h("span", { class: "brand-word", text: t("app.name") }) : null);
}
