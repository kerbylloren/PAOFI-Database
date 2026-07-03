const path = require("node:path");
const { normalizeContactNumber, titleCaseValue } = require("./database");

const MAX_PDF_OCR_PAGES = 5;
const PDF_RENDER_SCALE = 2.2;
const NUTRITION_STATUSES = [
  "Severely Underweight",
  "Underweight",
  "Normal",
  "Overweight"
];
const RELATIONSHIPS = [
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Grandfather",
  "Grandmother",
  "Guardian",
  "Feeding Child"
];

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function cleanValue(value) {
  return String(value || "")
    .replace(/^[\s:._-]+/, "")
    .replace(/[\s:._-]+$/, "")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function lineValueAfterLabel(line, labels) {
  const compacted = compactLabel(line);

  for (const label of labels) {
    const compactedLabel = compactLabel(label);
    const index = compacted.indexOf(compactedLabel);
    if (index !== 0) continue;

    const match = new RegExp(`${escapeRegex(label).replace(/\\ /g, "\\s+")}\\s*[:.]?\\s*(.*)$`, "i").exec(line);
    if (match) return cleanValue(match[1]);
  }

  return "";
}

function extractLabelValue(lines, labels, occurrence = 0) {
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const current = cleanValue(lines[index]);
    const directValue = lineValueAfterLabel(current, labels);
    const isLabelOnly = labels.some(label => compactLabel(current) === compactLabel(label));

    if (directValue || isLabelOnly) {
      if (seen === occurrence) {
        if (directValue) return directValue;

        for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
          const next = cleanValue(lines[nextIndex]);
          if (next) return next;
        }
      }
      seen += 1;
    }
  }

  return "";
}

function extractInlineValue(text, label, stopLabels = []) {
  const stops = stopLabels.length
    ? `(?=\\s+(?:${stopLabels.map(item => escapeRegex(item)).join("|")})\\s*[:.]?|$)`
    : "(?=$)";
  const pattern = new RegExp(`${escapeRegex(label)}\\s*[:.]?\\s*([\\s\\S]*?)${stops}`, "i");
  const match = pattern.exec(text);
  return match ? cleanValue(match[1].replace(/\n/g, " ")) : "";
}

function parseDate(value) {
  const text = cleanValue(value);
  const match = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(text);
  if (!match) return "";

  let first = Number(match[1]);
  let second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;

  let month = first;
  let day = second;

  if (first > 12 && second <= 12) {
    month = second;
    day = first;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return "";
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

function parseNumber(value, allowDecimal = false) {
  const pattern = allowDecimal ? /(\d+(?:\.\d+)?)/ : /(\d+)/;
  const match = pattern.exec(String(value || ""));
  return match ? match[1] : "";
}

function normalizeBirthOrder(value) {
  const text = cleanValue(value).replace(/\s+/g, " ");
  const match = /(\d+)\s*(st|nd|rd|th)/i.exec(text);
  return match ? `${match[1]}${match[2].toLowerCase()}` : titleCaseValue(text);
}

function parseNameParts(value) {
  const text = titleCaseValue(value);
  if (!text) return {};

  if (text.includes(",")) {
    const [last, rest] = text.split(",");
    const parts = cleanValue(rest).split(/\s+/).filter(Boolean);
    return {
      child_last_name: cleanValue(last),
      child_first_name: cleanValue(parts.shift() || ""),
      child_middle_name: cleanValue(parts.join(" "))
    };
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { child_first_name: parts[0] || "" };
  }

  return {
    child_first_name: parts.shift(),
    child_last_name: parts.pop(),
    child_middle_name: parts.join(" ")
  };
}

function normalizeStatus(value) {
  const text = String(value || "").toLowerCase();
  return NUTRITION_STATUSES.find(status => text.includes(status.toLowerCase())) || titleCaseValue(value);
}

function findNutritionStatuses(text) {
  const matches = [];
  const regex = /nutri(?:tional|tion)?\s+status\s*[:.]?\s*([^\n]+)/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push(normalizeStatus(match[1]));
  }

  return matches.filter(Boolean);
}

function parseHouseholdMembers(lines) {
  const members = [];
  const relationshipPattern = RELATIONSHIPS.map(escapeRegex).join("|");
  const rowPattern = new RegExp(`^(.+?)\\s+(\\d{1,3})\\s+(${relationshipPattern})\\s+(.+)$`, "i");

  lines.forEach(line => {
    const text = cleanValue(line);
    if (!text || /child|birth|gender|school|occupation|status|date|weight|height/i.test(text)) return;

    const match = rowPattern.exec(text);
    if (!match) return;

    members.push({
      member_name: titleCaseValue(match[1]),
      age: parseNumber(match[2]),
      relationship: titleCaseValue(match[3]),
      occupation: titleCaseValue(match[4])
    });
  });

  return members;
}

function parseNutritionProfileText(text) {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split("\n").map(cleanValue).filter(Boolean);
  const singleLine = normalized.replace(/\n/g, " ");
  const statuses = findNutritionStatuses(normalized);
  const occupationValues = lines
    .map(line => lineValueAfterLabel(line, ["Occupation"]))
    .filter(Boolean);

  const draft = {
    feeding_center: titleCaseValue(
      extractLabelValue(lines, ["Feeding Center"])
      || (/molave feeding center/i.test(normalized) ? "Molave Feeding Center" : "")
    ),
    birth_date: parseDate(extractLabelValue(lines, ["Birth Date", "Birthdate"])),
    age: parseNumber(extractLabelValue(lines, ["Age"])),
    gender: titleCaseValue(extractLabelValue(lines, ["Gender"])),
    home_address: titleCaseValue(extractLabelValue(lines, ["Home Address", "Address"])),
    school: titleCaseValue(extractLabelValue(lines, ["School"])),
    grade_level: titleCaseValue(extractLabelValue(lines, ["Grade Level", "Grade"])),
    mother_name: titleCaseValue(extractLabelValue(lines, ["Mother's Name", "Mothers Name", "Mother Name"])),
    mother_occupation: titleCaseValue(occupationValues[0] || ""),
    father_name: titleCaseValue(extractLabelValue(lines, ["Father's Name", "Fathers Name", "Father Name"])),
    father_occupation: titleCaseValue(occupationValues[1] || ""),
    contact_no: normalizeContactNumber(extractLabelValue(lines, ["Contact No.", "Contact No", "Contact Number"])),
    sibling_count: parseNumber(extractInlineValue(singleLine, "No. of Siblings", ["Birth Order"]) || extractLabelValue(lines, ["No. of Siblings", "No of Siblings", "Siblings"])),
    birth_order: normalizeBirthOrder(
      extractInlineValue(singleLine, "Birth Order", ["Household Members", "Admission Date"])
      || extractLabelValue(lines, ["Birth Order"])
    ),
    admission_date: parseDate(extractInlineValue(singleLine, "Admission Date", ["Current Status", "Remarks"]) || extractLabelValue(lines, ["Admission Date"])),
    profile_status: titleCaseValue(extractInlineValue(singleLine, "Current Status", ["Remarks"]) || extractLabelValue(lines, ["Current Status"])),
    remarks: titleCaseValue(extractInlineValue(singleLine, "Remarks", ["Age in month", "Initial Weight"]) || extractLabelValue(lines, ["Remarks"])),
    initial_age_months: parseNumber(extractLabelValue(lines, ["Age in month", "Age in months"], 0)),
    initial_weight_kg: parseNumber(extractLabelValue(lines, ["Initial Weight(kg)", "Initial Weight (kg)", "Initial Weight"], 0), true),
    initial_height_cm: parseNumber(extractLabelValue(lines, ["Initial Height(cm)", "Initial Height (cm)", "Initial Height"], 0), true),
    initial_nutrition_status: statuses[0] || "",
    current_update_date: parseDate(extractLabelValue(lines, ["Date"], 0)),
    current_age_months: parseNumber(extractLabelValue(lines, ["Age in month", "Age in months"], 1)),
    current_weight_kg: parseNumber(extractLabelValue(lines, ["Current Weight(kg)", "Current Weight (kg)", "Current Weight"], 0), true),
    current_height_cm: parseNumber(extractLabelValue(lines, ["Current Height(cm)", "Current Height (cm)", "Current Height"], 0), true),
    current_nutrition_status: statuses[1] || "",
    household_members: parseHouseholdMembers(lines)
  };

  Object.assign(draft, parseNameParts(extractLabelValue(lines, ["Child's Name", "Childs Name", "Child Name"])));

  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) => {
      if (Array.isArray(value)) return value.length;
      return Boolean(String(value || "").trim());
    })
  );
}

function documentBufferFromDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) {
    throw new Error("Upload a supported image or PDF file for OCR.");
  }

  const mimeType = match[1].toLowerCase();
  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
    throw new Error("Upload a supported image or PDF file for OCR.");
  }

  return {
    mimeType,
    buffer: Buffer.from(match[2], "base64")
  };
}

async function renderPdfToImageBuffers(pdfBuffer, maxPages = MAX_PDF_OCR_PAGES) {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");

  globalThis.DOMMatrix ||= DOMMatrix;
  globalThis.ImageData ||= ImageData;
  globalThis.Path2D ||= Path2D;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDirectory = path
    .join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")
    .replace(/\\/g, "/");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
    disableWorker: true,
    standardFontDataUrl: `${standardFontDirectory}/`
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");

    await page.render({ canvasContext, viewport }).promise;
    images.push(canvas.toBuffer("image/png"));
    page.cleanup();
  }

  if (typeof pdf.destroy === "function") {
    await pdf.destroy();
  } else if (typeof loadingTask.destroy === "function") {
    await loadingTask.destroy();
  } else if (typeof pdf.cleanup === "function") {
    pdf.cleanup();
  }
  return images;
}

async function buffersForOcr(dataUrl) {
  const document = documentBufferFromDataUrl(dataUrl);

  if (document.mimeType === "application/pdf") {
    const images = await renderPdfToImageBuffers(document.buffer);
    if (!images.length) {
      throw new Error("The PDF has no pages to scan.");
    }
    return {
      sourceType: "pdf",
      buffers: images
    };
  }

  return {
    sourceType: "image",
    buffers: [document.buffer]
  };
}

async function recognizeNutritionProfile(imageData) {
  const { recognize } = require("tesseract.js");
  const source = await buffersForOcr(imageData);
  const pageResults = [];

  for (const buffer of source.buffers) {
    const result = await recognize(buffer, "eng");
    pageResults.push({
      text: result?.data?.text || "",
      confidence: Number(result?.data?.confidence || 0)
    });
  }

  const text = pageResults.map(page => page.text).filter(Boolean).join("\n");
  const confidence = pageResults.length
    ? Math.round(pageResults.reduce((sum, page) => sum + page.confidence, 0) / pageResults.length)
    : 0;

  return {
    text,
    confidence,
    sourceType: source.sourceType,
    pages: source.buffers.length,
    draft: parseNutritionProfileText(text)
  };
}

module.exports = {
  documentBufferFromDataUrl,
  parseNutritionProfileText,
  recognizeNutritionProfile,
  renderPdfToImageBuffers
};
