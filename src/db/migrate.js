"use strict";

/**
 * In-place upgrades for a database file that an older build of the same schema version created.
 * CREATE TABLE IF NOT EXISTS adds new tables, but it cannot widen a CHECK on a table that exists.
 *
 * widenRuleKinds: agent_rules.kind gained 'reorder_level' (STK). SQLite cannot alter a CHECK and
 * node:sqlite runs in defensive mode (no writable_schema), so the table is rebuilt with the
 * schema's own definition in one transaction, keeping every row and id; its indexes and
 * triggers are then re-created from the schema. Foreign keys are off during the rebuild so
 * rule_readbacks rows are not cascaded away, and are checked before the commit.
 */

const RULE_KIND = "'reorder_level'";

/** The CREATE TABLE statement for `table` as written in schema.sql. */
function createStatement(schemaSql, table) {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`).exec(schemaSql);
  if (!match) throw new Error(`schema.sql has no CREATE TABLE for ${table}.`);
  return match[0];
}

/**
 * Rebuild agent_rules when its CHECK does not allow reorder_level yet. Returns true when it did.
 * @param {import("node:sqlite").DatabaseSync} handle  an open database the schema was just applied to
 * @param {string} schemaSql  the full schema.sql text
 */
function widenRuleKinds(handle, schemaSql) {
  const row = handle.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_rules'").get();
  if (!row || row.sql.includes(RULE_KIND)) return false;
  const create = createStatement(schemaSql, "agent_rules");
  if (!create.includes(RULE_KIND)) throw new Error("schema.sql's agent_rules does not allow reorder_level.");
  const columns = handle.prepare("PRAGMA table_info(agent_rules)").all().map((c) => `"${c.name}"`).join(", ");

  handle.exec("PRAGMA foreign_keys = OFF");
  try {
    handle.exec("BEGIN IMMEDIATE");
    try {
      handle.exec("PRAGMA legacy_alter_table = ON");
      handle.exec(create.replace("CREATE TABLE IF NOT EXISTS agent_rules (", "CREATE TABLE agent_rules_widened ("));
      handle.exec(`INSERT INTO agent_rules_widened (${columns}) SELECT ${columns} FROM agent_rules`);
      handle.exec("DROP TABLE agent_rules");
      handle.exec("ALTER TABLE agent_rules_widened RENAME TO agent_rules");
      handle.exec("PRAGMA legacy_alter_table = OFF");
      handle.exec(schemaSql); // agent_rules' indexes and triggers went with the old table
      const broken = handle.prepare("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`Rebuilding agent_rules broke ${broken.length} foreign key(s).`);
      handle.exec("COMMIT");
    } catch (err) {
      handle.exec("ROLLBACK");
      throw err;
    }
  } finally {
    handle.exec("PRAGMA legacy_alter_table = OFF");
    handle.exec("PRAGMA foreign_keys = ON");
  }
  return true;
}

module.exports = { widenRuleKinds };
