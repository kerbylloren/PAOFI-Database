const {
  educationLevel,
  normalizeKey,
  splitSponsorNames,
  sponsorType
} = require("./scholarship-roster-import");

const ACCESS_SOURCE_LABEL = "Scholars Profile SY2026-2027.accdb";
const CURRENT_ACADEMIC_YEAR = "2026-2027";
const GOOGLE_SHEETS_ROSTER_NOTE = "Imported from Scholarship Renewal Checklist 2026-2027.";
const MASTER_TABLE = "Scholars Profile 2026-2027";
const PASS_TABLES = new Set([
  "Elem-JHS Scholars Pass 2026-2027",
  "SHS-College Scholars Pass 2026-2027"
]);

const HOUSEHOLD_COLUMNS = [
  { name: "N1", middle: "Middle Name 1", age: "Age2", birth: "Bdate1", gender: "Gender2", relationship: "Relationship", civil: "Civil Status", education: "Educ Level/Completed", occupation: "Occupation", income: "Monthly Income" },
  { name: "N2", middle: "Middlename2", age: "Age3", birth: "Bdate2", gender: "G1", relationship: "R1", civil: "CS1", education: "EL1", occupation: "O1", income: "MI1" },
  { name: "N3", age: "Age4", birth: "Bdate3", gender: "G2", relationship: "R2", civil: "CS2", education: "EL2", occupation: "O2", income: "MI2" },
  { name: "n4", age: "Age5", birth: "Bdate4", gender: "G3", relationship: "R3", civil: "CS3", education: "EL3", occupation: "O3", income: "MI3" },
  { name: "N5", age: "Age6", birth: "Bdate5", gender: "G4", relationship: "R4", civil: "CS4", education: "EL4", occupation: "O4", income: "MI4" },
  { name: "N6", age: "Age7", birth: "Bdate6", gender: "G5", relationship: "R5", civil: "CS5", education: "EL5", occupation: "O5", income: "MI5" },
  { name: "N7", age: "age8", birth: "Bdate7", gender: "G6", relationship: "R6", civil: "CS6", education: "EL6", occupation: "O6", income: "MI6" }
];

function text(value) {
  return String(value ?? "").trim();
}

function available(value) {
  const normalized = text(value);
  return /^(?:-|none|n\/?a|null|undefined)$/i.test(normalized) ? "" : normalized;
}

