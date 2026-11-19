"use strict";

/** Typed errors of "My Sahay" (profile, rules, memories, speak-it). src/tools/errors.js maps the codes. */
class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

module.exports = { AgentError };
