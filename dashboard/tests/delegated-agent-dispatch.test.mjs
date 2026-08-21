import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const combinations = await import("../src/lib/hermes/capability-combinations.ts");

const source = (relativePath) =>
  fs
    .readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");

/** The body of the switch inside a surface's `launchDelegatedAgent`. */
function dispatchBody(file = "src/app/components/hermes/dashboard-agent-terminal.tsx") {
  const text = source(file);
  const start = text.indexOf("async function launchDelegatedAgent");
  assert.ok(start > 0, "launchDelegatedAgent should still exist");
  const switchAt = text.indexOf("switch (request.agentId)", start);
  assert.ok(switchAt > 0, "the delegated launch should still dispatch on agentId");
  const end = text.indexOf("\n    } finally {", switchAt);
  assert.ok(end > switchAt, "the dispatch should still be wrapped in try/finally");
  return text.slice(switchAt, end);
}

test("every agent the model may launch has somewhere to be launched", () => {
  const body = dispatchBody();
  const handled = new Set(
    [...body.matchAll(/case "([a-z0-9-]+)":/g)].map((match) => match[1]),
  );

  const launchable = combinations
    .modelLaunchableRuntimeAgents("dashboard_terminal")
    .map((agent) => agent.id);
  assert.ok(launchable.length > 5, "the registry should be populated");

  const missing = launchable.filter((id) => !handled.has(id));
  assert.deepEqual(
    missing,
    [],
    // Max Research was registered as launchable, accepted by the agent_launch
    // route, and had no case here. It fell to `default:` and the turn showed
    // only "Delegated to Max Research agent" with no card and no run. The
    // registry is the contract; this is what holds the dispatch to it.
    `these agents are launchable by the model but fall through to default: ${missing.join(", ")}`,
  );
});

test("max research in particular is reachable both ways in", () => {
  const text = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(
    dispatchBody(),
    /case "max-research":/,
    "the model must be able to delegate to it",
  );
  assert.match(
    text,
    /const routeMaxResearchCommand/,
    "and a person must be able to type it",
  );
  // Both entry points have to reach the same launcher, or the two ways in
  // drift into two behaviours.
  assert.equal(
    [...dispatchBody().matchAll(/launchMaxResearchRun\(/g)].length,
    1,
    "the delegated case should call the same launcher the typed command uses",
  );
});

test("the run-kind field map covers every kind, checked by the compiler", () => {
  const text = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(
    text,
    /\["maxResearchRun", "max_research"\]/,
    "a kind missing here renders as bare text instead of a run card",
  );
  assert.match(
    text,
    /type UnmappedRunKind = Exclude</,
    "the list needs a completeness check, since `satisfies` only sees the entries present",
  );
});

test("garden's dispatch covers what garden advertises as launchable", () => {
  const body = dispatchBody("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const handled = new Set([...body.matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]));
  const launchable = combinations
    .modelLaunchableRuntimeAgents("garden_chat")
    .map((agent) => agent.id);

  const missing = launchable.filter((id) => !handled.has(id));
  assert.deepEqual(
    missing,
    [],
    `these agents are launchable in Garden but fall through to default: ${missing.join(", ")}`,
  );
});
