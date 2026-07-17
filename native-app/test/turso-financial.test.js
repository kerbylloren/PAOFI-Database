const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TursoBeneficiaryDatabase } = require("../src/turso-database");

test("counts each child once in filtered libSQL growth analytics", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paofi-growth-analytics-libsql-test-"));
  const databasePath = path.join(dir, "growth.sqlite").replaceAll("\\", "/");
  const db = await TursoBeneficiaryDatabase.create({
    url: `file:${databasePath}`,
    authToken: "local-test-token"
  });
  const center = await db.saveNutritionCenter({ center_name: "Lourdes Feeding Program" });
  const child = await db.saveNutritionBeneficiary({
    beneficiary_no: "NP-LIBSQL-GROWTH-001",
    center_id: center.id,
    child_last_name: "Analytics",
    child_first_name: "Child",
    birth_date: "2020-01-15",
    gender: "Female",
    remarks: "Active"
  });

  await db.saveNutritionGrowthReport({
    center_id: center.id,
    report_month: "2026-01",
    submitted_date: "02/02/2026",
    entries: [{ beneficiary_id: child.id, height_cm: "110", weight_kg: "18" }]
  });
  await db.saveNutritionGrowthReport({
    center_id: center.id,
    report_month: "2026-02",
    submitted_date: "03/02/2026",
    entries: [{ beneficiary_id: child.id, height_cm: "111", weight_kg: "18.5" }]
  });

  const yearly = await db.nutritionGrowthAnalytics({ centerId: center.id, year: "2026" });
  assert.equal(yearly.reports.length, 2);
  assert.equal(yearly.entries.length, 1);
  assert.equal(yearly.entries[0].report_month, "2026-02");

  const january = await db.nutritionGrowthAnalytics({ centerId: center.id, year: "2026", month: "01" });
  assert.equal(january.reports.length, 1);
  assert.equal(january.entries.length, 1);
  assert.equal(january.entries[0].report_month, "2026-01");

  await db.close();
});

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

test("keeps recipe, menu, and costing generation consistent through the libSQL adapter", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paofi-menu-libsql-test-"));
  const databasePath = path.join(dir, "menu.sqlite").replaceAll("\\", "/");
  const db = await TursoBeneficiaryDatabase.create({
    url: `file:${databasePath}`,
    authToken: "local-test-token"
  });
  const center = await db.saveNutritionCenter({ center_name: "Molave", capacity: 30 });
  await db.saveNutritionFinancialBudgets({
    year: 2026,
    budgets: [{ center_id: center.id, approved_budget_per_child: 9 }]
  });
  const recipe = await db.saveNutritionRecipe({
    recipe_name: "Chicken Tinola",
    base_servings: 40,
    ingredients: [
      { ingredient_name: "Chicken", default_quantity: "3 kg", default_cost: 450 },
      { ingredient_name: "Papaya", default_quantity: "2 pcs", default_cost: 80 }
    ]
  });
  const menu = await db.saveNutritionMenu({
    menu_month: "2026-08",
    entries: [{ meal_date: "2026-08-03", recipe_id: recipe.id, meal_name: recipe.recipe_name }]
  });
  assert.equal(menu.entries.length, 1);
  const costings = await db.listNutritionCostings({ centerId: center.id, month: "2026-08" });
  assert.equal(costings.length, 1);
  assert.equal((await db.listNutritionMenus({ limit: 1, offset: 0 })).length, 1);
  assert.equal((await db.listNutritionMenus({ limit: 1, offset: 1 })).length, 0);
  assert.equal((await db.listNutritionCostings({ centerId: center.id, month: "2026-08", limit: 1, offset: 0 })).length, 1);
  assert.equal((await db.listNutritionCostings({ centerId: center.id, month: "2026-08", limit: 1, offset: 1 })).length, 0);
  const weeklyBatch = await db.listNutritionCostingsForWeek("2026-08-03");
  assert.equal(weeklyBatch.length, 1);
  assert.equal(weeklyBatch[0].days.length, 1);
  assert.equal(weeklyBatch[0].days[0].items.length, 2);
  assert.equal(costings[0].budget_released, 270);
  assert.equal(costings[0].budget_food_total, 417.5);
  const detail = await db.getNutritionCosting(costings[0].id);
  assert.equal(detail.days[0].items[0].budget_quantity, "2.25 kg");
  assert.equal(detail.days[0].items[0].budget_cost, 337.5);
  assert.equal(detail.days[0].items[1].budget_quantity, "2 pcs");
  assert.equal(detail.days[0].items[1].budget_cost, 80);
  detail.days[0].items[0].actual_cost = 475;
  const saved = await db.saveNutritionCosting(detail);
  assert.equal(saved.actual_food_total, 475);
  assert.equal((await db.stats()).nutritionMenuCostings, 1);
  await db.close();
});
