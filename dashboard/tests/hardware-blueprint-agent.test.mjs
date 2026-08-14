import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const identity = await import("../src/lib/hardware/identity.ts");
const { artifactRenderer, availableArtifactRenderers } = await import(
  "../src/lib/hermes/artifact-renderers.ts"
);
const { parseExternalAgentRun, externalAgentMessageFields, EXTERNAL_AGENT_RUN_KINDS } =
  await import("../src/lib/conversations/external-agent-runs.ts");
const { runtimeAgentByToken } = await import(
  "../src/lib/hermes/capability-combinations.ts"
);

test("the agent has one canonical slash command", () => {
  assert.equal(identity.HARDWARE_BLUEPRINT_COMMAND, "/agents:hardware-blueprint");
  assert.equal(identity.HARDWARE_BLUEPRINT_AGENT_ID, "hardware-blueprint");
  assert.equal(identity.HARDWARE_BLUEPRINT_AGENT_NAME, "Hardware Blueprint");
  assert.equal(
    identity.hardwareBlueprintUserMessage("build a weather station"),
    "/agents:hardware-blueprint build a weather station",
  );
  assert.equal(
    identity.taskFromHardwareBlueprintCommand("  /AGENTS:HARDWARE-BLUEPRINT  blink an LED"),
    "blink an LED",
  );
  assert.equal(identity.taskFromHardwareBlueprintCommand("/agents:hardware-blueprint"), "");
  assert.equal(identity.taskFromHardwareBlueprintCommand("/agents:socials-manager task"), null);
  assert.equal(identity.taskFromHardwareBlueprintCommand("build something"), null);
});

test("inline flags are parsed out of the brief", () => {
  const parsed = identity.parseHardwareBlueprintRequest(
    "an OLED weather station --board esp32 --perfboard --arduino",
  );
  assert.equal(parsed.brief, "an OLED weather station");
  assert.equal(parsed.board, "esp32");
  assert.equal(parsed.prototypeType, "perfboard");
  assert.equal(parsed.firmwarePlatform, "arduino");

  const plain = identity.parseHardwareBlueprintRequest("blink an LED");
  assert.equal(plain.brief, "blink an LED");
  assert.equal(plain.board, null);
  assert.equal(plain.prototypeType, null);
  assert.equal(plain.firmwarePlatform, null);

  const quoted = identity.parseHardwareBlueprintRequest('a servo rig --board "Raspberry Pi Pico"');
  assert.equal(quoted.board, "Raspberry Pi Pico");
  assert.equal(quoted.brief, "a servo rig");
});

test("a preceding capability token is preserved for the resolver", () => {
  assert.equal(
    identity.taskFromHardwareBlueprintCommand("/some-skill /agents:hardware-blueprint build it"),
    "/some-skill build it",
  );
});

test("the hardware-blueprint renderer is registered and validates its payload", async () => {
  const renderer = artifactRenderer("hardware-blueprint");
  assert.ok(renderer, "the renderer is not in the registry");
  assert.equal(renderer.kind, "data");
  assert.equal(renderer.extension, ".json");
  assert.ok(
    availableArtifactRenderers().some((entry) => entry.id === "hardware-blueprint"),
    "the renderer is not advertised",
  );

  assert.equal((await renderer.validate("not json")).ok, false);
  assert.equal((await renderer.validate('{"schemaVersion":"9.9.9"}')).ok, false);

  const { buildDesign } = await import("../src/lib/hardware/design.ts");
  const { design } = buildDesign({
    request: {
      purpose: "Blink an LED",
      controller: "Arduino Uno",
      inputs: [],
      outputs: [{ type: "LED", quantity: 1 }],
      communication: [],
      power: { source: "usb" },
      prototypeType: "breadboard",
      firmware: { platform: "platformio", language: "cpp" },
      constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
    },
    designId: "hwd_renderer_test",
  });
  const valid = await renderer.validate(JSON.stringify(design));
  assert.equal(valid.ok, true, valid.error);
});

test("the run kind round-trips through the durable transcript", () => {
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("hardware_blueprint"));

  const run = parseExternalAgentRun({
    kind: "hardware_blueprint",
    runId: "hwrun_1",
    brief: "an ESP32 weather station",
  });
  assert.deepEqual(run, {
    kind: "hardware_blueprint",
    runId: "hwrun_1",
    brief: "an ESP32 weather station",
  });
  assert.equal(parseExternalAgentRun({ kind: "hardware_blueprint", runId: "x" }), null);

  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: run,
    externalAgentOutcome: "completed",
  });
  assert.deepEqual(fields.hardwareBlueprintRun, { runId: "hwrun_1", brief: "an ESP32 weather station" });
  assert.equal(fields.externalAgentOutcome, "completed");
});

