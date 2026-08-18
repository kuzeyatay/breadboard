#!/usr/bin/env node

/**
 * W2-3C: split the genuine contract failures by what they actually protect.
 *
 * "Genuine" here means failing in the developer's live tree *and* in the
 * reconstruction, so neither environment nor snapshot drift explains them. Those
 * are the only failures where asking "is the product wrong or the test wrong?"
 * is a well-posed question.
 *
 * The families are assigned from the asserted pattern's semantics, not from the
 * test's name:
 *
 *   ROUTE_QUERY   a URL path or query string a consumer must be able to parse
 *   PROJECTION    which fields survive a data transform into a consumer
 *   UI_SHAPE      JSX structure, class names, local handler wiring
 *   PROSE_COPY    user-visible or model-visible literal text
 *   BEHAVIOURAL   a non-source assertion: value equality, thrown error
 */

import * as fs from "node:fs";
import * as path from "node:path";

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const reviewPath = path.resolve(arg("--review", ""));
const evidencePath = path.resolve(arg("--evidence", ""));
const partitionPath = path.resolve(arg("--partition", ""));
const outPath = path.resolve(arg("--out", "root4b-adjudication.json"));

const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const partition = JSON.parse(fs.readFileSync(partitionPath, "utf8"));
const evidenceByTest = new Map(evidence.rows.map((row) => [row.testId, row]));
const genuine = new Set(partition.genuineContractFailures);

const ROUTE_QUERY = /\/api\/|\?surface=|encodeURIComponent|skills\/(search|detail|install|promote)|href=/;
const PROJECTION = /project\w+|listConversationMessages|priorRequests|normalize\w+Reference|memoryUpdated\w+|presentConversationMessage|\.map\(/;
const UI_SHAPE = /className=|<div|<dt|<dd|disabled=\{|removeEventListener|addEventListener|defaultOpenHeight|isOpen\s*\?|timeline\.length|useState|setLearn/;

function family(row) {
  const found = evidenceByTest.get(row.testId) ?? {};
  const pattern = found.assertedPattern ?? "";
  if (row.failureType !== "SOURCE_TEXT_REGEX") return "BEHAVIOURAL";
  if (ROUTE_QUERY.test(pattern)) return "ROUTE_QUERY";
  if (PROJECTION.test(pattern)) return "PROJECTION";
  if (UI_SHAPE.test(pattern)) return "UI_SHAPE";
  // A pattern of ordinary words with no code punctuation is asserted copy.
  const body = pattern.replace(/^\//, "").replace(/\/[a-z]*$/, "");
  if (/^[\w\s.,'"|:()-]+$/.test(body)) return "PROSE_COPY";
  return "UI_SHAPE";
}

const FAMILY_GUIDANCE = {
  ROUTE_QUERY: {
    likelyContract: "REAL_CONTRACT",
    why: "A route or query string is a boundary a separate consumer must parse. Changing it changes externally observable behaviour, and encoding mistakes here are how cross-scope leaks happen.",
    nextEvidence:
      "Execute the route builder with a normal identifier, a space, a Unicode name, a slash and an already-encoded value, and compare against what the consumer parses.",
  },
  PROJECTION: {
    likelyContract: "REAL_CONTRACT",
    why: "Which fields survive a projection is a contract with whatever renders or persists them; a dropped field is invisible until a consumer needs it.",
    nextEvidence: "Run the projection on a known object and compare the field set against every call site.",
  },
  UI_SHAPE: {
    likelyContract: "IMPLEMENTATION_COUPLING",
    why: "JSX structure, class names and local handler wiring are techniques. Equivalent behaviour survives a refactor, so the assertion usually pins how rather than what.",
    nextEvidence:
      "Identify the behaviour the syntax is standing in for and assert that instead, at a stable boundary.",
  },
  PROSE_COPY: {
    likelyContract: "UNCLEAR",
    why: "Literal copy can be a real contract (guidance a model must receive, a label a user reads) or incidental wording.",
    nextEvidence: "Determine whether a consumer depends on the exact string or only on its presence.",
  },
  BEHAVIOURAL: {
    likelyContract: "REAL_CONTRACT",
    why: "A value comparison or thrown error is already behavioural; the assertion is not pinning syntax.",
    nextEvidence: "Reproduce the value or error and decide whether the product or the expectation is wrong.",
  },
};

const rows = review.rows
  .filter((row) => genuine.has(row.testId))
  .map((row) => {
    const kind = family(row);
    const found = evidenceByTest.get(row.testId) ?? {};
    return {
      testId: row.testId,
      testFile: row.testFile,
      previousRootCauseId: row.rootCauseId,
      subRoot: `ROOT-4B-${kind}`,
      family: kind,
      assertion: found.assertedPattern ?? row.failureSignature.slice(0, 160),
      failureType: row.failureType,
      failsInLiveTree: true,
      failsInReconstruction: true,
      likelyContractType: FAMILY_GUIDANCE[kind].likelyContract,
      whyThisFamily: FAMILY_GUIDANCE[kind].why,
      evidenceStillNeeded: FAMILY_GUIDANCE[kind].nextEvidence,
      classification: "UNRESOLVED_CONTRACT",
      confidence: "MEDIUM",
      notes:
        "Confirmed a genuine contract question: it fails in the developer's own tree as well as in the reconstruction, so neither the execution environment nor snapshot drift explains it.",
    };
  });

const byFamily = {};
for (const row of rows) byFamily[row.family] = (byFamily[row.family] ?? 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  scope:
    "The failures that reproduce in both the developer's live tree and the QA reconstruction. Environment-only failures are excluded and handled separately.",
  total: rows.length,
  byFamily,
  familyGuidance: FAMILY_GUIDANCE,
  subRoots: Object.keys(byFamily).map((kind) => ({
    subRoot: `ROOT-4B-${kind}`,
    tests: byFamily[kind],
    likelyContractType: FAMILY_GUIDANCE[kind].likelyContract,
    status: "SPLIT_AND_CHARACTERISED",
    remaining: "per-test adjudication",
  })),
  rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[families] genuine contract failures: ${rows.length}`);
for (const [kind, count] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ROOT-4B-${kind}  (likely ${FAMILY_GUIDANCE[kind].likelyContract})`);
}
