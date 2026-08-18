#!/usr/bin/env node

/**
 * Non-vacuity for the ROUTE_QUERY contract.
 *
 * "The invariants hold against current code" is not evidence that the invariants
 * can detect anything. This runs the same checks against deliberately broken
 * builders and requires each one to be caught.
 *
 * The mutations are applied to local stand-in builders, never to product source:
 * the point is to prove the *check* has teeth, and seeding a defect into
 * `session-client.ts` to learn that would be both unnecessary and unsafe.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "route-query-counterexamples.json");
const dashboardRoot = process.cwd();
const { HERMES_SURFACES } = await import(
  pathToFileURL(path.join(dashboardRoot, "src/lib/hermes/config.ts")).href
);

/** The production shape, reproduced here so mutations stay out of the product. */
const correctBuilder = (surface) =>
  `/api/hermes/sessions?surface=${encodeURIComponent(surface)}`;

const mutations = [
  {
    name: "encoding removed",
    build: (surface) => `/api/hermes/sessions?surface=${surface}`,
    breaks: "reserved characters stop round-tripping and can forge a second parameter",
  },
  {
    name: "value double encoded",
    build: (surface) => `/api/hermes/sessions?surface=${encodeURIComponent(encodeURIComponent(surface))}`,
    breaks: "the server recovers a percent-escaped string instead of the surface",
  },
  {
    name: "wrong query key",
    build: (surface) => `/api/hermes/sessions?scope=${encodeURIComponent(surface)}`,
    breaks: "the surface parameter is absent, so the consumer cannot scope the query",
  },
  {
    name: "wrong path",
    build: (surface) => `/api/hermes/conversations?surface=${encodeURIComponent(surface)}`,
    breaks: "a different route would answer",
  },
  {
    name: "surface hardcoded to dashboard_terminal",
    build: () => `/api/hermes/sessions?surface=dashboard_terminal`,
    breaks: "garden chat would receive the terminal's conversations — cross-surface leakage",
  },
];

/** The invariant checks, identical in spirit to the arbitration run. */
function evaluate(build) {
  const probes = [
    "dashboard_terminal",
    "garden_chat",
    "a&surface=dashboard_terminal",
    "a=b",
    "garden chat",
    "100%",
  ];
  const failures = [];
  for (const input of probes) {
    let url;
    try {
      url = new URL(build(input), "http://127.0.0.1");
    } catch (error) {
      failures.push({ input, reason: `URL could not be parsed: ${error.message}` });
      continue;
    }
    if (url.pathname !== "/api/hermes/sessions") {
      failures.push({ input, reason: `path is ${url.pathname}` });
      continue;
    }
    const recovered = url.searchParams.get("surface");
    if (recovered !== input) {
      failures.push({ input, reason: `recovered ${JSON.stringify(recovered)}` });
    }
  }
  // Valid surfaces must still be accepted by the consumer's rule.
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const url = new URL(build(surface), "http://127.0.0.1");
    const recovered = url.searchParams.get("surface");
    if (!HERMES_SURFACES.includes(recovered)) {
      failures.push({ input: surface, reason: "consumer would reject a valid surface" });
    }
  }
  return failures;
}

const control = evaluate(correctBuilder);
const results = mutations.map((mutation) => {
  const failures = evaluate(mutation.build);
  return {
    mutation: mutation.name,
    breaks: mutation.breaks,
    detected: failures.length > 0,
    failureCount: failures.length,
    firstFailure: failures[0] ?? null,
  };
});

const allDetected = results.every((entry) => entry.detected);
const controlClean = control.length === 0;

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "The invariant checks were run against the production builder shape and against five deliberately broken builders. Mutations were applied to local stand-ins; no product file was modified.",
  control: { passes: controlClean, failures: control },
  mutations: results,
  nonVacuous: allDetected && controlClean,
  conclusion:
    allDetected && controlClean
      ? "The contract check passes on correct behaviour and fails on every seeded semantic violation, including the cross-surface leakage case. It is non-vacuous."
      : "The contract check did not detect at least one seeded violation, so it is not yet a sufficient oracle.",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[counterexample] control passes: ${controlClean}`);
for (const entry of results) {
  console.log(`  ${entry.detected ? "CAUGHT " : "MISSED "} ${entry.mutation}`);
}
console.log(`[counterexample] non-vacuous: ${summary.nonVacuous}`);
process.exit(summary.nonVacuous ? 0 : 1);
