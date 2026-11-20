// My Sahay rules with no DOM (tested in test/me-logic.test.js): its four sections and their
// routes, the order rules and memories take in the constellation, star positions, and the checks
// on the Telegram deep link before it ever becomes an href.

/** Sections in order (spec 1.1 row 6, D4): route #/me/<id>, icon from dom.js ICONS. */
export const ME_SECTIONS = [
  { id: "teach", icon: "spark", word: "me3.teach" },
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
 * Constellation items: suggested rules first (they wait for the owner), then active rules, then
 * memories. Rules switched off are not stars. -> [{ type: "rule"|"memory", data }]
 */
export function starItems(rules = [], memories = []) {
  const rank = { suggested: 0, active: 1 };
  const rs = [...rules].filter((r) => r && r.status !== "off")
    .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
  return [...rs.map((d) => ({ type: "rule", data: d })), ...[...memories].filter(Boolean).map((d) => ({ type: "memory", data: d }))];
}

/**
 * Star positions in percent of a square box: up to 6 on the inner orbit, up to 10 more outside,
 * the rest are listed only (the list below the sky always holds every item).
 * -> [{ x, y, ring: 0|1 }] for the first min(n, 16) items.
 */
export function starPositions(n) {
  const out = [];
  const inner = Math.min(n, 6);
  const outer = Math.min(Math.max(n - 6, 0), 10);
  for (let i = 0; i < inner; i++) {
    const a = (-90 + (360 / inner) * i) * (Math.PI / 180);
    out.push({ x: round(50 + 27 * Math.cos(a)), y: round(50 + 27 * Math.sin(a)), ring: 0 });
  }
  for (let i = 0; i < outer; i++) {
    const a = (-90 + (360 / outer) * i + 180 / outer) * (Math.PI / 180);
    out.push({ x: round(50 + 43 * Math.cos(a)), y: round(50 + 43 * Math.sin(a)), ring: 1 });
  }
  return out;
}
const round = (v) => Math.round(v * 100) / 100;

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
