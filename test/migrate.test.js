"use strict";

// A database file made before agent_rules allowed reorder_level is widened in place on open,
// keeping every rule, read-back, index and trigger (src/db/migrate.js).
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const db = require("../src/db");
const { widenRuleKinds } = require("../src/db/migrate");

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
const OLD_SCHEMA = SCHEMA.replace(", 'reorder_level')", ")");

function oldDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sahay-migrate-"));
  const file = path.join(dir, "old.db");
  const handle = new DatabaseSync(file);
  handle.exec("PRAGMA foreign_keys = ON");
  handle.exec(OLD_SCHEMA);
  handle.exec(`PRAGMA user_version = ${db.SCHEMA_VERSION}`);
  const at = new Date().toISOString();
  handle.prepare("INSERT INTO businesses (id, name, language, created_at) VALUES ('biz_1', 'Asha', 'hi-IN', ?)").run(at);
  handle
    .prepare(
      "INSERT INTO agent_rules (id, business_id, kind, scope_key, params, sentence_hi, sentence_kn, sentence_en, status, source, created_at) VALUES ('rul_1', 'biz_1', 'bargain_style', 'bargain_style', '{\"style\":\"tough\"}', 'h', 'k', 'e', 'suggested', 'owner_said', ?)",
    )
    .run(at);
  handle.prepare("INSERT INTO rule_readbacks (id, business_id, rule_id, agent_id, spoken_text, spoken_at) VALUES ('rrb_1', 'biz_1', 'rul_1', 'agent_1', 'e', ?)").run(at);
  handle.close();
  return { file, dir };
}

const insertRule = (handle, id, kind, status = "suggested") =>
  handle
    .prepare(
      "INSERT INTO agent_rules (id, business_id, kind, scope_key, params, sentence_hi, sentence_kn, sentence_en, status, source, created_at) VALUES (?, 'biz_1', ?, ?, '{}', 'h', 'k', 'e', ?, 'owner_said', ?)",
    )
    .run(id, kind, `${kind}:${id}`, status, new Date().toISOString());

test("the old CHECK refuses reorder_level; opening the file widens it and keeps rows, read-backs and triggers", () => {
  const { file, dir } = oldDatabase();
  try {
    const before = new DatabaseSync(file);
    assert.throws(() => insertRule(before, "rul_x", "reorder_level"), /CHECK constraint failed/);
    before.close();

    const handle = db.open(file);
    try {
      insertRule(handle, "rul_2", "reorder_level");
      assert.equal(handle.prepare("SELECT COUNT(*) AS n FROM agent_rules").get().n, 2);
      assert.equal(handle.prepare("SELECT rule_id FROM rule_readbacks WHERE id = 'rrb_1'").get().rule_id, "rul_1", "the read-back survived the rebuild");
      // Triggers and indexes are back: a rule must start suggested, an unknown kind is refused, read-backs cascade.
      assert.throws(() => insertRule(handle, "rul_3", "max_price", "active"), /must start as suggested/);
      assert.throws(() => insertRule(handle, "rul_4", "something_else"), /CHECK constraint failed/);
      const indexes = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_rules'").all().map((r) => r.name);
      assert.ok(indexes.includes("agent_rules_one_active") && indexes.includes("agent_rules_by_business"));
      const triggers = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'agent_rules'").all().map((r) => r.name).sort();
      assert.deepEqual(triggers, ["agent_rules_are_fixed", "agent_rules_start_suggested", "agent_rules_status_flow", "agent_rules_voice_needs_spoken_readback"]);
      assert.equal(handle.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      handle.prepare("DELETE FROM agent_rules WHERE id = 'rul_1'").run();
      assert.equal(handle.prepare("SELECT COUNT(*) AS n FROM rule_readbacks").get().n, 0, "the foreign key from rule_readbacks still cascades");
      assert.equal(widenRuleKinds(handle, SCHEMA), false, "a widened table is left alone");
    } finally {
      handle.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a fresh database already allows reorder_level and is not rebuilt", () => {
  const handle = db.open(":memory:");
  try {
    assert.equal(widenRuleKinds(handle, SCHEMA), false);
  } finally {
    handle.close();
  }
});
