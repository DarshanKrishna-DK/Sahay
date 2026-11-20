// Buy and Stock helpers without any look: talking from a screen, words for a failed button, dates
// for the owner's screen, item names in the screen's script.

import { t, when, lang } from "./i18n.js";
import { clockOptions } from "./buy-model.js";
import { itemInLang } from "./stock-model.js";
import { stock } from "./store-sell.js";
import "./buy-i18n.js";
import { inCall, sendText } from "./call.js";

/**
 * Talk to Sahay from this screen (D11): with no call, a voice call starts in place with the
 * screen's hint; on a live call a prompt goes in as typed words (a request, never a yes).
 */
export function talkHere({ hint = null, prompt = null } = {}) {
  if (prompt && inCall()) { Promise.resolve(sendText(prompt)).catch(() => {}); return; }
  document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint } }));
}

/** Words for a failed button: the server's own words when it sent some. */
export function errorWords(err, fallback = "s3.err.save") {
  if (!err) return t(fallback);
  if (err.status === 404 && /route|HTTP 404/i.test(err.message || "")) return t("s3.err.notReady");
  if (err.status === 409) return err.say || t("s3.err.gone");
  if (err.status === 0) return t("err.network");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || t(fallback);
}

const DAY_TIME = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
/** A date (and time) for the owner's screen: native month, 24-hour clock on hi / kn screens. */
export function dateTime(d, opts = DAY_TIME) { return d ? when(d, clockOptions(lang(), opts)) : ""; }
/** Just the time ("14:10" on hi / kn, "2:10 pm" in English). */
export const timeOnly = (d) => dateTime(d, { hour: "numeric", minute: "2-digit" });
/** A said item name in the screen's script when stock knows the same item in it (stock-model itemInLang). */
export const itemWords = (text) => itemInLang(text, [...stock.items.values()], lang());
