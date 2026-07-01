const fs = require("node:fs");
const path = require("node:path");

const DATA_FOLDER_NAME = "PAOFI-LP-Database-Data";
const CLOUD_CONFIG_FILE = "cloud-database.json";

function appDataDir() {
  if (process.env.LPDB_DATA_DIR) return process.env.LPDB_DATA_DIR;
  if (process.env.LPDB_DB_PATH) return path.dirname(process.env.LPDB_DB_PATH);
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, DATA_FOLDER_NAME);
  return path.join(__dirname, "..", "data");
}

function cloudConfigPath() {
  return process.env.LPDB_CLOUD_CONFIG || path.join(appDataDir(), CLOUD_CONFIG_FILE);
}

function normalizeConfig(config = {}) {
  const provider = String(config.provider || "turso").trim().toLowerCase();
  const url = String(config.url || config.databaseUrl || "").trim();
  const authToken = String(config.authToken || config.token || "").trim();

  if (provider !== "turso" || !url || !authToken) return null;
  return { provider, url, authToken };
}

function readCloudConfig() {
  const envConfig = normalizeConfig({
    provider: "turso",
    url: process.env.TURSO_DATABASE_URL || process.env.LPDB_TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LPDB_TURSO_AUTH_TOKEN
  });

  if (envConfig) return envConfig;

  const configPath = cloudConfigPath();
  if (!fs.existsSync(configPath)) return null;

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizeConfig(parsed);
}

function writeCloudConfig(config) {
  const normalized = normalizeConfig(config);
  if (!normalized) {
    throw new Error("A Turso database URL and auth token are required.");
  }

  const configPath = cloudConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return configPath;
}

function cloudLocationLabel(url) {
  try {
    const parsed = new URL(url);
    return `Turso Cloud: ${parsed.host}`;
  } catch {
    return "Turso Cloud";
  }
}

module.exports = {
  appDataDir,
  cloudConfigPath,
  cloudLocationLabel,
  readCloudConfig,
  writeCloudConfig
};
