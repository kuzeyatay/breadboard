import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const terminal = read(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const panel = read("../src/app/components/hermes/agent-runtime-panel.tsx");
const garden = read("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const session = read("../src/app/components/hermes/use-agent-session.ts");

test("Terminal consumes delegation requests before the completed frame paints", () => {
  assert.match(
    terminal,
    /useLayoutEffect\(\(\) => \{\s*for \(const request of session\.agentLaunchRequests\)/,
  );
  assert.match(
    terminal,
    /useLayoutEffect\(\(\) => \{\s*if \(session\.loadingSession \|\| pendingLaunchContinuation\)/,
  );
});

test("delegation hand-backs remain pending until a continuation turn starts", () => {
  assert.match(session, /onTurnStarted\?: \(\) => void/);
  assert.match(
    session,
    /setMessages\(baseline\);[\s\S]{0,700}try \{\s*options\?\.onTurnStarted\?\.\(\)/,
  );

  for (const [name, source] of [
    ["Terminal", terminal],
    ["Garden", garden],
  ]) {
    const start = source.indexOf(
      "const continuation = pendingLaunchContinuation",
    );
    const dispatch = source.slice(start, start + 1_200);
    assert.ok(start >= 0, name);
    assert.match(
      dispatch,
      name === "Terminal"
        ? /onTurnStarted:/
        : /handleSubmit\([\s\S]{0,180}true,[\s\S]{0,180}setPendingLaunchContinuation/,
      name,
    );
    assert.doesNotMatch(
      dispatch,
      /setPendingLaunchContinuation\(null\)[\s\S]{0,160}(?:sendAgentContinuation|handleSubmit)/,
      name,
    );
  }
});

test("an unfinished delegation exposes no completed-message actions", () => {
  assert.match(
    panel,
    /suppressActions=\{[\s\S]{0,180}index === lastAssistantIndex && delegationInFlight/,
  );
  assert.match(
    garden,
    /!externalRun &&\s*!delegatedAgentActive &&\s*!\(isStreaming && i === lastAssistantIndex\)/,
  );
});

test("Garden hand-backs bypass the person's runtime-agent selection", () => {
  const routingStart = garden.indexOf("if (!internalAgentContinuation) {");
  const normalTurnStart = garden.indexOf(
    "const responseStartedAt = performance.now()",
    routingStart,
  );
  assert.ok(routingStart >= 0);
  assert.ok(normalTurnStart > routingStart);
  const routing = garden.slice(routingStart, normalTurnStart);
  assert.match(routing, /findCapabilityConflict/);
  assert.match(routing, /taskFromParametricCadCommand/);
  assert.match(routing, /if \(codexAgent\)/);
  assert.match(routing, /\}\s*$/);
});
