const fs = require("node:fs");
const path = require("node:path");
const { BeneficiaryDatabase, DEFAULT_DB_PATH } = require("../src/database");
const { readCloudConfig } = require("../src/cloud-config");
const { TursoBeneficiaryDatabase } = require("../src/turso-database");

function packagedDbPath() {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "PAOFI-Database-Data", "lp_database.sqlite")
    : "";
}

function legacyPackagedDbPath() {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "PAOFI-LP-Database-Data", "lp_database.sqlite")
    : "";
}

function sourceDbPath() {
  const candidates = [
    process.env.LPDB_SOURCE_DB_PATH,
    process.env.LPDB_DB_PATH,
    packagedDbPath(),
    legacyPackagedDbPath(),
    DEFAULT_DB_PATH
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || DEFAULT_DB_PATH;
}

async function main() {
  const cloudConfig = readCloudConfig();
  if (!cloudConfig) {
    throw new Error("Cloud database config was not found. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.");
  }

  const sourcePath = sourceDbPath();
  const local = new BeneficiaryDatabase(sourcePath);
  const cloud = await TursoBeneficiaryDatabase.create(cloudConfig);

  try {
    const exported = local.exportData();
    let activeUpserted = 0;

    for (const record of exported.records) {
      const existing = await cloud.getRecordByControlNo(record.control_no);
      await cloud.saveRecord(existing ? { ...record, id: existing.id } : record);
      activeUpserted += 1;
    }

    const stats = await cloud.stats();
    console.log(JSON.stringify({
      sourcePath,
      activeUpserted,
      deletedSeen: exported.deletedRecords.length,
      cloudActive: stats.active,
      cloudDeleted: stats.deleted,
      databasePath: stats.databasePath
    }, null, 2));
  } finally {
    local.close();
    await cloud.close();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
