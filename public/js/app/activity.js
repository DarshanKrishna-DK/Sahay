// "What is Sahay doing now", from the store only (never invented): one line for the Talk
// screen and the orb's working state.

import { state, pendingApprovals, vendorName } from "./store.js";

export function runningJobs() {
  return [...state.jobs.values()].filter((j) => j.status === "running" || j.status === "queued");
}

/** { key, vars, tone: "calm" | "busy" | "needs" | "done" | "bad" } for t(key, vars). */
export function nowLine() {
  const req = state.requirement;
  const item = req && req.item ? req.item : "";
  if (pendingApprovals().length) return { key: "now.waitingYes", vars: {}, tone: "needs" };
  const running = runningJobs().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const nego = running.find((j) => j.kind === "negotiation");
  if (nego) {
    const n = [...state.negotiations.values()].find((x) => !x.endedAt);
    const vid = nego.vendorId ?? (n && n.vendorId);
    const name = vendorName(vid);
    if (name) return { key: "now.bargaining", vars: { vendor: name }, tone: "busy" };
  }
  if (running.some((j) => j.kind === "sourcing")) return { key: "now.searching", vars: { item }, tone: "busy" };
  if (nego) return { key: "now.searching", vars: { item }, tone: "busy" };
  const jobs = [...state.jobs.values()].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const orders = [...state.orders.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const lastOrder = orders[0];
  if (lastOrder && (!req || String(lastOrder.createdAt || "") >= String(req.createdAt || ""))) return { key: "now.ordered", vars: {}, tone: "done" };
  if (jobs[0] && jobs[0].status === "failed") return { key: "now.failed", vars: {}, tone: "bad" };
  if (req && state.vendors.size) return { key: "now.found", vars: { n: state.vendors.size, item }, tone: "calm" };
  if (req && item) return { key: "now.heard", vars: { item }, tone: "calm" };
  return { key: "now.idle", vars: {}, tone: "calm" };
}
