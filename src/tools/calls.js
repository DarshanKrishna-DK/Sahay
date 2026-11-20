"use strict";

/**
 * Which tools are running, or ran lately, for a business: registry.callTool marks every call
 * here. Read by the server-side helpers that must not race the model:
 * - the confirmation watchdog (src/agora/confirm-watch.js) acts on an owner's yes only when the
 *   model did not call that confirm tool itself;
 * - the low-stock question (src/stock/reorder.js) waits while a tool is still running, so the
 *   question never comes before the result of the action that caused it;
 * - save_requirement refuses to turn a sale (draft_invoice in the same turn) into a purchase.
 * In memory only: it describes this process's live calls, nothing to persist.
 */

const KEEP_MS = 5 * 60 * 1000;

/** businessId -> { running: Map(token -> name), starts: [{ name, at, answer }] } */
const byBusiness = new Map();
let nextToken = 1;
let clock = () => Date.now();

function stateOf(businessId) {
  let state = byBusiness.get(businessId);
  if (!state) {
    state = { running: new Map(), starts: [] };
    byBusiness.set(businessId, state);
  }
  return state;
}

/**
 * Mark a tool call as started. `answer` marks a call that answers a read-back (a confirm tool, or
 * record_payment / set_item with their decision). Returns end(), to call once it has finished (either way).
 */
function begin(businessId, name, { answer = false } = {}) {
  const state = stateOf(businessId);
  const token = nextToken++;
  const at = clock();
  state.running.set(token, name);
  state.starts.push({ name, at, answer });
  state.starts = state.starts.filter((s) => s.at >= at - KEEP_MS);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.running.delete(token);
  };
}

const matches = (names, name) => !names || names.includes(name);

/** True while one of `names` (any tool when omitted) is running for the business. */
function inFlight(businessId, names = null) {
  const state = byBusiness.get(businessId);
  if (!state) return false;
  for (const name of state.running.values()) if (matches(names, name)) return true;
  return false;
}

/**
 * True when one of `names` (any tool when null) started at or after `since` (ms); with `answer`, only a
 * call that answered a read-back counts; tools named in `except` never count.
 */
function startedSince(businessId, names, since, { answer = false, except = [] } = {}) {
  const state = byBusiness.get(businessId);
  return Boolean(state?.starts.some((s) => matches(names, s.name) && !except.includes(s.name) && s.at >= since && (!answer || s.answer)));
}

/** Tests: forget everything, and optionally replace the clock. */
function reset({ now } = {}) {
  byBusiness.clear();
  clock = now ?? (() => Date.now());
}

module.exports = { begin, inFlight, startedSince, reset };
