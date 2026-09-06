import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const {
  abortRuntimeWorkerRun: abortRun,
  setRuntimeWorkerTerminalHandler: setRunTerminalHandler,
  startRuntimeWorkerRun: startRun,
} = await import("../src/lib/cad/run-manager.ts");
const { parseParametricCadRequest } = await import("../src/lib/cad/identity.ts");

test("a replayed CAD launch key reuses one run and rejects a changed request", () => {
  const brief = "a 60 mm mounting bracket --sla";
  const input = {
    userId: 41,
    conversationPublicId: "conv_cad_idempotent_launch",
    clientMessageId: "client_cad_1",
    brief,
    parsed: parseParametricCadRequest(brief),
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:9/v1",
  };

  const first = startRun(input);
  const replay = startRun(input);
  assert.equal(replay.runId, first.runId);
  assert.throws(
    () =>
      startRun({
        ...input,
        brief: "a different bracket",
        parsed: parseParametricCadRequest("a different bracket"),
      }),
    /client_message_id_conflict/,
  );

  // Whether the local service fails immediately or the abort wins its probe,
  // the already-terminal result must replay to a handler attached afterwards.
  abortRun(input.userId, first.runId);
  const terminalResults = [];
  setRunTerminalHandler(input.userId, first.runId, (result) => terminalResults.push(result));
  assert.equal(terminalResults.length, 1);
  assert.ok(["failed", "aborted"].includes(terminalResults[0].outcome));
  assert.ok(terminalResults[0].content);
});

test("the CAD route persists ownership before responding and the launcher sends one stable key", () => {
  const route = source("src/app/api/cad/runs/route.ts");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");

  assert.match(route, /const conversation = getConversationForUser\(conversationPublicId, userId\)/);
  assert.ok(
    route.indexOf("const conversation = getConversationForUser") <
      route.indexOf("const run = await startRun"),
  );
  assert.match(route, /clientMessageId/);
  assert.match(route, /branchGroupId/);
  assert.match(route, /attachToExistingTurn/);
  assert.match(route, /recordExternalAgentTurn/);
  assert.match(route, /attachExternalAgentRun/);
  assert.match(route, /setRunTerminalHandler/);
  assert.match(route, /finishExternalAgentTurn/);
  assert.match(route, /error instanceof ConversationStoreError/);
  assert.ok(route.indexOf("recordExternalAgentTurn") < route.lastIndexOf("return NextResponse.json"));
  assert.match(route, /userContent: parametricCadUserMessage\(brief\)/);
  assert.match(route, /kind: "parametric_cad" as const[\s\S]*?brief,/);
  assert.match(route, /abortRun\(userId, run\.runId\)/);

  const launcher = terminal.slice(
    terminal.indexOf("const launchParametricCadRun"),
    terminal.indexOf("const routeParametricCadCommand"),
  );
  assert.match(launcher, /const normalizedBrief = brief\.trim\(\)/);
  assert.match(launcher, /const requestedClientMessageId = crypto\.randomUUID\(\)/);
  assert.match(launcher, /session\.externalAgentTurnPersistence\(clientMessageId\)/);
  assert.doesNotMatch(launcher, /clientMessageId !== requestedClientMessageId/);
  assert.match(launcher, /brief: normalizedBrief/);
  assert.match(launcher, /clientMessageId,/);
  assert.match(launcher, /\.\.\.launchPersistence,/);
  assert.match(launcher, /branchGroupId: options\.branchGroupId/);

  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const gardenLauncher = garden.slice(
    garden.indexOf("async function launchParametricCad"),
    garden.indexOf("async function launchHyperframes"),
  );
  assert.match(gardenLauncher, /const launchClientMessageId = crypto\.randomUUID\(\)/);
  assert.match(gardenLauncher, /const prepared = await prepareExternalAgentSession\(userContent\)/);
  assert.match(gardenLauncher, /chatSessionId: prepared\.session\.id,/);
  assert.match(gardenLauncher, /clientMessageId: launchClientMessageId,/);
});
