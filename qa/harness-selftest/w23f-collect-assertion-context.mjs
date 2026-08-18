#!/usr/bin/env node

/**
 * W23F / B4 — collect each held source-shape assertion with the comment that
 * explains why it was written.
 *
 * Classifying an assertion by its regex alone is how a policy ends up sorting
 * by syntax instead of by intent. This repository documents intent in comments
 * next to the assertion, so the comment is pulled along with it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const outPath = path.resolve(process.argv[2] ?? "assertion-context.json");

const held = [];

const w23c = JSON.parse(
  fs.readFileSync(
    ".qa-results/week2-dashboard-contract-resolution/w23c-20260817T194135Z/root4b-adjudication.json",
    "utf8",
  ),
);
for (const row of w23c.rows.filter((entry) => entry.subRoot === "ROOT-4B-UI_SHAPE")) {
  held.push({ group: "UI_SHAPE", testId: row.testId, testFile: row.testFile, assertion: row.assertion });
}

const w23d = JSON.parse(
  fs.readFileSync(
    ".qa-results/week2-executable-contract-arbitration/w23d-20260817T200225Z/executable-contract-targets.json",
    "utf8",
  ),
);
for (const target of w23d.targets) {
  held.push({
    group: target.subRoot.replace("ROOT-4B-", ""),
    testId: target.testId,
    testFile: target.testFile,
    assertion: target.assertion,
  });
}

held.push({
  group: "ROOT-5",
  testId: "tests/vlm-ocr-figures.test.mjs :: figureCount assertion",
  testFile: "dashboard/tests/vlm-ocr-figures.test.mjs",
  assertion: "vlmFigureCount identifier",
});

const w23e = JSON.parse(
  fs.readFileSync(
    ".qa-results/week2-behavioural-contract-arbitration/w23e-20260817T202455Z/test-corrections.json",
    "utf8",
  ),
);
for (const correction of w23e.corrections) {
  held.push({
    group: "W23E-CATEGORY-" + correction.category,
    testId: correction.testId,
    testFile: correction.testId.split(" :: ")[0].replace(/^tests\//, "dashboard/tests/"),
    assertion: correction.oldContract,
    subRoot: correction.subRoot,
    classification: correction.classification,
  });
}

/** The comment block immediately above the first line matching a needle. */
function contextFor(testFile, needleParts) {
  const absolute = path.join(repoRoot, testFile);
  if (!fs.existsSync(absolute)) return { found: false };
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (needleParts.some((part) => part && lines[i].includes(part))) {
      index = i;
      break;
    }
  }
  if (index === -1) return { found: false };
  const start = Math.max(0, index - 8);
  return {
    found: true,
    line: index + 1,
    context: lines.slice(start, Math.min(lines.length, index + 3)).join("\n"),
  };
}

/** Turn a stored regex-ish assertion into literal fragments worth searching for. */
function needles(assertion) {
  if (!assertion) return [];
  const stripped = assertion.replace(/^\//, "").replace(/\/$/, "");
  const literals = stripped
    .split(/\[\\s\\S\]\*\??|\\s\*|\|/)
    .map((part) => part.replace(/\\([^\\])/g, "$1").replace(/[\^$()?*+{}]/g, "").trim())
    .filter((part) => part.length >= 8);
  return literals.slice(0, 3);
}

const rows = held.map((entry) => ({
  ...entry,
  ...contextFor(entry.testFile, needles(entry.assertion)),
}));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, rows }, null, 2) + "\n", "utf8");

for (const row of rows) {
  console.log("=".repeat(78));
  console.log("[" + row.group + "] " + row.testId);
  console.log("  assertion: " + String(row.assertion).slice(0, 100));
  if (row.found) {
    console.log("  " + row.testFile + ":" + row.line);
    console.log(
      row.context
        .split("\n")
        .map((line) => "    " + line)
        .join("\n"),
    );
  } else {
    console.log("  (assertion text not located in file)");
  }
}
console.log("total held: " + rows.length);
