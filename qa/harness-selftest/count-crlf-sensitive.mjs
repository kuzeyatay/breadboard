#!/usr/bin/env node

/**
 * How many failing source-contract assertions are sensitive to line endings?
 *
 * A worktree checkout under `core.autocrlf=true` writes CRLF, while the
 * developer's tree holds the bytes their editor wrote (LF here). Any assertion
 * that pins a bare `\n` across a line break therefore fails in every QA
 * reconstruction and passes for the developer — a harness artefact wearing the
 * costume of a contract failure.
 *
 * `\s*\n` and `[\s\S]` forms absorb the `\r` and are unaffected, which is why
 * two assertions on the *same file* in the same test can disagree.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const inputPath = path.resolve(process.argv[2] ?? "");
const evidence = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const NEWLINE_ESCAPE = String.fromCharCode(92) + "n";
const TOLERANT_FORMS = [
  String.fromCharCode(92) + "s*" + NEWLINE_ESCAPE,
  "[" + String.fromCharCode(92) + "s" + String.fromCharCode(92) + "S]",
  String.fromCharCode(92) + "s+" + NEWLINE_ESCAPE,
];

const withPattern = evidence.rows.filter((row) => row.assertedPattern);
const sensitive = [];
const tolerant = [];

for (const row of withPattern) {
  const pattern = row.assertedPattern;
  if (!pattern.includes(NEWLINE_ESCAPE)) continue;
  // Strip the forms that already absorb a carriage return, then see whether a
  // bare newline escape survives.
  let stripped = pattern;
  for (const form of TOLERANT_FORMS) stripped = stripped.split(form).join("");
  if (stripped.includes(NEWLINE_ESCAPE)) sensitive.push(row);
  else tolerant.push(row);
}

console.log(`[crlf] assertions carrying a pattern: ${withPattern.length}`);
console.log(`[crlf] CRLF-sensitive (bare newline escape): ${sensitive.length}`);
console.log(`[crlf] newline-tolerant forms: ${tolerant.length}`);
for (const row of sensitive) {
  console.log(`   ${row.testId.replace("dashboard/tests/", "").slice(0, 78)}`);
}

const outPath = process.argv[3];
if (outPath) {
  fs.writeFileSync(
    path.resolve(outPath),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        assertionsWithPattern: withPattern.length,
        crlfSensitive: sensitive.length,
        newlineTolerant: tolerant.length,
        sensitiveTests: sensitive.map((row) => row.testId),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
