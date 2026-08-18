#!/usr/bin/env node

/**
 * Non-vacuity for the PROJECTION contract.
 *
 * The invariants hold against current code; that alone proves nothing about
 * whether they can detect a regression. Each mutation below is a real semantic
 * violation of branch projection, applied to a local stand-in so the product is
 * never touched, and each must be caught.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "projection-counterexamples.json");
const dashboardRoot = process.cwd();
const { projectConversationBranchMessages } = await import(
  pathToFileURL(path.join(dashboardRoot, "src/lib/conversations/branch-history.ts")).href
);

const branchMetadata = JSON.stringify({ branchGroupId: "turn-2" });
const row = (id, clientMessageId, role, content, previousId, metadata) => ({
  id, conversation_id: 1, client_message_id: clientMessageId, role, content,
  previous_message_id: previousId, metadata: metadata ?? null,
  created_at: new Date(1700000000000 + id * 1000).toISOString(),
  updated_at: new Date(1700000000000 + id * 1000).toISOString(),
});
const attempts = [
  row(1, "turn-1", "user", "First question", null, null),
  row(2, "turn-1", "assistant", "First answer", 1, null),
  row(3, "turn-2", "user", "Show me a chart", 2, null),
  row(4, "turn-2", "assistant", "Abandoned answer", 3, null),
  row(5, "turn-2-retry-1", "user", "Show me a chart", 4, branchMetadata),
  row(6, "turn-2-retry-1", "assistant", "Superseded answer", 5, branchMetadata),
  row(9, "turn-2-retry-3", "user", "Visualize this", 8, branchMetadata),
  row(10, "turn-2-retry-3", "assistant", "Latest answer", 9, branchMetadata),
];

/** The contract oracle, independent of which module implements the projection. */
function checkContract(project) {
  const failures = [];
  const ids = project(attempts).map((m) => m.id);
  if (JSON.stringify(ids) !== JSON.stringify([1, 2, 9, 10])) {
    failures.push(`active branch wrong: ${JSON.stringify(ids)}`);
  }
  const content = project(attempts).map((m) => m.content);
  if (content.includes("Abandoned answer") || content.includes("Superseded answer")) {
    failures.push("an abandoned attempt survived projection");
  }
  if (!content.includes("Latest answer")) failures.push("the newest sibling was dropped");
  const plain = [row(1, "a", "user", "hi", null, null), row(2, "a", "assistant", "hello", 1, null)];
  if (JSON.stringify(project(plain).map((m) => m.id)) !== JSON.stringify([1, 2])) {
    failures.push("an unbranched conversation was altered");
  }
  if (project([]).length !== 0) failures.push("an empty transcript did not project to empty");
  return failures;
}

const mutations = [
  { name: "projection skipped entirely (raw log returned)", project: (m) => [...m],
    breaks: "the reader sees every abandoned regeneration as if it were current" },
  { name: "oldest sibling kept instead of newest", project: (m) => m.filter((x) => x.id <= 6),
    breaks: "the answer the user actually has is hidden behind a superseded one" },
  { name: "all branch metadata rows dropped", project: (m) => m.filter((x) => !x.metadata),
    breaks: "the regenerated turn disappears from the transcript" },
  { name: "assistant rows dropped", project: (m) => m.filter((x) => x.role !== "assistant"),
    breaks: "answers vanish while questions remain" },
  { name: "empty transcript synthesises a row", project: (m) => (m.length ? [...m].filter((x) => [1,2,9,10].includes(x.id)) : [row(0,"x","user","",null,null)]),
    breaks: "a transcript is invented where none exists" },
];

const control = checkContract(projectConversationBranchMessages);
const results = mutations.map((mutation) => {
  const failures = checkContract(mutation.project);
  return { mutation: mutation.name, breaks: mutation.breaks, detected: failures.length > 0,
    failureCount: failures.length, firstFailure: failures[0] ?? null };
});

const allDetected = results.every((r) => r.detected);
const controlClean = control.length === 0;
const summary = {
  generatedAt: new Date().toISOString(),
  method: "The contract oracle was run against the real projection and against five deliberately broken stand-ins. No product file was modified.",
  control: { passes: controlClean, failures: control },
  mutations: results,
  nonVacuous: allDetected && controlClean,
  conclusion: allDetected && controlClean
    ? "The projection contract passes on the real implementation and fails on every seeded semantic violation. It is non-vacuous."
    : "At least one seeded violation went undetected; the oracle is insufficient.",
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[counterexample] control passes: ${controlClean}`);
for (const r of results) console.log(`  ${r.detected ? "CAUGHT " : "MISSED "} ${r.mutation}`);
console.log(`[counterexample] non-vacuous: ${summary.nonVacuous}`);
process.exit(summary.nonVacuous ? 0 : 1);
