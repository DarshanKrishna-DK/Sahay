// History (My Sahay > History, spec 3.1 row 54): what Sahay and the owner did, from the audit rows
// (GET /api/state + SSE), newest first, one icon and one line per step, grouped by day. Decisions
// say yes or no and whether they were given by voice or by button; a simulated vendor stays
// labelled. Which rows show and what each says comes from history-lines.js (tested).
//
//   createHistoryPanel() -> { el, update(parts) }   the section body inside My Sahay
//   createHistory()      -> screen { el, update(state, parts) } for an old #/history route

import { h, icon, patch, scripted, rupees, toDate } from "./dom.js";
import { t, when, unitWord, has, lang } from "./i18n.js";
import { state } from "./store.js";
import { stateView, talkAction } from "./empty.js";
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

function row(r) {
  const L = historyLine(r, FMT);
  const d = toDate(r.ts);
  const label = L.minutes ? `${t(L.key)} (${L.minutes} min)` : t(L.key);
  const tags = [];
  if (L.via) tags.push(h("span", { class: "pill hx-via" }, icon(L.via === "voice" ? "mic" : "check", 16), h("span", { text: t(L.via === "voice" ? "hist.byVoice" : "hist.byButton") })));
  if (L.simulated) tags.push(h("span", { class: "pill pill-sim" }, icon("robot", 16), h("span", { text: t("simulated") })));
  return h("li", { class: `hx-row${L.tone ? ` is-${L.tone}` : ""}` },
    h("span", { class: "hx-dot", "aria-hidden": "true" }, icon(L.icon, 20)),
    h("div", { class: "hx-main" },
      h("p", { class: "hx-label", text: label }),
      L.detail ? scripted("p", String(L.detail), { class: "hx-detail" }) : null,
      tags.length ? h("p", { class: "hx-tags" }, ...tags) : null),
    d ? h("time", { class: "hx-time", datetime: d.toISOString(), text: clockWords(d, lang()) }) : null);
}

function skeleton() {
  return h("div", { class: "skel-wrap hx-skel", role: "status", "aria-busy": "true" },
    h("span", { class: "sr-only", text: t("hx.loading") }),
    h("span", { class: "skel skel-title" }),
    ...[0, 1, 2, 3].map(() => h("div", { class: "skel-row" }, h("span", { class: "skel skel-circle" }), h("span", { class: "skel skel-line" }))));
}

export function createHistoryPanel() {
  const el = h("div", { class: "hx" });
  const head = h("div", { class: "hx-head" });
  const body = h("div", { class: "hx-body" });
  el.append(head, body);

  function update(parts) {
    if (parts && !parts.has("all") && !parts.has("lang") && !parts.has("history") && !parts.has("boot")) return;
    const lang = document.documentElement.lang;
    if (state.boot !== "ready") {
      patch(head, `none|${lang}`, () => []);
      patch(body, `loading|${lang}`, skeleton);
      return;
    }
    const rows = historyRows(state.audit.values(), { has });
    patch(head, JSON.stringify([lang, rows.length]), () => rows.length
      ? [h("p", { class: "hx-count" }, icon("history", 20), h("span", { text: t("hx.count", { n: rows.length }) }))]
      : []);
    patch(body, JSON.stringify([lang, rows.map((r) => r.id), new Date().toDateString()]), () => {
      if (!rows.length) {
        return stateView({ kind: "empty", icon: "history", title: t("empty.history.title"), text: t("empty.history.text"), action: talkAction() });
      }
      return dayGroups(rows).map((g) => h("section", { class: "hx-day", "aria-label": dayTitle(g.day) },
        h("h3", { class: "hx-day-title" }, h("span", { text: dayTitle(g.day) })),
        h("ol", { class: "hx-list" }, ...g.rows.map(row))));
    });
  }

  return { el, update };
}

/** A whole screen for an old #/history link (the shell maps it to #/me/history; kept for safety). */
export function createHistory() {
  const el = h("section", { class: "history-screen", "aria-labelledby": "hx-title" });
  const head = h("header", { class: "screen-head" });
  const panel = createHistoryPanel();
  el.append(head, panel.el);
  function render(parts) {
    patch(head, document.documentElement.lang, () => [
      h("a", { class: "icon-btn tip-below", href: "#/me/teach", "aria-label": t("nav.me"), dataset: { tip: t("nav.me") } }, icon("arrowLeft", 24)),
      h("h1", { class: "screen-title", id: "hx-title", text: t("hist.title") }),
    ]);
    panel.update(parts);
  }
  return { el, update: (_s, parts) => render(parts) };
}
