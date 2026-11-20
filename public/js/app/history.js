// History (My Sahay > History, UI v5): what Sahay and the owner did, newest first, grouped by day,
// one icon and one plain line per step. Decisions say yes or no and "by voice" / "by button"; a
// simulated vendor stays labelled. Which rows show and what each says: history-lines.js (tested).
//
//   createHistoryPanel() -> { el, update(parts) }

import { h, patch, rupees, toDate, list, emptyState, skeleton, chip, simChip, section } from "./ui.js";
import { t, when, unitWord, has, lang } from "./i18n.js";
import { state } from "./store.js";
import { historyLine, historyRows, dayGroups, clockWords } from "./history-lines.js";
import "./me-strings.js";

const FMT = { rupees, unit: (u) => unitWord(u) };

function dayTitle(day) {
  if (day === "today") return t("hx.today");
  if (day === "yesterday") return t("hx.yesterday");
  if (day === "unknown") return t("hx.earlier");
  const [y, m, d] = day.split("-").map(Number);
  return when(new Date(y, m - 1, d), { weekday: "long", day: "numeric", month: "long" });
}

function rowOf(r) {
  const L = historyLine(r, FMT);
  const d = toDate(r.ts);
  const label = L.minutes ? `${t(L.key)} (${L.minutes} min)` : t(L.key);
  const tags = [];
  if (L.via) tags.push(chip(t(L.via === "voice" ? "hist.byVoice" : "hist.byButton"), { icon: L.via === "voice" ? "mic" : "check" }));
  if (L.simulated) tags.push(simChip());
  return {
    icon: L.icon,
    title: label,
    sub: L.detail ? String(L.detail) : null,
    end: [
      ...tags,
      d ? h("time", { class: "me-time num", datetime: d.toISOString(), text: clockWords(d, lang()) }) : null,
    ].filter(Boolean),
  };
}

export function createHistoryPanel() {
  const el = h("div", { class: "me-history" });

  function update(parts) {
    if (parts && !parts.has("all") && !parts.has("lang") && !parts.has("history") && !parts.has("boot")) return;
    const lng = document.documentElement.lang;
    if (state.boot !== "ready") { patch(el, `loading|${lng}`, () => skeleton("rows", 4)); return; }
    const rows = historyRows(state.audit.values(), { has });
    patch(el, JSON.stringify([lng, rows.map((r) => r.id), new Date().toDateString()]), () => {
      if (!rows.length) return emptyState({ icon: "history", title: t("empty.history.title"), text: t("empty.history.text") });
      return dayGroups(rows).map((g) => section({
        title: dayTitle(g.day), count: g.rows.length,
        body: list(g.rows.map(rowOf), { label: dayTitle(g.day), limit: 8 }),
      }));
    });
  }

  return { el, update };
}

