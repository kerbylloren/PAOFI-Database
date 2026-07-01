const { FIELD_NAMES, SUMMARY_FIELDS } = require("./metadata");
const { cloudLocationLabel } = require("./cloud-config");
const { normalizeRecord, nowIso, quoted } = require("./database");

function plainRow(row) {
  if (!row) return null;

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value
    ])
  );
}

function rows(result) {
  return result.rows.map(plainRow);
}

function displayName(record) {
  return [record.last_name, record.first_name, record.middle_name]
    .filter(Boolean)
    .join(", ") || record.control_no;
}

class TursoBeneficiaryDatabase {
  constructor(client, config) {
    this.client = client;
    this.url = config.url;
    this.dbPath = cloudLocationLabel(config.url);
  }

  static async create(config) {
    const { createClient } = await import("@libsql/client");
    const database = new TursoBeneficiaryDatabase(
      createClient({
        url: config.url,
        authToken: config.authToken
      }),
      config
    );

    await database.init();
    return database;
  }

  async execute(sql, args = []) {
    return this.client.execute({ sql, args });
  }

  async init() {
    const fieldColumns = FIELD_NAMES
      .map(fieldName => `${quoted(fieldName)} TEXT NOT NULL DEFAULT ''`)
      .join(",\n        ");

    const statements = [
      `
        CREATE TABLE IF NOT EXISTS beneficiaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ${fieldColumns},
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `,
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_beneficiaries_control_no ON beneficiaries(control_no)",
      "CREATE INDEX IF NOT EXISTS idx_beneficiaries_name ON beneficiaries(last_name, first_name, middle_name)",
      `
        CREATE TABLE IF NOT EXISTS deleted_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_id INTEGER,
          control_no TEXT NOT NULL,
          display_name TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          snapshot_json TEXT NOT NULL
        )
      `,
      "CREATE INDEX IF NOT EXISTS idx_deleted_records_control_no ON deleted_records(control_no)"
    ];

    for (const sql of statements) {
      await this.execute(sql);
    }
  }

  async close() {
    if (typeof this.client.close === "function") {
      await this.client.close();
    }
  }

  async stats() {
    const active = await this.execute("SELECT COUNT(*) AS count FROM beneficiaries");
    const deleted = await this.execute("SELECT COUNT(*) AS count FROM deleted_records");

    return {
      active: Number(active.rows[0].count || 0),
      deleted: Number(deleted.rows[0].count || 0),
      databasePath: this.dbPath
    };
  }

  async nextControlNo(year = new Date().getFullYear()) {
    const prefix = `LP-${year}-`;
    const activeRows = rows(
      await this.execute("SELECT control_no FROM beneficiaries WHERE control_no LIKE ?", [`${prefix}%`])
    );
    const deletedRows = rows(
      await this.execute("SELECT control_no FROM deleted_records WHERE control_no LIKE ?", [`${prefix}%`])
    );
    const highest = [...activeRows, ...deletedRows].reduce((max, row) => {
      const numberPart = Number(String(row.control_no || "").slice(prefix.length));
      return Number.isFinite(numberPart) && numberPart > max ? numberPart : max;
    }, 0);

    return `${prefix}${String(highest + 1).padStart(3, "0")}`;
  }

