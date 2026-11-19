"use strict";

/** Typed errors of the Sell modules. `status` is the HTTP status a route answers with. */
class SellError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = "SellError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

module.exports = { SellError };
