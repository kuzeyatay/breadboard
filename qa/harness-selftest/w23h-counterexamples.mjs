#!/usr/bin/env node

/**
 * W2-3H — non-vacuity for every assertion changed this pass.
 *
 * Four assertions were retargeted, so four contracts must be challenged
 * independently. A single generic counterexample would not do: each one guards
 * a different link in the same chain, and a replacement that cannot fail is not
 * a replacement.
 *
 * Mutations are applied to local stand-in strings, never to product source.
 *
 * Run from the repository root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const outPath = path.resolve(process.argv[2] ?? "counterexample-results.json");
const results = [];
const proof = (target, mutation, breaks, detected, detail) =>
  results.push({ target, mutation, breaks, detected, detail });

// The four replacement assertions, as predicates over file content.
const assertions = {
  "branch-history: the sessions route reaches the extracted presenter": (route) =>
    /from "@\/lib\/hermes\/session-presentation\.ts"/.test(route),
  "branch-history: the presenter applies the branch projection": (presentation) =>
    /projectConversationBranchMessages\(\s*listConversationMessages\(conversation\.id\),?\s*\)\.map/.test(presentation),
  "memory-badge: the presenter reads the memory evidence": (presentation) =>
    /memoryUpdatedClientMessageIdsForSession\(runtime\.id\)/.test(presentation),
  "quartz-parity: one presenter, reached by both surfaces": (presentation) =>
    /presentConversationMessage/.test(presentation),
};

// --- 1. the route stops reaching the shared presenter --------------------
{
  const good = 'import { presentHermesSessionDetail } from "@/lib/hermes/session-presentation.ts";\nexport async function GET() {}';
  const bad = 'function presentInline() { /* a second implementation */ }\nexport async function GET() {}';
  const check = assertions["branch-history: the sessions route reaches the extracted presenter"];
  proof(
    "branch-history wiring",
    "the route reimplements presentation inline instead of importing the shared module",
    "the two surfaces would drift apart, which is exactly what the extraction prevents",
    check(good) === true && check(bad) === false,
    "control accepted, inline reimplementation rejected",
  );
}

// --- 2. the projection is dropped from the presenter ---------------------
{
  const good =
    "const messages = projectConversationBranchMessages(\n  listConversationMessages(conversation.id),\n).map(presentConversationMessage);";
  const bad = "const messages = listConversationMessages(conversation.id).map(presentConversationMessage);";
  const check = assertions["branch-history: the presenter applies the branch projection"];
  proof(
    "branch-history projection",
    "the presenter stops projecting and returns every regenerated attempt",
    "a reader would see abandoned answers as if they were current",
    check(good) === true && check(bad) === false,
    "control accepted, unprojected transcript rejected",
  );
}

// --- 3. the memory evidence lookup is dropped ----------------------------
{
  const good = "const memoryUpdated = memoryUpdatedClientMessageIdsForSession(runtime.id);";
  const bad = "const memoryUpdated = new Set();";
  const check = assertions["memory-badge: the presenter reads the memory evidence"];
  proof(
    "memory-badge evidence",
    "the restored path stops consulting the memory evidence",
    "a restored transcript would silently lose the memory badges a live one shows",
    check(good) === true && check(bad) === false,
    "control accepted, empty-set substitute rejected",
  );
}

// --- 4. a second presenter appears ---------------------------------------
{
  const good = "export function presentConversationMessage(row) { return row; }";
  const bad = "export function presentMessageForQuartz(row) { return row; }";
  const check = assertions["quartz-parity: one presenter, reached by both surfaces"];
  proof(
    "quartz-parity shared presenter",
    "a surface-specific presenter replaces the shared one",
    "duplication is the failure mode here, and it can be behaviourally identical on every sampled input while still being the defect",
    check(good) === true && check(bad) === false,
    "control accepted, surface-specific duplicate rejected",
  );
}

// --- 5. the retarget must not be satisfiable by dead code ----------------
{
  // The dead-code rule: a replacement that a stray import or unused symbol
  // could satisfy is not protecting anything.
  const deadImport = 'import "@/lib/hermes/session-presentation.ts";\n// nothing else uses it';
  const check = assertions["branch-history: the sessions route reaches the extracted presenter"];
  proof(
    "dead-code sensitivity",
    "an unused import of the shared module",
    "a wiring assertion satisfiable by a stray import would be theatre",
    check(deadImport) === false,
    "recorded honestly: this assertion checks a named import, and a bare side-effect import does NOT satisfy it — but a genuinely unused named import would. The behavioural half lives in the same test files, which execute the real projection and the real evidence lookup.",
  );
}

const allDetected = results.every((entry) => entry.detected);
const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Each changed assertion was re-run against a stand-in that violates its own invariant. Four assertions, four independent challenges; a single shared counterexample would not have distinguished them.",
  total: results.length,
  detected: results.filter((entry) => entry.detected).length,
  results,
  nonVacuous: allDetected,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
for (const entry of results) {
  console.log((entry.detected ? "CAUGHT  " : "MISSED  ") + entry.target + " — " + entry.mutation);
}
console.log("non-vacuous: " + allDetected);
process.exit(allDetected ? 0 : 1);
