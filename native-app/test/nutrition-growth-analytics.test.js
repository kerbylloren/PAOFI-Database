const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("renders current-year and month controls for unique-child growth analytics", () => {
  assert.match(appSource, /id="nutritionGrowthAnalyticsYear"/);
  assert.match(appSource, /id="nutritionGrowthAnalyticsMonth"/);
  assert.match(appSource, /children: rows\.length/);
  assert.doesNotMatch(appSource, /children: rows\.length \|\| totals\.children/);
  assert.match(appSource, /"unique children"/);
  assert.match(appSource, /"latest record per child"/);
});

test("loads growth analytics from the filtered cached endpoint", () => {
  assert.match(appSource, /\/api\/nutrition\/growth\/analytics\?/);
  assert.match(serverSource, /pathname === "\/api\/nutrition\/growth\/analytics"/);
  assert.match(serverSource, /year: url\.searchParams\.get\("year"\)/);
  assert.match(serverSource, /month: url\.searchParams\.get\("month"\)/);
});
