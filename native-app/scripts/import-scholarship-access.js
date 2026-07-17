const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { createDatabase } = require("../src/database-factory");
const { importScholarshipAccess } = require("../src/scholarship-access-import");

function sourcePath() {
  const argument = process.argv.slice(2).find(value => !value.startsWith("--"));
  if (!argument) {
    throw new Error("Usage: node scripts/import-scholarship-access.js <source.accdb> [--commit]");
  }
  return path.resolve(argument);
}

function extractAccessPayload(filePath) {
  const extractor = path.join(__dirname, "extract-scholarship-access.ps1");
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", extractor,
      "-SourcePath", filePath
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    }
  );
  return JSON.parse(output);
}

async function main() {
  const filePath = sourcePath();
  const commit = process.argv.includes("--commit");
  const payload = extractAccessPayload(filePath);
  const database = await createDatabase();
  try {
    await database.warmup?.();
    const result = await importScholarshipAccess(database, payload, { commit });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.close?.();
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
