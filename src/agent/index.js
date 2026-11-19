"use strict";

/**
 * "My Sahay" at server boot: start() subscribes the learner to every business's events
 * (src/agent/learn.js). Idempotent; returns the function that stops it.
 */

const events = require("../events");
const learn = require("./learn");

let unsubscribe = null;

function start() {
  if (!unsubscribe) unsubscribe = events.subscribeAll((event) => learn.onEvent(event));
  return stop;
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
}

module.exports = { start, stop };
