const { cloudConfigPath, writeCloudConfig } = require("../src/cloud-config");

const url = process.env.TURSO_DATABASE_URL || process.env.LPDB_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LPDB_TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this script.");
}

const savedPath = writeCloudConfig({ provider: "turso", url, authToken });
console.log(`Cloud config saved to ${savedPath || cloudConfigPath()}`);
