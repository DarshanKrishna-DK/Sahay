// My Sahay rules with no DOM (tested in test/me-logic.test.js): its five sections and their
// routes (Stitch 09-mysahay: Rules, Memory, Voice, Shop, History), the order rules and memories
// are listed in, and the checks on the Telegram deep link before it ever becomes an href.

/** Sections in order (spec 1.1 row 6, D4; v4 Stitch 09): route #/me/<id>, icon from dom.js ICONS.
 *  "teach" keeps its route id (links and the shell use it) and is called Rules on screen. */
export const ME_SECTIONS = [
  { id: "teach", icon: "star", word: "me3.rules" },
  { id: "memory", icon: "box", word: "me3.memoryTab" },
  { id: "voice", icon: "speaker", word: "me3.voice" },
  { id: "shop", icon: "store", word: "me3.shop" },
  { id: "history", icon: "history", word: "me3.history" },
];
const IDS = new Set(ME_SECTIONS.map((s) => s.id));

/** "#/me/shop" -> "shop"; "#/history" (old link) -> "history"; anything else -> null. */
export function sectionFromHash(hash) {
  const h = String(hash || "");
  if (/^#\/history(?:[/?]|$)/.test(h)) return "history";
  const m = /^#\/me\/([a-z]+)/.exec(h);
  return m && IDS.has(m[1]) ? m[1] : null;
}

export const sectionHash = (id) => `#/me/${IDS.has(id) ? id : "teach"}`;

export const STYLES = ["gentle", "balanced", "tough"];
export const SPEEDS = ["slow", "normal"];

/** Keyboard on the bargaining dial: arrow keys move one stop, Home / End jump. -> next index or null. */
export function dialKey(key, index, count = STYLES.length) {
  const last = count - 1;
  let n = null;
  if (key === "ArrowRight" || key === "ArrowUp") n = Math.min(last, index + 1);
  else if (key === "ArrowLeft" || key === "ArrowDown") n = Math.max(0, index - 1);
  else if (key === "Home") n = 0;
  else if (key === "End") n = last;
  return n === null || n === index ? null : n;
}

/**
* List items: suggested rules first (they wait for the owner), then active rules, then
 * memories. Rules switched off are not stars. -> [{ type: "rule"|"memory", data }]
 */
export function starItems(rules = [], memories = []) {
  const rank = { suggested: 0, active: 1 };
  const rs = [...rules].filter((r) => r && r.status !== "off")
    .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
  return [...rs.map((d) => ({ type: "rule", data: d })), ...[...memories].filter(Boolean).map((d) => ({ type: "memory", data: d }))];
}

/** A rule's or memory's sentence in the owner's language (object by language code, or one string). */
export function sentenceOf(x, langCode) {
  const s = x && x.sentence;
  if (!s) return "";
  if (typeof s === "string") return s;
  return s[langCode] || s["en-IN"] || Object.values(s).find((v) => typeof v === "string") || "";
}

/** Only a https://t.me/ link from the server is ever opened (POST /api/telegram/link-code deepLink). */
export function telegramLink(r) {
  const u = r && typeof r.deepLink === "string" ? r.deepLink : null;
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "t.me" ? url.href : null;
  } catch { return null; }
}
