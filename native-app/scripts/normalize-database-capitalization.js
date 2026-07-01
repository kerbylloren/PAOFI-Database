const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { FIELD_NAMES } = require("../src/metadata");
const { DEFAULT_DB_PATH, normalizeFieldValue } = require("../src/database");

function quoted(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Unsafe column name: ${name}`);
  }

  return `"${name}"`;
}

function displayName(record) {
  return [record.last_name, record.first_name, record.middle_name]
    .filter(Boolean)
    .join(", ") || record.control_no || "Unnamed record";
}

function cleanRecord(record) {
  const cleaned = { ...record };
  let fieldChanges = 0;

  FIELD_NAMES.forEach(fieldName => {
    const before = String(record[fieldName] || "");
    const after = normalizeFieldValue(fieldName, before);

    if (before !== after) {
      cleaned[fieldName] = after;
      fieldChanges++;
    }
  });

  return { cleaned, fieldChanges };
}

function normalizeBeneficiaries(db) {
  const columns = FIELD_NAMES.map(quoted).join(", ");
  const assignments = FIELD_NAMES.map(fieldName => `${quoted(fieldName)} = ?`).join(", ");
  const rows = db.prepare(`SELECT id, ${columns} FROM beneficiaries ORDER BY id`).all();
  const update = db.prepare(`UPDATE beneficiaries SET ${assignments} WHERE id = ?`);
  let changedRecords = 0;
  let changedFields = 0;

  rows.forEach(row => {
    const { cleaned, fieldChanges } = cleanRecord(row);

    if (!fieldChanges) return;

    update.run(...FIELD_NAMES.map(fieldName => cleaned[fieldName]), row.id);
    changedRecords++;
    changedFields += fieldChanges;
  });

  return { checkedRecords: rows.length, changedRecords, changedFields };
}

function normalizeDeletedRecords(db) {
  const rows = db.prepare("SELECT id, snapshot_json FROM deleted_records ORDER BY id").all();
  const update = db.prepare("UPDATE deleted_records SET display_name = ?, snapshot_json = ? WHERE id = ?");
  let changedRecords = 0;
  let changedFields = 0;

  rows.forEach(row => {
    const snapshot = JSON.parse(row.snapshot_json);
    const { cleaned, fieldChanges } = cleanRecord(snapshot);

    if (!fieldChanges) return;

    update.run(displayName(cleaned), JSON.stringify(cleaned), row.id);
    changedRecords++;
    changedFields += fieldChanges;
  });

  return { checkedRecords: rows.length, changedRecords, changedFields };
}

function main() {
  const dbPath = path.resolve(process.argv[2] || process.env.LPDB_DB_PATH || DEFAULT_DB_PATH);
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("BEGIN");
  try {
    const beneficiaries = normalizeBeneficiaries(db);
    const deletedRecords = normalizeDeletedRecords(db);
    db.exec("COMMIT");

    console.log(JSON.stringify({
      databasePath: dbPath,
      beneficiaries,
      deletedRecords
    }, null, 2));
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

main();
