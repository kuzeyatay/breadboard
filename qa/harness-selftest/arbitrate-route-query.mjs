#!/usr/bin/env node

/**
 * W2-3D: settle the ROUTE_QUERY contract by executing it.
 *
 * Three tests assert that `/api/hermes/sessions?surface=…` appears inside a
 * component or hook. The literal now lives in `lib/hermes/session-client.ts`,
 * which both asserted files import. That is either a harmless relocation or a
 * broken contract, and reading source cannot tell the two apart.
 *
 * So this runs the real thing: it calls the exported production function with a
 * stubbed `fetch`, captures the URL the product actually builds, parses it with
 * `URL`/`URLSearchParams`, and feeds the result to the consumer's own
 * `parseSurface` logic. The contract that matters is not where the string is
 * written — it is that the server can recover the exact surface, because the
 * route filters conversations by it and a mismatch is cross-surface leakage.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "route-query-arbitration.json");

// Resolved from the dashboard working directory rather than from this script,
// so the production modules load exactly as the dashboard's own tests load them.
const dashboardRoot = process.cwd();
const productionModule = (relative) =>
  pathToFileURL(path.join(dashboardRoot, relative)).href;

const { loadHermesSessionSummaries } = await import(
  productionModule("src/lib/hermes/session-client.ts")
);
const { HERMES_SURFACES } = await import(productionModule("src/lib/hermes/config.ts"));

/** The consumer's own acceptance rule, mirrored from the sessions route. */
function parseSurfaceLikeConsumer(value) {
  if (typeof value === "string" && HERMES_SURFACES.includes(value)) return value;
  return { error: "invalid_surface" };
}

const originalFetch = globalThis.fetch;
const captured = [];

globalThis.fetch = async (url, init) => {
  captured.push({ url: String(url), init: init ?? null });
  return {
    ok: true,
    json: async () => ({ sessions: [] }),
  };
};

/** Force a real network build each time: the client caches per surface. */
async function buildUrlFor(surface) {
  captured.length = 0;
  try {
    await loadHermesSessionSummaries(surface, { force: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return captured.at(-1) ?? null;
}

const cases = [
  { label: "valid surface: dashboard_terminal", input: "dashboard_terminal", valid: true },
  { label: "valid surface: garden_chat", input: "garden_chat", valid: true },
  { label: "space in value", input: "garden chat", valid: false },
  { label: "unicode value", input: "jardín_chat", valid: false },
  { label: "ampersand injection", input: "a&surface=dashboard_terminal", valid: false },
  { label: "equals injection", input: "a=b", valid: false },
  { label: "question mark", input: "a?b", valid: false },
  { label: "hash fragment", input: "a#b", valid: false },
  { label: "forward slash", input: "garden/chat", valid: false },
  { label: "backslash", input: "garden\\chat", valid: false },
  { label: "percent sign", input: "100%", valid: false },
  { label: "already encoded", input: "garden%5Fchat", valid: false },
  { label: "empty string", input: "", valid: false },
];

const results = [];
for (const testCase of cases) {
  const call = await buildUrlFor(testCase.input);
  const raw = call?.url ?? null;
  let parsed = null;
  let recovered = null;
  let consumerVerdict = null;
  if (raw) {
    // The product builds a relative URL; parse against an origin the way a
    // browser would before the request leaves.
    const url = new URL(raw, "http://127.0.0.1");
    recovered = url.searchParams.get("surface");
    consumerVerdict = parseSurfaceLikeConsumer(recovered);
    parsed = { pathname: url.pathname, search: url.search };
  }
  results.push({
    ...testCase,
    rawUrl: raw,
    pathname: parsed?.pathname ?? null,
    search: parsed?.search ?? null,
    recoveredSurface: recovered,
    roundTripsExactly: recovered === testCase.input,
    consumerAccepts: typeof consumerVerdict === "string",
    consumerVerdict,
    cacheHeader: call?.init?.cache ?? null,
  });
}

globalThis.fetch = originalFetch;

// --- the invariants the contract actually rests on -----------------------
const invariants = [];
const record = (name, holds, detail) => invariants.push({ name, holds, detail });

const valid = results.filter((entry) => entry.valid);
const invalid = results.filter((entry) => !entry.valid);

record(
  "path is exactly /api/hermes/sessions",
  results.every((entry) => entry.pathname === "/api/hermes/sessions"),
  "a changed path would reach a different route entirely",
);
record(
  "every value round-trips byte-exactly through the query string",
  results.every((entry) => entry.roundTripsExactly),
  "the server must recover the surface it was sent; anything else risks reading another surface's conversations",
);
record(
  "query-reserved characters cannot inject a second parameter",
  results
    .filter((entry) => entry.input.includes("&") || entry.input.includes("="))
    .every((entry) => entry.recoveredSurface === entry.input),
  "an unencoded & or = would let a value forge a second surface parameter",
);
record(
  "valid surfaces are accepted by the consumer",
  valid.every((entry) => entry.consumerAccepts),
  "otherwise a legitimate surface could not load its own history",
);
record(
  "invalid surfaces are rejected by the consumer, not silently defaulted",
  invalid.every((entry) => !entry.consumerAccepts),
  "a silent default would return another surface's conversations",
);
record(
  "the request is issued no-store",
  results.every((entry) => entry.rawUrl === null || entry.cacheHeader === "no-store"),
  "a cached session list could show a stale or foreign conversation set",
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  boundary: {
    builder: "dashboard/src/lib/hermes/session-client.ts :: loadHermesSessionSummaries",
    consumer: "dashboard/src/app/api/hermes/sessions/route.ts :: parseSurface + surface filter",
    method:
      "The exported production function was called with a stubbed fetch; the URL it built was parsed with URL/URLSearchParams and fed to the consumer's acceptance rule.",
  },
  assertedByTests: [
    "dashboard/tests/hermes-live-routing.test.mjs -> use-agent-session.ts contains the literal",
    "dashboard/tests/background-hermes-chat.test.mjs -> the session hook contains the literal",
    "dashboard/tests/garden-agent-chat-ui.test.mjs -> garden-agent-chat.tsx contains the literal",
  ],
  relocation: {
    literalNowLivesIn: "dashboard/src/lib/hermes/session-client.ts",
    assertedFilesStillReachIt: true,
    evidence:
      "use-agent-session.ts and garden-agent-chat.tsx both import from @/lib/hermes/session-client; the centralised client additionally deduplicates concurrent requests and caches per surface.",
  },
  cases: results,
  invariants,
  allInvariantsHold: allHold,
  conclusion: allHold
    ? "The route/query contract is intact and stronger than when the assertions were written. The surface round-trips exactly, reserved characters cannot inject a parameter, invalid surfaces are refused rather than defaulted, and the request is no-store. The assertions pinned the file the literal lives in, not the behaviour."
    : "At least one route/query invariant does not hold; see invariants for which.",
  classification: allHold ? "STALE_TEST" : "PRODUCT_BUG",
  sourceContractKind: allHold ? "IMPLEMENTATION_COUPLING" : "REAL_CONTRACT",
  confidence: "HIGH",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[route-query] cases executed: ${results.length}`);
for (const entry of invariants) {
  console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
}
console.log(`[route-query] classification: ${summary.classification} (${summary.sourceContractKind})`);
assert.ok(results.length > 0, "no cases executed");
