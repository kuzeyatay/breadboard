#!/usr/bin/env node

/**
 * W2-3 evidence gathering.
 *
 * A source-contract assertion fails when a regex stops matching a source file.
 * That alone says nothing about whether the product regressed or the test froze
 * an implementation detail. What distinguishes them is *how* the source moved:
 *
 *   the asserted identifier is gone entirely      → the contract may be real and broken
 *   the identifier is present, the shape changed  → likely implementation coupling
 *   the file itself is gone                       → a rename or removal to trace
 *
 * This extracts, per failure: the regex the test asserted, the file it asserted
 * against, whether that file still exists, whether the regex's literal
 * identifiers still appear in it, and the nearby lines that contain them. The
 * classification stays a human judgement; this makes it a judgement about
 * evidence rather than about a test name.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inventoryPath = path.resolve(arg("--inventory", ""));
const outPath = path.resolve(arg("--out", path.join(repoRoot, "contract-evidence.json")));

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

/** The regex literal node:test prints in `did not match the regular expression /…/`. */
function assertedPattern(signature) {
  const match = /did not match the regular expression (\/.*\/[a-z]*)\.?\s*(?:Input:)?/.exec(signature);
  return match ? match[1] : null;
}

/**
 * Literal identifier-ish fragments inside a regex, with escaping removed. These
 * are what we look for in the current source: if `handleCreateClusterFolder`
 * still exists but the surrounding syntax changed, that is a very different
 * finding from the identifier having disappeared.
 */
function literalsFrom(pattern) {
  if (!pattern) return [];
  const body = pattern.replace(/^\//, "").replace(/\/[a-z]*$/, "");
  const cleaned = body
    .replace(/\\([\\/.^$*+?()[\]{}|-])/g, "$1")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((\?:)?/g, " ")
    .replace(/[)?*+|]/g, " ")
    .replace(/\\[sSdDwWbn]/g, " ")
    .replace(/\{\d+(,\d+)?\}/g, " ");
  return [...new Set(cleaned.split(/\s+/).filter((token) => /^[A-Za-z_][A-Za-z0-9_.-]{4,}$/.test(token)))];
}

/** Files the test reads directly, which is what a source-contract test asserts on. */
function assertedFiles(testFileRelative) {
  const absolute = path.join(repoRoot, testFileRelative);
  let text;
  try {
    text = fs.readFileSync(absolute, "utf8");
  } catch {
    return [];
  }
  // These suites read source through small local helpers rather than a single
  // idiom: `source("../src/…")`, `read("dashboard/src/…")` off a repo root, and
  // bare `new URL`/`readFileSync`. Collect every quoted path that names a source
  // file and resolve it both ways, keeping whichever exists.
  const candidates = new Set();
  for (const match of text.matchAll(/["'`](\.{1,2}\/[^"'`]+\.(?:ts|tsx|mjs|cjs|js|jsx|md|json))["'`]/g)) {
    candidates.add(match[1]);
  }
  for (const match of text.matchAll(
    /["'`]((?:dashboard|desktop|qa|gbrain-adapter|ui-tars-adapter)\/[^"'`]+\.(?:ts|tsx|mjs|cjs|js|jsx|md|json))["'`]/g,
  )) {
    candidates.add(match[1]);
  }

  const resolved = new Set();
  for (const specifier of candidates) {
    const fromTest = path.resolve(path.dirname(absolute), specifier);
    const fromRoot = path.resolve(repoRoot, specifier);
    for (const candidate of [fromTest, fromRoot]) {
      try {
        if (fs.statSync(candidate).isFile()) {
          resolved.add(path.relative(repoRoot, candidate).replaceAll("\\", "/"));
          break;
        }
      } catch {
        // try the next resolution base
      }
    }
  }
  return [...resolved];
}

function locateLiterals(files, literals) {
  const evidence = [];
  for (const relative of files) {
    const absolute = path.join(repoRoot, relative);
    let text;
    try {
      text = fs.readFileSync(absolute, "utf8");
    } catch {
      evidence.push({ file: relative, exists: false, literals: {} });
      continue;
    }
    const lines = text.split(/\r?\n/);
    const found = {};
    for (const literal of literals) {
      const hits = [];
      lines.forEach((line, index) => {
        if (hits.length < 3 && line.includes(literal)) {
          hits.push({ line: index + 1, text: line.trim().slice(0, 160) });
        }
      });
      found[literal] = { present: hits.length > 0, hits };
    }
    evidence.push({ file: relative, exists: true, bytes: text.length, literals: found });
  }
  return evidence;
}

const rows = [];
for (const failure of inventory.failures) {
  if (failure.verificationEligibility !== "ELIGIBLE") continue;
  if (failure.cascadeStatus !== "INDEPENDENT_FAILURE") continue;

  const pattern = assertedPattern(failure.failureSignature);
  const literals = literalsFrom(pattern);
  const files = assertedFiles(failure.testFile);
  const evidence = literals.length > 0 && files.length > 0 ? locateLiterals(files, literals) : [];

  const allLiterals = evidence.flatMap((entry) =>
    Object.entries(entry.literals).map(([literal, info]) => ({ literal, present: info.present })),
  );
  const presentCount = allLiterals.filter((entry) => entry.present).length;
  const absentLiterals = [...new Set(allLiterals.filter((entry) => !entry.present).map((entry) => entry.literal))];

  let evidenceHint = null;
  if (failure.failureType === "SOURCE_TEXT_REGEX") {
    if (evidence.length === 0) evidenceHint = "NO_ASSERTED_FILE_RESOLVED";
    else if (evidence.some((entry) => !entry.exists)) evidenceHint = "ASSERTED_FILE_MISSING";
    else if (absentLiterals.length === 0 && presentCount > 0) {
      evidenceHint = "ALL_IDENTIFIERS_PRESENT_SHAPE_CHANGED";
    } else if (presentCount === 0 && absentLiterals.length > 0) {
      evidenceHint = "IDENTIFIERS_ABSENT";
    } else {
      evidenceHint = "PARTIAL_IDENTIFIERS_PRESENT";
    }
  }

  rows.push({
    testId: failure.testId,
    testFile: failure.testFile,
    testName: failure.testName,
    failureType: failure.failureType,
    failureSignature: failure.failureSignature.slice(0, 220),
    assertedPattern: pattern,
    assertedLiterals: literals,
    assertedFiles: files,
    literalEvidence: evidence,
    identifiersPresent: presentCount,
    identifiersAbsent: absentLiterals,
    evidenceHint,
  });
}

const hintCounts = {};
for (const row of rows) hintCounts[row.evidenceHint ?? row.failureType] = (hintCounts[row.evidenceHint ?? row.failureType] ?? 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: inventory.executionSnapshot.executionSnapshotId,
  reviewed: rows.length,
  evidenceHintCounts: hintCounts,
  note:
    "Evidence only. `ALL_IDENTIFIERS_PRESENT_SHAPE_CHANGED` means the asserted names still exist and the surrounding syntax moved, which points at implementation coupling. `IDENTIFIERS_ABSENT` means the asserted thing is genuinely gone and needs a contract decision.",
  rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[evidence] enriched ${rows.length} eligible failures`);
for (const [hint, count] of Object.entries(hintCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${hint}`);
}
console.log(`[evidence] wrote ${path.relative(repoRoot, outPath).replaceAll("\\", "/")}`);
