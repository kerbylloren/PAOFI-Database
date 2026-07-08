const cgsData = require("./nutrition-cgs-data.json");

const CLASSIFICATIONS = {
  SEVERELY_UNDERWEIGHT: "Severely Underweight",
  UNDERWEIGHT: "Underweight",
  NORMAL: "Normal",
  OVERWEIGHT: "Overweight",
  NOT_CLASSIFIED: "Not Classified"
};

function parseMeasurementNumber(value) {
  const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeGenderKey(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("m")) return "male";
  if (text.startsWith("f")) return "female";
  return "";
}

function parseProfileDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (!match) return null;

  const year = Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]);
  const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeReportMonth(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || month < 1 || month > 12) return "";

  return `${year}-${String(month).padStart(2, "0")}`;
}

function reportMonthReferenceDate(reportMonth) {
  const normalized = normalizeReportMonth(reportMonth);
  if (!normalized) return null;

  const [year, month] = normalized.split("-").map(Number);
  return new Date(year, month, 0);
}

function calculateAgeMonths(birthDateValue, reportMonth) {
  const birthDate = parseProfileDate(birthDateValue);
  const referenceDate = reportMonthReferenceDate(reportMonth);
  if (!birthDate || !referenceDate || referenceDate < birthDate) return "";

  let months = (referenceDate.getFullYear() - birthDate.getFullYear()) * 12;
  months += referenceDate.getMonth() - birthDate.getMonth();
  if (referenceDate.getDate() < birthDate.getDate()) months -= 1;

  return months >= 0 ? String(months) : "";
}

function cgsRow(gender, ageMonths) {
  const key = normalizeGenderKey(gender);
  const age = Number(ageMonths);
  if (!key || !Number.isInteger(age)) return null;

  return (cgsData.standards[key] || []).find(row => Number(row.age_months) === age) || null;
}

function classifyCgs({ gender = "", ageMonths = "", weightKg = "" } = {}) {
  const row = cgsRow(gender, Number(ageMonths));
  const weight = parseMeasurementNumber(weightKg);
  if (!row || weight === null) return CLASSIFICATIONS.NOT_CLASSIFIED;

  const roundedWeight = Math.round(weight * 10) / 10;
  if (roundedWeight <= row.severely_underweight_max) return CLASSIFICATIONS.SEVERELY_UNDERWEIGHT;
  if (roundedWeight <= row.underweight_max) return CLASSIFICATIONS.UNDERWEIGHT;
  if (roundedWeight <= row.normal_max) return CLASSIFICATIONS.NORMAL;
  return CLASSIFICATIONS.OVERWEIGHT;
}

function cgsReferencePayload() {
  return {
    source: cgsData.source,
    description: cgsData.description,
    ageRangeMonths: cgsData.age_range_months,
    classifications: Object.values(CLASSIFICATIONS),
    standards: cgsData.standards
  };
}

module.exports = {
  CLASSIFICATIONS,
  calculateAgeMonths,
  cgsReferencePayload,
  classifyCgs,
  normalizeReportMonth,
  parseMeasurementNumber,
  reportMonthReferenceDate
};
