const test = require("node:test");
const assert = require("node:assert/strict");
const {
  documentBufferFromDataUrl,
  parseNutritionProfileText,
  renderPdfToImageBuffers
} = require("../src/nutrition-ocr");

function simplePdfBuffer() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 44 >>\nstream\nBT /F1 18 Tf 24 70 Td (Abot, Joan) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  offsets.slice(1).forEach(offset => {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  output += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output);
}

test("parses nutrition beneficiary profile OCR text", () => {
  const draft = parseNutritionProfileText(`
    PAYATAS ORIONE FOUNDATION, INC.
    MOLAVE FEEDING CENTER
    Child's Name: Abot, Joan
    Birth date: 9/16/2016
    Age: 8
    Gender: Female
    Home Address: Diamond hills Molave St., St. Payatas B, Q.C.
    School: Payatas B Elementary School
    Grade Level: Grade 2
    Mother's Name: Kristine Salde
    Occupation: Service Crew
    Father's Name: Jonathan Abot
    Occupation: Garbage Collector
    Contact No.: 09707054085
    No. of Siblings: 3 Birth Order: 4th
    Household Members Age Relationships Occupation
    Jonathan Abot 30 Father Garbage Collector
    Kristine Salde 34 Mother House Keeper
    John Christopher Salde 15 Brother Student
    Admission Date: 1/8/2018 Current Status: Old Remarks: Active
    Age in month: 16
    Initial Weight(kg): 7
    Initial Height(cm): 72
    Nutritional Status: Underweight
    Date: 04/08/2026
    Age in month: 101
    Current Weight(kg): 22.1
    Current Height(cm): 127
    Nutritional Status: Normal
  `);

  assert.equal(draft.feeding_center, "Molave Feeding Center");
  assert.equal(draft.child_last_name, "Abot");
  assert.equal(draft.child_first_name, "Joan");
  assert.equal(draft.birth_date, "09/16/2016");
  assert.equal(draft.gender, "Female");
  assert.equal(draft.school, "Payatas B Elementary School");
  assert.equal(draft.mother_name, "Kristine Salde");
  assert.equal(draft.mother_occupation, "Service Crew");
  assert.equal(draft.father_name, "Jonathan Abot");
  assert.equal(draft.father_occupation, "Garbage Collector");
  assert.equal(draft.contact_no, "09707054085");
  assert.equal(draft.sibling_count, "3");
  assert.equal(draft.birth_order, "4th");
  assert.equal(draft.admission_date, "01/08/2018");
  assert.equal(draft.profile_status, "Old");
  assert.equal(draft.remarks, "Active");
  assert.equal(draft.initial_age_months, "16");
  assert.equal(draft.initial_weight_kg, "7");
  assert.equal(draft.initial_height_cm, "72");
  assert.equal(draft.initial_nutrition_status, "Underweight");
  assert.equal(draft.current_update_date, "04/08/2026");
  assert.equal(draft.current_age_months, "101");
  assert.equal(draft.current_weight_kg, "22.1");
  assert.equal(draft.current_height_cm, "127");
  assert.equal(draft.current_nutrition_status, "Normal");
  assert.equal(draft.household_members.length, 3);
  assert.equal(draft.household_members[0].relationship, "Father");
});

test("accepts PDF data urls for nutrition OCR", () => {
  const source = documentBufferFromDataUrl(`data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`);
  assert.equal(source.mimeType, "application/pdf");
  assert.equal(source.buffer.toString(), "%PDF-1.4");
});

test("renders PDF pages for OCR", async () => {
  const images = await renderPdfToImageBuffers(simplePdfBuffer(), 1);

  assert.equal(images.length, 1);
  assert.equal(images[0].subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