function numberValue(value) {
  const normalized = available(value).replace(/[^\d.-]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerValue(value) {
  return Math.max(0, Math.round(numberValue(value)));
}

function normalizeDate(value) {
  const normalized = available(value);
  if (!normalized) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(normalized);
  if (!parts) return "";
  let year = Number(parts[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeContact(value) {
  let digits = available(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("9")) digits = `0${digits}`;
  return digits || available(value);
}

function appendNote(current, addition) {
  const lines = [text(current), text(addition)]
    .filter(Boolean)
    .flatMap(value => value.split("\n").map(line => line.trim()).filter(Boolean));
  return [...new Map(lines.map(line => [normalizeKey(line), line])).values()].join("\n");
}

function sourceName(row = {}) {
  let lastName = available(row.Surname);
  let firstName = available(row["First Name"]);
  let middleName = available(row["Middle Name"]);
  if ((!lastName || !firstName) && available(row["Scholar's Name"])) {
    const combined = available(row["Scholar's Name"]);
    const comma = combined.indexOf(",");
    if (comma >= 0) {
      lastName ||= combined.slice(0, comma).trim();
      firstName ||= combined.slice(comma + 1).trim();
    } else {
      lastName ||= combined;
    }
  }
  return { last_name: lastName, first_name: firstName, middle_name: middleName };
}

function primaryNameToken(value) {
  return normalizeKey(value).split(" ").filter(Boolean)[0] || "";
}

function sortedNameTokens(value) {
  return normalizeKey(value).split(" ").filter(Boolean).sort().join(" ");
}

function levenshtein(leftValue, rightValue) {
  const left = normalizeKey(leftValue);
  const right = normalizeKey(rightValue);
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return row[right.length];
}

function nameScore(left, right) {
  const leftLast = normalizeKey(left.last_name);
  const rightLast = normalizeKey(right.last_name);
  const leftFirst = normalizeKey(left.first_name);
  const rightFirst = normalizeKey(right.first_name);
  if (!leftLast || !leftFirst || !rightLast || !rightFirst) return 0;
  if (leftLast === rightLast && leftFirst === rightFirst) return 100;

  const sameBirthDate = left.birth_date && right.birth_date && left.birth_date === right.birth_date;
  const lastDistance = levenshtein(leftLast, rightLast);
  const firstDistance = levenshtein(leftFirst, rightFirst);
  const samePrimaryFirst = primaryNameToken(leftFirst) === primaryNameToken(rightFirst);
  const sameFirstTokens = sortedNameTokens(leftFirst) === sortedNameTokens(rightFirst);

  if (sameBirthDate && lastDistance <= 1 && samePrimaryFirst) return 98;
  if (leftLast === rightLast && sameFirstTokens) return 96;
  if (leftLast === rightLast && samePrimaryFirst) return 92;
  if (lastDistance <= 1 && leftFirst === rightFirst) return 92;
  if (lastDistance <= 1 && samePrimaryFirst) return 88;
  if (leftLast === rightLast && firstDistance <= 2) return 86;
  if (lastDistance <= 1 && firstDistance <= 2) return 84;
  return 0;
}

function sourceIdentity(row = {}) {
  const name = sourceName(row);
  return {
    ...name,
    birth_date: normalizeDate(row["Date of Birth"])
  };
}

function uniqueMatch(identity, candidates, identityForCandidate) {
  const scored = candidates
    .map(candidate => ({ candidate, score: nameScore(identity, identityForCandidate(candidate)) }))
    .filter(item => item.score >= 84)
    .sort((left, right) => right.score - left.score);
  if (!scored.length) return { match: null, type: "none", score: 0, ambiguous: false };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { match: null, type: "ambiguous", score: scored[0].score, ambiguous: true };
  }
  return {
    match: scored[0].candidate,
    type: scored[0].score === 100 ? "exact" : "fuzzy",
    score: scored[0].score,
    ambiguous: false
  };
}

function tableYear(tableName, row = {}) {
  const explicit = /^(\d{4})-(\d{4})$/.exec(available(row["School Year"]));
  if (explicit) return `${explicit[1]}-${explicit[2]}`;
  return (/(\d{4}-\d{4})/.exec(tableName) || [])[1] || "";
}

function sourceKind(tableName) {
  if (tableName === MASTER_TABLE) return "master";
  if (PASS_TABLES.has(tableName)) return "pass";
  return "historical";
}

function sourcePriority(source) {
  if (source.kind === "master") return 10000;
  if (source.kind === "pass") return 9000;
  return Number((source.year || "").slice(0, 4)) || 0;
}

function sourceValue(canonical, fieldName) {
  for (const source of [...canonical.sources].sort((left, right) => sourcePriority(right) - sourcePriority(left))) {
    const value = available(source.row[fieldName]);
    if (value) return value;
  }
  return "";
}

function joinMemberName(name, middleName) {
  const base = available(name);
  const middle = available(middleName);
  if (!base || !middle || normalizeKey(base).includes(normalizeKey(middle))) return base;
  return `${base} ${middle}`.trim();
}

function sourceHouseholdMembers(row = {}) {
  return HOUSEHOLD_COLUMNS.map((columns, index) => ({
    row_order: index,
    member_name: joinMemberName(row[columns.name], columns.middle ? row[columns.middle] : ""),
    relationship: available(row[columns.relationship]),
    birth_date: normalizeDate(row[columns.birth]),
    age: available(row[columns.age]),
    gender: available(row[columns.gender]),
    civil_status: available(row[columns.civil]),
    education_attainment: available(row[columns.education]),
    occupation: available(row[columns.occupation]),
    school: "",
    monthly_income: numberValue(row[columns.income])
  })).filter(member => member.member_name);
}

function canonicalHouseholdMembers(canonical) {
  return canonical.sources
    .map(source => ({
      source,
      members: sourceHouseholdMembers(source.row)
    }))
    .sort((left, right) => right.members.length - left.members.length || sourcePriority(right.source) - sourcePriority(left.source))[0]?.members || [];
}

function normalizeChapelCode(value) {
  const key = normalizeKey(value);
  const aliases = new Map([
    ["ascension", "ASCENSION"],
    ["benedict", "BENEDICT"],
    ["st benedict", "BENEDICT"],
    ["center", "CENTER"],
    ["mdpp", "CENTER"],
    ["mdpp center", "CENTER"],
    ["fatima", "FATIMA"],
    ["immaculate", "IMMACULATE"],
    ["icc", "IMMACULATE"],
    ["litex", "LITEX"],
    ["lourdes", "LOURDES"],
    ["molave", "MOLAVE"],
    ["st joseph molave", "MOLAVE"],
    ["nazareno", "NAZARENO"],
    ["sagrada", "SAGRADA"],
    ["san isidro", "SAN_ISIDRO"],
    ["sto nino", "STO_NINO"],
    ["sta cruz", "STA_CRUZ"]
  ]);
  return aliases.get(key) || "";
}

function sourceSponsors(row = {}) {
  const values = [
    row["Sponsor's Name"],
    row.Sponsor2,
    row.Sponsor3
  ];
  return [...new Map(values.flatMap(splitSponsorNames).map(name => [normalizeKey(name), name])).values()];
}

function enrollmentFromSources(sources, academicYear) {
  const sorted = [...sources].sort((left, right) => sourcePriority(right) - sourcePriority(left));
  const value = fieldName => {
    for (const source of sorted) {
      const found = available(source.row[fieldName]);
      if (found) return found;
    }
    return "";
  };
  const gradeOrYear = value("Grade/Year Level2") || value("Grade/Year Level");
  const schoolName = value("Name of School") || value("School Last Atended");
  const course = value("Course2") || value("Course");
  const sponsors = [...new Map(sorted.flatMap(source => sourceSponsors(source.row)).map(name => [normalizeKey(name), name])).values()];
  const notes = [
    `Imported from Access source table${sorted.length === 1 ? "" : "s"}: ${[...new Set(sorted.map(source => source.table))].join(", ")}.`,
    value("School Address2") ? `School address: ${value("School Address2")}.` : "",
    value("School Last Atended") ? `Previous school: ${value("School Last Atended")}.` : "",
    value("School Address") ? `Previous school address: ${value("School Address")}.` : "",
    value("Honors/Awards Recived") ? `Honors or awards: ${value("Honors/Awards Recived")}.` : "",
    value("Club/Organization Affiliated") ? `Club or organization: ${value("Club/Organization Affiliated")}.` : "",
    value("General Average") ? `General average: ${value("General Average")}.` : ""
  ].filter(Boolean).join("\n");
  return {
    academic_year: academicYear,
    school_name: schoolName,
    education_level: educationLevel(`${gradeOrYear} ${course}`),
    grade_or_year: gradeOrYear,
    course,
    scholarship_status: academicYear === CURRENT_ACADEMIC_YEAR ? "Active" : "Completed",
    coverage_status: sponsors.length ? "Covered" : "Unassigned",
    notes,
    sponsors,
    commitment_amount_php: Math.max(0, ...sorted.map(source => numberValue(source.row["Sponsored Amount"])))
  };
}

function canonicalEnrollments(canonical) {
  const plans = [];
  if (canonical.currentPassed) {
    const currentSources = canonical.sources.filter(source => source.kind === "master" || source.kind === "pass");
    plans.push(enrollmentFromSources(currentSources, CURRENT_ACADEMIC_YEAR));
  }
  const historicalByYear = new Map();
  for (const source of canonical.sources.filter(item => item.kind === "historical" && item.year)) {
    if (!historicalByYear.has(source.year)) historicalByYear.set(source.year, []);
    historicalByYear.get(source.year).push(source);
  }
  for (const [year, sources] of historicalByYear) {
    plans.push(enrollmentFromSources(sources, year));
  }
  return plans;
}

function canonicalProfile(canonical) {
  const name = sourceIdentity(canonical.sources.sort((left, right) => sourcePriority(right) - sourcePriority(left))[0]?.row || {});
  const members = canonicalHouseholdMembers(canonical);
  const guardian = members.find(member => /guardian/i.test(member.relationship))
    || members.find(member => /mother/i.test(member.relationship))
    || members.find(member => /father/i.test(member.relationship));
  const accessId = sourceValue(canonical, "ID No");
  const sourceStatus = sourceValue(canonical, "Status");
  const scholarSince = sourceValue(canonical, "Scholar Since");
  const sports = sourceValue(canonical, "Sports");
  const referredBy = sourceValue(canonical, "Referred by");
  const photoReference = sourceValue(canonical, "Photo");
  const sourceChapel = sourceValue(canonical, "Chapel");
  const chapelCode = normalizeChapelCode(sourceChapel);
  const notes = [
    `Imported from ${ACCESS_SOURCE_LABEL}.`,
    accessId ? `Access profile ID: ${accessId}.` : "",
    scholarSince ? `Scholar since: ${scholarSince}.` : "",
    sourceStatus ? `Source profile status: ${sourceStatus}.` : "",
    sourceChapel && !chapelCode ? `Source chapel: ${sourceChapel}.` : "",
    sports ? `Sports: ${sports}.` : "",
    referredBy ? `Referred by: ${referredBy}.` : "",
    photoReference ? `Source photo reference: ${photoReference}.` : ""
  ].filter(Boolean).join("\n");
  return {
    ...name,
    access_id: accessId,
    place_of_birth: sourceValue(canonical, "Place of Birth"),
    gender: sourceValue(canonical, "Gender"),
    contact_no: normalizeContact(sourceValue(canonical, "Contact Number")),
    address: sourceValue(canonical, "Home Address"),
    chapel_code: chapelCode,
    source_chapel: sourceChapel,
    hobbies: sourceValue(canonical, "Hobbies"),
    ambition: sourceValue(canonical, "Ambition"),
    special_circumstances: sourceValue(canonical, "Special Circumstances"),
    other_income_source: sourceValue(canonical, "Other Source of Income"),
    birth_order: sourceValue(canonical, "Birth Order"),
    total_siblings: integerValue(sourceValue(canonical, "Total No of Siblings")),
    married_siblings: integerValue(sourceValue(canonical, "Number of Married Siblings")),
    household_contribution: numberValue(sourceValue(canonical, "Contribution")),
    guardian_name: guardian?.member_name || "",
    guardian_relationship: guardian?.relationship || "",
    status: canonical.currentPassed ? "Active" : "Inactive",
    notes,
    household_members: members
  };
}

function prepareScholarshipAccessPayload(payload = {}) {
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const sourceTables = tables.filter(table => table?.name && Array.isArray(table.rows));
  const master = sourceTables.find(table => table.name === MASTER_TABLE);
  if (!master) throw new Error(`The Access database does not contain ${MASTER_TABLE}.`);

  const canonicals = master.rows.map((row, index) => ({
    key: `master:${index}`,
    sources: [{ table: master.name, row, kind: "master", year: CURRENT_ACADEMIC_YEAR }],
    currentPassed: false
  }));
  const ambiguousSourceMatches = [];

  const addRows = (table, kind) => {
    for (const row of table.rows) {
      const identity = sourceIdentity(row);
      const result = uniqueMatch(identity, canonicals, canonical => sourceIdentity(canonical.sources[0].row));
      if (result.ambiguous) {
        ambiguousSourceMatches.push({ table: table.name, name: `${identity.last_name}, ${identity.first_name}` });
        continue;
      }
      const canonical = result.match || {
        key: `${kind}:${table.name}:${canonicals.length}`,
        sources: [],
        currentPassed: false
      };
      if (!result.match) canonicals.push(canonical);
      canonical.sources.push({
        table: table.name,
        row,
        kind,
        year: tableYear(table.name, row)
      });
      if (kind === "pass") canonical.currentPassed = true;
    }
  };

  sourceTables.filter(table => PASS_TABLES.has(table.name)).forEach(table => addRows(table, "pass"));
  sourceTables
    .filter(table => table.name !== MASTER_TABLE && !PASS_TABLES.has(table.name))
    .forEach(table => addRows(table, "historical"));

  return {
    sourceFile: payload.source_file || ACCESS_SOURCE_LABEL,
    sourceTables,
    canonicals: canonicals.map(canonical => ({
      ...canonical,
      profile: canonicalProfile(canonical),
      enrollments: canonicalEnrollments(canonical)
    })),
    ambiguousSourceMatches
  };
}

function nextReferences(rows, prefix, year, count) {
  const highest = rows.reduce((maximum, row) => {
    const value = Number(text(row.reference).split("-").pop());
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, 0);
  return Array.from({ length: count }, (_, index) => `${prefix}-${year}-${String(highest + index + 1).padStart(4, "0")}`);
}

async function runBatch(database, store, statements) {
  const batchSize = 200;
  for (let offset = 0; offset < statements.length; offset += batchSize) {
    const batch = statements.slice(offset, offset + batchSize);
    if (!batch.length) continue;
    if (typeof database?.executeBatch === "function") {
      await database.executeBatch(batch, "write", true);
    } else {
      for (const statement of batch) await store.driver.run(statement.sql, statement.args);
    }
  }
}

function mergeProfile(profile, existing, chapelId) {
  const value = (fieldName, fallback = "") => profile[fieldName] || existing?.[fieldName] || fallback;
  const isGoogleSheetsScholar = text(existing?.notes).includes(GOOGLE_SHEETS_ROSTER_NOTE);
  return {
    last_name: value("last_name"),
    first_name: value("first_name"),
    middle_name: value("middle_name"),
    birth_date: value("birth_date"),
    place_of_birth: value("place_of_birth"),
    gender: value("gender"),
    contact_no: value("contact_no"),
    email: existing?.email || "",
    address: value("address"),
    chapel_id: chapelId || existing?.chapel_id || null,
    hobbies: value("hobbies"),
    ambition: value("ambition"),
    special_circumstances: value("special_circumstances"),
    other_income_source: value("other_income_source"),
    birth_order: value("birth_order"),
    total_siblings: profile.total_siblings || existing?.total_siblings || 0,
    married_siblings: profile.married_siblings || existing?.married_siblings || 0,
    household_contribution: profile.household_contribution || existing?.household_contribution || 0,
    guardian_name: value("guardian_name"),
    guardian_relationship: value("guardian_relationship"),
    guardian_contact: existing?.guardian_contact || "",
    status: isGoogleSheetsScholar ? "Active" : existing?.status === "Active" ? "Inactive" : existing?.status || "Inactive",
    notes: appendNote(existing?.notes, profile.notes)
  };
}

function isGoogleSheetsScholar(scholar) {
  return text(scholar?.notes).includes(GOOGLE_SHEETS_ROSTER_NOTE);
}

async function reconcileCurrentRosterStatuses(database, store, timestamp) {
  const notePattern = `%${GOOGLE_SHEETS_ROSTER_NOTE}%`;
  const inactiveEnrollmentNote = `Not included in the authoritative Google Sheets roster for ${CURRENT_ACADEMIC_YEAR}.`;
  await runBatch(database, store, [
    {
      sql: `UPDATE scholarship_scholars SET
        status = CASE
          WHEN notes LIKE ? THEN 'Active'
          WHEN status = 'Active' THEN 'Inactive'
          ELSE status
        END,
        updated_at = ?`,
      args: [notePattern, timestamp]
    },
    {
      sql: `UPDATE scholarship_enrollments SET
        scholarship_status = CASE
          WHEN scholar_id IN (SELECT id FROM scholarship_scholars WHERE notes LIKE ?) THEN 'Active'
          WHEN scholarship_status = 'Active' THEN 'On Hold'
          ELSE scholarship_status
        END,
        notes = CASE
          WHEN scholar_id NOT IN (SELECT id FROM scholarship_scholars WHERE notes LIKE ?)
            AND notes NOT LIKE ?
          THEN CASE WHEN trim(notes) = '' THEN ? ELSE notes || char(10) || ? END
          ELSE notes
        END,
        updated_at = ?
        WHERE academic_year_id = (
          SELECT id FROM scholarship_academic_years WHERE label = ? LIMIT 1
        )`,
      args: [
        notePattern,
        notePattern,
        `%${inactiveEnrollmentNote}%`,
        inactiveEnrollmentNote,
        inactiveEnrollmentNote,
        timestamp,
        CURRENT_ACADEMIC_YEAR
      ]
    }
  ]);
}

async function importScholarshipAccess(database, payload, { commit = false } = {}) {
  const prepared = prepareScholarshipAccessPayload(payload);
  const store = database.scholarship;
  if (!store) throw new Error("Scholarship database support is unavailable.");

  const [existingScholars, chapels, existingYears, existingEnrollments, existingSponsors] = await Promise.all([
    store.driver.all("SELECT * FROM scholarship_scholars"),
    store.driver.all("SELECT * FROM scholarship_chapels"),
    store.driver.all("SELECT * FROM scholarship_academic_years"),
    store.driver.all("SELECT * FROM scholarship_enrollments"),
    store.driver.all("SELECT * FROM scholarship_sponsors")
  ]);
  const chapelMap = new Map(chapels.map(chapel => [chapel.chapel_code, chapel]));
  const unmatchedChapels = new Set();
  const ambiguousDatabaseMatches = [];
  const existingAssignments = new Map();
  let resolvedDatabaseTargetCollisions = 0;

  for (const canonical of prepared.canonicals) {
    const identity = canonical.profile;
    const match = uniqueMatch(identity, existingScholars, scholar => ({
      last_name: scholar.last_name,
      first_name: scholar.first_name,
      middle_name: scholar.middle_name,
      birth_date: scholar.birth_date
    }));
    if (match.ambiguous) {
      ambiguousDatabaseMatches.push(`${identity.last_name}, ${identity.first_name}`);
      continue;
    }
    if (match.match) {
      const previous = existingAssignments.get(Number(match.match.id));
      if (previous) {
        if (previous.score >= match.score) {
          canonical.existing = null;
          canonical.matchType = "none";
          canonical.matchScore = 0;
        } else {
          previous.canonical.existing = null;
          previous.canonical.matchType = "none";
          previous.canonical.matchScore = 0;
          canonical.existing = match.match;
          canonical.matchType = match.type;
          canonical.matchScore = match.score;
          existingAssignments.set(Number(match.match.id), { canonical, score: match.score });
        }
        resolvedDatabaseTargetCollisions += 1;
      } else {
        canonical.existing = match.match;
        canonical.matchType = match.type;
        canonical.matchScore = match.score;
        existingAssignments.set(Number(match.match.id), { canonical, score: match.score });
      }
    } else {
      canonical.existing = null;
      canonical.matchType = "none";
      canonical.matchScore = 0;
    }
    if (identity.source_chapel && !identity.chapel_code) unmatchedChapels.add(identity.source_chapel);
  }

  const newCanonicals = prepared.canonicals.filter(canonical => !canonical.existing && !ambiguousDatabaseMatches.includes(`${canonical.profile.last_name}, ${canonical.profile.first_name}`));
  const exactMatches = prepared.canonicals.filter(canonical => canonical.matchType === "exact").length;
  const fuzzyMatches = prepared.canonicals.filter(canonical => canonical.matchType === "fuzzy").length;
  const scholarReferences = nextReferences(
    existingScholars.map(scholar => ({ reference: scholar.scholar_no })).filter(row => /^SCH-2026-\d+$/.test(row.reference)),
    "SCH",
    2026,
    newCanonicals.length
  );
  newCanonicals.forEach((canonical, index) => {
    canonical.scholarNo = scholarReferences[index];
  });
  prepared.canonicals.filter(canonical => canonical.existing).forEach(canonical => {
    canonical.scholarNo = canonical.existing.scholar_no;
  });

  const enrollmentPlans = prepared.canonicals.flatMap(canonical =>
    canonical.enrollments.map(enrollment => ({ canonical, enrollment }))
  );
  const yearLabels = [...new Set(enrollmentPlans.map(plan => plan.enrollment.academic_year))].sort();
  const existingYearMap = new Map(existingYears.map(year => [year.label, year]));
  const existingEnrollmentMap = new Map(existingEnrollments.map(enrollment => [
    `${enrollment.scholar_id}:${enrollment.academic_year_id}`,
    enrollment
  ]));
  const sponsorNames = [...new Map(
    enrollmentPlans.flatMap(plan => plan.enrollment.sponsors).map(name => [normalizeKey(name), name])
  ).values()];
  const existingSponsorMap = new Map(existingSponsors.map(sponsor => [normalizeKey(sponsor.sponsor_name), sponsor]));
  const sponsorsToCreate = sponsorNames.filter(name => !existingSponsorMap.has(normalizeKey(name)));

  const result = {
    sourceFile: prepared.sourceFile,
    sourceTables: prepared.sourceTables.length,
    sourceRows: prepared.sourceTables.reduce((sum, table) => sum + table.rows.length, 0),
    canonicalProfiles: prepared.canonicals.length,
    currentPassedProfiles: prepared.canonicals.filter(canonical => canonical.currentPassed).length,
    authoritativeGoogleSheetsProfiles: existingScholars.filter(isGoogleSheetsScholar).length,
    exactMatches,
    fuzzyMatches,
    resolvedDatabaseTargetCollisions,
    scholarsToCreate: newCanonicals.length,
    currentPassedScholarsToCreate: newCanonicals.filter(canonical => canonical.currentPassed).length,
    inactiveScholarsToCreate: newCanonicals.filter(canonical => !canonical.currentPassed).length,
    scholarsToUpdate: prepared.canonicals.filter(canonical => canonical.existing).length,
    householdProfiles: prepared.canonicals.filter(canonical => canonical.profile.household_members.length).length,
    householdMembers: prepared.canonicals.reduce((sum, canonical) => sum + canonical.profile.household_members.length, 0),
    academicYearsToCreate: yearLabels.filter(label => !existingYearMap.has(label)).length,
    enrollmentPlans: enrollmentPlans.length,
    sponsorsToCreate: sponsorsToCreate.length,
    unmatchedChapels: [...unmatchedChapels].sort(),
    ambiguousSourceMatches: prepared.ambiguousSourceMatches,
    ambiguousDatabaseMatches,
    committed: false
  };

  if (!commit) return result;
  if (prepared.ambiguousSourceMatches.length || ambiguousDatabaseMatches.length) {
    throw new Error("The Access import has ambiguous scholar matches. Run a dry preview and resolve them before committing.");
  }

  const timestamp = new Date().toISOString();
  const scholarStatements = [];
  for (const canonical of prepared.canonicals) {
    const profile = canonical.profile;
    const chapelId = chapelMap.get(profile.chapel_code)?.id || null;
    const merged = mergeProfile(profile, canonical.existing, chapelId);
    if (canonical.existing) {
      scholarStatements.push({
        sql: `UPDATE scholarship_scholars SET
          last_name = ?, first_name = ?, middle_name = ?, birth_date = ?, place_of_birth = ?, gender = ?,
          contact_no = ?, email = ?, address = ?, chapel_id = ?, hobbies = ?, ambition = ?,
          special_circumstances = ?, other_income_source = ?, birth_order = ?, total_siblings = ?,
          married_siblings = ?, household_contribution = ?, guardian_name = ?, guardian_relationship = ?,
          guardian_contact = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
        args: [
          merged.last_name, merged.first_name, merged.middle_name, merged.birth_date, merged.place_of_birth, merged.gender,
          merged.contact_no, merged.email, merged.address, merged.chapel_id, merged.hobbies, merged.ambition,
          merged.special_circumstances, merged.other_income_source, merged.birth_order, merged.total_siblings,
          merged.married_siblings, merged.household_contribution, merged.guardian_name, merged.guardian_relationship,
          merged.guardian_contact, merged.status, merged.notes, timestamp, canonical.existing.id
        ]
      });
    } else {
      scholarStatements.push({
        sql: `INSERT INTO scholarship_scholars
          (scholar_no, last_name, first_name, middle_name, birth_date, place_of_birth, gender, contact_no,
           address, chapel_id, hobbies, ambition, special_circumstances, other_income_source, birth_order,
           total_siblings, married_siblings, household_contribution, guardian_name, guardian_relationship,
           status, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          canonical.scholarNo, merged.last_name, merged.first_name, merged.middle_name, merged.birth_date,
          merged.place_of_birth, merged.gender, merged.contact_no, merged.address, merged.chapel_id, merged.hobbies,
          merged.ambition, merged.special_circumstances, merged.other_income_source, merged.birth_order,
          merged.total_siblings, merged.married_siblings, merged.household_contribution, merged.guardian_name,
          merged.guardian_relationship, merged.status, merged.notes, timestamp, timestamp
        ]
      });
    }
  }
  await runBatch(database, store, scholarStatements);

  const refreshedScholars = await store.driver.all("SELECT * FROM scholarship_scholars");
  const scholarByNo = new Map(refreshedScholars.map(scholar => [scholar.scholar_no, scholar]));
  const householdStatements = [];
  for (const canonical of prepared.canonicals) {
    const scholar = scholarByNo.get(canonical.scholarNo);
    if (!scholar || !canonical.profile.household_members.length) continue;
    householdStatements.push({
      sql: "DELETE FROM scholarship_household_members WHERE scholar_id = ?",
      args: [scholar.id]
    });
    for (const member of canonical.profile.household_members) {
      householdStatements.push({
        sql: `INSERT INTO scholarship_household_members
          (scholar_id, row_order, member_name, relationship, birth_date, age, gender, civil_status,
           education_attainment, occupation, school, monthly_income)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          scholar.id, member.row_order, member.member_name, member.relationship, member.birth_date, member.age,
          member.gender, member.civil_status, member.education_attainment, member.occupation, member.school,
          member.monthly_income
        ]
      });
    }
  }
  await runBatch(database, store, householdStatements);

  const yearStatements = yearLabels.filter(label => !existingYearMap.has(label)).map(label => {
    const startYear = Number(label.slice(0, 4));
    return {
      sql: `INSERT INTO scholarship_academic_years
        (label, start_date, end_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        label,
        `${startYear}-06-01`,
        `${startYear + 1}-05-31`,
        label === CURRENT_ACADEMIC_YEAR ? "Active" : "Closed",
        timestamp,
        timestamp
      ]
    };
  });
  await runBatch(database, store, yearStatements);

  const refreshedYears = await store.driver.all("SELECT * FROM scholarship_academic_years");
  const yearMap = new Map(refreshedYears.map(year => [year.label, year]));
  const enrollmentStatements = [];
  for (const plan of enrollmentPlans) {
    const scholar = scholarByNo.get(plan.canonical.scholarNo);
    const year = yearMap.get(plan.enrollment.academic_year);
    if (!scholar || !year) continue;
    const existing = existingEnrollmentMap.get(`${scholar.id}:${year.id}`);
    const scholarshipStatus = plan.enrollment.academic_year === CURRENT_ACADEMIC_YEAR
      ? isGoogleSheetsScholar(scholar) ? "Active" : "On Hold"
      : "Completed";
    if (existing) {
      enrollmentStatements.push({
        sql: `UPDATE scholarship_enrollments SET
          school_name = ?, education_level = ?, grade_or_year = ?, course = ?, scholarship_status = ?,
          coverage_status = ?, notes = ?, updated_at = ? WHERE id = ?`,
        args: [
          plan.enrollment.school_name || existing.school_name,
          plan.enrollment.education_level || existing.education_level,
          plan.enrollment.grade_or_year || existing.grade_or_year,
          plan.enrollment.course || existing.course,
          scholarshipStatus,
          plan.enrollment.coverage_status,
          appendNote(existing.notes, plan.enrollment.notes),
          timestamp,
          existing.id
        ]
      });
    } else {
      enrollmentStatements.push({
        sql: `INSERT INTO scholarship_enrollments
          (scholar_id, academic_year_id, school_name, education_level, grade_or_year, course,
           scholarship_status, renewal_status, coverage_status, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, ?, ?, ?)`,
        args: [
          scholar.id, year.id, plan.enrollment.school_name, plan.enrollment.education_level,
          plan.enrollment.grade_or_year, plan.enrollment.course, scholarshipStatus,
          plan.enrollment.coverage_status, plan.enrollment.notes, timestamp, timestamp
        ]
      });
    }
  }
  await runBatch(database, store, enrollmentStatements);

  const sponsorReferences = nextReferences(
    existingSponsors.map(sponsor => ({ reference: sponsor.sponsor_no })).filter(row => /^SPN-2026-\d+$/.test(row.reference)),
    "SPN",
    2026,
    sponsorsToCreate.length
  );
  await runBatch(database, store, sponsorsToCreate.map((name, index) => ({
    sql: `INSERT INTO scholarship_sponsors
      (sponsor_no, sponsor_type, sponsor_name, consent_status, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'Not Recorded', 'Active', ?, ?, ?)`,
    args: [
      sponsorReferences[index],
      sponsorType(name),
      name,
      `Imported from ${ACCESS_SOURCE_LABEL}.`,
      timestamp,
      timestamp
    ]
  })));

  const [refreshedSponsors, refreshedEnrollments] = await Promise.all([
    store.driver.all("SELECT * FROM scholarship_sponsors"),
    store.driver.all("SELECT * FROM scholarship_enrollments")
  ]);
  const sponsorMap = new Map(refreshedSponsors.map(sponsor => [normalizeKey(sponsor.sponsor_name), sponsor]));
  const enrollmentMap = new Map(refreshedEnrollments.map(enrollment => [
    `${enrollment.scholar_id}:${enrollment.academic_year_id}`,
    enrollment
  ]));
  const existingSponsorships = await store.driver.all("SELECT sponsor_id, enrollment_id FROM scholarship_sponsorships");
  const sponsorshipKeys = new Set(existingSponsorships.map(item => `${item.sponsor_id}:${item.enrollment_id}`));
  const sponsorshipStatements = [];
  for (const plan of enrollmentPlans) {
    const scholar = scholarByNo.get(plan.canonical.scholarNo);
    const year = yearMap.get(plan.enrollment.academic_year);
    const enrollment = enrollmentMap.get(`${scholar?.id}:${year?.id}`);
    if (!enrollment) continue;
    for (const sponsorName of plan.enrollment.sponsors) {
      const sponsor = sponsorMap.get(normalizeKey(sponsorName));
      const key = `${sponsor?.id}:${enrollment.id}`;
      if (!sponsor || sponsorshipKeys.has(key)) continue;
      sponsorshipKeys.add(key);
      sponsorshipStatements.push({
        sql: `INSERT INTO scholarship_sponsorships
          (sponsor_id, enrollment_id, commitment_amount_php, frequency, status, notes, created_at, updated_at)
          VALUES (?, ?, ?, 'Annual', ?, ?, ?, ?)`,
        args: [
          sponsor.id,
          enrollment.id,
          plan.enrollment.commitment_amount_php,
          plan.enrollment.academic_year === CURRENT_ACADEMIC_YEAR ? "Active" : "Completed",
          `Imported from ${ACCESS_SOURCE_LABEL}.`,
          timestamp,
          timestamp
        ]
      });
    }
  }
  await runBatch(database, store, sponsorshipStatements);
  await reconcileCurrentRosterStatuses(database, store, timestamp);
  await runBatch(database, store, [{
    sql: `INSERT INTO scholarship_audit_log
      (user_id, action, entity_type, entity_id, summary, created_at)
      VALUES (NULL, 'access_import', 'scholars', NULL, ?, ?)`,
    args: [
      `${prepared.canonicals.length} canonical scholar profiles processed from ${ACCESS_SOURCE_LABEL}.`,
      timestamp
    ]
  }]);

  result.sponsorshipsCreated = sponsorshipStatements.length;
  result.committed = true;
  return result;
}

module.exports = {
  ACCESS_SOURCE_LABEL,
  CURRENT_ACADEMIC_YEAR,
  canonicalHouseholdMembers,
  importScholarshipAccess,
  nameScore,
  normalizeContact,
  normalizeDate,
  prepareScholarshipAccessPayload,
  sourceHouseholdMembers
};
