"use strict";

/** Typed errors of the stock module (src/stock/*). The tools turn them into spoken ToolErrors. */
class StockError extends Error {
  /**
   * @param {string} code  stable machine code, e.g. "ITEM_NOT_FOUND"
   * @param {string} message
   * @param {{status?: number, details?: object, cause?: unknown}} [options]
   */
  constructor(code, message, { status, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "StockError";
    this.code = code;
    this.status = status ?? 400;
    if (details) this.details = details;
  }
}

module.exports = { StockError };
