const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BeneficiaryDatabase } = require("../src/database");
const { scalePurchaseBudget } = require("../src/nutrition-menu");

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpdb-test-"));
  return path.join(dir, "test.sqlite");
}

test("rounds recipe budgets to practical wet-market purchase units", () => {
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Soy Sauce", quantity: "1 pack", cost: 20, factor: 0.66 }),
    { quantity: "1 pack", cost: 20 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Soy Sauce", quantity: "2 packs", cost: 40, factor: 0.66 }),
    { quantity: "2 packs", cost: 40 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Chicken", quantity: "3 kg", cost: 900, factor: 0.8 }),
    { quantity: "2.5 kg", cost: 750 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Pechay", quantity: "3 tali", cost: 60, factor: 0.66 }),
    { quantity: "2 tali", cost: 40 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Egg", quantity: "5", cost: 50, factor: 0.66 }),
    { quantity: "4", cost: 40 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Mantika", quantity: "2 bts", cost: 180, factor: 0.66 }),
    { quantity: "2 bts", cost: 180 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Carrots", quantity: ".75", cost: 60, factor: 0.66 }),
    { quantity: "0.5", cost: 40 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Lumpia Wrapper", quantity: "3 tanda", cost: 90, factor: 0.66 }),
    { quantity: "2 tanda", cost: 60 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Bawang", quantity: "1", cost: 10, factor: 0.66 }),
    { quantity: "1", cost: 10 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Sibuyas", quantity: "2", cost: 10, factor: 1.3 }),
    { quantity: "3", cost: 15 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Mantika", quantity: "1 ltr", cost: 70, factor: 0.66 }),
    { quantity: "1 ltr", cost: 70 }
  );
  assert.deepEqual(
    scalePurchaseBudget({ ingredientName: "Seasonings (asin/paminta/laurel)", quantity: "", cost: 16, factor: 0.66 }),
    { quantity: "", cost: 15 }
  );
});

test("creates, searches, updates, deletes, and restores a record", () => {
  const db = new BeneficiaryDatabase(tempDbPath());

  const created = db.saveRecord({
    control_no: "LP-2026-001",
    status: "Active",
    last_name: "Santos",
    first_name: "Ana",
    middle_name: "Cruz"
  });

  assert.equal(created.control_no, "LP-2026-001");
  assert.equal(db.stats().active, 1);
  assert.equal(db.listRecords({ search: "ana" }).length, 1);

  const updated = db.saveRecord({
    ...created,
    status: "Inactive"
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.status, "Inactive");

  db.deleteRecord(created.id);
  assert.equal(db.stats().active, 0);
  assert.equal(db.stats().deleted, 1);

  const deleted = db.listDeletedRecords()[0];
  const restored = db.restoreDeletedRecord(deleted.id);
  assert.equal(restored.control_no, "LP-2026-001");
  assert.equal(db.stats().active, 1);
  assert.equal(db.stats().deleted, 0);

  db.close();
});

test("generates weekly center costings from monthly menus and preserves actual entries", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const ascension = db.saveNutritionCenter({ center_name: "Ascension", capacity: 20 });
  const lourdes = db.saveNutritionCenter({ center_name: "Lourdes", capacity: 15 });
  db.saveNutritionFinancialBudgets({
    year: 2026,
    budgets: [
      { center_id: ascension.id, approved_budget_per_child: 10 },
      { center_id: lourdes.id, approved_budget_per_child: 8 }
    ]
  });
  const recipe = db.saveNutritionRecipe({
    recipe_name: "Chicken Adobo",
    base_servings: 20,
    ingredients: [
      { ingredient_name: "Chicken", default_quantity: "2 kg", default_cost: 300 },
      { ingredient_name: "Soy Sauce", default_quantity: "1 bottle", default_cost: 50 }
    ]
  });

  const menu = db.saveNutritionMenu({
    menu_month: "2026-07",
    status: "Final",
    entries: [
      { meal_date: "2026-07-06", recipe_id: recipe.id, meal_name: recipe.recipe_name },
      { meal_date: "2026-07-07", recipe_id: recipe.id, meal_name: recipe.recipe_name }
    ]
  });

  assert.equal(menu.entries.length, 2);
  assert.equal(db.countNutritionCostings({ month: "2026-07" }), 2);
  assert.equal(db.listNutritionMenus({ limit: 1, offset: 0 }).length, 1);
  assert.equal(db.listNutritionMenus({ limit: 1, offset: 1 }).length, 0);
  const firstCostingPage = db.listNutritionCostings({ month: "2026-07", limit: 1, offset: 0 });
  const secondCostingPage = db.listNutritionCostings({ month: "2026-07", limit: 1, offset: 1 });
  assert.equal(firstCostingPage.length, 1);
  assert.equal(secondCostingPage.length, 1);
  assert.notEqual(firstCostingPage[0].id, secondCostingPage[0].id);
  const weeklyBatch = db.listNutritionCostingsForWeek("2026-07-06");
  assert.equal(weeklyBatch.length, 2);
  assert.deepEqual(weeklyBatch.map(costing => costing.center_name), ["Ascension", "Lourdes"]);
  assert.ok(weeklyBatch.every(costing => costing.days.length === 2));
  assert.ok(weeklyBatch.every(costing => costing.days[0].meal_date === "2026-07-06"));
  assert.ok(weeklyBatch.every(costing => costing.days[1].meal_date === "2026-07-07"));
  assert.ok(weeklyBatch.every(costing => costing.days.every(day => day.items.length === 2)));
  assert.deepEqual(db.listNutritionCostingsForWeek("2026-07-13"), []);
  const ascensionCosting = db.listNutritionCostings({ centerId: ascension.id })[0];
  assert.equal(ascensionCosting.budget_released, 400);
  assert.equal(ascensionCosting.budget_food_total, 700);
  const lourdesCosting = db.getNutritionCosting(db.listNutritionCostings({ centerId: lourdes.id })[0].id);
  assert.equal(lourdesCosting.days[0].items[0].budget_quantity, "1.5 kg");
  assert.equal(lourdesCosting.days[0].items[0].budget_cost, 225);
  assert.equal(lourdesCosting.days[0].items[1].budget_quantity, "1 bottle");
  assert.equal(lourdesCosting.days[0].items[1].budget_cost, 50);

  const detailed = db.getNutritionCosting(ascensionCosting.id);
  detailed.days[0].items[0].actual_quantity = "2.25 kg";
  detailed.days[0].items[0].actual_cost = 325;
  const saved = db.saveNutritionCosting(detailed);
  assert.equal(saved.actual_food_total, 325);

  db.saveNutritionRecipe({
    ...recipe,
    ingredients: [
      { ingredient_name: "Chicken", default_quantity: "2.5 kg", default_cost: 340 },
      { ingredient_name: "Soy Sauce", default_quantity: "1 bottle", default_cost: 55 }
    ]
  });
  db.saveNutritionMenu(menu);
  const regenerated = db.getNutritionCosting(ascensionCosting.id);
  assert.equal(regenerated.days[0].items[0].budget_cost, 340);
  assert.equal(regenerated.days[0].items[0].actual_quantity, "2.25 kg");
  assert.equal(regenerated.days[0].items[0].actual_cost, 325);
  assert.equal(db.stats().nutritionRecipes, 1);
  assert.equal(db.stats().nutritionMonthlyMenus, 1);
  assert.equal(db.stats().nutritionMenuCostings, 2);

  const exported = db.exportData();
  assert.equal(exported.nutritionRecipes.length, 1);
  assert.equal(exported.nutritionMonthlyMenus.length, 1);
  assert.equal(exported.nutritionMenuCostings.length, 2);
  db.close();
});

test("uses zero growth change when previous measurements are missing", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const center = db.saveNutritionCenter({
    center_name: "molave feeding center"
  });
  const child = db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-030",
    center_id: center.id,
    child_last_name: "No Reference",
    child_first_name: "Child",
    birth_date: "2021-01-15",
    gender: "female"
  });

  const saved = db.saveNutritionGrowthReport({
    center_id: center.id,
    report_month: "2026-04",
    submitted_date: "2026-04-20",
    entries: [
      {
        beneficiary_id: child.id,
        height_cm: "102",
        weight_kg: "18"
      }
    ]
  });

  assert.equal(saved.entries[0].previous_height_cm, "");
  assert.equal(saved.entries[0].previous_weight_kg, "");
  assert.equal(saved.entries[0].height_change_cm, "0");
  assert.equal(saved.entries[0].weight_change_kg, "0");

  db.close();
});

test("generates the next control number from active and deleted records", () => {
  const db = new BeneficiaryDatabase(tempDbPath());

  const first = db.saveRecord({ control_no: "LP-2026-001", last_name: "One" });
  db.saveRecord({ control_no: "LP-2026-003", last_name: "Three" });
  db.deleteRecord(first.id);

  assert.equal(db.nextControlNo(2026), "LP-2026-004");

  db.close();
});

test("creates, updates, lists, exports, and deletes monitoring reports", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const beneficiary = db.saveRecord({
    control_no: "LP-2026-010",
    last_name: "Dela Cruz",
    first_name: "Maria",
    field_c12: "Lourdes",
    field_l11: "09507089825"
  });

  const created = db.saveMonitoringReport({
    beneficiary_id: beneficiary.id,
    report_month: "2026-03",
    project_type: "dishwashing liquid production",
    forwarded_balance: "100",
    materials: [
      {
        entry_date: "2026-03-05",
        materials_received: "soap base",
        quantity: "10 liters",
        materials_used: "5 liters",
        inventory: "5 liters"
      }
    ],
    sales: [
      {
        entry_date: "2026-03-10",
        quantity_produced: "20",
        quantity_sold: "12",
        price_per_unit: "25"
      }
    ],
    expenses: [
      {
        entry_date: "2026-03-12",
        payee: "supplier",
        description: "bottles",
        amount: "75"
      }
    ],
    challenges: "slow sales",
    success_stories: "repeat buyers"
  });

  assert.equal(created.control_no, "LP-2026-010");
  assert.equal(created.beneficiary_name, "Dela Cruz, Maria");
  assert.equal(created.project_type, "Dishwashing Liquid Production");
  assert.equal(created.forwarded_balance, 0);
  assert.equal(created.total_sales, 300);
  assert.equal(created.total_expenses, 75);
  assert.equal(created.net_income, 225);
  assert.equal(created.challenges, "Slow sales");
  assert.equal(created.success_stories, "Repeat buyers");
  assert.equal(created.prepared_by, "Dela Cruz, Maria");
  assert.equal(created.materials.length, 1);
  assert.equal(created.sales.length, 1);
  assert.equal(created.expenses.length, 1);
  assert.equal(db.stats().monitoringReports, 1);
  assert.equal(db.listMonitoringReports({ search: "dela" }).length, 1);

  const nextMonth = db.saveMonitoringReport({
    beneficiary_id: beneficiary.id,
    report_month: "2026-04",
    project_type: "dishwashing liquid production",
    forwarded_balance: 9999,
    sales: [
      {
        quantity_sold: "10",
        price_per_unit: "20"
      }
    ],
    expenses: [
      {
        payee: "supplier",
        description: "soap",
        amount: "50"
      }
    ]
  });

  assert.equal(nextMonth.forwarded_balance, 225);
  assert.equal(nextMonth.net_income, 375);

  const updated = db.saveMonitoringReport({
    ...created,
    forwarded_balance: 50,
    expenses: []
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.forwarded_balance, 0);
  assert.equal(updated.total_expenses, 0);
  assert.equal(updated.net_income, 300);
  assert.equal(db.getMonitoringReport(nextMonth.id).forwarded_balance, 300);
  assert.equal(db.getMonitoringReport(nextMonth.id).net_income, 450);

  const exported = db.exportData();
  assert.equal(exported.monitoringReports.length, 2);
  assert.equal(exported.monitoringReports.find(report => report.id === created.id).sales[0].total_sales, 300);

  db.deleteMonitoringReport(created.id);
  assert.equal(db.getMonitoringReport(nextMonth.id).forwarded_balance, 0);
  assert.equal(db.getMonitoringReport(nextMonth.id).net_income, 150);
  db.deleteMonitoringReport(nextMonth.id);
  assert.equal(db.stats().monitoringReports, 0);

  db.close();
});

test("seeds a superadmin and creates standard user accounts", () => {
  const db = new BeneficiaryDatabase(tempDbPath());

  const superadmin = db.authenticateUser("superadmin", "ChangeMe123!");
  assert.equal(superadmin.role, "superadmin");
  assert.equal(superadmin.active, true);

  const user = db.saveUser({
    username: "staff.user",
    display_name: "staff member",
    password: "StaffPass123"
  });

  assert.equal(user.username, "staff.user");
  assert.equal(user.display_name, "Staff Member");
  assert.equal(user.role, "user");
  assert.equal(user.active, true);

  const authenticated = db.authenticateUser("staff.user", "StaffPass123");
  assert.equal(authenticated.role, "user");
  assert.equal(db.listUsers().length, 2);

  assert.throws(() => db.authenticateUser("staff.user", "wrong-password"), /Invalid username or password/);

  db.close();
});

test("backfills current group from livelihood interest", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const beneficiary = db.saveRecord({
    control_no: "LP-2026-020",
    last_name: "Group",
    first_name: "Member",
    livelihood_interest: "Rag Making"
  });

  assert.equal(beneficiary.current_group, "Rag Making");

  const updated = db.saveRecord({
    ...beneficiary,
    current_group: "Sewing"
  });

  assert.equal(updated.current_group, "Sewing");

  db.close();
});

test("sorts livelihood family composition rows by age", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const beneficiary = db.saveRecord({
    control_no: "LP-2026-030",
    last_name: "Sorted",
    first_name: "Family",
    list_a18: "Young Member\nOlder Parent\nTeen Member",
    list_c18: "7\n44\n16",
    list_d18: "Male\nFemale\nFemale"
  });

  assert.equal(beneficiary.list_a18, "Older Parent\nTeen Member\nYoung Member");
  assert.equal(beneficiary.list_c18, "44\n16\n7");
  assert.equal(beneficiary.list_d18, "Female\nFemale\nMale");

  db.close();
});

test("creates, updates, lists, exports, and deletes nutrition core records", () => {
  const db = new BeneficiaryDatabase(tempDbPath());

  assert.equal(db.nextNutritionBeneficiaryNo(2026), "NP-2026-001");

  const center = db.saveNutritionCenter({
    center_name: "molave feeding center",
    location: "st. payatas b, q.c.",
    coordinator: "kristine salde",
    contact_no: "9707054085",
    capacity: "45",
    notes: "pilot center"
  });

  assert.equal(center.center_name, "Molave Feeding Center");
  assert.equal(center.contact_no, "09707054085");
  assert.equal(db.stats().nutritionCenters, 1);

  const created = db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-001",
    center_id: center.id,
    child_last_name: "abot",
    child_first_name: "joan",
    birth_date: "2016-09-16",
    age: "8",
    gender: "female",
    home_address: "diamond hills molave st., st. payatas b, q.c.",
    school: "payatas b elementary school",
    grade_level: "grade 2",
    mother_name: "kristine salde",
    mother_occupation: "service crew",
    father_name: "jonathan abot",
    father_occupation: "garbage collector",
    contact_no: "9707054085",
    sibling_count: "3",
    birth_order: "4th",
    admission_date: "2018-01-08",
    profile_status: "old",
    remarks: "active",
    initial_age_months: "16",
    initial_weight_kg: "7",
    initial_height_cm: "72",
    initial_nutrition_status: "underweight",
    current_update_date: "2026-08-04",
    current_age_months: "101",
    current_weight_kg: "22.1",
    current_height_cm: "127",
    current_nutrition_status: "normal",
    household_members: [
      { member_name: "jonathan abot", age: "30", relationship: "father", occupation: "garbage collector" },
      { member_name: "", age: "", relationship: "", occupation: "" },
      { member_name: "kristine salde", age: "34", relationship: "mother", occupation: "house keeper" }
    ]
  });

  assert.equal(created.beneficiary_no, "NP-2026-001");
  assert.equal(created.feeding_center, "Molave Feeding Center");
  assert.equal(created.child_last_name, "Abot");
  assert.equal(created.child_first_name, "Joan");
  assert.equal(created.birth_date, "09/16/2016");
  assert.equal(created.gender, "Female");
  assert.equal(created.contact_no, "09707054085");
  assert.equal(created.admission_date, "01/08/2018");
  assert.equal(created.current_update_date, "08/04/2026");
  assert.equal(created.current_nutrition_status, "Normal");
  assert.equal(created.household_members.length, 2);
  assert.equal(created.household_members[0].relationship, "Mother");
  assert.equal(created.household_members[0].occupation, "Service Crew");
  assert.equal(db.stats().nutritionBeneficiaries, 1);
  assert.equal(db.nextNutritionBeneficiaryNo(2026), "NP-2026-002");
  assert.equal(db.listNutritionBeneficiaries({ search: "abot" }).length, 1);
  assert.equal(db.listNutritionBeneficiaries({ centerId: center.id }).length, 1);

  const renamedCenter = db.saveNutritionCenter({
    ...center,
    center_name: "molave supplemental feeding center"
  });
  assert.equal(renamedCenter.center_name, "Molave Supplemental Feeding Center");
  assert.equal(db.getNutritionBeneficiary(created.id).feeding_center, "Molave Supplemental Feeding Center");

  const updated = db.saveNutritionBeneficiary({
    ...created,
    current_weight_kg: "23.4",
    current_nutrition_status: "normal",
    household_members: [
      ...created.household_members,
      { member_name: "kenneth abot", age: "2", relationship: "brother", occupation: "n/a" }
    ]
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.current_weight_kg, "23.4");
  assert.equal(updated.household_members.length, 3);

  const overview = db.nutritionOverview();
  assert.equal(overview.stats.centers, 1);
  assert.equal(overview.stats.activeBeneficiaries, 1);

  const exported = db.exportData();
  assert.equal(exported.nutritionCenters.length, 1);
  assert.equal(exported.nutritionBeneficiaries.length, 1);
  assert.equal(exported.nutritionBeneficiaries[0].household_members.length, 3);

  db.deleteNutritionBeneficiary(created.id);
  assert.equal(db.stats().nutritionBeneficiaries, 0);
  db.deleteNutritionCenter(center.id);
  assert.equal(db.stats().nutritionCenters, 0);

  db.close();
});

test("duplicates nutrition household members across sibling beneficiaries", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const center = db.saveNutritionCenter({
    center_name: "molave feeding center"
  });

  const firstChild = db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-020",
    center_id: center.id,
    child_last_name: "Abot",
    child_first_name: "Joan",
    birth_date: "2016-09-16",
    mother_name: "Kristine Salde",
    mother_occupation: "Service Crew",
    father_name: "Jonathan Abot",
    father_occupation: "Garbage Collector",
    contact_no: "09707054085",
    household_members: [
      { member_name: "Kristine Salde", age: "34", relationship: "Mother", occupation: "House Keeper" },
      { member_name: "Jonathan Abot", age: "30", relationship: "Father", occupation: "Garbage Collector" },
      { member_name: "Kenneth Abot", age: "2", relationship: "Brother", occupation: "N/A" }
    ]
  });

  const secondChild = db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-021",
    center_id: center.id,
    child_last_name: "Abot",
    child_first_name: "John Christopher",
    birth_date: "2011-03-01",
    mother_name: "Kristine Salde",
    mother_occupation: "Service Crew",
    father_name: "Jonathan Abot",
    father_occupation: "Garbage Collector",
    contact_no: "09707054085",
    household_members: [
      { member_name: "Maria Abot", age: "12", relationship: "Sister", occupation: "Student" }
    ]
  });

  const refreshedFirst = db.getNutritionBeneficiary(firstChild.id);
  assert.deepEqual(
    refreshedFirst.household_members.map(member => member.member_name),
    secondChild.household_members.map(member => member.member_name)
  );
  assert.deepEqual(
    refreshedFirst.household_members.map(member => member.age),
    ["34", "30", "12", "2"]
  );
  assert.equal(refreshedFirst.household_members[0].occupation, "Service Crew");

  db.close();
});

