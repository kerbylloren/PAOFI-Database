const test = require("node:test");
const assert = require("node:assert/strict");
const {
  easterSunday,
  lastMondayOfAugust,
  philippineHolidaysForYear
} = require("../src/philippine-holidays");

test("returns the proclaimed 2026 Philippine national holidays", () => {
  const holidays = philippineHolidaysForYear(2026);
  const byDate = new Map(holidays.map(item => [item.date, item]));
  assert.equal(byDate.get("2026-02-17").name, "Chinese New Year");
  assert.equal(byDate.get("2026-03-20").name, "Eid'l Fitr");
  assert.equal(byDate.get("2026-04-02").name, "Maundy Thursday");
  assert.equal(byDate.get("2026-05-27").name, "Eid'l Adha");
  assert.equal(byDate.get("2026-08-31").name, "National Heroes Day");
  assert.equal(byDate.get("2026-11-02").name, "All Souls' Day");
  assert.equal(byDate.get("2026-12-24").name, "Christmas Eve");
  assert.equal(byDate.get("2026-02-25").type, "special-working");
});

test("keeps movable holiday calculations available for future years", () => {
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(lastMondayOfAugust(2027), "2027-08-30");
  const holidays = philippineHolidaysForYear(2027);
  assert.ok(holidays.some(item => item.date === "2027-03-25" && item.name === "Maundy Thursday"));
  assert.ok(holidays.some(item => item.date === "2027-03-26" && item.name === "Good Friday"));
  assert.ok(holidays.some(item => item.date === "2027-03-27" && item.name === "Black Saturday"));
});