test("the agent is reachable from every chat surface", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /HARDWARE_BLUEPRINT_COMMAND/);
  assert.match(hub, /Turns a hardware idea into a checked circuit/);
  assert.match(hub, /onSelectHardwareBlueprint/);
  // Picker rows are text only, like every other agent in the list.
  assert.doesNotMatch(hub, /CircuitIcon/);

  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /insertCommandToken\(HARDWARE_BLUEPRINT_COMMAND\)/);

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(terminal, /routeHardwareBlueprintCommand/);
  assert.match(terminal, /\/api\/hardware-blueprint\/runs/);
  assert.match(terminal, /kind: "hardware_blueprint"/);
  assert.match(
    terminal,
    /\/api\/hardware-blueprint\/runs[\s\S]{0,400}clientMessageId/,
    "the Blueprint launch has no stable replay key",
  );

  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(garden, /launchHardwareBlueprint/);
  assert.match(garden, /InlineHardwareBlueprintRun/);

  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(panel, /message\.hardwareBlueprintRun/);

  // The resolver recognizes the token through the shared runtime-agent table
  // rather than a literal list, so it can name the agent when a turn reaches it
  // unhandled. capability-combinations.test.mjs covers that rejection.
  const agent = runtimeAgentByToken("agents:hardware-blueprint");
  assert.equal(agent?.id, "hardware-blueprint");
  assert.equal(agent?.name, "Hardware Blueprint");
  assert.deepEqual([...agent.surfaces], ["dashboard_terminal", "garden_chat"]);
});

test("the artifact viewer renders a blueprint natively and validates it first", () => {
  const viewer = source("src/app/components/hermes/artifact-viewer.tsx");
  assert.match(viewer, /renderer === "hardware-blueprint"/);
  assert.match(viewer, /parseStoredDesign/);
  assert.match(viewer, /HardwareBlueprintArtifact/);
  assert.match(viewer, /Hardware blueprint · /);
});

test("the API routes exist for starting, streaming and stopping a run", () => {
  for (const route of [
    "src/app/api/hardware-blueprint/runs/route.ts",
    "src/app/api/hardware-blueprint/runs/[runId]/events/route.ts",
    "src/app/api/hardware-blueprint/runs/[runId]/abort/route.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(dashboardRoot, route)), `${route} is missing`);
    assert.match(source(route), /requireUserId/, `${route} does not authenticate`);
  }
  const route = source("src/app/api/hardware-blueprint/runs/route.ts");
  const manager = source("src/lib/hardware/run-manager.ts");
  assert.match(route, /clientMessageId/);
  assert.match(route, /branchGroupId/);
  assert.match(route, /recordExternalAgentTurn/);
  assert.match(route, /setRunTerminalHandler/);
  assert.match(route, /finishExternalAgentTurn/);
  assert.match(route, /error instanceof ConversationStoreError/);
  assert.match(manager, /__breadboardHardwareBlueprintLaunches/);
  assert.match(manager, /existing\.requestSignature !== requestSignature/);
  assert.match(manager, /publishTerminal/);
});

test("server-first persistence replays flagged Blueprint briefs without a descriptor conflict", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const launchStart = terminal.indexOf("const launchHardwareBlueprintRun");
  const launchEnd = terminal.indexOf("const routeHardwareBlueprintCommand", launchStart);
  const launch = terminal.slice(launchStart, launchEnd);
  assert.match(launch, /const normalizedBrief = brief\.trim\(\)/);
  assert.equal(
    (launch.match(/brief: normalizedBrief/g) ?? []).length,
    2,
    "the run request and its replay descriptor do not use the same brief",
  );

  const route = source("src/app/api/hardware-blueprint/runs/route.ts");
  const descriptorStart = route.indexOf("const externalRun = {");
  const descriptor = route.slice(descriptorStart, descriptorStart + 500);
  assert.match(descriptor, /\n\s*brief,\s*\n/);
  assert.doesNotMatch(descriptor, /brief: parsed\.brief/);
});

