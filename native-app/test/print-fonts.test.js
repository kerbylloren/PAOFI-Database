const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test("keeps print form text at least 10px", () => {
  const fontSizes = [...appSource.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g)]
    .map(match => Number(match[1]));

  assert.ok(fontSizes.length > 0);
  assert.deepEqual(fontSizes.filter(size => size < 10), []);
  assert.match(appSource, /function enforceMinimumPrintFontSize\(printDocument, minimumSize = 10\)/);
});
