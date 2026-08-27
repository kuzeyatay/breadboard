// The CAD backend selector: the setting, the flag, the precedence between them,
// and the SolidWorks backend the choice can reach.
//
// Nothing here needs Windows, SolidWorks, a licence, or the SolidworksMCP-python
// clone. The bridge is a seam — `buildWithSolidWorks` takes one — so the whole
// operation path is exercised against a fake that records what it was asked to
// do. The one place a real machine matters is availability, and that is asserted
// per platform rather than skipped.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const engines = await import("../src/lib/cad/engines.ts");
const operations = await import("../src/lib/cad/solidworks/operations.ts");
const availability = await import("../src/lib/cad/solidworks/availability.ts");
const bridgeModule = await import("../src/lib/cad/solidworks/bridge.ts");
const backend = await import("../src/lib/cad/solidworks/backend.ts");
const errors = await import("../src/lib/cad/errors.ts");
const cadTools = await import("../src/lib/cad/tools.ts");
const prompts = await import("../src/lib/cad/prompts.ts");
const { parseHardwareBlueprintRequest } = await import("../src/lib/hardware/identity.ts");
const { hardwarePreferences } = await import("../src/lib/agent-settings/defaults.ts");
const { findConfigurableAgent, agentSettingDefaults, normalizeAgentSettings } = await import(
  "../src/lib/agent-settings/catalog.ts"
);
const { ensureAgentSettingsSchema } = await import("../src/lib/agent-settings/schema.ts");
const { assessCadSafety } = await import("../src/lib/cad/safety.ts");

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

test("the CAD backend is a card on the Hardware Blueprint settings, not a switch", () => {
  const agent = findConfigurableAgent("hardware-blueprint");
  assert.ok(agent, "hardware-blueprint is missing from the settings catalog");
  const field = agent.fields.find((entry) => entry.key === "cadBackend");
  assert.ok(field, "the CAD backend setting is missing");
  assert.equal(field.kind, "select", "a backend selector must not be a boolean toggle");
  assert.equal(field.label, "CAD backend");
  assert.equal(field.help, "Which CAD engine is used when a run needs mechanical CAD.");
  assert.equal(field.flag, "--cad solidworks");
  assert.deepEqual(
    field.options.map((option) => option.value),
    ["auto", "cadquery", "solidworks"],
  );
  assert.deepEqual(
    field.options.map((option) => option.label),
    ["Let the design decide", "Parametric CAD (CadQuery)", "SolidWorks"],
  );
  assert.equal(field.default, "auto");

  // Whether a part is made and who makes it stay two separate questions.
  const enclosure = agent.fields.find((entry) => entry.key === "enclosure");
  assert.ok(enclosure, "the printable-enclosure setting must survive unchanged");
  assert.equal(enclosure.label, "Printable enclosure");
  assert.notEqual(enclosure.key, field.key);
});

test("an upgrading user with no stored backend reads as auto", () => {
  const agent = findConfigurableAgent("hardware-blueprint");
  assert.equal(agentSettingDefaults(agent).cadBackend, "auto");

  // A row saved before this option existed has no key for it at all.
  const legacy = normalizeAgentSettings(agent, { board: "esp32-devkit-v1", enclosure: "always" });
  assert.equal(legacy.cadBackend, "auto");
  assert.equal(hardwarePreferences(legacy).cadBackend, "auto");
  // And the settings it did carry are untouched.
  assert.equal(hardwarePreferences(legacy).board, "esp32-devkit-v1");
  assert.equal(hardwarePreferences(legacy).enclosure, "always");

  // Nonsense is repaired to auto rather than trusted.
  assert.equal(hardwarePreferences({ cadBackend: "freecad" }).cadBackend, "auto");
  assert.equal(hardwarePreferences({}).cadBackend, "auto");
});

