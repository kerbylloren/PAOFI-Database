function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function lastMondayOfAugust(year) {
  const date = new Date(Date.UTC(year, 7, 31));
  const distance = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - distance);
  return date.toISOString().slice(0, 10);
}

function holiday(date, name, type, source = "") {
  return { date, name, type, source };
}

function baselineHolidays(year) {
  const easter = easterSunday(year);
  return [
    holiday(isoDate(year, 1, 1), "New Year's Day", "regular"),
    holiday(addUtcDays(easter, -3), "Maundy Thursday", "regular"),
    holiday(addUtcDays(easter, -2), "Good Friday", "regular"),
    holiday(addUtcDays(easter, -1), "Black Saturday", "special-non-working"),
    holiday(isoDate(year, 4, 9), "Araw ng Kagitingan", "regular"),
    holiday(isoDate(year, 5, 1), "Labor Day", "regular"),
    holiday(isoDate(year, 6, 12), "Independence Day", "regular"),
    holiday(isoDate(year, 8, 21), "Ninoy Aquino Day", "special-non-working"),
    holiday(lastMondayOfAugust(year), "National Heroes Day", "regular"),
    holiday(isoDate(year, 11, 1), "All Saints' Day", "special-non-working"),
    holiday(isoDate(year, 11, 30), "Bonifacio Day", "regular"),
    holiday(isoDate(year, 12, 8), "Feast of the Immaculate Conception", "special-non-working"),
    holiday(isoDate(year, 12, 25), "Christmas Day", "regular"),
    holiday(isoDate(year, 12, 30), "Rizal Day", "regular"),
    holiday(isoDate(year, 12, 31), "Last Day of the Year", "special-non-working")
  ];
}

const YEAR_SPECIFIC_HOLIDAYS = {
  2025: [
    holiday("2025-01-29", "Chinese New Year", "special-non-working", "Proclamation No. 727"),
    holiday("2025-02-25", "EDSA People Power Revolution Anniversary", "special-working", "Proclamation No. 727"),
    holiday("2025-04-01", "Eid'l Fitr", "regular", "Proclamation No. 839"),
    holiday("2025-06-06", "Eid'l Adha", "regular", "Proclamation No. 911"),
    holiday("2025-10-31", "All Saints' Day Eve", "special-non-working", "Proclamation No. 727"),
    holiday("2025-12-24", "Christmas Eve", "special-non-working", "Proclamation No. 727")
  ],
  2026: [
    holiday("2026-02-17", "Chinese New Year", "special-non-working", "Proclamation No. 1006"),
    holiday("2026-02-25", "EDSA People Power Revolution Anniversary", "special-working", "Proclamation No. 1006"),
    holiday("2026-03-20", "Eid'l Fitr", "regular", "Proclamation No. 1189"),
    holiday("2026-05-27", "Eid'l Adha", "regular", "Proclamation No. 1264"),
    holiday("2026-11-02", "All Souls' Day", "special-non-working", "Proclamation No. 1006"),
    holiday("2026-12-24", "Christmas Eve", "special-non-working", "Proclamation No. 1006")
  ]
};

function proclamationSource(year) {
  if (year === 2025) return "Proclamation No. 727";
  if (year === 2026) return "Proclamation No. 1006";
  return "Statutory and movable national observances";
}

function philippineHolidaysForYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return [];
  const source = proclamationSource(year);
  const entries = [
    ...baselineHolidays(year).map(item => ({ ...item, source: item.source || source })),
    ...(YEAR_SPECIFIC_HOLIDAYS[year] || [])
  ];
  return entries
    .filter((item, index, list) => list.findIndex(other => other.date === item.date && other.name === item.name) === index)
    .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
}

module.exports = {
  easterSunday,
  lastMondayOfAugust,
  philippineHolidaysForYear
};
