// The work river (UI v3): the current need as seven stations on one glowing curved path,
// Heard -> Searching -> Bargaining -> Your yes -> Ordered -> Paid -> Reminder. Each station that
// has a real figure carries a HUD tracker (corner brackets, hairline down to its station) with
// that figure only. Seller chips pop in under the river as sellers are found.
// One DOM for both shapes: app-buy.css lays it out as a horizontal wave when the river is wide
// (container query) and as a vertical meander on a phone; the SVG for each shape is drawn here.

import { h, icon, svgEl, scripted, rupees, toDate } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import { reachOf, riverGeometry, shortName } from "./buy-model.js";
import { simPill, timeOnly, dateTime } from "./buy-kit.js";

export const STATION_WORD = { heard: "st.heard", search: "st.search", bargain: "st.bargain", yes: "st.yes", ordered: "st.ordered", paid: "st.paid", reminder: "st.reminder" };
export const STATE_WORD = { done: "st.done", active: "st.active", needs: "st.needsYou", upcoming: "st.upcoming", failed: "st.failed" };
export const STATION_ICON = { heard: "ear", search: "search", bargain: "handshake", yes: "check", ordered: "doc", paid: "rupee", reminder: "bell" };
const STATE_ICON = { done: "check", active: "refresh", needs: "alert", failed: "x" };

const perUnit = (p, unit) => `${rupees(p)}${unit ? `/${unitWord(unit)}` : ""}`;
const time = (ts) => { const d = toDate(ts); return d ? timeOnly(d) : null; };
const day = (ts) => { const d = toDate(ts); return d ? dateTime(d) : null; };

/** The HUD lines of one station: [{ text, tone?, mono? }], from hudFor() only. */
export function hudLines(id, hud) {
  const x = hud && hud[id];
  if (!x) return [];
  switch (id) {
    case "heard": { const at = time(x.at); return at ? [{ text: at, mono: true }] : []; }
    case "search":
      if (x.error) return [{ text: t("b3.searchFailed"), tone: "bad" }];
      return [
        { text: x.sellers === 1 ? t("b3.hud.sellersOne") : t("b3.hud.sellers", { n: x.sellers }) },
        x.simulated ? { text: t("b3.hud.sim", { n: x.simulated }), tone: "sim" } : null,
      ].filter(Boolean);
    case "bargain": {
      const lines = [{ text: t("b3.hud.round", { n: x.rounds }) }];
      if (x.agreed !== null) lines.push({ text: perUnit(x.agreed, x.unit), tone: "ok", mono: true });
      else if (x.ask !== null && x.offer !== null) lines.push({ text: `${rupees(x.ask)} → ${rupees(x.offer)}`, mono: true });
      else if (x.ask !== null) lines.push({ text: perUnit(x.ask, x.unit), mono: true });
      return lines;
    }
    case "yes": return [{ text: t("b3.hud.total", { p: rupees(x.total) }), tone: x.status === "pending" ? "needs" : undefined, mono: true }];
    case "ordered": return [{ text: x.po, mono: true }];
    case "paid": return [{ text: x.paid ? t("b3.hud.paid") : t("b3.hud.link"), tone: x.paid ? "ok" : undefined }];
    case "reminder": { const d = day(x.at); return d ? [{ text: t(x.sent ? "b3.hud.sent" : "b3.hud.next", { d }) }] : []; }
    default: return [];
  }
}

function tracker(lines) {
  if (!lines.length) return null;
  return h("span", { class: "b3-hud", "aria-hidden": "true" },
    h("span", { class: "b3-hud-box" }, ...lines.map((l) => h("span", { class: `b3-hud-line${l.tone ? ` is-${l.tone}` : ""}${l.mono ? " is-mono" : ""}`, text: l.text }))),
    h("span", { class: "b3-hud-link" }));
}

