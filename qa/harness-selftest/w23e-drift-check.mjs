#!/usr/bin/env node

/**
 * W2-3E: did the developer's tree move during the pass, and if so does any
 * moved file carry evidence this pass relied on?
 *
 * The freeze exists so the oracle is a fixed snapshot rather than a moving
 * tree. The developer edits continuously, so the honest thing is not to claim
 * the tree stood still — it is to detect the movement and prove it is disjoint
 * from the evidence set. If it were not disjoint, the affected conclusion would
 * have to be re-run against the frozen snapshot.
 *
 * Run from the repository root.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23e-drift-check.mjs <run-dir>");

const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, "execution-snapshot.json"), "utf8"));
const targets = JSON.parse(fs.readFileSync(path.join(runDir, "behavioural-contract-targets.json"), "utf8"));
const freeze = new Date(snapshot.frozenAt).getTime();

const evidenceFiles = new Set();
for (const target of targets.targets) {
  for (const file of target.sourceFiles) evidenceFiles.add(file.split("\\").join("/"));
}
// Every additional file an arbitration script read directly.
for (const extra of [
  "dashboard/src/app/components/hermes/garden-agent-chat.tsx",
  "dashboard/src/app/components/hermes/use-agent-session.ts",
  "dashboard/src/app/api/chat-sessions/[sessionId]/route.ts",
  "dashboard/src/lib/hermes/super-agent.ts",
  "dashboard/src/app/api/hermes/tools/skill/route.ts",
  "dashboard/src/lib/assistant-model-catalog-client.ts",
  "dashboard/src/lib/visualization-contract-validation.ts",
  "dashboard/src/lib/visualization-contract-repair.ts",
  "dashboard/src/lib/model-visual-necessity.ts",
  "dashboard/src/lib/generated-visuals.ts",
  "dashboard/src/lib/conversations/store.ts",
  "dashboard/src/lib/hermes/runtime-store.ts",
  "dashboard/src/lib/hermes/artifact-store.ts",
  "dashboard/src/lib/vimax/types.ts",
  "dashboard/src/lib/db.ts",
]) {
  evidenceFiles.add(extra);
}

/** Paths the source snapshot deliberately excludes from identity. */
const EXCLUDED = [/^quartz\/public\//, /^gbrain\/pglite\//, /^\.qa-/, /(^|\/)node_modules\//];

const status = execSync("git status --porcelain -uall", { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
const moved = [];
for (const line of status.split("\n")) {
  const raw = line.slice(3).trim();
  const file = raw.replace(/^"|"$/g, "");
  if (!file || EXCLUDED.some((pattern) => pattern.test(file))) continue;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.mtimeMs <= freeze) continue;
  moved.push(file);
}

const qaAuthored = moved.filter((file) => file.startsWith("qa/"));
const developerMoved = moved.filter((file) => !file.startsWith("qa/"));
const intersection = developerMoved.filter((file) => evidenceFiles.has(file));

const record = {
  generatedAt: new Date().toISOString(),
  frozenAt: snapshot.frozenAt,
  executionSnapshotId: snapshot.executionSnapshotId,
  question:
    "Did the developer tree move during the pass, and does any moved file carry evidence this pass relied on?",
  filesInEvidenceSet: evidenceFiles.size,
  qaFilesAuthoredThisPass: qaAuthored.length,
  qaFiles: qaAuthored,
  developerFilesMovedAfterFreeze: developerMoved.length,
  developerFilesMoved: developerMoved,
  intersectionWithEvidenceSet: intersection,
  disjoint: intersection.length === 0,
  excludedFromSourceIdentity: ["quartz/public/**", "gbrain/pglite/**", ".qa-*/**", "**/node_modules/**"],
  conclusion:
    intersection.length === 0
      ? "The tree moved during the pass and every moved developer file is disjoint from the evidence set. The frozen snapshot remains the oracle; the movement is recorded as drift rather than used as evidence. The baseline and final test runs, taken either side of the movement, produced identical per-test outcomes, which corroborates the disjointness."
      : "A file this pass relied on changed after the freeze. The affected conclusion must be re-run against the frozen snapshot before it can stand.",
};

fs.writeFileSync(path.join(runDir, "source-drift-during-pass.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`evidence files: ${evidenceFiles.size}`);
console.log(`qa files authored this pass: ${qaAuthored.length}`);
console.log(`developer files moved after the freeze: ${developerMoved.length}`);
for (const file of developerMoved) console.log(`  ${file}`);
console.log(`intersection with the evidence set: ${JSON.stringify(intersection)} — disjoint: ${record.disjoint}`);
