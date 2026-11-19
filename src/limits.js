"use strict";

/**
 * Global cost guards (security review r1 #1): caps on paid resources that run at the same
 * time across ALL businesses, plus a small fixed-window rate limiter keyed by caller.
 * In-process only (one server instance).
 *
 *   const release = limits.tryAcquire("negotiation"); // null when the cap is reached
 *   try { ... } finally { release?.(); }
 */

const { config } = require("./config");

const CAPS = Object.freeze({
  owner_call: () => config.limits.ownerCalls,
  negotiation: () => config.limits.negotiations,
  sourcing: () => config.limits.sourcing,
});

const inUse = new Map(Object.keys(CAPS).map((k) => [k, 0]));

/** Take one slot of `kind`. Returns an idempotent release function, or null when full. */
function tryAcquire(kind) {
  const cap = CAPS[kind];
  if (!cap) throw new Error(`unknown limit kind ${kind}`);
  if (inUse.get(kind) >= cap()) return null;
  inUse.set(kind, inUse.get(kind) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inUse.set(kind, Math.max(0, inUse.get(kind) - 1));
  };
}

function usage() {
  return Object.fromEntries([...inUse].map(([k, n]) => [k, { inUse: n, cap: CAPS[k]() }]));
}

/** Fixed-window counter: allow(key, max, windowMs) -> true while under max in the window. */
const windows = new Map();
function allow(key, max, windowMs, now = Date.now()) {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return true;
  }
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

/** Tests only. */
function reset() {
  for (const k of inUse.keys()) inUse.set(k, 0);
  windows.clear();
}

module.exports = { tryAcquire, usage, allow, reset };
