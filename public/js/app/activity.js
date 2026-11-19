// "What is Sahay doing now", from the store only (never invented): one line for the Talk
// screen and the orb's working state.

import { state, pendingApprovals, vendorName } from "./store.js";
import { call } from "./call.js";
import { lang } from "./i18n.js";
import { itemLine } from "./item-line.js";

export function runningJobs() {
  return [...state.jobs.values()].filter((j) => j.status === "running" || j.status === "queued");
}

/** { key, vars, tone: "calm" | "busy" | "needs" | "done" | "bad" } for t(key, vars). */
export function nowLine() {
  const req = state.requirement;
  const item = req && req.item ? req.item : "";
  // The item is named only when it is in the screen's script (never a Kannada item in a Hindi line).
  const withItem = (key, vars, tone) => ({ ...itemLine(key, { ...vars, item }, lang()), tone });
  if (pendingApprovals().length) return { key: "now.waitingYes", vars: {}, tone: "needs" };
  const running = runningJobs().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const nego = running.find((j) => j.kind === "negotiation");
  if (nego) {
    const n = [...state.negotiations.values()].find((x) => !x.endedAt);
    const vid = nego.vendorId ?? (n && n.vendorId);
    const name = vendorName(vid);
    if (name) return { key: "now.bargaining", vars: { vendor: name }, tone: "busy" };
  }
  if (running.some((j) => j.kind === "sourcing") || nego) return withItem("now.searching", {}, "busy");
  const jobs = [...state.jobs.values()].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const orders = [...state.orders.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const lastOrder = orders[0];
  if (lastOrder && (!req || String(lastOrder.createdAt || "") >= String(req.createdAt || ""))) return { key: "now.ordered", vars: {}, tone: "done" };
  if (jobs[0] && jobs[0].status === "failed") return { key: "now.failed", vars: {}, tone: "bad" };
  if (req && state.vendors.size) return withItem("now.found", { n: state.vendors.size }, "calm");
  if (req && item) return withItem("now.heard", {}, "calm");
  return { key: "now.idle", vars: {}, tone: "calm" };
}

/**
 * One word for what the agent is doing, for the thinking orbs (thinking-orb.js maps it to an orb
 * state): connecting | listening | thinking | speaking | bargaining | searching | composing |
 * working | idle. Call states win (they answer the owner now); then running work.
 */
export function agentState() {
  const s = call.status;
  if (s === "mic" || s === "connecting" || s === "waiting" || s === "reconnecting" || s === "ending") return "connecting";
  if (s === "live") {
    const a = call.agentState;
    if (a === "thinking") return "thinking";
    if (a === "speaking") return "speaking";
    if (a === "listening") return "listening";
  }
  const running = runningJobs();
  if (running.some((j) => j.kind === "negotiation")) return "bargaining";
  if (running.some((j) => j.kind === "sourcing")) return "searching";
  if (running.some((j) => /invoice/.test(String(j.kind || "")))) return "composing";
  if (running.length) return "working";
  return s === "live" ? "listening" : "idle";
}
