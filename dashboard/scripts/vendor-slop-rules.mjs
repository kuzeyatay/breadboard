#!/usr/bin/env node
/**
 * Regenerate src/lib/prose-score/rules.base.ts from the soundshuman clone.
 *
 * Run this after pulling the clone. It only ever rewrites the base pack;
 * Breadboard tuning lives in rules.breadboard.ts and is never touched, so an
 * upstream rule change stays a reviewable one-file diff.
 *
 *   node dashboard/scripts/vendor-slop-rules.mjs [--clone <path>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const cloneArg = process.argv.indexOf("--clone");
const clone =
  cloneArg !== -1 && process.argv[cloneArg + 1]
    ? path.resolve(process.argv[cloneArg + 1])
    : process.env.SOUNDSHUMAN_DIR
      ? path.resolve(process.env.SOUNDSHUMAN_DIR)
      : path.join(repoRoot, "soundshuman");

const rulesPath = path.join(clone, "rules", "slop-rules.json");
if (!fs.existsSync(rulesPath)) {
  console.error(
    `no rule pack at ${rulesPath}\n` +
      `clone it first: git clone https://github.com/aashaexo/soundshuman ${clone}`,
  );
  process.exit(1);
}

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

let sha = "unknown";
try {
  sha = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // A tarball copy with no .git is fine; provenance just degrades to "unknown".
}

rules.source =
  `Vendored from aashaexo/soundshuman rules/slop-rules.json @ ${sha} (MIT). ` +
  `Regenerate with scripts/vendor-slop-rules.mjs.`;

const out = `/**
 * Base slop rule pack, vendored from soundshuman.
 *
 * Kept as a TypeScript module rather than a JSON file on purpose: the unslop
 * integration once shipped broken because a data directory was never staged by
 * desktop/scripts/prepare-app-resources.mjs and the packaged app silently found
 * nothing. A module cannot go missing at package time.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   node dashboard/scripts/vendor-slop-rules.mjs
 * Breadboard-specific tuning belongs in rules.breadboard.ts, not here, so a
 * future upstream pull stays a clean overwrite.
 */

import type { SlopRules } from './engine.ts';

export const BASE_SLOP_RULES: SlopRules = ${JSON.stringify(rules, null, 2)};
`;

const target = path.join(
  repoRoot,
  "dashboard",
  "src",
  "lib",
  "prose-score",
  "rules.base.ts",
);
fs.writeFileSync(target, out);
console.log(`wrote ${path.relative(repoRoot, target)} from ${sha.slice(0, 12)}`);