/** The wide river: one SVG path through the station centres, lit up to the furthest started one. */
function waveSvg(n, reach, activeAt) {
  const W = 1000, H = 100;
  const { pts, d } = riverGeometry(n, false, W, H);
  const frac = n > 1 ? reach / (n - 1) : 0;
  const svg = svgEl("svg", { class: "b3-wave", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("path", { d, class: "b3-path-bed", "vector-effect": "non-scaling-stroke" }),
    svgEl("path", { d, class: "b3-path-glow", pathLength: 1, "stroke-dasharray": `${frac} 1`, "vector-effect": "non-scaling-stroke" }),
    svgEl("path", { d, class: "b3-path-lit", pathLength: 1, "stroke-dasharray": `${frac} 1`, "vector-effect": "non-scaling-stroke" }));
  if (activeAt > 0) {
    // The leg Sahay is on right now: marching dashes into the active station.
    const a = pts[activeAt - 1], b = pts[activeAt];
    const mx = (a[0] + b[0]) / 2;
    svg.append(svgEl("path", { d: `M ${a[0]} ${a[1]} C ${mx} ${a[1]}, ${mx} ${b[1]}, ${b[0]} ${b[1]}`, class: "b3-path-signal", "vector-effect": "non-scaling-stroke" }));
  }
  return { svg, ys: pts.map((p) => p[1] / H) };
}

/** One leg of the narrow river, from a station down to the next one (a gentle S). */
function legSvg(i, lit, signal) {
  const svg = svgEl("svg", { class: "b3-leg", viewBox: "0 0 56 100", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  const d = i % 2 === 0 ? "M 28 0 C 4 30, 52 70, 28 100" : "M 28 0 C 52 30, 4 70, 28 100";
  svg.append(svgEl("path", { d, class: "b3-path-bed", "vector-effect": "non-scaling-stroke" }));
  if (lit) svg.append(svgEl("path", { d, class: "b3-path-glow", "vector-effect": "non-scaling-stroke" }), svgEl("path", { d, class: "b3-path-lit", "vector-effect": "non-scaling-stroke" }));
  if (signal) svg.append(svgEl("path", { d, class: "b3-path-signal", "vector-effect": "non-scaling-stroke" }));
  return svg;
}

/**
 * renderRiver(model, hud, { onStation, freshVendorIds }) -> element.
 * onStation(station, button) opens the station's sheet.
 */
export function renderRiver(model, hud, { onStation, freshVendorIds = new Set() } = {}) {
  const { stations, vendors } = model;
  const n = stations.length;
  const reach = reachOf(stations);
  const activeAt = stations.findIndex((s) => s.status === "active" || s.status === "needs");
  const { svg, ys } = waveSvg(n, reach, activeAt);
  const now = stations[activeAt !== -1 ? activeAt : reach];

  const list = h("ol", { class: "b3-stations" });
  stations.forEach((s, i) => {
    const word = t(STATION_WORD[s.id]);
    const stateWord = t(STATE_WORD[s.status]);
    const lines = hudLines(s.id, hud);
    const btn = h("button", {
      class: "b3-st-btn", type: "button",
      "aria-label": `${i + 1}. ${word}, ${stateWord}${lines.length ? `, ${lines.map((l) => l.text).join(", ")}` : ""}`,
      on: { click: (e) => onStation && onStation(s, e.currentTarget) },
    },
    h("span", { class: "b3-dot", "aria-hidden": "true" },
      s.status === "upcoming" ? h("span", { class: "b3-dot-num", text: String(i + 1) }) : icon(s.status === "done" ? "check" : s.status === "failed" ? "x" : s.status === "needs" ? "alert" : STATION_ICON[s.id], 26)),
    h("span", { class: "b3-st-text", "aria-hidden": "true" },
      h("span", { class: "b3-st-word", text: word }),
      s.status !== "upcoming" ? h("span", { class: "b3-st-state" }, icon(STATE_ICON[s.status] || "spark", 16), h("span", { text: stateWord })) : null));
    const next = stations[i + 1];
    list.append(h("li", { class: "b3-st", dataset: { status: s.status, id: s.id }, style: `--i:${i};--y:${ys[i].toFixed(3)}` },
      next ? legSvg(i, s.status !== "upcoming" && next.status !== "upcoming", i + 1 === activeAt) : null,
      tracker(lines),
      btn));
  });

  const extra = vendors.length > 6 ? vendors.length - 5 : 0;
  const shown = vendors.slice(0, extra ? 5 : 6);
  const sellers = vendors.length ? h("div", { class: "b3-sellers" },
    h("p", { class: "b3-sellers-head" }, icon("store", 20), h("span", { text: vendors.length === 1 ? t("b3.hud.sellersOne") : t("b3.hud.sellers", { n: vendors.length }) })),
    h("ul", { class: "b3-sellers-list" },
      ...shown.map((v, i) => {
        const full = String(v.name || "");
        return h("li", { class: `b3-seller${freshVendorIds.has(String(v.id)) ? " is-new" : ""}${v.simulated ? " is-sim" : ""}`, style: `--i:${i}`, title: v.simulated ? `${full}, ${t("simulated")}` : full },
          icon(v.simulated ? "robot" : "store", 16),
          scripted("span", shortName(full) || full, { class: "b3-seller-name" }),
          v.simulated ? h("span", { class: "sr-only", text: `, ${t("simulated")}` }) : null);
      }),
      extra ? h("li", { class: "b3-seller is-more", text: `+${extra}` }) : null),
    vendors.some((v) => v.simulated) ? simPill() : null) : null;

  return h("section", { class: "b3-river glass glass-rim", "aria-label": t("work.stations") },
    h("header", { class: "b3-river-head" },
      h("p", { class: "b3-river-now", dataset: { status: now ? now.status : "upcoming" } },
        icon(!now ? "river" : now.status === "needs" || now.status === "failed" ? "alert" : now.status === "done" ? "check" : STATION_ICON[now.id], 20),
        h("span", { class: "b3-river-now-word", text: now ? t(STATION_WORD[now.id]) : "" }),
        now && now.status !== "upcoming" ? h("span", { class: "b3-river-now-state", text: t(STATE_WORD[now.status]) }) : null),
      h("span", { class: "b3-river-count", "aria-hidden": "true", text: `${Math.min(reach + 1, n)} / ${n}` })),
    h("div", { class: "b3-river-stage" }, svg, list),
    sellers);
}
