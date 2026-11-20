"use strict";

/**
 * Wrong-PIN lockout with two counters per guess (security review r2 #2):
 *
 *   pair   phone + client address   5 wrong PINs in 15 minutes -> that pair is locked 15 minutes
 *   phone  the phone, any address   10 wrong PINs in an hour   -> the phone is locked an hour
 *
 * The phone counter is what stops a guesser who rotates addresses (or sits behind a tunnel whose
 * callers all look alike, src/client-address.js). A right PIN clears the pair's failures only: the
 * phone's hourly count keeps running, so an owner's own login never hands a guesser fresh tries.
 * Passkey login never consults this module, so a locked owner can still sign in with a passkey.
 *
 * An attempt is counted the moment it starts (before the async scrypt check), so parallel requests
 * cannot try more than the limit. The map is capped at MAX_KEYS: expired entries go first, then the
 * least recently used unlocked ones; a live lock is evicted only when nothing else is left.
 * In-process only, like src/limits.js (one server instance); a restart forgets every lock.
 *
 *   const attempt = lockout.attempt({ phone, address });
 *   if (attempt.locked) -> 429 PIN_LOCKED, Retry-After attempt.retryAfterSeconds
 *   const { locked, retryAfterSeconds, lockedNow } = attempt.finish(pinWasRight);
 *   lockedNow: "phone" | "pair" | null, the lock this very failure started
 */

const MINUTE = 60 * 1000;
const POLICIES = Object.freeze({
  pair: Object.freeze({ max: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }),
  phone: Object.freeze({ max: 10, windowMs: 60 * MINUTE, lockMs: 60 * MINUTE }),
});
const MAX_KEYS = 10000;
const LOW_WATER = Math.floor(MAX_KEYS * 0.9); // evict in batches, not one full scan per guess

/** key -> { policy, failures, windowStart, pending, lockedUntil } (Map order = least recently used first) */
const entries = new Map();

const retryAfter = (until, now) => Math.max(1, Math.ceil((until - now) / 1000));

/** The live entry for `key`, or null once its lock or window is over (and nothing is in flight). */
function current(key, now) {
  const e = entries.get(key);
  if (!e) return null;
  const policy = POLICIES[e.policy];
  const lockOver = e.lockedUntil && e.lockedUntil <= now;
  const windowOver = !e.lockedUntil && e.pending === 0 && now - e.windowStart >= policy.windowMs;
  if (lockOver || windowOver) {
    entries.delete(key);
    return null;
  }
  return e;
}

function touch(key, e) {
  entries.delete(key);
  entries.set(key, e);
}

function prune(now) {
  if (entries.size <= MAX_KEYS) return;
  for (const key of [...entries.keys()]) current(key, now);
  for (const [key, e] of entries) {
    if (entries.size <= LOW_WATER) return;
    if (!e.lockedUntil && e.pending === 0) entries.delete(key);
  }
  for (const key of entries.keys()) {
    if (entries.size <= LOW_WATER) return;
    entries.delete(key);
  }
}

function entryFor(key, policy, now) {
  let e = current(key, now);
  if (!e) {
    e = { policy, failures: 0, windowStart: now, pending: 0, lockedUntil: 0 };
    entries.set(key, e);
  } else {
    touch(key, e);
  }
  return e;
}

/** Why `e` refuses a new guess now: the end of its lock (or of a full in-flight window), else 0. */
function refusedUntil(e, now) {
  if (e.lockedUntil) return e.lockedUntil;
  const policy = POLICIES[e.policy];
  return e.failures + e.pending >= policy.max ? now + policy.lockMs : 0;
}

function attempt({ phone, address }, now = Date.now()) {
  if (typeof phone !== "string" || phone === "") throw new Error("lockout.attempt needs a phone.");
  const keyed = [
    [`phone:${phone}`, "phone"],
    [`pair:${phone}|${address ?? "unknown"}`, "pair"],
  ].map(([key, policy]) => ({ key, e: entryFor(key, policy, now) }));
  prune(now);

  const until = Math.max(...keyed.map(({ e }) => refusedUntil(e, now)));
  if (until) {
    const refused = { locked: true, retryAfterSeconds: retryAfter(until, now), lockedNow: null };
    return { ...refused, finish: () => refused };
  }

  for (const { e } of keyed) e.pending += 1;
  let finished = null;
  return {
    locked: false,
    retryAfterSeconds: 0,
    finish(success, at = Date.now()) {
      if (finished) return finished;
      let lockedUntil = 0;
      let lockedNow = null;
      for (const { key, e } of keyed) {
        e.pending = Math.max(0, e.pending - 1);
        if (success) {
          if (e.policy === "pair") entries.delete(key);
          continue;
        }
        e.failures += 1;
        const policy = POLICIES[e.policy];
        if (!e.lockedUntil && e.failures >= policy.max) {
          e.lockedUntil = at + policy.lockMs;
          if (lockedNow !== "phone") lockedNow = e.policy;
        }
        if (e.lockedUntil) lockedUntil = Math.max(lockedUntil, e.lockedUntil);
        if (!entries.has(key)) entries.set(key, e);
      }
      finished = lockedUntil
        ? { locked: true, retryAfterSeconds: retryAfter(lockedUntil, at), lockedNow }
        : { locked: false, retryAfterSeconds: 0, lockedNow: null };
      return finished;
    },
  };
}

const size = () => entries.size;

/** Tests only. */
function reset() {
  entries.clear();
}

module.exports = { attempt, reset, size, POLICIES, MAX_KEYS };