  async listRecords({ search = "", limit = 50, detail = "summary" } = {}) {
    const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const selectedFields = detail === "full"
      ? ["id", ...FIELD_NAMES, "created_at", "updated_at"]
      : SUMMARY_FIELDS;
    const columns = selectedFields.map(quoted).join(", ");

    if (!search.trim()) {
      return rows(await this.execute(
        `SELECT ${columns} FROM beneficiaries ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [max]
      ));
    }

    const pattern = `%${search.trim().toLowerCase()}%`;
    return rows(await this.execute(
      `
        SELECT ${columns}
        FROM beneficiaries
        WHERE lower(control_no) LIKE ?
          OR lower(last_name) LIKE ?
          OR lower(first_name) LIKE ?
          OR lower(middle_name) LIKE ?
          OR lower(first_name || ' ' || middle_name || ' ' || last_name) LIKE ?
          OR lower(last_name || ' ' || first_name || ' ' || middle_name) LIKE ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      [pattern, pattern, pattern, pattern, pattern, pattern, max]
    ));
  }

  async getRecord(id) {
    const result = await this.execute("SELECT * FROM beneficiaries WHERE id = ?", [Number(id)]);
    return plainRow(result.rows[0]) || null;
  }

  async getRecordByControlNo(controlNo) {
    const key = String(controlNo || "").trim();
    if (!key) return null;

    const result = await this.execute("SELECT * FROM beneficiaries WHERE control_no = ?", [key]);
    return plainRow(result.rows[0]) || null;
  }

  async saveRecord(input) {
    const record = normalizeRecord(input);

    if (!record.control_no) {
      throw new Error("Control No. is required.");
    }

    const id = Number(input.id || 0);
    const existing = id ? await this.getRecord(id) : await this.getRecordByControlNo(record.control_no);

    return existing ? this.updateRecord(existing.id, record) : this.insertRecord(record);
  }

  async insertRecord(record) {
    const timestamp = nowIso();
    const columns = FIELD_NAMES.map(quoted).join(", ");
    const placeholders = FIELD_NAMES.map(() => "?").join(", ");
    const values = FIELD_NAMES.map(fieldName => record[fieldName]);
    const result = await this.execute(
      `
        INSERT INTO beneficiaries (${columns}, created_at, updated_at)
        VALUES (${placeholders}, ?, ?)
      `,
      [...values, timestamp, timestamp]
    );

    const id = result.lastInsertRowid ? Number(result.lastInsertRowid) : 0;
    return id ? this.getRecord(id) : this.getRecordByControlNo(record.control_no);
  }

  async updateRecord(id, record) {
    const existing = await this.getRecord(id);

    if (!existing) {
      throw new Error("Record was not found.");
    }

    const duplicate = await this.getRecordByControlNo(record.control_no);
    if (duplicate && duplicate.id !== existing.id) {
      throw new Error(`Control No. already exists: ${record.control_no}`);
    }

    const timestamp = nowIso();
    const assignments = FIELD_NAMES.map(fieldName => `${quoted(fieldName)} = ?`).join(", ");
    const values = FIELD_NAMES.map(fieldName => record[fieldName]);

    await this.execute(
      `UPDATE beneficiaries SET ${assignments}, updated_at = ? WHERE id = ?`,
      [...values, timestamp, id]
    );

    return this.getRecord(id);
  }

  async deleteRecord(id) {
    const record = await this.getRecord(id);

    if (!record) {
      throw new Error("Record was not found.");
    }

    await this.client.batch([
      {
        sql: `
          INSERT INTO deleted_records (original_id, control_no, display_name, deleted_at, snapshot_json)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          record.id,
          record.control_no,
          displayName(record),
          nowIso(),
          JSON.stringify(record)
        ]
      },
      {
        sql: "DELETE FROM beneficiaries WHERE id = ?",
        args: [Number(id)]
      }
    ], "write");

    return record;
  }

  async listDeletedRecords() {
    return rows(await this.execute(`
      SELECT id, original_id, control_no, display_name, deleted_at
      FROM deleted_records
      ORDER BY deleted_at DESC, id DESC
    `));
  }

  async restoreDeletedRecord(id) {
    const deleted = plainRow(
      (await this.execute("SELECT * FROM deleted_records WHERE id = ?", [Number(id)])).rows[0]
    );

    if (!deleted) {
      throw new Error("Deleted record was not found.");
    }

    if (await this.getRecordByControlNo(deleted.control_no)) {
      throw new Error(`Cannot restore. Control No. already exists: ${deleted.control_no}`);
    }

    const snapshot = JSON.parse(deleted.snapshot_json);
    delete snapshot.id;
    const restored = normalizeRecord(snapshot);
    const timestamp = nowIso();
    const columns = FIELD_NAMES.map(quoted).join(", ");
    const placeholders = FIELD_NAMES.map(() => "?").join(", ");
    const values = FIELD_NAMES.map(fieldName => restored[fieldName]);

    await this.client.batch([
      {
        sql: `
          INSERT INTO beneficiaries (${columns}, created_at, updated_at)
          VALUES (${placeholders}, ?, ?)
        `,
        args: [...values, timestamp, timestamp]
      },
      {
        sql: "DELETE FROM deleted_records WHERE id = ?",
        args: [Number(id)]
      }
    ], "write");

    return this.getRecordByControlNo(restored.control_no);
  }

  async exportData() {
    return {
      exportedAt: nowIso(),
      fields: FIELD_NAMES,
      records: rows(await this.execute("SELECT * FROM beneficiaries ORDER BY control_no")),
      deletedRecords: rows(await this.execute("SELECT * FROM deleted_records ORDER BY deleted_at DESC, id DESC"))
    };
  }
}

module.exports = {
  TursoBeneficiaryDatabase
};
