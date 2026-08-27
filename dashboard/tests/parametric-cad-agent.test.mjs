import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const identity = await import("../src/lib/cad/identity.ts");
const schemas = await import("../src/lib/cad/schemas.ts");
const defaults = await import("../src/lib/cad/defaults.ts");
const safety = await import("../src/lib/cad/safety.ts");
const errors = await import("../src/lib/cad/errors.ts");
const tools = await import("../src/lib/cad/tools.ts");
const enclosures = await import("../src/lib/cad/board-enclosures.ts");
const designService = await import("../src/lib/cad/design-service.ts");
const { artifactRenderer, availableArtifactRenderers } = await import(
  "../src/lib/hermes/artifact-renderers.ts"
);
const { parseExternalAgentRun, externalAgentMessageFields, EXTERNAL_AGENT_RUN_KINDS } =
  await import("../src/lib/conversations/external-agent-runs.ts");
const { runtimeAgentByToken, findCapabilityConflict } = await import(
  "../src/lib/hermes/capability-combinations.ts"
);

test("editable CAD parameters must actually drive geometry", () => {
  const issues = tools.unusedCadParameterIssues(
    `# eye_relief is adjustable\ndef build_model(params):\n    width = params["width"]\n    return width`,
    {
      parameters: [
        { id: "width", label: "Width", value: 20, editable: true },
        { id: "eye_relief", label: "Eye relief", value: 18, editable: true },
        { id: "note_only", label: "Internal note", value: 1, editable: false },
      ],
    },
  );
  assert.deepEqual(issues.map((issue) => issue.feature), ["eye_relief"]);
  assert.equal(issues[0].severity, "error");
});

test("an old valid revision cannot masquerade as this turn's CAD build", () => {
  const project = { id: "cadp_revision_identity", current_revision: 4 };

  assert.equal(
    designService.isCurrentBuildFromThisTurn({}, project, 4),
    false,
    "a no-op model response must not reuse the existing current revision",
  );
  assert.equal(
    designService.isCurrentBuildFromThisTurn(
      {
        lastBuild: {
          projectId: project.id,
          revision: 5,
          status: "invalid",
          issues: [{ code: "invalid_shape", severity: "error", message: "bad solid" }],
        },
      },
      project,
      4,
    ),
    false,
    "a failed revision leaves current_revision on the older model and must fail the turn",
  );
  assert.equal(
    designService.isCurrentBuildFromThisTurn(
      {
        lastBuild: {
          projectId: project.id,
          revision: 4,
          status: "valid",
          issues: [],
        },
      },
      project,
      4,
    ),
    false,
    "even a valid stored revision is stale unless this request advanced it",
  );
  assert.equal(
    designService.isCurrentBuildFromThisTurn(
      {
        lastBuild: {
          projectId: "cadp_other_project",
          revision: 5,
          status: "valid",
          issues: [],
        },
      },
      { ...project, current_revision: 5 },
      4,
    ),
    false,
    "revision numbers are project-local",
  );
  assert.equal(
    designService.isCurrentBuildFromThisTurn(
      {
        lastBuild: {
          projectId: project.id,
          revision: 5,
          status: "valid-with-warnings",
          issues: [{ code: "clearance", severity: "warning", message: "review clearance" }],
        },
      },
      { ...project, current_revision: 5 },
      4,
    ),
    true,
  );

  const manager = source("src/lib/cad/run-manager.ts");
  const publicationGate = manager.indexOf("outcome.builtRevision !== manifest.revision");
  const artifactFork = manager.indexOf("openCadArtifactContext({");
  assert.ok(publicationGate > 0 && artifactFork > publicationGate);
  assert.match(manager, /outcome\.builtRevision <= outcome\.startingRevision/);
  assert.match(manager, /!manifest\.validation\.passed/);
});

// ---------------------------------------------------------------------------
// Agent registration
// ---------------------------------------------------------------------------

test("the agent has one canonical slash command", () => {
  assert.equal(identity.PARAMETRIC_CAD_COMMAND, "/agents:parametric-cad");
  assert.equal(identity.PARAMETRIC_CAD_AGENT_ID, "parametric-cad");
  assert.equal(identity.PARAMETRIC_CAD_AGENT_NAME, "Parametric CAD");
  assert.equal(
    identity.parametricCadUserMessage("a bracket"),
    "/agents:parametric-cad a bracket",
  );
  assert.equal(
    identity.taskFromParametricCadCommand("  /AGENTS:PARAMETRIC-CAD  a 60 mm spacer"),
    "a 60 mm spacer",
  );
  assert.equal(identity.taskFromParametricCadCommand("/agents:parametric-cad"), "");
  assert.equal(identity.taskFromParametricCadCommand("/agents:hardware-blueprint x"), null);
  assert.equal(identity.taskFromParametricCadCommand("design a bracket"), null);
});

test("a preceding capability token is preserved for the resolver", () => {
  assert.equal(
    identity.taskFromParametricCadCommand("/some-skill /agents:parametric-cad a plate"),
    "/some-skill a plate",
  );
});

test("inline flags are parsed out of the brief", () => {
  const parsed = identity.parseParametricCadRequest(
    "a Pi enclosure --sla --bed 145x90x175 --inch --fresh",
  );
  assert.equal(parsed.brief, "a Pi enclosure");
  assert.equal(parsed.process, "sla");
  assert.deepEqual(parsed.printerBed, { x: 145, y: 90, z: 175 });
  assert.equal(parsed.units, "inch");
  assert.equal(parsed.fresh, true);

  const plain = identity.parseParametricCadRequest("a 20 mm spacer");
  assert.equal(plain.brief, "a 20 mm spacer");
  assert.equal(plain.process, null);
  assert.equal(plain.printerBed, null);
  assert.equal(plain.units, null);
  assert.equal(plain.fresh, false);
});

test("the runtime-agent table knows the agent", () => {
  const agent = runtimeAgentByToken("agents:parametric-cad");
  assert.equal(agent?.id, "parametric-cad");
  assert.equal(agent?.name, "Parametric CAD");
  assert.deepEqual([...agent.surfaces], ["dashboard_terminal", "garden_chat"]);
  // It runs the whole message itself, so a stacked skill is refused rather than
  // delivered as prose.
  assert.equal(agent.stacksCapabilities, false);
  assert.equal(agent.acceptsAttachments, false);
});

test("conflicting capabilities are refused by the shared rules", () => {
  const stacked = findCapabilityConflict({
    text: "/my-skill /agents:parametric-cad a bracket",
    surface: "dashboard_terminal",
  });
  assert.equal(stacked?.code, "runtime_agent_capability_conflict");

  const twoAgents = findCapabilityConflict({
    text: "/agents:parametric-cad /agents:hardware-blueprint a thing",
    surface: "dashboard_terminal",
  });
  assert.equal(twoAgents?.code, "conflicting_runtime_agents");

  const quartz = findCapabilityConflict({
    text: "/agents:parametric-cad a bracket",
    surface: "quartz_ai",
  });
  assert.equal(quartz?.code, "runtime_agent_surface_unavailable");

  assert.equal(
    findCapabilityConflict({ text: "/agents:parametric-cad a bracket", surface: "garden_chat" }),
    null,
  );
});

test("the run kind round-trips through the durable transcript", () => {
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("parametric_cad"));
  const run = parseExternalAgentRun({
    kind: "parametric_cad",
    runId: "cadrun_1",
    brief: "a wall-mounted Pi enclosure",
  });
  assert.deepEqual(run, {
    kind: "parametric_cad",
    runId: "cadrun_1",
    brief: "a wall-mounted Pi enclosure",
  });
  assert.equal(parseExternalAgentRun({ kind: "parametric_cad", runId: "x" }), null);

  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: run,
    externalAgentOutcome: "completed",
  });
  assert.deepEqual(fields.parametricCadRun, {
    runId: "cadrun_1",
    brief: "a wall-mounted Pi enclosure",
  });
  assert.equal(fields.externalAgentOutcome, "completed");
});

test("the agent is reachable from every chat surface", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /PARAMETRIC_CAD_COMMAND/);
  assert.match(hub, /onSelectParametricCad/);
  assert.match(hub, /3D-printable part/);

  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /insertCommandToken\(PARAMETRIC_CAD_COMMAND\)/);

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(terminal, /routeParametricCadCommand/);
  assert.match(terminal, /\/api\/cad\/runs/);
  assert.match(terminal, /kind: "parametric_cad"/);

  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(garden, /launchParametricCad/);
  assert.match(garden, /InlineParametricCadRun/);

  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(panel, /message\.parametricCadRun/);
});

