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

/**
 * Fixed-window counter: allow(key, max, windowMs) -> true while under max in the window.
 * At most MAX_KEYS windows are kept (security review r2 #8): every use moves a key to the recent
 * end, and past the cap ended windows go first, then the least recently used ones.
 */
const MAX_KEYS = 20000;
const LOW_WATER = Math.floor(MAX_KEYS * 0.9); // evict in batches, not one full scan per request
const windows = new Map(); // key -> { start, count, windowMs }, least recently used first
function allow(key, max, windowMs, now = Date.now()) {
  let w = windows.get(key);
  windows.delete(key);
  if (!w || now - w.start >= windowMs) w = { start: now, count: 0, windowMs };
  windows.set(key, w);
  if (windows.size > MAX_KEYS) evict(now);
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

function evict(now) {
  for (const [k, v] of windows) if (now - v.start >= v.windowMs) windows.delete(k);
  for (const k of windows.keys()) {
    if (windows.size <= LOW_WATER) return;
    windows.delete(k);
  }
}

const size = () => windows.size;

/** Tests only. */
function reset() {
  for (const k of inUse.keys()) inUse.set(k, 0);
  windows.clear();
}

module.exports = { tryAcquire, usage, allow, reset, size, MAX_KEYS };
