#!/usr/bin/env node

/**
 * Secret scan over QA artifacts and QA source.
 *
 * Week 1 exit criterion 13: no credential or capability token may appear in a
 * textual QA artifact. This walks the committed QA layer plus a run's evidence
 * directory and reports every hit; it never prints the matched text.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scanForSecrets } from "../autonomous/lib/receipt.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots = process.argv.slice(2);
if (roots.length === 0) roots.push(path.join(repoRoot, "qa"));

const SCANNABLE = new Set([
  ".md",
  ".json",
  ".jsonl",
  ".mjs",
  ".cjs",
  ".js",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
  ".txt",
  ".csv",
  ".log",
]);

/**
 * Files whose job is to carry secret-*shaped* literals so the redactor and the
 * receipt scanner can be proven to catch them. Their contents are synthetic
 * (documentation examples and locally generated throwaway strings) and are
 * never read from a real credential store. They are reported separately rather
 * than suppressed: an unexpected file appearing here is still a failure, and an
 * expected file that stops matching means a self-test has lost its teeth.
 */
const SYNTHETIC_FIXTURE_FILES = new Set([
  "qa/electron/specs/selftest/evidence-capture.spec.ts",
  "qa/electron/specs/selftest/isolation-and-oracles.spec.ts",
  "qa/harness-selftest/receipt.test.mjs",
]);

let scanned = 0;
const hits = [];
const synthetic = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(target);
      continue;
    }
    if (!SCANNABLE.has(path.extname(entry.name))) continue;
    scanned += 1;
    const result = scanForSecrets(fs.readFileSync(target, "utf8"));
    if (!result.clean) {
      const relative = path.relative(repoRoot, target).replace(/\\/g, "/");
      const entry = { path: relative, rules: [...new Set(result.hits.map((hit) => hit.rule))] };
      if (SYNTHETIC_FIXTURE_FILES.has(relative)) synthetic.push(entry);
      else hits.push(entry);
    }
  }
}

for (const root of roots) {
  const resolved = path.resolve(root);
  if (fs.existsSync(resolved)) walk(resolved);
  else console.log(`[secret-scan] skipped missing root: ${root}`);
}

console.log(`[secret-scan] scanned ${scanned} file(s) across ${roots.length} root(s)`);
console.log(`[secret-scan] synthetic self-test fixtures matching by design: ${synthetic.length}`);
for (const entry of synthetic) console.log(`  (expected) ${entry.path} :: ${entry.rules.join(", ")}`);
console.log(`[secret-scan] findings: ${hits.length}`);
for (const hit of hits) console.log(`  ${hit.path} :: ${hit.rules.join(", ")}`);

// A self-test fixture that no longer trips the scanner means the scanner's own
// coverage has silently regressed, so that is a failure too.
const missing = [...SYNTHETIC_FIXTURE_FILES].filter(
  (file) => !synthetic.some((entry) => entry.path === file) && fs.existsSync(path.join(repoRoot, file)),
);
for (const file of missing) {
  console.log(`  [regression] ${file} no longer contains a detectable synthetic secret`);
}
process.exit(hits.length === 0 && missing.length === 0 ? 0 : 1);