test("every API route authenticates", () => {
  for (const route of [
    "src/app/api/cad/runs/route.ts",
    "src/app/api/cad/runs/[runId]/events/route.ts",
    "src/app/api/cad/runs/[runId]/abort/route.ts",
    "src/app/api/cad/health/route.ts",
    "src/app/api/cad/projects/[projectId]/files/[revision]/[format]/route.ts",
    "src/app/api/cad/projects/[projectId]/parameters/route.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(dashboardRoot, route)), `${route} is missing`);
    assert.match(source(route), /requireUserId/, `${route} does not authenticate`);
  }
});

test("the download route never accepts a filesystem path", () => {
  const route = source(
    "src/app/api/cad/projects/[projectId]/files/[revision]/[format]/route.ts",
  );
  // Only (projectId, revision, format) — the stored relative path comes from the
  // database and is re-checked by the blob store.
  assert.match(route, /CAD_FILE_DESCRIPTORS/);
  assert.match(route, /Number\.isInteger\(revisionNumber\)/);
  assert.match(route, /project\.user_id !== userId/);
  assert.doesNotMatch(route, /searchParams\.get\("path"\)/);
  assert.doesNotMatch(route, /readFileSync\(/);
});

// ---------------------------------------------------------------------------
// Tool contracts
// ---------------------------------------------------------------------------

test("all seven tools are defined with usable JSON schemas", () => {
  assert.deepEqual(
    [...tools.CAD_TOOL_NAMES],
    [
      "cad_create_project",
      "cad_generate_model",
      "cad_validate_model",
      "cad_export_model",
      "cad_get_project",
      "cad_update_parameters",
      "cad_render_views",
    ],
  );
  assert.equal(tools.CAD_TOOL_DEFINITIONS.length, tools.CAD_TOOL_NAMES.length);
  for (const definition of tools.CAD_TOOL_DEFINITIONS) {
    assert.ok(tools.CAD_TOOL_NAMES.includes(definition.name), definition.name);
    assert.ok(definition.description.length > 20, definition.name);
    assert.equal(definition.parameters.type, "object");
    assert.ok(Array.isArray(definition.parameters.required), definition.name);
    for (const required of definition.parameters.required) {
      assert.ok(
        required in definition.parameters.properties,
        `${definition.name} requires ${required} but does not define it`,
      );
    }
  }
});

test("an unknown tool is a typed refusal, not a throw", async () => {
  const result = await tools.runCadTool("cad_do_something", {}, {
    userId: 1,
    conversationId: 1,
    clusterId: null,
    model: "test",
    instruction: "",
    safety: { level: "supported" },
    defaults: defaults.cadDefaults("fdm"),
    attemptsRemaining: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "unknown_tool");
  assert.deepEqual(result.available, tools.CAD_TOOL_NAMES);
});

test("the standard view set is complete and framed from the measurements", () => {
  assert.deepEqual(
    [...tools.CAD_STANDARD_VIEWS],
    ["isometric", "front", "rear", "left", "right", "top", "bottom"],
  );
  const views = tools.standardViews({
    boundingBox: { x: 100, y: 60, z: 30, unit: "mm" },
    solidCount: 1,
    bodies: [],
  });
  assert.equal(views.views.length, 7);
  assert.ok(views.radius > 0);
  for (const view of views.views) {
    assert.equal(view.direction.length, 3);
    assert.ok(view.distance > views.radius);
  }
  // Looking straight down Z needs a different up vector, or the camera degenerates.
  assert.deepEqual(views.views.find((v) => v.name === "top").up, [0, 1, 0]);
  assert.deepEqual(views.views.find((v) => v.name === "front").up, [0, 0, 1]);
});

// ---------------------------------------------------------------------------
// Design specification
// ---------------------------------------------------------------------------

function draftSpec(overrides = {}) {
  return {
    name: "test-bracket",
    description: "A rectangular mounting bracket.",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [
      {
        id: "width",
        label: "Width",
        value: 60,
        unit: "mm",
        minimum: 10,
        maximum: 200,
        editable: true,
        source: "user",
      },
      { id: "wall", label: "Wall thickness", value: 2.4, editable: true, source: "default" },
    ],
    components: [{ id: "plate", name: "Plate", quantity: 1, bodyRole: "primary" }],
    constraints: [
      { id: "c1", type: "hole", description: "M3 clearance holes", expected: 3.4 },
      { id: "c2", type: "wall-thickness", description: "2.4 mm walls", expected: 2.4 },
      { id: "c3", type: "clearance", description: "lid clearance", expected: 0.35 },
    ],
    assumptions: [
      { id: "a1", description: "2.4 mm walls", reason: "Not stated", userEditable: true },
    ],
    exportSettings: {
      stlLinearTolerance: 0.05,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: true,
    },
    declaredBoundingBox: { x: 60, y: 40, z: 6, tolerance: 0.5 },
    ...overrides,
  };
}

test("a design-spec draft validates and refuses malformed parameters", () => {
  const ok = schemas.cadDesignSpecDraftSchema.safeParse(draftSpec());
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues ?? []));

  // Parameter ids become Python dict keys, so they must be identifiers.
  const badId = schemas.cadDesignSpecDraftSchema.safeParse(
    draftSpec({
      parameters: [{ id: "wall thickness", label: "W", value: 1, editable: true, source: "user" }],
    }),
  );
  assert.equal(badId.success, false);

  const badSource = schemas.cadDesignSpecDraftSchema.safeParse(
    draftSpec({
      parameters: [{ id: "wall", label: "W", value: 1, editable: true, source: "guessed" }],
    }),
  );
  assert.equal(badSource.success, false);

  // The model may not claim a project id or a schema version.
  assert.ok(!("projectId" in schemas.cadDesignSpecDraftSchema.shape));
  assert.ok(!("schemaVersion" in schemas.cadDesignSpecDraftSchema.shape));
});

test("validation expectations are derived from the specification", () => {
  const spec = {
    ...draftSpec(),
    schemaVersion: 1,
    projectId: "cadp_" + "0".repeat(32),
    printerBed: { x: 220, y: 220, z: 250 },
  };
  const expectations = tools.expectationsFromSpec(spec, defaults.cadDefaults("fdm"));
  assert.equal(expectations.expectedSolidCount, 1);
  assert.deepEqual(expectations.boundingBox, { x: 60, y: 40, z: 6 });
  assert.equal(expectations.boundingBoxTolerance, 0.5);
  assert.equal(expectations.minimumWallThickness, 2.4);
  assert.deepEqual(expectations.holeDiameters, [3.4]);
  assert.deepEqual(expectations.clearances, [0.35]);
  assert.deepEqual(expectations.printerBed, { x: 220, y: 220, z: 250 });
  assert.equal(expectations.units, "mm");
});

test("reference bodies do not count toward the expected solid count", () => {
  const spec = {
    ...draftSpec({
      components: [
        { id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" },
        { id: "lid", name: "Lid", quantity: 1, bodyRole: "lid" },
        { id: "board", name: "PCB outline", quantity: 1, bodyRole: "reference" },
        { id: "foot", name: "Foot", quantity: 4, bodyRole: "other" },
      ],
    }),
    schemaVersion: 1,
    projectId: "cadp_" + "0".repeat(32),
  };
  assert.equal(tools.expectedSolidCount(spec), 6);
});

test("a status is derived from the worst issue present", () => {
  assert.equal(tools.statusFromIssues([]), "valid");
  assert.equal(tools.statusFromIssues([{ severity: "info", code: "x", message: "m" }]), "valid");
  assert.equal(
    tools.statusFromIssues([{ severity: "warning", code: "x", message: "m" }]),
    "valid-with-warnings",
  );
  assert.equal(
    tools.statusFromIssues([
      { severity: "warning", code: "x", message: "m" },
      { severity: "error", code: "y", message: "m" },
    ]),
    "invalid",
  );
});

// ---------------------------------------------------------------------------
// Artifact manifest
// ---------------------------------------------------------------------------

function manifest(overrides = {}) {
  const projectId = "cadp_" + "a".repeat(32);
  return {
    schemaVersion: 1,
    artifactType: "parametric-cad",
    projectId,
    revision: 1,
    title: "Test bracket",
    status: "valid",
    designSpec: { ...draftSpec(), schemaVersion: 1, projectId },
    source: "def build_model(params):\n    return None\n",
    entrypoint: "build_model",
    parameters: { width: 60, wall: 2.4 },
    previewFile: {
      projectId,
      revision: 1,
      format: "glb",
      filename: "model.glb",
      mimeType: "model/gltf-binary",
      byteSize: 1024,
      sha256: "b".repeat(64),
    },
    exports: [
      {
        projectId,
        revision: 1,
        format: "step",
        filename: "model.step",
        mimeType: "model/step",
        byteSize: 2048,
        sha256: "c".repeat(64),
      },
    ],
    measurements: {
      boundingBox: { x: 60, y: 40, z: 6, unit: "mm" },
      volume: 12000,
      surfaceArea: 3800,
      solidCount: 1,
      triangleCount: 240,
      bodies: [
        {
          name: "plate",
          volume: 12000,
          surfaceArea: 3800,
          boundingBox: { x: 60, y: 40, z: 6 },
          valid: true,
          watertight: true,
        },
      ],
    },
    validation: { passed: true, checkedAt: "2026-08-05T00:00:00.000Z", issues: [] },
    assumptions: ["2.4 mm walls"],
    disclaimers: [safety.CAD_VALIDATION_DISCLAIMER],
    revisionHistory: [],
    generationLog: [],
    provenance: {
      engine: "cadquery",
      engineVersion: "2.6.0",
      kernel: "opencascade",
      kernelVersion: "7.8.1",
      pythonVersion: "3.12.13",
      serviceVersion: "1.0.0",
      model: "test-model",
      generatedAt: "2026-08-05T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("a well-formed manifest parses and a malformed one is refused", () => {
  const ok = schemas.parseStoredCadArtifact(manifest());
  assert.equal(ok.ok, true, JSON.stringify(ok.issues ?? []));

  assert.equal(schemas.parseStoredCadArtifact({ schemaVersion: 9 }).ok, false);
  assert.equal(schemas.parseStoredCadArtifact(manifest({ source: "" })).ok, false);
  assert.equal(
    schemas.parseStoredCadArtifact(manifest({ status: "probably-fine" })).ok,
    false,
  );
  // A file reference must carry a real hash: the download route verifies it.
  const badHash = manifest();
  badHash.exports[0].sha256 = "nope";
  assert.equal(schemas.parseStoredCadArtifact(badHash).ok, false);
});

test("the renderer is registered and validates the manifest before publishing", async () => {
  const renderer = artifactRenderer("parametric-cad");
  assert.ok(renderer, "the renderer is not in the registry");
  assert.equal(renderer.kind, "data");
  assert.equal(renderer.extension, ".json");
  assert.equal(renderer.mimeType, "application/vnd.breadboard.parametric-cad+json");
  assert.ok(availableArtifactRenderers().some((entry) => entry.id === "parametric-cad"));

  assert.equal((await renderer.validate("not json")).ok, false);
  assert.equal((await renderer.validate('{"schemaVersion":9}')).ok, false);
  const valid = await renderer.validate(JSON.stringify(manifest()));
  assert.equal(valid.ok, true, valid.error);
});

test("the artifact viewer validates a stored design before rendering it", () => {
  const viewer = source("src/app/components/hermes/artifact-viewer.tsx");
  assert.match(viewer, /renderer === "parametric-cad"/);
  assert.match(viewer, /parseStoredCadArtifact/);
  assert.match(viewer, /ParametricCadArtifact/);
});

test("the renderer receives no credential, service address or filesystem path", () => {
  for (const file of [
    "src/app/components/cad/parametric-cad-artifact.tsx",
    "src/app/components/cad/model-viewer.tsx",
    "src/app/components/hermes/inline-parametric-cad-run.tsx",
  ]) {
    const text = source(file);
    assert.doesNotMatch(text, /CAD_SERVICE_SECRET|BREADBOARD_CAD_SECRET/, file);
    assert.doesNotMatch(text, /CAD_SERVICE_URL/, file);
    assert.doesNotMatch(text, /node:fs|from "fs"/, file);
    assert.doesNotMatch(text, /process\.env/, file);
  }
  // The preview is loaded from Breadboard's own authenticated route.
  assert.match(
    source("src/app/components/cad/parametric-cad-artifact.tsx"),
    /\/api\/cad\/projects\//,
  );
});

test("the viewer bundles three.js rather than loading it from a CDN", () => {
  const viewer = source("src/app/components/cad/model-viewer.tsx");
  assert.match(viewer, /from "three"/);
  assert.doesNotMatch(viewer, /https?:\/\/(?:unpkg|cdn|jsdelivr)/);
  const packageJson = JSON.parse(source("package.json"));
  assert.ok(packageJson.dependencies.three, "three is not a dependency");
});

// ---------------------------------------------------------------------------
// Errors, defaults, safety
// ---------------------------------------------------------------------------

test("failures translate into a message plus an actionable repair hint", () => {
  const forbidden = errors.describeCadFailure("forbidden_source", "", [
    { code: "forbidden_import", message: "`os` is not available.", line: 1 },
  ]);
  assert.equal(forbidden.code, "forbidden_source");
  assert.match(forbidden.message, /refused/);
  assert.match(forbidden.repairHint, /line 1/);
  assert.equal(forbidden.retryable, true);

  const timeout = errors.describeCadFailure("execution_timeout", "did not finish in 30000 ms");
  assert.match(timeout.message, /30000/);
  assert.match(timeout.repairHint, /Simplify/);

  const unavailable = errors.describeCadFailure("cad_service_unavailable");
  assert.equal(unavailable.retryable, false);
  assert.match(unavailable.message, /dev:cad/);

  // Anything unknown still produces a usable failure rather than throwing.
  const unknown = errors.describeCadFailure("something_new", "detail here");
  assert.equal(unknown.message, "detail here");
  assert.equal(unknown.retryable, true);
});

test("every documented failure mode has a translation", () => {
  for (const code of [
    "forbidden_source",
    "syntax_error",
    "missing_entrypoint",
    "empty_result",
    "execution_error",
    "execution_timeout",
    "out_of_memory",
    "tessellation_failed",
    "export_failed",
    "worker_crashed",
    "engine_unavailable",
    "cad_service_unavailable",
    "cad_service_busy",
    "invalid_request",
  ]) {
    const failure = errors.describeCadFailure(code, "");
    assert.ok(failure.message.length > 10, code);
  }
});

test("process defaults differ and are environment-overridable", () => {
  const fdm = defaults.cadDefaults("fdm", {});
  assert.equal(fdm.defaultWallThickness, 2.4);
  assert.equal(fdm.generalClearance, 0.3);
  assert.equal(fdm.pressFitClearance, 0.15);
  assert.equal(fdm.slidingFitClearance, 0.35);
  assert.equal(fdm.minimumFeatureSize, 0.8);
  assert.equal(fdm.maximumUnsupportedOverhangDegrees, 45);
  assert.deepEqual(fdm.printerBed, { x: 220, y: 220, z: 250 });

  const sla = defaults.cadDefaults("sla", {});
  assert.ok(sla.minimumFeatureSize < fdm.minimumFeatureSize);
  assert.ok(sla.generalClearance < fdm.generalClearance);

  const overridden = defaults.cadDefaults("fdm", {
    CAD_WALL_THICKNESS: "3",
    CAD_PRINTER_BED: "300x300x400",
  });
  assert.equal(overridden.defaultWallThickness, 3);
  assert.deepEqual(overridden.printerBed, { x: 300, y: 300, z: 400 });

  // A nonsense override falls back rather than poisoning the design.
  assert.equal(defaults.cadDefaults("fdm", { CAD_WALL_THICKNESS: "-1" }).defaultWallThickness, 2.4);
});

test("fastener sizes are real numbers the prompt can quote", () => {
  const m3 = defaults.METRIC_FASTENERS.m3;
  assert.equal(m3.clearanceHoleDiameter, 3.4);
  assert.equal(m3.heatSetInsertHoleDiameter, 4.2);
  assert.match(defaults.fastenerReference(), /M3: clearance hole 3\.4 mm/);
});

test("safety-critical requests are flagged, weapons are refused, ordinary parts pass", () => {
  assert.equal(safety.assessCadSafety("a wall-mounted Raspberry Pi enclosure").level, "supported");
  assert.equal(safety.assessCadSafety("a shelf bracket").level, "supported");
  assert.equal(safety.assessCadSafety("a replacement knob for my oven dial").level, "supported");

  for (const brief of [
    "a compressed air tank fitting",
    "a lifting eye for a hoist",
    "a climbing carabiner",
    "a bicycle brake lever",
    "a surgical guide",
    "an enclosure for a 230 VAC socket",
    "a bracket for the exhaust manifold",
  ]) {
    const decision = safety.assessCadSafety(brief);
    assert.equal(decision.level, "engineering-review", brief);
    assert.ok(safety.engineeringReviewNotice(decision).length > 40, brief);
  }

  const refused = safety.assessCadSafety("a firearm receiver");
  assert.equal(refused.level, "refused");
  assert.equal(safety.engineeringReviewNotice(refused), null);
});

test("the standard disclaimer separates geometry from engineering", () => {
  assert.match(safety.CAD_VALIDATION_DISCLAIMER, /geometric/i);
  assert.match(safety.CAD_VALIDATION_DISCLAIMER, /not a mechanical engineering verification/i);
});

// ---------------------------------------------------------------------------
// Hardware Blueprint hand-off
// ---------------------------------------------------------------------------

test("an enclosure request is recognized from the brief or a flag", () => {
  assert.equal(enclosures.enclosureIntent("an ESP32 weather station").wanted, false);
  assert.equal(enclosures.enclosureIntent("a weather station with a case").wanted, true);
  assert.equal(enclosures.enclosureIntent("a weather station, no case").wanted, false);

  const forced = enclosures.enclosureIntent("a weather station --enclosure");
  assert.equal(forced.wanted, true);
  assert.equal(forced.remaining, "a weather station");

  const declined = enclosures.enclosureIntent("a station in a box --no-enclosure");
  assert.equal(declined.wanted, false);
});

test("holding the circuit onto something counts as asking for a physical part", () => {
  // The brief that produced a blueprint with no CAD at all: it never used a
  // container word, and a clip is as much a printed part as a lid is.
  assert.equal(
    enclosures.enclosureIntent(
      "i want to build ar glasses that should be attachable to my glasses",
    ).wanted,
    true,
  );
  for (const brief of [
    "a sensor that clips onto my bike",
    "a badge that straps to my arm",
    "a reader with a holder for the desk",
    "a tracker mounted on the collar",
  ]) {
    assert.equal(enclosures.enclosureIntent(brief).wanted, true, brief);
  }
});

test("explicit CAD, mechanisms, wearables, optics, and free-form parts reach CAD", () => {
  for (const brief of [
    "make a parametric CAD model for this unusual lamp body",
    "design a ratcheting rack and pinion mechanism around the motor",
    "build a wrist-worn posture tracker",
    "align a micro OLED, focusing lens, and waveguide",
    "make a printable impeller for the controller-driven fan",
    "create an ergonomic control knob with a splined bore",
  ]) {
    assert.equal(enclosures.enclosureIntent(brief).wanted, true, brief);
  }
  assert.equal(
    enclosures.enclosureIntent("make a 3D model for this assembly --no-enclosure").wanted,
    false,
    "the explicit opt-out remains authoritative",
  );
});

test("one negated enclosure does not suppress a different requested CAD part", () => {
  for (const brief of [
    "without a case, make a 3D-printable bracket",
    "not just a case — design the wearable frame",
  ]) {
    assert.equal(enclosures.enclosureIntent(brief).wanted, true, brief);
  }
  assert.equal(enclosures.enclosureIntent("a weather station with no case or lid").wanted, false);
});

test("mentioning a mechanism to sense or control does not request its CAD", () => {
  for (const brief of [
    "build an ESP32 tachometer that measures a gearbox shaft",
    "design a tachometer for a gearbox",
    "sense when a hinge opens and turn on an LED",
    "control the speed of an existing pulley with a motor",
  ]) {
    assert.equal(enclosures.enclosureIntent(brief).wanted, false, brief);
  }
});

test("active and passive construction requests both reach mechanism CAD", () => {
  assert.equal(
    enclosures.enclosureIntent("design an adjustable gear train around the motor").wanted,
    true,
  );
  assert.equal(
    enclosures.enclosureIntent("a gear train should be designed around the motor").wanted,
    true,
  );
});

test("coordinated CAD and enclosure negations remain authoritative", () => {
  assert.equal(
    enclosures.enclosureIntent("no CAD or 3D model, only the circuit").wanted,
    false,
  );
  assert.equal(
    enclosures.enclosureIntent("no case, lid, or cover; only the PCB").wanted,
    false,
  );
  assert.equal(
    enclosures.enclosureIntent("do not design a gear train; only control the motor").wanted,
    false,
  );
  assert.equal(
    enclosures.enclosureIntent("make it portable, but not wearable").wanted,
    false,
  );
  assert.equal(
    enclosures.enclosureIntent("do not design a bracket; only wire the sensor").wanted,
    false,
  );
  assert.equal(enclosures.enclosureIntent("never make a case for it").wanted, false);
});

test("wiring language and English idiom are not read as enclosure requests", () => {
  for (const brief of [
    "attach the DHT22 to pin 4 and read it every second",
    "mount the sensor on the breadboard next to the controller",
    "use alligator clips for the probe leads",
    "surface-mount parts are fine",
    "log the reading, and in that case flash the LED",
    "add a test case for the sensor driver",
  ]) {
    assert.equal(enclosures.enclosureIntent(brief).wanted, false, brief);
  }
});

test("the enclosure brief carries measured board figures, not invented ones", () => {
  const known = enclosures.enclosureBriefFromDesign({
    userBrief: "with a lid I can screw down",
    designTitle: "ESP32 weather station",
    controllerDefinitionId: "esp32-devkit-v1",
    controllerName: "ESP32 DevKit V1",
    peripherals: [{ name: "BME280", definitionId: "bme280" }],
    prototypeType: "breadboard",
  });
  assert.match(known, /51\.5 × 28\.3 mm/);
  assert.match(known, /Micro-USB on the front face/);
  assert.match(known, /with a lid I can screw down/);
  assert.match(known, /measured figures/);
  assert.match(known, /BME280/);

  const unknown = enclosures.enclosureBriefFromDesign({
    userBrief: "in a case",
    designTitle: "Something",
    controllerDefinitionId: "not-in-the-table",
    controllerName: "Mystery board",
    peripherals: [],
    prototypeType: "pcb",
  });
  assert.match(unknown, /not in Breadboard's dimension table/);
  assert.doesNotMatch(unknown, /Board footprint:/);
});

test("physical CAD preserves product intent and exposes no canned geometry fallback", () => {
  const arInput = {
    userBrief: "design AR glasses that fit onto my glasses",
    designTitle: "Clip-on AR display",
    controllerDefinitionId: "seeed-xiao-esp32c3",
    controllerName: "Seeed Studio XIAO ESP32C3",
    peripherals: [
      {
        name: "0.49-inch micro-OLED display module",
        definitionId: "micro-oled-display",
        category: "display",
        mechanical: { length: 19, width: 15, height: 6 },
      },
      {
        name: "Transparent optical waveguide combiner",
        definitionId: "optical-combiner-waveguide",
        category: "optical",
        mechanical: { length: 50, width: 35, height: 2 },
      },
    ],
    prototypeType: "pcb",
  };
  assert.equal(enclosures.physicalDesignKind(arInput.userBrief), "optomechanical-product");

  const brief = enclosures.enclosureBriefFromDesign(arInput);
  assert.match(brief, /complete physical part or product/i);
  assert.match(brief, /do not reinterpret it as merely a box/i);
  assert.match(brief, /display_mount/);
  assert.match(brief, /focusing_optic_mount/);
  assert.match(brief, /combiner_mount/);
  assert.match(brief, /optical_axis_alignment/);
  assert.match(brief, /accommodate_micro_oled_display/);
  assert.match(brief, /50 × 35 × 2 mm/);
  assert.doesNotMatch(brief, /Design a two-part enclosure/);

  assert.equal("enclosureFallbackFromDesign" in enclosures, false);
  assert.equal("physicalFallbackFromDesign" in enclosures, false);
});

test("physical-design routing covers enclosures, mounts, wearables, mechanisms and freeform parts", () => {
  const cases = [
    ["a sealed case with a screwed lid", "simple-enclosure"],
    ["a camera bracket that clamps to a tripod", "mount"],
    ["a wrist-worn posture tracker", "wearable-product"],
    ["AR glasses with a waveguide combiner", "optomechanical-product"],
    ["a ratcheting rack and pinion mechanism", "mechanism"],
    ["a sculpted ergonomic replacement knob", "freeform"],
  ];
  for (const [brief, expected] of cases) {
    assert.equal(enclosures.physicalDesignKind(brief), expected, brief);
  }
  assert.equal(
    enclosures.physicalDesignKind(
      "make a 3D model of a stencil for surface-mount PCB assembly",
    ),
    "freeform",
  );
});

test("semantic CAD coverage rejects a valid shell and lid as AR glasses", () => {
  const input = {
    userBrief: "design AR glasses that fit onto my glasses",
    designTitle: "Clip-on AR display",
    controllerDefinitionId: "esp32-devkit-v1",
    controllerName: "ESP32 DevKit V1",
    peripherals: [
      {
        name: "Transparent optical waveguide combiner",
        definitionId: "optical-combiner-waveguide",
        category: "optical",
        mechanical: { length: 50, width: 35, height: 2 },
      },
    ],
    prototypeType: "pcb",
  };
  const manifest = {
    designSpec: {
      name: "Generic shell",
      description: "A hollow electronics shell with a flat lid.",
      parameters: [],
      components: [
        { id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" },
        { id: "lid", name: "Lid", quantity: 1, bodyRole: "lid" },
      ],
      constraints: [],
      assumptions: [],
    },
    source: 'return {"shell": shell, "lid": lid}',
  };
  const issues = enclosures.physicalDesignCoverageIssues(input, manifest);
  assert.ok(issues.length >= 6);
  assert.ok(issues.some((issue) => issue.code === "MISSING_REQUIRED_FEATURE"));
  assert.ok(issues.some((issue) => issue.code === "PRODUCT_INTENT_COLLAPSED_TO_ENCLOSURE"));
  assert.ok(issues.some((issue) => issue.code === "MISSING_COMPONENT_REFERENCE"));
  assert.ok(issues.some((issue) => issue.feature === "combiner_mount"));
  assert.ok(issues.some((issue) => issue.feature === "optical_axis_alignment"));
  assert.ok(issues.some((issue) => issue.feature === "host_interface_retention"));
});

test("acceptance prose alone cannot make missing geometry pass", () => {
  const input = {
    userBrief: "put the controller in an enclosure with a removable lid",
    designTitle: "Controller case",
    controllerDefinitionId: "esp32-devkit-v1",
    controllerName: "ESP32 DevKit V1",
    peripherals: [],
    prototypeType: "pcb",
  };
  const manifest = {
    designSpec: {
      name: "Unretained box",
      description: "Claims a retained controller and screwed cover.",
      parameters: [],
      components: [
        { id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" },
        { id: "lid", name: "Lid", quantity: 1, bodyRole: "lid" },
        {
          id: "esp32-devkit-v1",
          name: "ESP32 DevKit V1",
          quantity: 1,
          bodyRole: "reference",
        },
      ],
      constraints: [
        {
          id: "controller_retention",
          type: "fit",
          description: "The controller is retained in a board pocket with rails.",
        },
        {
          id: "closure_retention",
          type: "fit",
          description: "The lid is retained with screws and bosses.",
        },
      ],
      assumptions: [],
    },
    source: 'return {"shell": shell, "lid": lid}',
  };
  const issues = enclosures.physicalDesignCoverageIssues(input, manifest);
  assert.ok(issues.some((issue) => issue.feature === "controller_retention"));
  assert.ok(issues.some((issue) => issue.feature === "closure_retention"));
});

test("a model that goes away is reported in words, not as \"fetch failed\"", async () => {
  const transport = await import("../src/lib/model-transport.ts");

  // The distinguishing detail is never on the error itself — undici wraps a
  // socket error in a TypeError whose whole message is "fetch failed".
  const dropped = new TypeError("fetch failed", {
    cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
  });
  assert.equal(transport.transportFailureCode(dropped), "UND_ERR_SOCKET");
  assert.equal(transport.isTransportFailure(dropped), true);

  const message = transport.describeTransportFailure(dropped, {
    endpoint: "http://127.0.0.1:8765/v1/chat/completions",
    lead: "The model could not be reached",
  });
  assert.doesNotMatch(message, /^fetch failed$/);
  assert.match(message, /dropped part-way through/);
  // Which service, and which failure — the two facts a bare message threw away.
  assert.match(message, /http:\/\/127\.0\.0\.1:8765\/v1\/chat\/completions/);
  assert.match(message, /UND_ERR_SOCKET/);

  // A host that resolves to several addresses reports them together.
  assert.equal(
    transport.transportFailureCode(
      new TypeError("fetch failed", {
        cause: new AggregateError([Object.assign(new Error("refused"), { code: "ECONNREFUSED" })]),
      }),
    ),
    "ECONNREFUSED",
  );

  // Stopping a run is deliberate. It must never be retried and never be
  // described as a fault.
  const stopped = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  assert.equal(transport.isTransportFailure(stopped), false);

  // Both clients hand their failures to it rather than passing a raw message on.
  for (const client of ["src/lib/cad/model-client.ts", "src/lib/hardware/model-client.ts"]) {
    const text = source(client);
    assert.match(text, /withTransportRetry\(/, `${client} does not re-send a dropped request`);
    assert.match(text, /describeTransportFailure\(/, `${client} does not explain a dropped request`);
  }
});

test("a failed enclosure is a sentence about the circuit, not a stray error", async () => {
  const manager = source("src/lib/hardware/run-manager.ts");
  // Readiness denial, a typed result, and a thrown build all use the same
  // wording; the fourth occurrence is the formatter definition itself.
  assert.equal((manager.match(/enclosureFailureNotice\(/g) ?? []).length, 4);
  assert.match(manager, /so only the circuit was produced/);
  // The raw pass-through this replaces: the enclosure notice is printed in the
  // run card and again in the chat reply, so "fetch failed" appeared twice.
  assert.doesNotMatch(
    manager,
    /enclosureNotice =\s*\n?\s*error instanceof Error \? error\.message/,
  );

  // A stopped run says so once, in its own event.
  const enclosureCatch = manager.slice(
    manager.indexOf("} catch (error) {", manager.indexOf("designCadPart({")),
  );
  assert.match(enclosureCatch.slice(0, 400), /if \(run\.aborted\) return;/);
});

test("the hardware agent asks the CAD agent instead of growing its own generator", async () => {
  const manager = source("src/lib/hardware/run-manager.ts");
  assert.match(manager, /designCadPart/);
  assert.match(manager, /enclosureBriefFromDesign/);
  assert.match(manager, /publishCadDesign/);
  // The circuit is still a deliverable when the enclosure fails.
  assert.match(manager, /enclosure\.failed/);
  assert.match(manager, /cad\.manifest\.validation\.passed/);
  assert.match(manager, /physicalDesignCoverageIssues/);
  assert.doesNotMatch(manager, /physicalFallbackFromDesign/);
  assert.doesNotMatch(manager, /enclosureFallbackFromDesign/);
  assert.match(manager, /not published as a completed design/);
  assert.match(manager, /markPhysicalDesignIncomplete\(final\.design, enclosureNotice\)/);
  assert.match(manager, /rule: "PHYSICAL_DESIGN_INCOMPLETE"/);
  assert.doesNotMatch(manager, /cadquery/i);

  const hardwareIdentity = await import("../src/lib/hardware/identity.ts");
  const parsed = hardwareIdentity.parseHardwareBlueprintRequest(
    "a weather station --enclosure --board esp32",
  );
  assert.equal(parsed.enclosure, true);
  assert.equal(parsed.board, "esp32");
  assert.equal(parsed.brief, "a weather station");
});

test("an interrupted final answer preserves only a valid built CAD revision", () => {
  const service = source("src/lib/cad/design-service.ts");
  assert.match(
    service,
    /isCurrentBuildFromThisTurn\(toolContext, partialProject, startingRevision\)/,
  );
  assert.match(service, /build\.status === "valid"/);
  assert.match(service, /build\.status === "valid-with-warnings"/);
  assert.match(service, /build\.revision === project\.current_revision/);
  assert.match(service, /cad\.model\.response_incomplete/);
  assert.doesNotMatch(
    service,
    /if \(partialProject\?\.current_revision\) \{/,
    "an invalid or draft partial revision must not be treated as the deliverable",
  );
});

test("the CAD service never substitutes deterministic geometry for a failed model design", () => {
  const service = source("src/lib/cad/design-service.ts");
  const store = source("src/lib/cad/project-store.ts");
  assert.doesNotMatch(service, /CadDesignFallback|runCadFallback|fromFallback/);
  assert.doesNotMatch(service, /cad\.fallback\.(started|completed|resumed_project|adopted_project)/);
  assert.doesNotMatch(service, /deterministic-template|deterministic fallback/);
  assert.doesNotMatch(store, /replaceUnbuiltCadProjectSpec/);
  assert.match(service, /reason: failureReason\(toolContext, \[\], message\)/);
  assert.match(service, /The geometry passed kernel validation but did not satisfy the requested product/);
});

test("a model outage returns no CAD result instead of recovery geometry", async () => {
  const { designCadPart } = await import("../src/lib/cad/design-service.ts");
  const realFetch = globalThis.fetch;
  const events = [];
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "model unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    const result = await designCadPart({
      userId: 1,
      conversationId: 1,
      clusterId: null,
      brief: "Design AR glasses that clip onto ordinary eyeglasses.",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "test-model",
      reasoningEffort: "medium",
      process: "fdm",
      modelRequestTimeoutMs: 1_000,
      emit: (type) => events.push(type),
    });

    assert.equal(result.ok, false);
    assert.equal("manifest" in result, false);
    assert.equal("projectId" in result, false);
    assert.equal(events.some((type) => /fallback|template/i.test(type)), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a saved CAD plan is built in a forced, bounded source phase", async () => {
  const { runCadProjectBuildPhase } = await import("../src/lib/cad/model-client.ts");
  const designSpec = {
    schemaVersion: 1,
    projectId: "cadp_recovery_test",
    name: "Recovery bracket",
    description: "A small recovery-test bracket.",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [
      { id: "width", label: "Width", value: 20, editable: true, source: "user" },
    ],
    components: [{ id: "body", name: "Body", quantity: 1, bodyRole: "primary" }],
    constraints: [],
    assumptions: [],
    exportSettings: {
      stlLinearTolerance: 0.1,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: false,
    },
  };
  const project = {
    id: designSpec.projectId,
    user_id: 1,
    conversation_id: 1,
    cluster_id: null,
    artifact_id: null,
    name: designSpec.name,
    units: "mm",
    process: "fdm",
    status: "draft",
    current_revision: 0,
    latest_revision: 0,
    design_spec_json: JSON.stringify(designSpec),
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
  };
  const context = {
    userId: 1,
    conversationId: 1,
    clusterId: null,
    model: "test-model",
    instruction: "build it",
    safety: safety.assessCadSafety("a bracket"),
    defaults: defaults.cadDefaults("fdm"),
    attemptsRemaining: 3,
    projectId: project.id,
  };
  const realFetch = globalThis.fetch;
  const requestBodies = [];
  const toolArguments = [];
  try {
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call_build",
                    type: "function",
                    function: {
                      name: "cad_generate_model",
                      arguments: JSON.stringify({
                        projectId: "cadp_wrong_project",
                        source:
                          'import cadquery as cq\nDEFAULT_PARAMS={"width":20}\ndef build_model(params):\n p={**DEFAULT_PARAMS,**params}\n return {"body":cq.Workplane("XY").box(p["width"],10,3)}',
                        parameters: { width: 999, invented: 1 },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await runCadProjectBuildPhase({
      baseUrl: "http://chatmock.local/v1",
      model: "test-model",
      reasoningEffort: "xhigh",
      project,
      toolContext: context,
      runTool: async (_name, args) => {
        toolArguments.push(args);
        return { ok: true, validationPassed: true, revision: 1, status: "valid" };
      },
    });
    assert.equal(result.stoppedBecause, "answered");
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].reasoning_effort, "medium");
    assert.deepEqual(requestBodies[0].tools.map((entry) => entry.function.name), [
      "cad_generate_model",
    ]);
    assert.deepEqual(requestBodies[0].tool_choice, {
      type: "function",
      function: { name: "cad_generate_model" },
    });
    assert.equal(toolArguments[0].projectId, project.id);
    assert.deepEqual(toolArguments[0].parameters, { width: 20 });
    assert.equal(toolArguments[0].timeoutMs, 120_000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the CAD source phase repairs one failed build instead of dropping the saved plan", async () => {
  const { runCadProjectBuildPhase } = await import("../src/lib/cad/model-client.ts");
  const spec = {
    schemaVersion: 1,
    projectId: "cadp_repair_test",
    name: "Repair test",
    description: "Repair test",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [],
    components: [{ id: "body", name: "Body", quantity: 1, bodyRole: "primary" }],
    constraints: [],
    assumptions: [],
    exportSettings: {
      stlLinearTolerance: 0.1,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: false,
    },
  };
  const project = {
    id: spec.projectId,
    user_id: 1,
    conversation_id: 1,
    cluster_id: null,
    artifact_id: null,
    name: spec.name,
    units: "mm",
    process: "fdm",
    status: "draft",
    current_revision: 0,
    latest_revision: 0,
    design_spec_json: JSON.stringify(spec),
    created_at: "",
    updated_at: "",
  };
  const context = {
    userId: 1,
    conversationId: 1,
    clusterId: null,
    model: "test-model",
    instruction: "build it",
    safety: safety.assessCadSafety("a bracket"),
    defaults: defaults.cadDefaults("fdm"),
    attemptsRemaining: 3,
    projectId: project.id,
  };
  const realFetch = globalThis.fetch;
  let completions = 0;
  let builds = 0;
  try {
    globalThis.fetch = async () => {
      completions += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `call_${completions}`,
                    function: {
                      name: "cad_generate_model",
                      arguments: JSON.stringify({ source: `source_${completions}`, parameters: {} }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await runCadProjectBuildPhase({
      baseUrl: "http://chatmock.local/v1",
      model: "test-model",
      project,
      toolContext: context,
      runTool: async () => {
        builds += 1;
        return builds === 1
          ? { ok: false, error: "invalid_shape", message: "Body is not watertight." }
          : { ok: true, validationPassed: true, revision: 2, status: "valid" };
      },
    });
    assert.equal(completions, 2);
    assert.equal(builds, 2);
    assert.equal(result.stoppedBecause, "answered");
    assert.equal(result.toolCalls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

test("every documented lifecycle event is emitted and consumed", () => {
  const emitted = new Set();
  for (const file of [
    "src/lib/cad/tools.ts",
    "src/lib/cad/run-manager.ts",
  ]) {
    for (const match of source(file).matchAll(/emit(?:\(run,)?\s*\(?"(cad\.[a-z._]+)"/g)) {
      emitted.add(match[1]);
    }
    for (const match of source(file).matchAll(/"(cad\.[a-z._]+)"/g)) emitted.add(match[1]);
  }
  const expected = [
    "cad.spec.created",
    "cad.source.generated",
    "cad.execution.started",
    "cad.execution.failed",
    "cad.execution.completed",
    "cad.validation.started",
    "cad.validation.failed",
    "cad.validation.completed",
    "cad.export.started",
    "cad.export.completed",
    "cad.artifact.created",
    "cad.artifact.updated",
  ];
  for (const type of expected) {
    assert.ok(emitted.has(type), `${type} is never emitted`);
  }

  const card = source("src/app/components/hermes/inline-parametric-cad-run.tsx");
  for (const type of expected) {
    assert.ok(card.includes(`"${type}"`), `${type} is never consumed by the run card`);
  }
  // A failure must always reach a terminal state, so the card can never stick.
  assert.match(card, /"run\.failed"/);
  assert.match(card, /"run\.aborted"/);
  assert.match(card, /const TERMINAL = new Set\(\["completed", "failed", "aborted"\]\)/);
});

test("the run reports its thinking time and the tokens it spent", () => {
  const manager = source("src/lib/cad/run-manager.ts");
  assert.match(manager, /sumChatTokenUsage/);
  assert.match(manager, /emit\(run, "run\.usage"/);
  const card = source("src/app/components/hermes/inline-parametric-cad-run.tsx");
  assert.match(card, /<AssistantResponseMeta/);
  assert.match(card, /agentName="Parametric CAD"/);
  assert.match(card, /persistedUsage\?: ChatTokenUsage/);
});

test("the build budget is enforced in code, not only in the prompt", async () => {
  const { MAX_BUILD_ATTEMPTS } = await import("../src/lib/cad/design-service.ts");
  assert.equal(MAX_BUILD_ATTEMPTS, 3);
  const toolsSource = source("src/lib/cad/tools.ts");
  assert.match(toolsSource, /context\.attemptsRemaining <= 0/);
  assert.match(toolsSource, /context\.attemptsRemaining -= 1/);
  assert.match(toolsSource, /attempt_budget_exhausted/);
});

// ---------------------------------------------------------------------------
// Service + execution boundary
// ---------------------------------------------------------------------------

test("the service resolves without any launcher handing over an address", async () => {
  const service = await import("../src/lib/cad/service.ts");
  const config = await import("../src/lib/cad/config.ts");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");

  // A throwaway home, so this never reads or writes the developer's own secret.
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-cad-config-"));
  try {
    const env = { BREADBOARD_CAD_HOME: home };
    // Nothing in the environment: the port defaults and the secret is minted.
    assert.equal(config.cadBaseUrl(env), `http://127.0.0.1:${config.CAD_DEFAULT_PORT}`);
    const secret = config.cadServiceSecret(env);
    assert.match(secret, /^[0-9a-f]{48}$/);
    // Read back rather than re-minted, which is what makes two processes agree.
    assert.equal(config.cadServiceSecret(env), secret);
    assert.equal(service.cadServiceConfigured(env), true);
    assert.deepEqual(service.cadServiceEndpoint(env), {
      baseUrl: `http://127.0.0.1:${config.CAD_DEFAULT_PORT}`,
      secret,
    });

    // An explicit environment still wins, which is how the desktop supervisor
    // keeps its per-install secret and dynamically allocated port.
    const overridden = {
      BREADBOARD_CAD_HOME: home,
      CAD_SERVICE_URL: "http://127.0.0.1:9999",
      CAD_SERVICE_SECRET: "supervisor-secret",
    };
    assert.deepEqual(service.cadServiceEndpoint(overridden), {
      baseUrl: "http://127.0.0.1:9999",
      secret: "supervisor-secret",
    });
    assert.equal(config.cadPort({ ...env, BREADBOARD_CAD_PORT: "8123" }), 8123);
    // A nonsense port falls back rather than producing an unusable URL.
    assert.equal(config.cadPort({ ...env, BREADBOARD_CAD_PORT: "nope" }), config.CAD_DEFAULT_PORT);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test("a managed service is cold-started before any model time is spent", async () => {
  const service = await import("../src/lib/cad/service.ts");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");

  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-cad-probe-"));
  try {
    // Port 1 is never a Breadboard service.
    const listening = await service.cadServiceListening(
      { BREADBOARD_CAD_HOME: home, CAD_SERVICE_URL: "http://127.0.0.1:1" },
      300,
    );
    assert.equal(listening, false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }

  // The run acquires through Runtime before model work. A passive TCP probe
  // cannot start the managed service and the dashboard must not tell users to
  // run the removed direct-spawn command.
  const manager = source("src/lib/cad/run-manager.ts");
  assert.match(manager, /await ensureCadServiceReady\(\)/);
  assert.doesNotMatch(manager, /cadServiceListening/);
  assert.doesNotMatch(manager, /npm run dev:cad/);
});

test("generated Python never runs in the Breadboard application process", () => {
  for (const file of fs.readdirSync(path.join(dashboardRoot, "src/lib/cad"))) {
    if (!file.endsWith(".ts")) continue;
    const text = source(path.join("src/lib/cad", file));
    assert.doesNotMatch(text, /\beval\(/, file);
    assert.doesNotMatch(text, /new Function\(/, file);
    assert.doesNotMatch(text, /child_process/, file);
  }
});

test("the Python service exists with its execution boundary intact", () => {
  const serviceRoot = path.join(repoRoot, "cad-service");
  for (const file of [
    "requirements.txt",
    "pyproject.toml",
    "breadboard_cad/guard.py",
    "breadboard_cad/executor.py",
    "breadboard_cad/worker.py",
    "breadboard_cad/cadquery_engine.py",
    "breadboard_cad/validation.py",
    "breadboard_cad/server.py",
    "breadboard_cad/models.py",
    "breadboard_cad/engine.py",
    "tests/test_guard.py",
    "tests/test_execution.py",
    "tests/test_validation.py",
    "tests/test_server.py",
  ]) {
    assert.ok(fs.existsSync(path.join(serviceRoot, file)), `cad-service/${file} is missing`);
  }

  const executor = fs.readFileSync(path.join(serviceRoot, "breadboard_cad/executor.py"), "utf8");
  assert.match(executor, /subprocess\.Popen/);
  assert.match(executor, /taskkill/);
  assert.match(executor, /_kill_tree/);
  assert.match(executor, /shutil\.rmtree\(workdir, ignore_errors=True\)/);
  assert.match(executor, /MAX_EXPORT_BYTES/);

  // The server process never imports the kernel: a crash costs one request.
  const server = fs.readFileSync(path.join(serviceRoot, "breadboard_cad/server.py"), "utf8");
  assert.doesNotMatch(server, /^import cadquery/m);
  assert.match(server, /hmac\.compare_digest/);
  assert.match(server, /refusing host/);

  // Dependencies are pinned so a rebuild reproduces the same geometry.
  const requirements = fs.readFileSync(path.join(serviceRoot, "requirements.txt"), "utf8");
  assert.match(requirements, /^cadquery==/m);
  assert.match(requirements, /^cadquery-ocp==/m);
  assert.match(requirements, /^pydantic==/m);
});

test("the local service is supervised in dev and on the desktop", () => {
  const devAll = fs.readFileSync(path.join(repoRoot, "scripts/dev-all.mjs"), "utf8");
  assert.match(devAll, /start-cad\.mjs/);
  assert.match(devAll, /CAD_SERVICE_URL/);
  // No secret is minted here any more: both sides read the shared file, so a
  // dashboard started on its own finds the service too.
  assert.doesNotMatch(devAll, /CAD_SERVICE_SECRET:/);

  const start = fs.readFileSync(path.join(repoRoot, "scripts/start-cad.mjs"), "utf8");
  assert.match(start, /127\.0\.0\.1/);
  assert.match(start, /BREADBOARD_CAD_SECRET/);
  // The secret goes through the environment, never argv.
  assert.doesNotMatch(start, /"--secret"/);
  // The launcher and the dashboard resolve the same file-backed secret, so no
  // value has to be copied between them.
  assert.match(start, /lib", "cad", "config\.ts"/);

  // Every startup path starts it, not just the one that can pass an env.
  const startBat = fs.readFileSync(path.join(repoRoot, "start.bat"), "utf8");
  assert.match(startBat, /start-cad\.mjs/);
  assert.match(startBat, /cad-venv/, "start.bat runs the launcher unconditionally");

  const definitions = fs.readFileSync(
    path.join(repoRoot, "desktop/src/main/service-definitions.ts"),
    "utf8",
  );
  assert.match(definitions, /id: "cad"/);
  assert.match(definitions, /BREADBOARD_CAD_SECRET: persistent\.cadServiceSecret/);
  assert.match(definitions, /required: false/);
  assert.match(definitions, /CAD_SERVICE_URL: cadUrl/);

  const config = fs.readFileSync(path.join(repoRoot, "desktop/src/main/runtime-config.ts"), "utf8");
  // The per-install secret is redacted from logs like every other one.
  assert.match(config, /config\.cadServiceSecret,/);
  // …and never published in the renderer-visible diagnostics summary.
  const summary = config.slice(config.indexOf("redactedConfigSummary"));
  assert.doesNotMatch(summary.slice(0, 900), /cadServiceSecret/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["dev:cad"], "node scripts/start-cad.mjs");
  assert.equal(packageJson.scripts["setup:cad"], "node scripts/setup-cad.mjs");
  assert.equal(packageJson.scripts["test:cad"], "node scripts/test-cad.mjs");
});

// ---------------------------------------------------------------------------
// What attaches where, and who wrote the geometry
// ---------------------------------------------------------------------------

const AR_INPUT = {
  userBrief: "design AR glasses that clip onto my glasses",
  designTitle: "Universal Clip-On AR Glasses",
  controllerDefinitionId: "xiao-esp32c3",
  controllerName: "Seeed Studio XIAO ESP32C3",
  peripherals: [
    {
      name: "0.49-inch micro-OLED",
      definitionId: "micro-oled-display",
      mechanical: { length: 19, width: 15, height: 6 },
    },
    {
      name: "Waveguide combiner",
      definitionId: "waveguide-combiner",
      mechanical: { length: 50, width: 35, height: 2 },
    },
  ],
  prototypeType: "pcb",
};

test("a multi-body design that never says what attaches where is not accepted", () => {
  const designSpec = {
    constraints: [],
    components: [
      { id: "temple_chassis", name: "Temple chassis", quantity: 1, bodyRole: "primary" },
        { id: "display_mount", name: "Display mount", quantity: 1, bodyRole: "other" },
        { id: "combiner_mount", name: "Combiner mount", quantity: 1, bodyRole: "other" },
      ...AR_INPUT.peripherals.map((part) => ({
        id: part.definitionId,
        name: part.name,
        quantity: 1,
        bodyRole: "reference",
      })),
    ],
    assembly: {
      overview: "Attach the display mount to the chassis, then attach the combiner mount.",
      hardware: [],
      steps: [
        {
          order: 1,
          summary: "Seat the display and attach its mount.",
          parts: ["temple_chassis", "display_mount", "micro-oled-display"],
          detail: "Seat the display reference in the display mount, then attach the mount to the chassis.",
        },
        {
          order: 2,
          summary: "Seat and align the combiner.",
          parts: ["display_mount", "combiner_mount", "waveguide-combiner"],
          detail: "Seat the waveguide reference in the combiner mount, then align it with the display mount.",
        },
      ],
    },
  };
  const manifest = {
    designSpec,
    source: "temple_chassis display_mount combiner_mount",
    measurements: { boundingBox: { x: 122, y: 66, z: 44 } },
  };
  assert.deepEqual(
    enclosures
      .physicalDesignCoverageIssues(AR_INPUT, manifest)
      .filter((issue) => issue.code.startsWith("ASSEMBLY_")),
    [],
    "complete, connected instructions that use real ids should pass",
  );

  const oneStepAssembly = {
    ...manifest,
    designSpec: {
      ...designSpec,
      assembly: {
        overview: "Install both bought parts while joining the three printed bodies.",
        hardware: [],
        steps: [
          {
            order: 1,
            summary: "Join and align the complete optical assembly.",
            parts: designSpec.components.map((component) => component.id),
            detail: "Seat each reference envelope and join both carriers to the chassis.",
          },
        ],
      },
    },
  };
  assert.deepEqual(
    enclosures
      .physicalDesignCoverageIssues(AR_INPUT, oneStepAssembly)
      .filter((issue) => issue.code.startsWith("ASSEMBLY_")),
    [],
    "one real step may legitimately join more than two parts",
  );

  const undocumented = {
    ...manifest,
    designSpec: { ...designSpec, assembly: undefined },
  };
  const issue = enclosures
    .physicalDesignCoverageIssues(AR_INPUT, undocumented)
    .find((candidate) => candidate.code === "ASSEMBLY_NOT_DOCUMENTED");
  assert.ok(issue, "multiple printed bodies and no assembly is not a finished design");
  assert.equal(issue.severity, "error");
  assert.match(issue.repairHint, /cad_generate_model/);
});

test("assembly instructions must use real ids, cover every item and join every subassembly", () => {
  const input = {
    userBrief: "design a wearable instrument with a removable sensor arm",
    designTitle: "Wearable instrument",
    controllerDefinitionId: "xiao-esp32c3",
    controllerName: "Seeed Studio XIAO ESP32C3",
    peripherals: [],
    prototypeType: "pcb",
  };
  const manifest = {
    designSpec: {
      constraints: [],
      components: [
        { id: "chassis", name: "Chassis", quantity: 1, bodyRole: "primary" },
        { id: "pod", name: "Electronics pod", quantity: 1, bodyRole: "other" },
        { id: "sensor_arm", name: "Sensor arm", quantity: 1, bodyRole: "other" },
      ],
      assembly: {
        overview: "Two documented subassemblies that are not actually joined.",
        hardware: [
          { id: "m3_screw", name: "M3 x 12 screw", quantity: 2 },
          { id: "unused_pad", name: "1 mm silicone pad", quantity: 1 },
        ],
        steps: [
          {
            order: 1,
            summary: "Bolt the pod to the chassis.",
            parts: ["chassis", "pod"],
            hardware: ["m3_screw"],
          },
          {
            order: 1,
            summary: "Prepare the separate arm.",
            parts: ["sensor_arm", "made_up_part"],
            hardware: ["made_up_hardware"],
          },
        ],
      },
    },
    source: "chassis pod sensor_arm",
    measurements: { boundingBox: { x: 100, y: 50, z: 25 } },
  };

  const codes = new Set(
    enclosures.physicalDesignCoverageIssues(input, manifest).map((issue) => issue.code),
  );
  assert.ok(codes.has("ASSEMBLY_UNKNOWN_PART_IDS"));
  assert.ok(codes.has("ASSEMBLY_UNKNOWN_HARDWARE_IDS"));
  assert.ok(codes.has("ASSEMBLY_DUPLICATE_ORDER"));
  assert.ok(codes.has("ASSEMBLY_UNUSED_HARDWARE"));
  assert.ok(codes.has("ASSEMBLY_GRAPH_DISCONNECTED"));

  const withUnusedComponent = {
    ...manifest,
    designSpec: {
      ...manifest.designSpec,
      components: [
        ...manifest.designSpec.components,
        { id: "unused_cover", name: "Cover", quantity: 1, bodyRole: "lid" },
      ],
    },
  };
  assert.ok(
    enclosures
      .physicalDesignCoverageIssues(input, withUnusedComponent)
      .some((issue) => issue.code === "ASSEMBLY_UNUSED_COMPONENTS"),
  );
});

test("a valid solid that misses a required feature is repaired, not published", async () => {
  const { runCadProjectBuildPhase } = await import("../src/lib/cad/model-client.ts");
  const spec = {
    schemaVersion: 1,
    projectId: "cadp_acceptance_test",
    name: "Acceptance test",
    description: "Acceptance test",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [],
    components: [{ id: "body", name: "Body", quantity: 1, bodyRole: "primary" }],
    constraints: [],
    assumptions: [],
    exportSettings: {
      stlLinearTolerance: 0.1,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: false,
    },
  };
  const project = {
    id: spec.projectId,
    user_id: 1,
    conversation_id: 1,
    cluster_id: null,
    artifact_id: null,
    name: spec.name,
    units: "mm",
    process: "fdm",
    status: "draft",
    current_revision: 0,
    latest_revision: 0,
    design_spec_json: JSON.stringify(spec),
    created_at: "",
    updated_at: "",
  };
  const context = {
    userId: 1,
    conversationId: 1,
    clusterId: null,
    model: "test-model",
    instruction: "build it",
    safety: safety.assessCadSafety("a bracket"),
    defaults: defaults.cadDefaults("fdm"),
    attemptsRemaining: 3,
    projectId: project.id,
  };
  const realFetch = globalThis.fetch;
  const prompts = [];
  let completions = 0;
  let checks = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      completions += 1;
      prompts.push(JSON.parse(init.body).messages.at(-1).content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `call_${completions}`,
                    function: {
                      name: "cad_generate_model",
                      arguments: JSON.stringify({ source: `source_${completions}`, parameters: {} }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await runCadProjectBuildPhase({
      baseUrl: "http://chatmock.local/v1",
      model: "test-model",
      project,
      toolContext: context,
      runTool: async () => ({ ok: true, validationPassed: true, revision: 1, status: "valid" }),
      // Valid geometry, but the clamp the brief asked for is missing until the
      // second attempt.
      acceptance: () => {
        checks += 1;
        return checks === 1
          ? [
              {
                code: "MISSING_REQUIRED_FEATURE",
                severity: "error",
                feature: "host_interface_retention",
                message: "The geometry built, but it has no clamp.",
                repairHint: 'Record a constraint with id "host_interface_retention".',
              },
            ]
          : [];
      },
    });

    assert.equal(completions, 2, "a missing feature must be sent back to the model");
    assert.equal(result.stoppedBecause, "answered");
    // The model is told exactly what is missing, not merely that something is.
    assert.match(prompts[1], /host_interface_retention/);
    assert.match(prompts[1], /it has no clamp/);
    assert.match(prompts[1], /constraints/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the physical hand-off gives the model bounded repair attempts and no template", () => {
  const manager = source("src/lib/hardware/run-manager.ts");
  assert.match(manager, /acceptance: \(manifest\) => physicalDesignCoverageIssues\(/);
  assert.match(manager, /maxModelBuildSteps: 2/);
  assert.doesNotMatch(manager, /physicalFallbackFromDesign|enclosureFallbackFromDesign/);

  const service = source("src/lib/cad/design-service.ts");
  assert.doesNotMatch(service, /geometryAuthor: "deterministic-template"/);
  assert.match(service, /cad\.acceptance\.failed/);
});
