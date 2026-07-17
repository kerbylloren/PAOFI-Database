const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BeneficiaryDatabase } = require("../src/database");
const {
  importScholarshipAccess,
  nameScore,
  normalizeContact,
  prepareScholarshipAccessPayload
} = require("../src/scholarship-access-import");

function tempDbPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paofi-access-import-test-"));
  return path.join(directory, "database.sqlite");
}

function sourcePayload() {
  return {
    source_file: "Scholar profiles.accdb",
    tables: [
      {
        name: "Scholars Profile 2026-2027",
        rows: [
          {
            "ID No": 1,
            Surname: "Adarayan",
            "First Name": "Khean Mark",
            "Middle Name": "Santos",
            "Date of Birth": "2010-01-02",
            "Contact Number": 9382651892,
            Chapel: "Sto. Niño",
            Status: "Old",
            "School Year": "2026-2027",
            "Name of School": "Payatas High School",
            "Grade/Year Level2": "Grade 10",
            N1: "Maria Adarayan",
            Age2: 40,
            Gender2: "Female",
            Relationship: "Mother",
            Occupation: "Vendor",
            "Monthly Income": 5000
          },
          {
            "ID No": 2,
            Surname: "Archive",
            "First Name": "Scholar",
            "Date of Birth": "2001-05-06",
            Chapel: "Lourdes",
            Status: "Old",
            "School Year": "2026-2027",
            N1: "Parent Archive",
            Relationship: "Father"
          }
        ]
      },
      {
        name: "Elem-JHS Scholars Pass 2026-2027",
        rows: [
          {
            "ID No": 1,
            Surname: "Adarayan",
            "First Name": "Mark Khean",
            "Date of Birth": "2010-01-02",
            Chapel: "Sto. Nino",
            "School Year": "2026-2027",
            "Sponsor's Name": "Sample Foundation",
            "Name of School": "Payatas High School",
            "Grade/Year Level2": "Grade 10"
          }
        ]
      },
      {
        name: "Sample Scholars Profile 2025-2026",
        rows: [
          {
            "ID No": 1,
            Surname: "Adarayan",
            "First Name": "Khean Mark",
            "Date of Birth": "2010-01-02",
            "School Year": "2025-2026",
            "Sponsor's Name": "Sample Foundation",
            "Name of School": "Payatas High School",
            "Grade/Year Level2": "Grade 9"
          }
        ]
      }
    ]
  };
}

test("reconciles Access name variants and extracts household data", () => {
  const prepared = prepareScholarshipAccessPayload(sourcePayload());
  assert.equal(prepared.canonicals.length, 2);
  assert.equal(prepared.canonicals.filter(item => item.currentPassed).length, 1);
  assert.equal(prepared.ambiguousSourceMatches.length, 0);
  const active = prepared.canonicals.find(item => item.currentPassed);
  assert.equal(active.profile.contact_no, "09382651892");
  assert.equal(active.profile.household_members.length, 1);
  assert.equal(active.profile.guardian_name, "Maria Adarayan");
  assert.deepEqual(active.enrollments.map(item => item.academic_year).sort(), ["2025-2026", "2026-2027"]);
  assert.ok(nameScore(
    { last_name: "Adarayan", first_name: "Khean Mark" },
    { last_name: "Adarayan", first_name: "Mark Khean" }
  ) >= 84);
  assert.equal(normalizeContact(9382651892), "09382651892");
});

test("keeps Access-only profiles non-active even when they appear in the pass list", async () => {
  const database = new BeneficiaryDatabase(tempDbPath());
  const preview = await importScholarshipAccess(database, sourcePayload());
  assert.equal(preview.scholarsToCreate, 2);
  assert.equal(preview.currentPassedProfiles, 1);
  assert.equal(preview.ambiguousDatabaseMatches.length, 0);

  const result = await importScholarshipAccess(database, sourcePayload(), { commit: true });
  assert.equal(result.committed, true);
  const scholars = await database.scholarship.driver.all(
    "SELECT last_name, first_name, contact_no, status FROM scholarship_scholars ORDER BY last_name"
  );
  assert.deepEqual(scholars.map(row => row.status), ["Inactive", "Inactive"]);
  assert.equal(scholars[0].contact_no, "09382651892");

  const enrollments = await database.scholarship.driver.all(
    `SELECT y.label, e.scholarship_status
     FROM scholarship_enrollments e
     JOIN scholarship_academic_years y ON y.id = e.academic_year_id
     ORDER BY y.label`
  );
  assert.deepEqual(enrollments.map(row => ({ ...row })), [
    { label: "2025-2026", scholarship_status: "Completed" },
    { label: "2026-2027", scholarship_status: "On Hold" }
  ]);
  assert.equal(Number((await database.scholarship.driver.get(
    "SELECT COUNT(*) AS count FROM scholarship_household_members"
  )).count), 2);
  assert.equal(Number((await database.scholarship.driver.get(
    "SELECT COUNT(*) AS count FROM scholarship_sponsorships"
  )).count), 2);
  database.close();
});

test("keeps Google Sheets-origin scholars active when Access data enriches them", async () => {
  const database = new BeneficiaryDatabase(tempDbPath());
  const timestamp = new Date().toISOString();
  await database.scholarship.driver.run(
    `INSERT INTO scholarship_scholars
      (scholar_no, last_name, first_name, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'Active', ?, ?, ?)`,
    [
      "SCH-2026-0001",
      "Adarayan",
      "Mark Khean",
      "Imported from Scholarship Renewal Checklist 2026-2027.",
      timestamp,
      timestamp
    ]
  );

  const preview = await importScholarshipAccess(database, sourcePayload());
  assert.equal(preview.authoritativeGoogleSheetsProfiles, 1);
  assert.equal(preview.scholarsToUpdate, 1);
  assert.equal(preview.scholarsToCreate, 1);

  await importScholarshipAccess(database, sourcePayload(), { commit: true });
  const scholar = await database.scholarship.driver.get(
    "SELECT id, status FROM scholarship_scholars WHERE scholar_no = 'SCH-2026-0001'"
  );
  assert.equal(scholar.status, "Active");
  const enrollment = await database.scholarship.driver.get(
    `SELECT e.scholarship_status
     FROM scholarship_enrollments e
     JOIN scholarship_academic_years y ON y.id = e.academic_year_id
     WHERE e.scholar_id = ? AND y.label = '2026-2027'`,
    [scholar.id]
  );
  assert.equal(enrollment.scholarship_status, "Active");
  database.close();
});

test("does not assign two Access profiles to the same existing scholar", async () => {
  const database = new BeneficiaryDatabase(tempDbPath());
  const timestamp = new Date().toISOString();
  await database.scholarship.driver.run(
    `INSERT INTO scholarship_scholars
      (scholar_no, last_name, first_name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Active', ?, ?)`,
    ["SCH-2026-0001", "Exact", "Person", timestamp, timestamp]
  );
  const payload = {
    source_file: "collision.accdb",
    tables: [{
      name: "Scholars Profile 2026-2027",
      rows: [
        { Surname: "Exact", "First Name": "Person", "Date of Birth": "2000-01-01" },
        { Surname: "Exakt", "First Name": "Person", "Date of Birth": "2001-01-01" }
      ]
    }]
  };

  const preview = await importScholarshipAccess(database, payload);
  assert.equal(preview.resolvedDatabaseTargetCollisions, 1);
  assert.equal(preview.scholarsToUpdate, 1);
  assert.equal(preview.scholarsToCreate, 1);
  database.close();
});