test("creates monthly nutrition growth reports per feeding center", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const center = db.saveNutritionCenter({
    center_name: "molave feeding center"
  });
  const child = db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-010",
    center_id: center.id,
    child_last_name: "growth",
    child_first_name: "child",
    birth_date: "2020-01-15",
    gender: "male",
    admission_date: "2020-01-01",
    initial_weight_kg: "3",
    initial_height_cm: "50",
    initial_nutrition_status: "Normal",
    current_update_date: "2020-01-01",
    current_age_months: "0",
    current_weight_kg: "3",
    current_height_cm: "50",
    current_nutrition_status: "normal"
  });

  const draft = db.buildNutritionGrowthDraft({
    center_id: center.id,
    report_month: "2020-01",
    submitted_date: "2020-02-05"
  });

  assert.equal(draft.entries.length, 1);
  assert.equal(draft.entries[0].beneficiary_id, child.id);
  assert.equal(draft.entries[0].age_months, "0");
  assert.equal(draft.entries[0].previous_weight_kg, "");
  assert.equal(draft.entries[0].previous_height_cm, "");

  const saved = db.saveNutritionGrowthReport({
    ...draft,
    entries: [
      {
        beneficiary_id: child.id,
        height_cm: "51",
        weight_kg: "3.2"
      }
    ]
  });

  assert.equal(saved.center_name, "Molave Feeding Center");
  assert.equal(saved.submitted_date, "02/05/2020");
  assert.equal(saved.report_month, "2020-01");
  assert.equal(saved.child_count, 1);
  assert.equal(saved.entries[0].age_months, "0");
  assert.equal(saved.entries[0].height_change_cm, "0");
  assert.equal(saved.entries[0].weight_change_kg, "0");
  assert.equal(saved.entries[0].cgs_classification, "Normal");

  const updatedChild = db.getNutritionBeneficiary(child.id);
  assert.equal(updatedChild.current_update_date, "02/05/2020");
  assert.equal(updatedChild.current_age_months, "0");
  assert.equal(updatedChild.current_weight_kg, "3.2");
  assert.equal(updatedChild.current_height_cm, "51");
  assert.equal(updatedChild.current_nutrition_status, "Normal");

  const editDraft = db.buildNutritionGrowthDraft({ id: saved.id });
  assert.equal(editDraft.entries[0].previous_weight_kg, "");
  assert.equal(editDraft.entries[0].previous_height_cm, "");
  assert.equal(editDraft.entries[0].weight_change_kg, "0");
  assert.equal(editDraft.entries[0].height_change_cm, "0");

  const nextDraft = db.buildNutritionGrowthDraft({
    center_id: center.id,
    report_month: "2020-02",
    submitted_date: "2020-03-03"
  });

  assert.equal(nextDraft.entries[0].age_months, "1");
  assert.equal(nextDraft.entries[0].previous_record_date, "2020-01");
  assert.equal(nextDraft.entries[0].previous_weight_kg, "3.2");

  const nextReport = db.saveNutritionGrowthReport({
    ...nextDraft,
    entries: [
      {
        beneficiary_id: child.id,
        height_cm: "52",
        weight_kg: "2.9"
      }
    ]
  });

  assert.equal(nextReport.entries[0].height_change_cm, "1");
  assert.equal(nextReport.entries[0].weight_change_kg, "-0.3");
  assert.equal(nextReport.entries[0].cgs_classification, "Severely Underweight");
  assert.equal(db.stats().nutritionGrowthReports, 2);
  assert.equal(db.listNutritionGrowthReports({ centerId: center.id }).length, 2);

  const yearlyAnalytics = db.nutritionGrowthAnalytics({ centerId: center.id, year: "2020" });
  assert.equal(yearlyAnalytics.reports.length, 2);
  assert.equal(yearlyAnalytics.entries.length, 1);
  assert.equal(yearlyAnalytics.entries[0].beneficiary_id, child.id);
  assert.equal(yearlyAnalytics.entries[0].report_month, "2020-02");
  assert.equal(yearlyAnalytics.entries[0].weight_kg, "2.9");

  const januaryAnalytics = db.nutritionGrowthAnalytics({ centerId: center.id, year: "2020", month: "01" });
  assert.equal(januaryAnalytics.reports.length, 1);
  assert.equal(januaryAnalytics.entries.length, 1);
  assert.equal(januaryAnalytics.entries[0].report_month, "2020-01");
  assert.equal(januaryAnalytics.entries[0].weight_kg, "3.2");

  const protectedSnapshot = db.saveNutritionBeneficiary({
    ...db.getNutritionBeneficiary(child.id),
    current_update_date: "01/01/1999",
    current_weight_kg: "99",
    current_height_cm: "199",
    current_nutrition_status: "Overweight"
  });
  assert.equal(protectedSnapshot.current_update_date, "03/03/2020");
  assert.equal(protectedSnapshot.current_weight_kg, "2.9");
  assert.equal(protectedSnapshot.current_height_cm, "52");
  assert.equal(protectedSnapshot.current_nutrition_status, "Severely Underweight");

  const exported = db.exportData();
  assert.equal(exported.nutritionGrowthReports.length, 2);
  assert.equal(exported.nutritionGrowthReports[0].entries.length, 1);

  db.deleteNutritionGrowthReport(saved.id);
  db.deleteNutritionGrowthReport(nextReport.id);
  assert.equal(db.stats().nutritionGrowthReports, 0);

  db.close();
});

