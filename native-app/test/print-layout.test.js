const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const scholarshipSource = fs.readFileSync(path.join(__dirname, "..", "public", "scholarship.js"), "utf8");

test("uses readable wrapping rules for every print document", () => {
  assert.match(appSource, /function applyPrintTableReadability\(printDocument\)/);
  assert.match(appSource, /th \{ overflow-wrap: normal !important; \}/);
  assert.match(appSource, /td \{ overflow-wrap: break-word !important; \}/);
  assert.doesNotMatch(appSource, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(scholarshipSource, /overflow-wrap:\s*anywhere/);
  assert.match(scholarshipSource, /applyPrintTableReadability\?\.\(win\.document\)/);
});

test("paginates yearly growth records into readable month bands", () => {
  assert.match(appSource, /NUTRITION_GROWTH_YEARLY_MONTHS_PER_PAGE = 2/);
  assert.match(appSource, /function printNutritionGrowthYearlyPivotTables/);
  assert.match(appSource, /yearly-table-page \{ break-before: page; page-break-before: always; \}/);
  assert.match(appSource, /yearly-pivot \{ table-layout: fixed; \}/);
});

test("separates program actual and budget print tables", () => {
  assert.match(appSource, /class="program-actual-table"/);
  assert.match(appSource, /class="program-budget-table"/);
  assert.doesNotMatch(appSource, /<th colspan="6" class="actual-group">Actual<\/th><th colspan="3" class="budget-group">Budget<\/th>/);
});

test("fits single and all-center weekly menu costing prints on Letter portrait pages", () => {
  assert.match(appSource, /nutritionCostingPrintDocument[\s\S]*?"letter"/);
  assert.match(appSource, /@page\{size:letter portrait;margin:\.2in\}/);
  assert.match(appSource, /class="weekly-costing-day-table"/);
  assert.match(appSource, /weekly-costing-tables\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(appSource, /weekly-costing-day-card:last-child:nth-child\(odd\)\{grid-column:1\/-1;width:calc\(50% - 2px\);justify-self:center\}/);
  assert.doesNotMatch(appSource, /class="weekly-costing-print-table"/);
  assert.match(appSource, /nutritionCostingWeekBatchPrintDocument[\s\S]*?"letter"/);
  assert.match(appSource, /type="week"/);
  assert.match(appSource, /function isoWeekStart\(value\)/);
  assert.match(appSource, /batch-costing-sheet\{break-after:page;page-break-after:always/);
  assert.match(appSource, /Batch Print Week/);
});
