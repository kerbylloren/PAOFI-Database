const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TursoBeneficiaryDatabase } = require("../src/turso-database");

test("keeps nutrition financial calculations consistent through the libSQL adapter", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paofi-libsql-test-"));
  const databasePath = path.join(dir, "financial.sqlite").replaceAll("\\", "/");
  const db = await TursoBeneficiaryDatabase.create({
    url: `file:${databasePath}`,
    authToken: "local-test-token"
  });

  const center = await db.saveNutritionCenter({
    center_name: "Ascension Feeding Program",
    capacity: 40
  });
  await db.saveNutritionBeneficiary({
    beneficiary_no: "NP-LIBSQL-001",
    center_id: center.id,
    child_last_name: "Adapter",
    child_first_name: "Test",
    remarks: "Active"
  });
  await db.saveNutritionFinancialBudgets({
    year: 2026,
    budgets: [{ center_id: center.id, feeding_days: 20, approved_budget_per_child: 12.5, viands: 8000 }]
  });
  const report = await db.saveNutritionFinancialReport({
    center_id: center.id,
    report_month: "2026-03",
    entries: [{ viands: 2000, gas: 500 }]
  });

  assert.equal(report.total_disbursements, 2500);
  const summary = await db.nutritionFinancialSummary({ year: 2026 });
  assert.equal(summary.program.active_kids, 1);
  assert.equal(summary.program.capacity, 40);
  assert.equal(summary.centers[0].category_metrics.viands.actual_per_child, 100);
  assert.equal(summary.centers[0].category_metrics.viands.budget_per_child, 10);
  assert.equal(summary.centers[0].budget_metrics.actual_per_child, 125);
  assert.equal(summary.centers[0].budget_metrics.approved_per_child, 12.5);
  assert.equal(summary.centers[0].budget_metrics.approved_monthly, 10000);

  await db.close();
});
