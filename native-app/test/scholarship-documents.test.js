const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const indexSource = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const scholarshipSource = fs.readFileSync(path.join(publicDir, "scholarship.js"), "utf8");
const scholarshipStoreSource = fs.readFileSync(path.join(__dirname, "..", "src", "scholarship-store.js"), "utf8");

test("exposes the Scholarship Document Center in navigation and routing", () => {
  assert.match(indexSource, /data-route="scholarship-documents"/);
  assert.match(indexSource, />Document Center</);
  assert.match(appSource, /"scholarship-documents":\s*\{/);
  assert.match(scholarshipSource, /route === "scholarship-documents"/);
  assert.match(scholarshipSource, /function renderDocumentCenter\(\)/);
});

test("defines the five sponsor document formats and their issuance scopes", () => {
  for (const code of ["APR", "CHRISTMAS_LETTER", "SOA", "SERVICE_INVOICE", "TYL"]) {
    assert.match(scholarshipSource, new RegExp(`code: "${code}"`));
  }
  assert.match(scholarshipSource, /scope: "Per sponsor \/ per scholar"/);
  assert.match(scholarshipSource, /Never combines multiple scholars in one SOA/);
  assert.match(scholarshipSource, /covering all selected donations they are scheduled to send/);
  assert.match(scholarshipSource, /Uses Scanned Thank You Letter and Thank You Letter Photo links/);
  assert.match(scholarshipSource, /Uses APR, APR photo, and final report card links/);
});

test("stores consolidated Service Invoice donation lines and prints them as particulars", () => {
  assert.match(scholarshipStoreSource, /CREATE TABLE IF NOT EXISTS scholarship_invoice_items/);
  assert.match(scholarshipStoreSource, /replaceChildren\("scholarship_invoice_items"/);
  assert.match(scholarshipStoreSource, /enriched\.items = await this\.driver\.all/);
  assert.match(scholarshipSource, /function openServiceInvoiceComposer\(\)/);
  assert.match(scholarshipSource, /Scheduled Donations Covered by this Invoice/);
});
