const { BeneficiaryDatabase } = require("./database");
const { readCloudConfig } = require("./cloud-config");

async function createDatabase() {
  const cloudConfig = readCloudConfig();

  if (cloudConfig) {
    const { TursoBeneficiaryDatabase } = require("./turso-database");
    return TursoBeneficiaryDatabase.create(cloudConfig);
  }

  return new BeneficiaryDatabase();
}

module.exports = {
  createDatabase
};
