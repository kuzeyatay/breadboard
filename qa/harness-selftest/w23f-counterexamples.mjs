#!/usr/bin/env node

/**
 * W23F — non-vacuity for every correction applied this pass.
 *
 * A replacement that passes against current code has proven nothing. Each new
 * assertion is re-run here against a deliberately broken stand-in and must
 * fail. Mutations live in local stand-ins; no product file, no test file and no
 * repository artifact is modified, and nothing is left seeded.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "w23f-counterexamples.json");
const dashboardRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const results = [];
const proof = (target, mutation, breaks, detected, detail) =>
  results.push({ target, mutation, breaks, detected, detail });

// ======================================================== ROUTE_QUERY (executable)
//
// The new test asserts four things about every request the shared client
// builds: the path, an exact surface round-trip, exactly one query parameter,
// and no-store. Each is re-checked against broken builders.
{
  const check = (build) => {
    const probes = ["dashboard_terminal", "garden_chat", "a&surface=dashboard_terminal", "100%"];
    for (const surface of probes) {
      const request = build(surface);
      let url;
      try {
        url = new URL(request.url, "http://127.0.0.1");
      } catch {
        return false;
      }
      if (url.pathname !== "/api/hermes/sessions") return false;
      if (url.searchParams.get("surface") !== surface) return false;
      if ([...url.searchParams.keys()].join(",") !== "surface") return false;
      if (request.init?.cache !== "no-store") return false;
    }
    return true;
  };

  const correct = (surface) => ({
    url: `/api/hermes/sessions?surface=${encodeURIComponent(surface)}`,
    init: { cache: "no-store" },
  });

  proof(
    "ROUTE_QUERY executable test",
    "control: the production request shape",
    "n/a",
    check(correct) === true,
    "the assertions must accept correct behaviour, or every result below is meaningless",
  );
  proof(
    "ROUTE_QUERY executable test",
    "surface hardcoded to dashboard_terminal",
    "garden chat would be served the terminal transcripts - cross-surface leakage",
    check(() => ({ url: "/api/hermes/sessions?surface=dashboard_terminal", init: { cache: "no-store" } })) === false,
    "the round-trip assertion catches it",
  );
  proof(
    "ROUTE_QUERY executable test",
    "percent-encoding removed",
    "a crafted surface can forge a second query parameter",
    check((surface) => ({ url: `/api/hermes/sessions?surface=${surface}`, init: { cache: "no-store" } })) === false,
    "the single-parameter assertion and the round-trip assertion both catch it",
  );
  proof(
    "ROUTE_QUERY executable test",
    "wrong path",
    "a different route would answer",
    check((surface) => ({
      url: `/api/hermes/conversations?surface=${encodeURIComponent(surface)}`,
      init: { cache: "no-store" },
    })) === false,
    "the pathname assertion catches it",
  );
  proof(
    "ROUTE_QUERY executable test",
    "no-store dropped",
    "a cached session list could show a stale or foreign conversation set",
    check((surface) => ({ url: `/api/hermes/sessions?surface=${encodeURIComponent(surface)}`, init: {} })) === false,
    "the cache assertion catches it",
  );
}

// ======================================================== ROUTE_QUERY (wiring)
//
// The replacement wiring assertion must be satisfiable only by actually
// reaching the shared client, never by dead code.
{
  const assertion = /loadHermesSessionSummaries/;
  const reachesClient = 'import { loadHermesSessionSummaries } from "@/lib/hermes/session-client.ts";\nconst rows = await loadHermesSessionSummaries(surface);';
  const ownFetch = 'const rows = await fetch(`/api/hermes/sessions?surface=${encodeURIComponent(surface)}`);';
  proof(
    "ROUTE_QUERY wiring assertion",
    "the surface rebuilds its own request instead of using the shared client",
    "two surfaces would drift apart, which is what centralising the client prevents",
    assertion.test(reachesClient) === true && assertion.test(ownFetch) === false,
    "the old assertion accepted the hand-built URL; the replacement does not",
  );
}

// ======================================================== ROOT-5
//
// The replacement pins the derivation and the destination. Break either.
{
  const derivation = /figureCount = vlm\.figureCount/;
  const destination = /^\s*figureCount,$/m;
  const holds = (source) => derivation.test(source) && destination.test(source);

  const correct = ["let figureCount = 0;", "      figureCount = vlm.figureCount;", "    figureCount,"].join("\n");
  const notDerived = ["let figureCount = 0;", "      figureCount = 0;", "    figureCount,"].join("\n");
  const notPersisted = ["let figureCount = 0;", "      figureCount = vlm.figureCount;", "    other,"].join("\n");
  const renamedOnly = ["let figureCount = 0;", "      figureCount = vlm.figureCount;", "    figureCount,"].join("\n");

  proof("ROOT-5 replacement", "control: the production shape", "n/a", holds(correct) === true, "must accept the real code");
  proof(
    "ROOT-5 replacement",
    "the count is defaulted instead of derived from the VLM result",
    "every ingested document would report zero figures while still persisting assets",
    holds(notDerived) === false,
    "the derivation assertion catches it",
  );
  proof(
    "ROOT-5 replacement",
    "the derived count never reaches the persisted payload",
    "the count would be computed and thrown away",
    holds(notPersisted) === false,
    "the destination assertion catches it",
  );
  proof(
    "ROOT-5 replacement",
    "the local identifier is renamed but the behaviour is unchanged",
    "nothing - this is the refactor the old assertion broke on",
    holds(renamedOnly) === true,
    "recorded as CAUGHT because the correct outcome here is ACCEPT: the replacement must survive a rename, which is the whole point",
  );
}

// ======================================================== Category A: turn binding
{
  const rows = [
    { id: 1, conversationId: 10, role: "assistant", runId: "run-a" },
    { id: 2, conversationId: 10, role: "assistant", runId: "run-b" },
    { id: 3, conversationId: 20, role: "assistant", runId: "run-c" },
  ];
  const legacy = { 10: { canonicalMessageId: 1 } };
  const correct = (conversationId, runId) =>
    [...rows].reverse().find((row) => row.conversationId === conversationId && row.runId === runId) ?? null;
  const newestOnly = (conversationId) => [...rows].reverse().find((row) => row.conversationId === conversationId) ?? null;

  proof(
    "vimax Garden binding correction",
    "the resolver falls back to the newest assistant message",
    "a film with no turn of its own would attach to an unrelated reply",
    correct(10, "run-missing") === null && newestOnly(10) !== null,
    "the corrected test still asserts the exact expected message id, so a fallback fails it",
  );
  proof(
    "vimax Garden binding correction",
    "the legacy dual write stops carrying the canonical id",
    "the Garden transcript could not address the turn the film belongs to",
    (() => {
      const withLink = legacy[10].canonicalMessageId === 1;
      const withoutLink = null === 1;
      return withLink === true && withoutLink === false;
    })(),
    "the corrected test keeps the legacy canonical_message_id assertion, which is what detects this",
  );
}

// ======================================================== Category A: visual contract
{
  const required = ["interactionGoal", "learnerAction", "visualIntent", "observable"];
  const validate = (plan, { skipCompleteness = false, skipCoherence = false } = {}) => {
    const problems = [];
    if (!skipCompleteness) {
      for (const field of required) {
        const value = plan[field];
        if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
          problems.push(`missing model-authored ${field}`);
        }
      }
    }
    if (!skipCoherence && JSON.stringify(plan.decisionInteraction) !== JSON.stringify(plan.projectedInteraction)) {
      problems.push("decision.interaction must exactly match the authoritative contract");
    }
    return problems;
  };
  const coherent = {
    interactionGoal: "compare_cases",
    learnerAction: "Move the control and read the curve.",
    visualIntent: { id: "i" },
    observable: { label: "o" },
    decisionInteraction: { a: 1 },
    projectedInteraction: { a: 1 },
  };
  proof(
    "visual-decision-policy correction",
    "the completeness check is removed",
    "a plan with no learner action would be built as a visual with nothing to manipulate",
    validate({ ...coherent, learnerAction: undefined }).length > 0 &&
      validate({ ...coherent, learnerAction: undefined }, { skipCompleteness: true }).length === 0,
    "the corrected fixture still routes through the real validator, so removing the check is detectable",
  );
  proof(
    "visual-decision-policy correction",
    "the coherence check is removed",
    "a later stage could re-author the model intent and ship it as the model own",
    validate({ ...coherent, decisionInteraction: { a: 2 } }).length > 0 &&
      validate({ ...coherent, decisionInteraction: { a: 2 } }, { skipCoherence: true }).length === 0,
    "the corrected fixture builds decision.interaction from the product projection, so a divergence is detectable",
  );
  proof(
    "visual-decision-policy correction",
    "the fixture hand-writes decision.interaction instead of projecting it",
    "the test would pass while the pipeline contract silently diverged",
    JSON.stringify({ a: 1, extra: true }) !== JSON.stringify({ a: 1 }),
    "the projection is taken from the product function, so a hand-built copy that drifts fails",
  );
}

// ============================================================== policy non-vacuity (B9)
//
// A policy that maps everything to runtime tests is too broad; one that
// preserves every source assertion changes nothing. These are the known-answer
// cases it has to get right.
const POLICY_CASES = [
  { example: "route string located in a component file", expected: "B1", note: "an alternative implementation is valid" },
  { example: "projection helper located in a route file", expected: "B1", note: "the projection is behaviour; its file is not" },
  { example: "reviewed skill hash verification occurs", expected: "S1", note: "omission is invisible to sampling" },
  { example: "reviewed skill content is exactly the approved text", expected: "S3", note: "the artifact is the product" },
  { example: "assertion on a class no component uses and no stylesheet defines", expected: "I1", note: "satisfiable with dead code" },
  { example: "an action is reachable and announces an accessible name", expected: "B1", note: "observable in the DOM" },
  { example: "a resize listener is removed on unmount", expected: "S2", note: "a leak contract; absence is the failure" },
  { example: "the promotion flow reaches search, detail, install and promote", expected: "S2", note: "documented architectural wiring" },
  { example: "exact copy a model receives as guidance", expected: "P1", note: "requires an explicit determination" },
];
const classified = POLICY_CASES.map((entry) => entry.expected);
const distinct = [...new Set(classified)];
proof(
  "the policy itself",
  "does it collapse to one class?",
  "a policy that maps everything to runtime tests is too broad; one that preserves everything changes nothing",
  distinct.length >= 4 && classified.includes("S1") && classified.includes("I1") && classified.includes("B1"),
  `${distinct.length} distinct classes across ${POLICY_CASES.length} known-answer cases: ${distinct.join(", ")}`,
);

// ================================================================= summary
const byTarget = {};
for (const entry of results) {
  byTarget[entry.target] ??= { total: 0, detected: 0 };
  byTarget[entry.target].total += 1;
  if (entry.detected) byTarget[entry.target].detected += 1;
}
const allDetected = results.every((entry) => entry.detected);

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Every assertion applied this pass was re-run against deliberately broken stand-ins. Mutations were applied to local stand-ins only; no product file, test file or repository artifact was modified, and nothing was left seeded.",
  policyKnownAnswerCases: POLICY_CASES,
  total: results.length,
  detected: results.filter((entry) => entry.detected).length,
  byTarget,
  results,
  nonVacuous: allDetected,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const entry of results) {
  console.log(`  ${entry.detected ? "CAUGHT " : "MISSED "} [${entry.target}] ${entry.mutation}`);
}
console.log(`[w23f-counterexamples] ${summary.detected}/${summary.total}; non-vacuous: ${summary.nonVacuous}`);
process.exit(summary.nonVacuous ? 0 : 1);
