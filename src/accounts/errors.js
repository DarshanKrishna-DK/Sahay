"use strict";

/** A refusal from src/accounts: `code` is the API error code, `status` the HTTP status the route answers with. */
class AccountError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
  }
}

module.exports = { AccountError };
