"use strict";

/**
 * Opens the node:sqlite database named by DB_FILE and applies the schema.
 * Tests set DB_FILE=":memory:" before the first require.
 */

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { config } = require("../config");

const SCHEMA_VERSION = 2;
const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

class DbError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

let db = null;
let statements = new Map();
let depth = 0;
let commitHooks = [];

/** Open a database file, apply the schema and return the handle. */
function open(file = config.dbFile) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const handle = new DatabaseSync(file);
  try {
    handle.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") handle.exec("PRAGMA journal_mode = WAL");

    const version = handle.prepare("PRAGMA user_version").get().user_version;
    const tables = handle.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
    if (version !== SCHEMA_VERSION && (version !== 0 || tables > 0)) {
      throw new DbError(
        "INCOMPATIBLE_DB",
        `The database at ${file} was not created by Sahay v${SCHEMA_VERSION}. ` +
          "Move it aside or point DB_FILE at a new file; Sahay will not modify it.",
      );
    }
    handle.exec(SCHEMA);
    handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } catch (err) {
    handle.close();
    throw err;
  }
  return handle;
}

function getDb() {
  if (!db) db = open();
  return db;
}

function close() {
  if (!db) return;
  db.close();
  db = null;
  statements = new Map();
  depth = 0;
  commitHooks = [];
}

/** A prepared statement, compiled once per SQL string. */
function prepare(sql) {
  let statement = statements.get(sql);
  if (!statement) {
    statement = getDb().prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

function inTransaction() {
  return depth > 0;
}

/**
 * Run a synchronous function in one transaction. A nested call joins the outer
 * transaction, so an error must be allowed to propagate: it rolls everything back.
 */
function transaction(fn) {
  if (depth > 0) return runSync(fn);

  const handle = getDb();
  handle.exec("BEGIN IMMEDIATE");
  depth = 1;
  let result;
  try {
    result = runSync(fn);
    handle.exec("COMMIT");
  } catch (err) {
    // `isTransaction` is missing on the oldest supported Node; there, always attempt the rollback.
    if (handle.isTransaction ?? true) handle.exec("ROLLBACK");
    depth = 0;
    commitHooks = [];
    throw err;
  }
  depth = 0;
  const hooks = commitHooks;
  commitHooks = [];
  for (const hook of hooks) hook();
  return result;
}

function runSync(fn) {
  const result = fn();
  if (result && typeof result.then === "function") {
    throw new DbError("ASYNC_TRANSACTION", "A transaction body must be synchronous.");
  }
  return result;
}

/** Run `fn` once the current transaction commits; at once when there is none. Dropped on rollback. */
function afterCommit(fn) {
  if (depth > 0) commitHooks.push(fn);
  else fn();
}

module.exports = { open, getDb, close, prepare, transaction, inTransaction, afterCommit, DbError, SCHEMA_VERSION };
