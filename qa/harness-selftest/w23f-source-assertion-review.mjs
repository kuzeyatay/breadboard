#!/usr/bin/env node

/**
 * Source-assertion review helper.
 *
 * Reports candidate policy violations in the dashboard test suite. It is a
 * reporting tool, not a gate: it is wired into nothing, exits 0 whatever it
 * finds, and is meant to be read by a person. A linter confident enough to
 * block a legitimate S1 assertion would cost more than the coupling it removes,
 * and this cannot tell an S1 assertion from an I1 one without knowing intent.
 *
 * What it can do is surface the two shapes the policy is unambiguous about:
 *
 *   dead-class      an ASSERTION requiring a CSS class that no component and no
 *                   stylesheet under dashboard/src contains, so it could only be
 *                   satisfied by adding markup nothing consumes.
 *
 *   sliced-window   a regex applied to a slice of a file taken between two
 *                   markers, which silently widens as the file grows.
 *
 * Only lines containing an `assert.` call are considered for dead classes. A
 * class name in fixture data is not a claim about the product, and treating it
 * as one is how a review helper becomes noise nobody reads.
 *
 * Usage: node qa/harness-selftest/w23f-source-assertion-review.mjs [--json out.json]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const testsDir = path.join(repoRoot, "dashboard", "tests");
const jsonFlag = process.argv.indexOf("--json");
const outPath = jsonFlag === -1 ? null : path.resolve(process.argv[jsonFlag + 1]);

function walk(dir, filter, depth = 12) {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(absolute, filter, depth - 1);
    return filter(entry.name) ? [absolute] : [];
  });
}

const sourceRoot = path.join(repoRoot, "dashboard", "src");
const sourceText = walk(sourceRoot, (name) => /\.(tsx?|css)$/.test(name))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

const testFiles = walk(testsDir, (name) => name.endsWith(".test.mjs"), 2);
const findings = [];

for (const testFile of testFiles) {
  const relative = path.relative(repoRoot, testFile).split(path.sep).join("/");
  const lines = fs.readFileSync(testFile, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    if (/\bassert\./.test(line)) {
      for (const match of line.matchAll(/["'/\\.]((?:bb|neu)-[a-z0-9-]{3,})\b/g)) {
        const className = match[1];
        const used = new RegExp(`["'\`\\s.]${className}[\\s"'\`:{,)]`).test(sourceText);
        if (!used) {
          // A doesNotMatch assertion is SUPPOSED to name an absent class: that
          // is a regression guard, not dead code. Label it rather than counting
          // it as a violation.
          const negative = /doesNotMatch|\.includes\([^)]*\)\s*,\s*false/.test(line);
          findings.push({
            kind: negative ? "dead-class-negative-guard" : "dead-class",
            file: relative,
            line: index + 1,
            detail: `${className} appears in no component or stylesheet under dashboard/src`,
            policy:
              "Never satisfy an assertion by adding dead code. If the only way to pass is markup nothing consumes, the assertion is wrong.",
            text: line.trim().slice(0, 120),
          });
        }
      }
    }

    const nearby = lines.slice(Math.max(0, index - 6), index + 1).join("\n");
    if (/\.slice\(\s*\w*(?:Start|start|index)\b/.test(line) && /indexOf\(|lastIndexOf\(/.test(nearby)) {
      findings.push({
        kind: "sliced-window",
        file: relative,
        line: index + 1,
        detail: "a regex is applied to a slice taken between two markers",
        policy: "Parse, do not slice. A text window silently widens as the file grows.",
        text: line.trim().slice(0, 120),
      });
    }
  });
}

const byKind = findings.reduce((accumulator, entry) => {
  accumulator[entry.kind] = (accumulator[entry.kind] ?? 0) + 1;
  return accumulator;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  policy: "qa/autonomous/SOURCE_ASSERTION_POLICY.md",
  reportingOnly: true,
  wiredIntoAnyGate: false,
  testFilesScanned: testFiles.length,
  byKind,
  findings,
  caveat:
    "Candidates, not verdicts. A dead class may be a genuinely missing implementation rather than a wrong assertion, and a sliced window may be intentional. Read before acting.",
};

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

console.log(`[source-assertion-review] ${testFiles.length} test files scanned`);
for (const [kind, count] of Object.entries(byKind)) console.log(`  ${kind}: ${count}`);
for (const entry of findings.slice(0, 20)) {
  console.log(`  ${entry.kind}  ${entry.file}:${entry.line}  ${entry.detail}`);
}
if (findings.length > 20) console.log(`  ... and ${findings.length - 20} more`);
console.log("reporting only; exit 0 regardless of findings");