test("creates nutrition financial reports and derives center and program budget summaries", () => {
  const db = new BeneficiaryDatabase(tempDbPath());
  const center = db.saveNutritionCenter({
    center_name: "Lourdes Feeding Program",
    capacity: 50
  });
  db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-101",
    center_id: center.id,
    child_last_name: "Active",
    child_first_name: "Child",
    remarks: "Active"
  });
  db.saveNutritionBeneficiary({
    beneficiary_no: "NP-2026-102",
    center_id: center.id,
    child_last_name: "Inactive",
    child_first_name: "Child",
    profile_status: "Inactive",
    remarks: "Inactive"
  });

  const budgets = db.saveNutritionFinancialBudgets({
    year: 2026,
    budgets: [{
      center_id: center.id,
      feeding_days: 20,
      approved_budget_per_child: 15,
      viands: 10000,
      milk: 2000,
      rice: 1500,
      gas: 1000,
      mineral_water: 500,
      utilities: 800,
      others: 1200
    }]
  });
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].viands, 10000);
  assert.equal(budgets[0].approved_budget_per_child, 15);

  const january = db.saveNutritionFinancialReport({
    center_id: center.id,
    report_month: "2026-01",
    submitted_date: "2026-02-05",
    beginning_balance: 1000,
    cash_receipts: 500,
    prepared_by: "finance officer",
    entries: [{
      entry_date: "2026-01-16",
      rep_no: "R-001",
      particulars: "REPLENISHMENT FOR JANUARY",
      cv_no: "19416",
      viands: 2000,
      gas: 500,
      others: 100
    }]
  });
  assert.equal(january.submitted_date, "02/05/2026");
  assert.equal(january.entries[0].cash, 2600);
  assert.equal(january.total_disbursements, 2600);
  assert.equal(january.balance, -1100);

  db.saveNutritionFinancialReport({
    center_id: center.id,
    report_month: "2026-02",
    submitted_date: "2026-03-05",
    entries: [{ viands: 3000, milk: 400 }]
  });

  assert.throws(() => db.saveNutritionFinancialReport({
    center_id: center.id,
    report_month: "2026-01"
  }), /already exists/i);

  const summary = db.nutritionFinancialSummary({ year: 2026 });
  const centerSummary = summary.centers.find(item => item.id === center.id);
  assert.equal(summary.program.center_count, 1);
  assert.equal(summary.program.active_kids, 1);
  assert.equal(summary.program.capacity, 50);
  assert.equal(centerSummary.reported_months, 2);
  assert.equal(centerSummary.totals.total_expenses, 6000);
  assert.equal(centerSummary.category_metrics.viands.actual_total, 5000);
  assert.equal(centerSummary.category_metrics.viands.actual_monthly_average, 2500);
  assert.equal(centerSummary.category_metrics.viands.actual_daily_average, 125);
  assert.equal(centerSummary.category_metrics.viands.actual_per_child, 125);
  assert.equal(centerSummary.category_metrics.viands.budget_monthly, 10000);
  assert.equal(centerSummary.category_metrics.viands.budget_daily, 500);
  assert.equal(centerSummary.category_metrics.viands.budget_per_child, 10);
  assert.equal(centerSummary.budget_metrics.actual_per_child, 150);
  assert.equal(centerSummary.budget_metrics.approved_per_child, 15);
  assert.equal(centerSummary.budget_metrics.approved_monthly, 15000);
  assert.equal(centerSummary.budget_metrics.monthly_variance, -12000);
  assert.equal(summary.program.approved_budget_per_child, 15);
  assert.equal(db.stats().nutritionFinancialReports, 2);
  assert.equal(db.countNutritionFinancialReports({ centerId: center.id, year: 2026 }), 2);

  const exported = db.exportData();
  assert.equal(exported.nutritionFinancialReports.length, 2);
  assert.equal(exported.nutritionFinancialBudgets.length, 1);

  db.deleteNutritionFinancialReport(january.id);
  assert.equal(db.countNutritionFinancialReports({ centerId: center.id }), 1);
  db.close();
});
