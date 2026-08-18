#!/usr/bin/env node

/**
 * W2-3D: settle the PROJECTION contract by executing it.
 *
 * Five assertions pin the shape of session-transcript projection inside
 * `api/hermes/sessions/route.ts`. That logic was extracted into
 * `lib/hermes/session-presentation.ts`, which the route imports — so the
 * question is whether the *behaviour* survived the extraction.
 *
 * The behaviour that matters is branch projection: canonical storage keeps every
 * regenerated attempt, and a transcript must expose only the currently active
 * path. Getting that wrong shows a reader an abandoned branch, or hides the
 * answer they actually have. That is checked here by running the real function
 * over a branched fixture, not by looking for the call in a particular file.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "projection-arbitration.json");
const dashboardRoot = process.cwd();
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const { projectConversationBranchMessages } = await load(
  "src/lib/conversations/branch-history.ts",
);

const presentationSource = fs.readFileSync(
  path.join(dashboardRoot, "src/lib/hermes/session-presentation.ts"),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.join(dashboardRoot, "src/app/api/hermes/sessions/route.ts"),
  "utf8",
);

const branchMetadata = JSON.stringify({ branchGroupId: "turn-2" });
const row = (id, clientMessageId, role, content, previousId, metadata) => ({
  id,
  conversation_id: 1,
  client_message_id: clientMessageId,
  role,
  content,
  previous_message_id: previousId,
  metadata: metadata ?? null,
  created_at: new Date(1700000000000 + id * 1000).toISOString(),
  updated_at: new Date(1700000000000 + id * 1000).toISOString(),
});

/** A conversation whose second turn was regenerated twice. */
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

const projected = projectConversationBranchMessages(attempts);
const projectedIds = projected.map((message) => message.id);
const projectedContent = projected.map((message) => message.content);

const invariants = [];
const record = (name, holds, detail) => invariants.push({ name, holds, detail });

record(
  "only the active branch survives",
  JSON.stringify(projectedIds) === JSON.stringify([1, 2, 9, 10]),
  `projected ids ${JSON.stringify(projectedIds)}; the first turn plus the newest sibling of turn 2`,
);
record(
  "abandoned attempts are excluded",
  !projectedContent.includes("Abandoned answer") && !projectedContent.includes("Superseded answer"),
  "a reader must not see a regenerated-away answer as if it were current",
);
record(
  "the surviving turn is the newest sibling, not the first",
  projectedContent.includes("Latest answer"),
  "showing an older sibling would hide the answer the user actually has",
);
record(
  "an unbranched conversation is returned unchanged",
  (() => {
    const plain = [row(1, "a", "user", "hi", null, null), row(2, "a", "assistant", "hello", 1, null)];
    const out = projectConversationBranchMessages(plain).map((message) => message.id);
    return JSON.stringify(out) === JSON.stringify([1, 2]);
  })(),
  "projection must be a no-op when nothing was regenerated",
);
record(
  "an empty transcript projects to empty",
  projectConversationBranchMessages([]).length === 0,
  "no defaulting or synthesised rows",
);

// --- consumer evidence: is the extracted module actually on the path? ----
const consumerEvidence = {
  routeImportsPresentation: /from "@\/lib\/hermes\/session-presentation\.ts"/.test(routeSource),
  presentationAppliesBranchProjection:
    /projectConversationBranchMessages\(\s*listConversationMessages\(conversation\.id\),?\s*\)\.map/.test(
      presentationSource,
    ),
  presentationUsesSharedMessagePresenter: /presentConversationMessage\(/.test(presentationSource),
  presentationReadsMemoryEvidence: /memoryUpdatedClientMessageIdsForSession\(/.test(
    presentationSource,
  ),
  presentationCarriesResponseDuration: /presented\.metadata\.responseDurationMs/.test(
    presentationSource,
  ),
};

record(
  "the sessions route reaches the extracted presentation module",
  consumerEvidence.routeImportsPresentation,
  "otherwise the extraction would have orphaned the projection",
);
record(
  "the extracted module applies exactly the asserted projection call",
  consumerEvidence.presentationAppliesBranchProjection,
  "the asserted pattern matches session-presentation.ts verbatim; only its location changed",
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  boundary: {
    projection: "dashboard/src/lib/conversations/branch-history.ts :: projectConversationBranchMessages",
    consumer: "dashboard/src/lib/hermes/session-presentation.ts :: presentHermesSessionDetail",
    route: "dashboard/src/app/api/hermes/sessions/route.ts",
    method:
      "The real projection was executed over a fixture whose second turn was regenerated twice; the consumer chain was then confirmed by import and call evidence.",
  },
  rootCause:
    "Session presentation was extracted from api/hermes/sessions/route.ts into lib/hermes/session-presentation.ts. Four assertions across four suites still read the route file, where the logic no longer lives. The behaviour moved intact: session-presentation.ts contains the asserted projection call, the shared message presenter, the memory-evidence lookup and the response-duration metadata, all together.",
  fixtureIds: attempts.map((message) => message.id),
  projectedIds,
  invariants,
  consumerEvidence,
  allInvariantsHold: allHold,
  fieldClassification: [
    { field: "active-branch membership", kind: "REQUIRED_CONTRACT_FIELD", why: "determines what the reader sees" },
    { field: "message id and content", kind: "REQUIRED_CONTRACT_FIELD", why: "identity and body of each transcript row" },
    {
      field: "the module the call is written in",
      kind: "IMPLEMENTATION_DETAIL",
      why: "not observable to any consumer; the route reaches the same behaviour through an import",
    },
  ],
  classification: allHold ? "STALE_TEST" : "PRODUCT_BUG",
  sourceContractKind: allHold ? "IMPLEMENTATION_COUPLING" : "REAL_CONTRACT",
  confidence: "HIGH",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[projection] projected ids: ${JSON.stringify(projectedIds)}`);
for (const entry of invariants) {
  console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
}
console.log(`[projection] classification: ${summary.classification} (${summary.sourceContractKind})`);
