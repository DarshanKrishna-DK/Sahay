"use strict";

/**
 * Wrong-PIN lockout, keyed by phone + client IP: 5 wrong PINs within 15 minutes lock the key
 * for 15 minutes. An attempt is counted the moment it starts (before the async scrypt check),
 * so parallel requests cannot try more than 5 PINs.
 *
 * In-process only, like src/limits.js (one server instance); a restart forgets every lock.
 *
 *   const attempt = lockout.attempt(key);
 *   if (attempt.locked) -> 429 PIN_LOCKED, Retry-After attempt.retryAfterSeconds
 *   const { locked, retryAfterSeconds } = attempt.finish(pinWasRight);
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_KEYS = 10000;

/** key -> { failures, windowStart, pending, lockedUntil } */
const entries = new Map();

const lockedResult = (until, now) => ({ locked: true, retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1000)) });

function current(key, now) {
  let e = entries.get(key);
  if (e && e.lockedUntil && e.lockedUntil <= now) {
    entries.delete(key);
    e = null;
  }
  if (e && !e.lockedUntil && e.pending === 0 && now - e.windowStart >= WINDOW_MS) {
    entries.delete(key);
    e = null;
  }
  return e ?? null;
}

function prune(now) {
  if (entries.size <= MAX_KEYS) return;
  for (const key of [...entries.keys()]) current(key, now);
}

function attempt(key, now = Date.now()) {
  let e = current(key, now);
  if (e?.lockedUntil) return { ...lockedResult(e.lockedUntil, now), finish: () => lockedResult(e.lockedUntil, Date.now()) };
  if (e && e.failures + e.pending >= MAX_FAILURES) {
    // Enough guesses are already in flight to reach the limit: refuse this one as if locked.
    return { ...lockedResult(now + LOCK_MS, now), finish: () => lockedResult(now + LOCK_MS, Date.now()) };
  }
  if (!e) {
    e = { failures: 0, windowStart: now, pending: 0, lockedUntil: 0 };
    entries.set(key, e);
    prune(now);
  }
  e.pending += 1;
  let finished = null;
  return {
    locked: false,
    retryAfterSeconds: 0,
    finish(success, at = Date.now()) {
      if (finished) return finished;
      e.pending = Math.max(0, e.pending - 1);
      if (success) {
        entries.delete(key);
        finished = { locked: false, retryAfterSeconds: 0 };
        return finished;
      }
      e.failures += 1;
      if (e.failures >= MAX_FAILURES) {
        e.lockedUntil = at + LOCK_MS;
        finished = lockedResult(e.lockedUntil, at);
      } else {
        finished = { locked: false, retryAfterSeconds: 0 };
      }
      if (!entries.has(key)) entries.set(key, e);
      return finished;
    },
  };
}

/** Tests only. */
function reset() {
  entries.clear();
}

module.exports = { attempt, reset, MAX_FAILURES, LOCK_MS };