test("the backend preference persists through the shared agent-settings store", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT);",
  );
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(
    "k",
    "k@example.com",
    "x",
  );
  ensureAgentSettingsSchema(db);

  const agent = findConfigurableAgent("hardware-blueprint");
  const write = db.prepare(
    `INSERT INTO agent_settings (user_id, agent_id, values_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, agent_id) DO UPDATE SET
       values_json = excluded.values_json,
       updated_at  = excluded.updated_at`,
  );
  const read = db.prepare("SELECT values_json FROM agent_settings WHERE user_id = ? AND agent_id = ?");

  write.run(1, agent.id, JSON.stringify(normalizeAgentSettings(agent, { cadBackend: "solidworks" })));
  const stored = normalizeAgentSettings(agent, JSON.parse(read.get(1, agent.id).values_json));
  assert.equal(stored.cadBackend, "solidworks");
  assert.equal(hardwarePreferences(stored).cadBackend, "solidworks");

  // Reset means no row, which reads as the shipped default.
  db.prepare("DELETE FROM agent_settings WHERE user_id = ? AND agent_id = ?").run(1, agent.id);
  assert.equal(read.get(1, agent.id), undefined);
  db.close();
});

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("--cad is parsed out of the brief for one message", () => {
  for (const [flag, expected] of [
    ["--cad solidworks", "solidworks"],
    ["--cad cadquery", "cadquery"],
    ["--cad auto", "auto"],
    ["--cad=solidworks", "solidworks"],
    ["--CAD SolidWorks", "solidworks"],
  ]) {
    const parsed = parseHardwareBlueprintRequest(`a 100 mm plate ${flag}`);
    assert.equal(parsed.cadBackend, expected, flag);
    assert.equal(parsed.brief, "a 100 mm plate", `${flag} must not survive in the brief`);
  }

  // No flag means the saved preference decides.
  assert.equal(parseHardwareBlueprintRequest("a 100 mm plate").cadBackend, null);

  // An unknown backend is not a backend. It stays in the brief rather than
  // silently selecting something, so the person can see it was not understood.
  const unknown = parseHardwareBlueprintRequest("a plate --cad freecad");
  assert.equal(unknown.cadBackend, null);
  assert.match(unknown.brief, /--cad freecad/);
});