test("a published blueprint survives storage and forks a new version on revision", async () => {
  const Database = (await import("better-sqlite3")).default;
  const os = await import("node:os");
  const { ensureArtifactSchema } = await import("../src/lib/hermes/artifact-schema.ts");
  const { createArtifact, readArtifactSource, renderArtifact, updateArtifactContent, artifactFile } =
    await import("../src/lib/hermes/artifact-store.ts");
  const { buildDesign, applyModification } = await import("../src/lib/hardware/design.ts");
  const { parseStoredDesign } = await import("../src/lib/hardware/schemas.ts");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hardware-artifact-store-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  const storageRoot = path.join(root, "storage");
  try {
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
      CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
      CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
      CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
      CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES (1);
      INSERT INTO conversations VALUES (12, 'conv_terminal', 1, 'dashboard_terminal', NULL);
      INSERT INTO hermes_runtime_sessions VALUES (20);
      INSERT INTO hermes_runs VALUES ('run_one', 20);
    `);
    ensureArtifactSchema(database);

    const request = {
      purpose: "Build an ESP32 weather station with a BME280 and a 128x64 OLED",
      controller: "ESP32",
      inputs: [{ type: "BME280", quantity: 1 }],
      outputs: [{ type: "128x64 OLED", quantity: 1 }],
      communication: ["i2c", "wifi"],
      power: { source: "usb" },
      prototypeType: "breadboard",
      firmware: { platform: "platformio", language: "cpp" },
      constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
    };
    const { design } = buildDesign({ request, designId: "hwd_store_test" });

    const created = createArtifact({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 12,
      clusterId: null,
      runId: "run_one",
      assistantMessageId: null,
      surface: "dashboard_terminal",
      kind: "data",
      rendererId: "hardware-blueprint",
      title: `Hardware Blueprint: ${design.title}`,
      filename: "hardware-design.json",
      content: `${JSON.stringify(design, null, 2)}\n`,
      metadata: { hardwareBlueprint: true, hardwareStatus: design.status },
      sourceHermesTool: "hardware_blueprint_compile",
      database,
      storageRoot,
    });
    const rendered = await renderArtifact({
      artifact: created,
      runId: "run_one",
      assistantMessageId: null,
      database,
      storageRoot,
    });
    assert.equal(rendered.status, "ready", JSON.stringify(rendered.error_json));
    assert.equal(rendered.current_version, 1);
    assert.ok(rendered.preview_location, "no preview was published");

    // Reopening reads the stored design back with nothing else involved.
    const restored = parseStoredDesign(
      JSON.parse(readArtifactSource(rendered, 1, storageRoot, database)),
    );
    assert.equal(restored.ok, true, JSON.stringify(restored.issues ?? []));
    assert.equal(restored.value.components.length, design.components.length);
    assert.equal(restored.value.firmware.files.length, 4);

    const preview = artifactFile({
      artifact: rendered,
      version: 1,
      purpose: "preview",
      database,
      storageRoot,
    });
    assert.ok(fs.existsSync(preview.path));

    // A follow-up change forks a second version of the same artifact.
    const displayId = design.components.find(
      (instance) => instance.definitionId === "ssd1306-oled-128x64",
    ).id;
    const outcome = applyModification(design, {
      operations: [
        { type: "remove-component", targetComponentId: displayId },
        { type: "add-component", componentDefinitionId: "led-5mm", quantity: 1 },
      ],
    });
    const revised = buildDesign({ request: outcome.request, designId: design.id }).design;
    const forked = updateArtifactContent({
      artifact: rendered,
      content: `${JSON.stringify(revised, null, 2)}\n`,
      mode: "fork",
      runId: "run_one",
      assistantMessageId: null,
      database,
      storageRoot,
    });
    const publishedRevision = await renderArtifact({
      artifact: forked,
      runId: "run_one",
      assistantMessageId: null,
      database,
      storageRoot,
    });
    assert.equal(publishedRevision.current_version, 2);
    assert.equal(publishedRevision.status, "ready");

    const v2 = parseStoredDesign(
      JSON.parse(readArtifactSource(publishedRevision, 2, storageRoot, database)),
    );
    assert.equal(v2.ok, true);
    assert.ok(!v2.value.components.some((c) => c.definitionId === "ssd1306-oled-128x64"));
    assert.ok(v2.value.components.some((c) => c.definitionId === "led-5mm"));
    // The earlier revision is still there.
    const v1 = parseStoredDesign(
      JSON.parse(readArtifactSource(publishedRevision, 1, storageRoot, database)),
    );
    assert.equal(v1.ok, true);
    assert.ok(v1.value.components.some((c) => c.definitionId === "ssd1306-oled-128x64"));
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a blueprint artifact belongs to the chat turn that produced it", async () => {
  const Database = (await import("better-sqlite3")).default;
  const os = await import("node:os");
  const { ensureArtifactSchema } = await import("../src/lib/hermes/artifact-schema.ts");
  const { createArtifact, getArtifactById, setArtifactOriginatingMessage } =
    await import("../src/lib/hermes/artifact-store.ts");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hardware-artifact-owner-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  const storageRoot = path.join(root, "storage");
  try {
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
      CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
      CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
      CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
      CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES (1);
      INSERT INTO conversations VALUES (12, 'conv_terminal', 1, 'dashboard_terminal', NULL);
      INSERT INTO hermes_runtime_sessions VALUES (20);
      INSERT INTO hermes_runs VALUES ('run_one', 20);
      INSERT INTO conversation_messages VALUES (77), (78);
    `);
    ensureArtifactSchema(database);

    const created = createArtifact({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 12,
      clusterId: null,
      runId: "run_one",
      assistantMessageId: 77,
      surface: "dashboard_terminal",
      kind: "data",
      rendererId: "hardware-blueprint",
      title: "Hardware Blueprint: Reader",
      filename: "hardware-design.json",
      content: "{}\n",
      sourceHermesTool: "hardware_blueprint_compile",
      database,
      storageRoot,
    });
    // The transcript places a card by this column; null puts it in the
    // unassigned pile at the end of the chat instead of under its response.
    assert.equal(created.originating_message_id, 77);

    // A revision forks the same artifact, so its one card follows the turn that
    // asked for the change.
    setArtifactOriginatingMessage({
      artifactId: created.id,
      assistantMessageId: 78,
      database,
    });
    assert.equal(getArtifactById(created.id, database).originating_message_id, 78);

    // A run with no stored turn must not clear an owner that is already set.
    setArtifactOriginatingMessage({
      artifactId: created.id,
      assistantMessageId: null,
      database,
    });
    assert.equal(getArtifactById(created.id, database).originating_message_id, 78);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the blueprint run resolves the turn it is publishing into", () => {
  const artifact = source("src/lib/hardware/artifact.ts");
  const runManager = source("src/lib/hardware/run-manager.ts");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");

  // The run works in the background, so the run id is its only handle on the
  // turn: nothing about the launching chat is in scope by the time it publishes.
  assert.match(runManager, /agentRunId: run\.runId/);
  assert.match(artifact, /findExternalAgentAssistantMessage\(\{/);
  assert.match(artifact, /runId: input\.agentRunId/);
  assert.match(artifact, /const assistantMessageId = input\.context\.assistantMessageId/);
  assert.doesNotMatch(artifact, /assistantMessageId: null/);
  assert.match(artifact, /setArtifactOriginatingMessage\(\{ artifactId: artifact\.id, assistantMessageId \}\)/);
  // No chat stream announces a background run's artifacts, so the transcript
  // only learns about them when the run ends.
  assert.match(panel, /externalRunWasActive\.current && !externalRunActive/);
  assert.match(panel, /ARTIFACT_BROWSER_EVENT/);
});

test("a product-level brief can never compile to a bare board", async () => {
  const { buildDesign } = await import("../src/lib/hardware/design.ts");

  // What "i want to build something kindle like" produced: interpretation named
  // no part, so the compiler emitted a controller on a breadboard and every
  // other rule found nothing wrong with it.
  const bare = buildDesign({
    request: {
      purpose: "Build a Kindle-like e-reader",
      inputs: [],
      outputs: [],
      communication: [],
      power: { source: "usb" },
      prototypeType: "breadboard",
      firmware: { platform: "platformio", language: "cpp" },
      constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
    },
    designId: "hwd_empty_test",
  }).design;
  const emptyFindings = bare.validationResults.filter((entry) => entry.rule === "EMPTY_DESIGN");
  assert.equal(emptyFindings.length, 1, "a bare board reported no EMPTY_DESIGN error");
  assert.equal(emptyFindings[0].severity, "error");
  assert.equal(bare.status, "needs-changes");

  // The guard is about an empty design, not about small ones.
  const oneLed = buildDesign({
    request: {
      purpose: "Blink an LED",
      controller: "Arduino Uno",
      inputs: [],
      outputs: [{ type: "LED", quantity: 1 }],
      communication: [],
      power: { source: "usb" },
      prototypeType: "breadboard",
      firmware: { platform: "platformio", language: "cpp" },
      constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
    },
    designId: "hwd_one_led_test",
  }).design;
  assert.ok(!oneLed.validationResults.some((entry) => entry.rule === "EMPTY_DESIGN"));

  // And interpretation is told to fill in the parts a product implies rather
  // than hand the compiler an empty request in the first place.
  const client = source("src/lib/hardware/model-client.ts");
  assert.match(client, /`inputs` and `outputs`/);
  assert.match(client, /never both be empty/);
});

test("the run reports its thinking time and the tokens it spent", () => {
  // Both model steps hand their completion usage back, the run adds them up and
  // streams the running total, and the card shows the same Thinking line every
  // other agent has instead of silently omitting it.
  const client = source("src/lib/hardware/model-client.ts");
  assert.match(client, /onUsage\?: \(usage: unknown\) => void/);
  assert.match(client, /if \(data\.usage\) target\.onUsage\?\.\(data\.usage\)/);

  const manager = source("src/lib/hardware/run-manager.ts");
  assert.match(manager, /sumChatTokenUsage/);
  assert.match(manager, /emit\(run, "run\.usage"/);
  assert.match(manager, /const usage = \{ \.\.\.sumChatTokenUsage\(spent\), responseDurationMs: elapsedMs \}/);
  assert.match(manager, /emit\(run, "run\.completed", \{[\s\S]*?usage,/);
  // Four paths may spend tokens now: interpretation, bounded component
  // research, firmware logic, and the enclosure hand-off to Parametric CAD.
  assert.equal((manager.match(/onUsage,/g) ?? []).length, 4, "a model step is not reporting usage");

  const card = source("src/app/components/hermes/inline-hardware-blueprint-run.tsx");
  assert.match(card, /<AssistantResponseMeta/);
  assert.match(card, /agentName="Hardware Blueprint"/);
  assert.match(card, /"run\.usage"/);
  assert.match(card, /persistedUsage\?: ChatTokenUsage/);
  assert.match(card, /counts\.errors > 0/);
  assert.match(card, /needsChanges \? "needs changes" : status/);
  for (const host of [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    assert.match(
      source(host),
      /<InlineHardwareBlueprintRun[\s\S]{0,600}?persistedUsage=\{(?:msg|message)\.usage\}/,
      `${host} does not restore the blueprint's token usage`,
    );
  }
});

test("retrying an external agent turn replaces it instead of duplicating it", () => {
  // The pending turn used to be appended to the end of the transcript while the
  // turn being retried was still in it, so the same request showed up twice
  // until the run started — and permanently when starting failed.
  const session = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(session, /function withoutReplacedBranch/);
  assert.match(session, /\.\.\.withoutReplacedBranch\(current, input\.branchGroupId\)/);
  assert.match(session, /"clientMessageId" \| "userContent" \| "attachments" \| "branchGroupId"/);

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  for (const launcher of ["const launchSocialsManagerRun", "const launchHardwareBlueprintRun"]) {
    const start = terminal.indexOf(launcher);
    assert.ok(start > 0, `${launcher} is gone`);
    const preview = terminal.indexOf("previewExternalAgentTurn({", start);
    assert.ok(preview > start, `${launcher} no longer previews its turn`);
    assert.match(
      terminal.slice(preview, preview + 240),
      /branchGroupId: options\.branchGroupId/,
      "a retry-routed launcher still previews without its branch",
    );
  }
  const hardwareStart = terminal.indexOf("const launchHardwareBlueprintRun");
  const hardwareRoute = terminal.indexOf('"/api/hardware-blueprint/runs"', hardwareStart);
  assert.match(
    terminal.slice(hardwareRoute, hardwareRoute + 700),
    /branchGroupId: options\.branchGroupId/,
    "the server-first Blueprint turn loses its retry branch on refresh",
  );
});

test("no view invents its own pin assignments", () => {
  // Wiring, schematic, assembly and firmware all read the compiler's output.
  // A hard-coded pin number in any of them would be a second source of truth.
  for (const file of [
    "src/app/components/hardware/wiring-view.tsx",
    "src/app/components/hardware/schematic-view.tsx",
    "src/lib/hardware/assembly.ts",
  ]) {
    assert.doesNotMatch(
      source(file),
      /\bGPIO\d+\b|\bPIN_[A-Z0-9_]+\b/,
      `${file} names a pin directly`,
    );
  }
});