test("--cad is independent of the enclosure flags", () => {
  const parsed = parseHardwareBlueprintRequest(
    "an ESP32 humidity logger --enclosure --cad solidworks --board esp32-devkit-v1",
  );
  assert.equal(parsed.enclosure, true);
  assert.equal(parsed.cadBackend, "solidworks");
  assert.equal(parsed.board, "esp32-devkit-v1");
  assert.equal(parsed.brief, "an ESP32 humidity logger");

  const held = parseHardwareBlueprintRequest("a logger --no-enclosure --cad solidworks");
  assert.equal(held.enclosure, false, "choosing a backend must not ask for a part");
  assert.equal(held.cadBackend, "solidworks");
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test("the flag wins, then the brief, then the setting, then the default", () => {
  const { resolveCadEngine } = engines;

  // 1. The flag beats everything, and is explicit.
  assert.deepEqual(resolveCadEngine({ flag: "solidworks", brief: "cadquery", setting: "cadquery" }), {
    engine: "solidworks",
    explicit: true,
    source: "flag",
  });
  assert.deepEqual(resolveCadEngine({ flag: "cadquery", setting: "solidworks" }), {
    engine: "cadquery",
    explicit: true,
    source: "flag",
  });
  // `--cad auto` asks for automatic selection for this message only, so it
  // outranks the saved preference without being an explicit engine.
  assert.deepEqual(resolveCadEngine({ flag: "auto", setting: "solidworks" }), {
    engine: "cadquery",
    explicit: false,
    source: "flag",
  });

  // 2. A backend the brief itself requires.
  assert.deepEqual(resolveCadEngine({ brief: "solidworks", setting: "cadquery" }), {
    engine: "solidworks",
    explicit: true,
    source: "brief",
  });

  // 3. The saved preference.
  assert.deepEqual(resolveCadEngine({ setting: "solidworks" }), {
    engine: "solidworks",
    explicit: true,
    source: "setting",
  });

  // 4. Nothing said anything.
  assert.deepEqual(resolveCadEngine({ setting: "auto" }), {
    engine: "cadquery",
    explicit: false,
    source: "default",
  });
  assert.deepEqual(resolveCadEngine({}), {
    engine: "cadquery",
    explicit: false,
    source: "default",
  });
});

test("a flag never changes the saved default", () => {
  const agent = findConfigurableAgent("hardware-blueprint");
  const saved = normalizeAgentSettings(agent, { cadBackend: "cadquery" });
  const parsed = parseHardwareBlueprintRequest("a plate --cad solidworks");
  const chosen = engines.resolveCadEngine({
    flag: parsed.cadBackend,
    setting: hardwarePreferences(saved).cadBackend,
  });
  assert.equal(chosen.engine, "solidworks");
  // The stored values are untouched by parsing a message.
  assert.equal(saved.cadBackend, "cadquery");
});

test("CadQuery is what a caller that says nothing gets", () => {
  assert.equal(engines.DEFAULT_CAD_ENGINE, "cadquery");
  // The tool contracts a model is shown default to the CadQuery ones.
  const shipped = cadTools.cadToolDefinitions();
  const generate = shipped.find((tool) => tool.name === "cad_generate_model");
  assert.match(generate.description, /CadQuery program/);
  assert.match(prompts.cadSystemPrompt({ safety: assessCadSafety("a bracket"), attemptBudget: 3 }), /CadQuery/);
});

test("choosing SolidWorks changes the contract the model is given", () => {
  const swTools = cadTools.cadToolDefinitions("solidworks");
  const generate = swTools.find((tool) => tool.name === "cad_generate_model");
  assert.match(generate.description, /SolidWorks/);
  assert.doesNotMatch(generate.description, /CadQuery/);
  assert.match(generate.parameters.properties.source.description, /operations/);

  // Everything else about the contract is the same tool set.
  assert.deepEqual(
    swTools.map((tool) => tool.name),
    cadTools.cadToolDefinitions("cadquery").map((tool) => tool.name),
  );

  const prompt = prompts.cadSystemPrompt({
    safety: assessCadSafety("a mounting plate"),
    attemptBudget: 3,
    engine: "solidworks",
  });
  assert.match(prompt, /SolidWorks/);
  assert.match(prompt, /no chamfer, no Hole Wizard/);
  assert.doesNotMatch(prompt, /DEFAULT_PARAMS/, "a SolidWorks turn must not be told to write CadQuery");
});

// ---------------------------------------------------------------------------
// The operation program
// ---------------------------------------------------------------------------

const PLATE_PROGRAM = JSON.stringify({
  name: "mounting-plate",
  units: "mm",
  operations: [
    {
      op: "sketch",
      plane: "Front",
      entities: [{ kind: "rectangle", x1: -50, y1: -40, x2: 50, y2: 40 }],
    },
    { op: "extrude", depth: 10 },
    {
      op: "sketch",
      plane: "Front",
      entities: [
        { kind: "circle", centerX: -40, centerY: -30, radius: 2.5 },
        { kind: "circle", centerX: 40, centerY: -30, radius: 2.5 },
        { kind: "circle", centerX: -40, centerY: 30, radius: 2.5 },
        { kind: "circle", centerX: 40, centerY: 30, radius: 2.5 },
      ],
    },
    { op: "cut", depth: 12 },
  ],
});

test("an operation program is validated before anything is driven", () => {
  const good = operations.parseSolidWorksProgram(PLATE_PROGRAM);
  assert.equal(good.ok, true);
  assert.equal(good.program.operations.length, 4);

  // Fenced JSON is still JSON.
  assert.equal(
    operations.parseSolidWorksProgram("```json\n" + PLATE_PROGRAM + "\n```").ok,
    true,
  );

  const broken = operations.parseSolidWorksProgram("not json at all");
  assert.equal(broken.ok, false);
  assert.match(broken.issues.join(" "), /not valid JSON/);

  const empty = operations.parseSolidWorksProgram(JSON.stringify({ name: "x", operations: [] }));
  assert.equal(empty.ok, false);
});

test("an operation the bridge cannot perform is refused by name", () => {
  for (const op of ["chamfer", "hole", "rebuild", "revolve", "sweep", "loft", "pattern"]) {
    const result = operations.parseSolidWorksProgram(
      JSON.stringify({ name: "part", operations: [{ op, radius: 2 }] }),
    );
    assert.equal(result.ok, false, `${op} must not be accepted`);
    assert.equal(result.unsupported.op, op);
    assert.ok(result.unsupported.reason.length > 0, `${op} must say why`);
  }
  // And the supported set is exactly what the bridge was verified to expose.
  assert.deepEqual([...operations.SUPPORTED_OPERATIONS], ["sketch", "extrude", "cut", "fillet"]);
});

// ---------------------------------------------------------------------------
// Driving the bridge
// ---------------------------------------------------------------------------

/** A stand-in for the MCP process. Records calls; never starts anything. */
function fakeBridge(options = {}) {
  const calls = [];
  let started = false;
  return {
    calls,
    get started() {
      return started;
    },
    async ensureStarted() {
      started = true;
      if (options.failToStart) throw options.failToStart;
    },
    attachedToExistingSession() {
      return options.attached ?? true;
    },
    async callTool(name, args) {
      calls.push({ name, args });
      if (options.failOn === name) {
        return {
          data: { status: "error", message: options.failMessage ?? "refused" },
          text: "",
          isError: false,
          raw: {},
        };
      }
      const data = { status: "success" };
      if (name === "create_sketch") data.sketch = { name: `Sketch${calls.length}` };
      return { data, text: JSON.stringify(data), isError: false, raw: {} };
    },
  };
}

const buildRequest = {
  source: PLATE_PROGRAM,
  entrypoint: "build_model",
  parameters: {},
  timeoutMs: 45_000,
  exports: [{ format: "glb", filename: "model.glb" }],
  expectations: {},
};

test("a bad program fails before the bridge is touched at all", async () => {
  const bridge = fakeBridge();
  const result = await backend.buildWithSolidWorks({
    source: "{ not json",
    request: buildRequest,
    bridge,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "solidworks_invalid_program");
  assert.equal(result.engine, "solidworks");
  assert.equal(bridge.started, false, "an unreadable program must not start SolidWorks");
  assert.equal(bridge.calls.length, 0);

  const unsupported = await backend.buildWithSolidWorks({
    source: JSON.stringify({ name: "p", operations: [{ op: "chamfer" }] }),
    request: buildRequest,
    bridge,
  });
  assert.equal(unsupported.failure.code, "solidworks_unsupported_operation");
  assert.equal(bridge.started, false);
});

test("the program is driven through the bridge's real tool names, in order", async () => {
  const bridge = fakeBridge({ failOn: "export_step" });
  await assert.rejects(
    backend.buildWithSolidWorks({ source: PLATE_PROGRAM, request: buildRequest, bridge }),
    (error) => error.code === "solidworks_operation_failed",
  );
  const names = bridge.calls.map((call) => call.name);
  assert.deepEqual(names, [
    "create_part",
    "create_sketch",
    "add_rectangle",
    "exit_sketch",
    "create_extrusion",
    "create_sketch",
    "add_circle",
    "add_circle",
    "add_circle",
    "add_circle",
    "exit_sketch",
    "create_cut_extrude",
    "save_as",
    "export_step",
  ]);

  // Millimetres reach the bridge unchanged, under its own argument names.
  const rectangle = bridge.calls.find((call) => call.name === "add_rectangle");
  assert.deepEqual(rectangle.args, { x1: -50, y1: -40, x2: 50, y2: 40, construction: false });
  const extrude = bridge.calls.find((call) => call.name === "create_extrusion");
  assert.equal(extrude.args.depth, 10);
  const circle = bridge.calls.find((call) => call.name === "add_circle");
  assert.deepEqual(circle.args, { center_x: -40, center_y: -30, radius: 2.5, construction: false });

  // The native part is saved before anything is derived from it.
  const saveIndex = names.indexOf("save_as");
  assert.ok(saveIndex < names.indexOf("export_step"));
  const save = bridge.calls[saveIndex];
  assert.equal(save.args.format_type, "solidworks");
  assert.match(save.args.file_path, /\.SLDPRT$/);
});

test("a modelling operation SolidWorks refuses becomes a structured failure", async () => {
  const bridge = fakeBridge({ failOn: "create_extrusion", failMessage: "profile is open" });
  await assert.rejects(
    backend.buildWithSolidWorks({ source: PLATE_PROGRAM, request: buildRequest, bridge }),
    (error) => {
      assert.equal(error.code, "solidworks_operation_failed");
      assert.match(error.message, /profile is open/);
      return true;
    },
  );
  // It stops at the failure rather than carrying on to export nothing.
  assert.equal(bridge.calls.some((call) => call.name === "export_step"), false);

  const described = errors.describeCadFailure("solidworks_operation_failed", "profile is open");
  assert.match(described.message, /profile is open/);
  assert.ok(described.repairHint, "the model must be told what to change");
});

test("a bridge that will not start becomes a structured failure, not a crash", async () => {
  const failure = new errors.CadServiceError(
    "solidworks_bridge_failed",
    "The SolidWorks bridge could not be started.",
  );
  const bridge = fakeBridge({ failToStart: failure });
  await assert.rejects(
    backend.buildWithSolidWorks({ source: PLATE_PROGRAM, request: buildRequest, bridge }),
    (error) => error.code === "solidworks_bridge_failed",
  );
  assert.equal(errors.describeCadFailure("solidworks_bridge_crashed").retryable, true);
  assert.equal(errors.describeCadFailure("solidworks_unavailable", "no clone").message, "no clone");
});

// ---------------------------------------------------------------------------
// Availability, ownership, and the lazy lifecycle
// ---------------------------------------------------------------------------

test("an unusable machine produces a typed, actionable state", async () => {
  if (process.platform !== "win32") {
    const status = await availability.solidworksAvailability({});
    assert.equal(status.available, false);
    assert.equal(status.code, "unsupported_os");
    assert.match(status.message, /Windows only/);
    assert.equal(availability.describeSolidWorksAvailability(status), "Windows only");
    return;
  }

  // On Windows the first thing that can be missing is the clone, and the
  // message has to name the setting that fixes it.
  const missing = path.join(os.tmpdir(), "breadboard-no-such-solidworks-mcp");
  const status = await availability.solidworksAvailability({
    BREADBOARD_SOLIDWORKS_MCP_PATH: missing,
  });
  assert.equal(status.available, false);
  assert.equal(status.code, "mcp_not_configured");
  assert.match(status.message, /BREADBOARD_SOLIDWORKS_MCP_PATH/);
  assert.equal(availability.describeSolidWorksAvailability(status), "Bridge not configured");
});

test("every unavailable state has a label the settings panel can show", () => {
  const labels = [
    "unsupported_os",
    "mcp_not_configured",
    "python_missing",
    "dependencies_missing",
    "solidworks_not_installed",
  ].map((code) =>
    availability.describeSolidWorksAvailability({ available: false, code, running: null }),
  );
  assert.equal(new Set(labels).size >= 4, true);
  for (const label of labels) assert.ok(label.length > 0);
  assert.equal(
    availability.describeSolidWorksAvailability({ available: true, code: "available", running: true }),
    "Running",
  );
  assert.equal(
    availability.describeSolidWorksAvailability({ available: true, code: "available", running: false }),
    "Installed, not running",
  );
});

test("a SolidWorks session that was already open is never claimed as ours", () => {
  // Already running: the user's. Not running: ours. Could not tell: the user's.
  assert.equal(bridgeModule.ownsLaunchedSolidWorks(true), false);
  assert.equal(bridgeModule.ownsLaunchedSolidWorks(false), true);
  assert.equal(bridgeModule.ownsLaunchedSolidWorks(null), false);
});

test("nothing starts SolidWorks or its bridge when Breadboard starts", () => {
  // Importing every module above is what a cold server does; the singleton must
  // still be idle.
  const status = bridgeModule.solidworksBridge().status();
  assert.equal(status.running, false);
  assert.equal(status.ownsSolidWorks, false);
  assert.equal(status.startedAt, null);

  const bridge = source("src/lib/cad/solidworks/bridge.ts");
  // The process is started from `ensureStarted`, which is only reached from a
  // tool call — never at module scope and never from a health probe.
  assert.match(bridge, /async ensureStarted\(/);
  assert.doesNotMatch(bridge, /^\s*(void )?solidworksBridge\(\)\.ensureStarted/m);
  assert.doesNotMatch(source("src/app/api/cad/health/route.ts"), /ensureStarted/);
  assert.doesNotMatch(source("src/lib/cad/solidworks/availability.ts"), /ensureStarted|spawn\(/);
});

test("SolidWorks is only reached when a run actually needs mechanical CAD", () => {
  const runManager = source("src/lib/hardware/run-manager.ts");
  // The backend is resolved every run — it is cheap and it is logged — but the
  // CAD agent, and therefore the bridge, is only called inside the branch that
  // decided there is a part to make.
  assert.match(runManager, /resolveCadEngine\(/);
  const enclosureBranch = runManager.slice(runManager.indexOf("if (enclosure.wanted)"));
  assert.match(enclosureBranch, /designCadPart\(/);
  assert.equal(
    runManager.slice(0, runManager.indexOf("if (enclosure.wanted)")).includes("designCadPart("),
    false,
    "a run with no physical part must never reach the CAD agent",
  );

  // And the design service only reads the passive Runtime projection when
  // SolidWorks was chosen; it does not lease or wake the bridge here.
  const service = source("src/lib/cad/design-service.ts");
  assert.match(service, /if \(requested === "solidworks"\) \{/);
  assert.match(service, /readSolidWorksRuntimeStatus\(\)/);
  assert.doesNotMatch(service, /solidworksBridge|child_process|acquireServiceLease/);
});

test("an explicit SolidWorks choice never silently falls back to CadQuery", () => {
  const service = source("src/lib/cad/design-service.ts");
  const block = service.slice(
    service.indexOf('if (requested === "solidworks")'),
    service.indexOf("let toolContext"),
  );
  // Explicit: the design fails with the availability message.
  assert.match(block, /if \(input\.engineExplicit\)/);
  assert.match(block, /reason: availability\.message/);
  // Automatic: falling back is allowed, and it is announced rather than silent.
  assert.match(block, /cad\.engine\.fallback/);
  assert.match(block, /engine = DEFAULT_CAD_ENGINE/);
  assert.doesNotMatch(service, /runCadFallback|CadDesignFallback|input\.fallback/);
});

test("the run manager hands the resolved backend to the CAD agent", () => {
  const runManager = source("src/lib/hardware/run-manager.ts");
  assert.match(runManager, /engine: cadEngine\.engine/);
  assert.match(runManager, /engineExplicit: cadEngine\.explicit/);
  // The flag is read from the parsed message, the preference from settings.
  assert.match(runManager, /flag: input\.parsed\.cadBackend/);
  assert.match(runManager, /setting: input\.preferences\?\.cadBackend/);
});

// ---------------------------------------------------------------------------
// Results and the health endpoint
// ---------------------------------------------------------------------------

test("a SolidWorks build is recorded through the same path as a CadQuery one", () => {
  const tools = source("src/lib/cad/tools.ts");
  // One branch, at the execution step, and nowhere else.
  assert.match(tools, /engine === "solidworks"\s*\?\s*await buildWithSolidWorks/);
  assert.equal(tools.split("buildWithSolidWorks").length - 1, 2, "one import, one call site");
  // The native part and the operation program get their own export slots.
  assert.match(tools, /engine === "solidworks" \? "operations" : "source"/);
  const store = source("src/lib/cad/blob-store.ts");
  assert.match(store, /sldprt: \{/);
  assert.match(store, /operations: \{/);
});

test("a mass-properties payload is read in the shape the bridge really sends", () => {
  // The bridge reports each quantity as {value, units} inside `mass_properties`,
  // not as a bare number. Reading it as a number would silently lose
  // SolidWorks' own cross-check against the measured STEP.
  assert.deepEqual(
    backend.massPropertiesFrom({
      status: "success",
      message: "Mass properties calculated successfully",
      mass_properties: {
        volume: { value: 78_037.2, units: "mm³" },
        surface_area: { value: 19_884.9, units: "mm²" },
        mass: { value: 0.21, units: "kg" },
      },
    }),
    { volume: 78_037.2, surfaceArea: 19_884.9 },
  );

  // The adapter's own flatter shape is read too.
  assert.deepEqual(backend.massPropertiesFrom({ data: { volume: 1_000, surface_area: 600 } }), {
    volume: 1_000,
    surfaceArea: 600,
  });

  // A payload with no measurement in it yields absence, never zero.
  assert.deepEqual(backend.massPropertiesFrom({ status: "error", message: "No active model" }), {
    volume: null,
    surfaceArea: null,
  });
});

test("measurements come from the kernel, never from the model", () => {
  const backendSource = source("src/lib/cad/solidworks/backend.ts");
  // The STEP SolidWorks exported is measured by the existing convert path, so
  // the bounding box, volume and mesh are the same measurements a CadQuery
  // build produces.
  assert.match(backendSource, /cadServiceConvert\(/);
  assert.match(backendSource, /solidworks_measurement_unavailable/);
  // SolidWorks' own numbers are a cross-check, and a disagreement is reported.
  assert.match(backendSource, /solidworks_volume_disagreement/);
  // An unobtainable measurement is absent rather than zero.
  assert.match(backendSource, /volume: null, surfaceArea: null/);
});

test("a file the bridge reports is validated before it is read", () => {
  const backendSource = source("src/lib/cad/solidworks/backend.ts");
  assert.match(backendSource, /solidworks_export_escaped_workspace/);
  assert.match(backendSource, /solidworksWorkspaceRoot/);
  // Parts are written into Breadboard's own workspace, never over the user's.
  const config = source("src/lib/cad/solidworks/config.ts");
  assert.match(config, /BREADBOARD_SOLIDWORKS_MCP_PATH/);
  assert.match(config, /path\.join\(candidate, "src", "solidworks_mcp", "server\.py"\)/);
  assert.doesNotMatch(
    config,
    /CLONE_MARKERS|path\.join\(candidate,\s*marker\)/,
    "clone discovery must not make the production bundler enumerate an arbitrary candidate tree",
  );
  assert.match(config, /existsSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(config, /statSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(config, /readdirSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(
    config,
    /path\.join\(\/\* turbopackIgnore: true \*\/ base, name\)/,
  );
  const nextConfig = source("next.config.ts");
  assert.match(
    nextConfig,
    /const bundlerRoot = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/,
  );
  assert.doesNotMatch(nextConfig, /const turbopackRoot|process\.cwd\(\), "\.\."/);
  assert.match(nextConfig, /outputFileTracingRoot:\s*bundlerRoot/);
  assert.match(nextConfig, /turbopack:\s*\{[\s\S]*?root:\s*bundlerRoot/);
  assert.doesNotMatch(config, /C:\\\\Users\\\\/, "no absolute developer path may be hard-coded");
});

test("the health endpoint reports each backend, and starts none of them", () => {
  const route = source("src/app/api/cad/health/route.ts");
  assert.match(route, /requireUserId/);
  assert.match(route, /readSolidWorksRuntimeStatus/);
  assert.doesNotMatch(route, /solidworksBridge|child_process|acquireServiceLease/);
  assert.match(route, /engines: \{/);
  assert.match(route, /cadquery: \{/);
  // No hardcoded engine list survives.
  assert.doesNotMatch(route, /\["cadquery"\]/);
  const service = fs.readFileSync(
    path.join(dashboardRoot, "..", "cad-service", "breadboard_cad", "server.py"),
    "utf8",
  );
  assert.match(service, /engines=\["cadquery"\] if healthy else \[\]/);
});

test("the SolidWorks bridge is never given Breadboard's credentials", () => {
  const bridge = source("src/lib/cad/solidworks/bridge.ts");
  // An allowlist, so a provider key can never be inherited by a child process
  // that drives a desktop application.
  assert.match(bridge, /const carried = \[/);
  assert.doesNotMatch(bridge, /\.\.\.process\.env/);
  assert.doesNotMatch(bridge, /OPENAI_API_KEY|ANTHROPIC_API_KEY/);
  // And no shell, so a path with a space cannot become an argument boundary.
  assert.match(bridge, /shell: false/);
  // stdio only, on this machine. Nothing is bound to a network interface.
  assert.doesNotMatch(bridge, /0\.0\.0\.0|--host/);
});
