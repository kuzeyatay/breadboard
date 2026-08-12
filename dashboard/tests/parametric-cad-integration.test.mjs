// The complete path, with a real CAD kernel:
//
//   tool call -> CadQuery execution -> validation -> export -> artifact
//   persistence -> the shape the artifact renderer reads
//
// The model step is deliberately absent. These tests supply the CadQuery source
// a competent model would write, so a failure here is a defect in Breadboard's
// pipeline rather than a bad day for a language model. The model loop itself is
// covered structurally in parametric-cad-agent.test.mjs and by the live run in
// docs/PARAMETRIC_CAD_AGENT_DEV.md.
//
// The suite starts the CAD service itself on a free loopback port with a
// throwaway secret. It skips with a specific message when the Python
// environment has not been provisioned (`npm run setup:cad`), so a checkout
// without it still has a green suite.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const cadServiceRoot = path.join(repoRoot, "cad-service");
const cadPython = path.join(
  repoRoot,
  ".runtime",
  "cad-venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

const available = fs.existsSync(cadPython) && fs.existsSync(cadServiceRoot);
const skip = available
  ? false
  : "the CAD Python environment is not provisioned — run `npm run setup:cad`";

const Database = (await import("better-sqlite3")).default;
const { ensureCadSchema } = await import("../src/lib/cad/schema.ts");
const { ensureArtifactSchema } = await import("../src/lib/hermes/artifact-schema.ts");
const { runCadTool } = await import("../src/lib/cad/tools.ts");
const { cadDefaults } = await import("../src/lib/cad/defaults.ts");
const { parseStoredCadArtifact } = await import("../src/lib/cad/schemas.ts");
const { enclosureFallbackFromDesign, physicalDesignCoverageIssues } = await import(
  "../src/lib/cad/board-enclosures.ts"
);
const { buildCadManifest } = await import("../src/lib/cad/artifact.ts");
const store = await import("../src/lib/cad/project-store.ts");

// ---------------------------------------------------------------------------
// The service under test
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

let service = null;
let serviceEnv = {};
let workspaceRoot = "";

async function startService() {
  const port = await freePort();
  const secret = `test-${Math.random().toString(36).slice(2)}`;
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cad-itest-ws-"));
  service = spawn(
    cadPython,
    ["-m", "breadboard_cad", "serve", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: cadServiceRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        BREADBOARD_CAD_SECRET: secret,
        BREADBOARD_CAD_WORKSPACE: workspaceRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  service.stdout.setEncoding("utf8");
  service.stderr.setEncoding("utf8");

  const baseUrl = `http://127.0.0.1:${port}`;
  serviceEnv = { CAD_SERVICE_URL: baseUrl, CAD_SERVICE_SECRET: secret };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the CAD service did not start");
}

function stopService() {
  if (service && service.exitCode === null) service.kill();
  service = null;
  if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// A conversation to build in
// ---------------------------------------------------------------------------

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cad-itest-"));
  const database = new Database(path.join(root, "cad.sqlite"));
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
  ensureCadSchema(database);
  return { root, database, storageRoot: path.join(root, "cad-projects") };
}

function context(harnessValue, overrides = {}) {
  return {
    userId: 1,
    conversationId: 12,
    clusterId: null,
    model: "integration-test",
    instruction: "integration test",
    safety: { level: "supported" },
    defaults: cadDefaults("fdm", {}),
    database: harnessValue.database,
    storageRoot: harnessValue.storageRoot,
    env: serviceEnv,
    attemptsRemaining: 3,
    ...overrides,
  };
}

function exportSettings() {
  return {
    stlLinearTolerance: 0.06,
    stlAngularTolerance: 0.25,
    generateStep: true,
    generateStl: true,
    generateGlb: true,
    generate3mf: true,
  };
}

function parameter(id, label, value, extra = {}) {
  return { id, label, value, editable: true, source: "user", ...extra };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BRACKET_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {
    "length": 80.0,
    "width": 50.0,
    "thickness": 5.0,
    "hole_diameter": 4.5,
    "hole_inset": 8.0,
    "corner_radius": 4.0,
}


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    plate = (
        cq.Workplane("XY")
        .box(p["length"], p["width"], p["thickness"])
        .edges("|Z")
        .fillet(p["corner_radius"])
    )
    plate = (
        plate.faces(">Z")
        .workplane()
        .rect(
            p["length"] - 2 * p["hole_inset"],
            p["width"] - 2 * p["hole_inset"],
            forConstruction=True,
        )
        .vertices()
        .hole(p["hole_diameter"])
    )
    return {"bracket": plate}
`;

const ENCLOSURE_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {
    "inner_width": 92.0,
    "inner_depth": 65.0,
    "inner_height": 28.0,
    "wall": 2.4,
    "lid_clearance": 0.35,
    "lid_thickness": 2.4,
    "lid_gap": 12.0,
}


def _shell(p):
    outer_width = p["inner_width"] + 2 * p["wall"]
    outer_depth = p["inner_depth"] + 2 * p["wall"]
    outer_height = p["inner_height"] + p["wall"]
    return (
        cq.Workplane("XY")
        .box(outer_width, outer_depth, outer_height, centered=(True, True, False))
        .faces(">Z")
        .shell(-p["wall"])
    )


def _lid(p):
    return (
        cq.Workplane("XY")
        .workplane(offset=p["inner_height"] + p["wall"] + p["lid_gap"])
        .box(
            p["inner_width"] - 2 * p["lid_clearance"],
            p["inner_depth"] - 2 * p["lid_clearance"],
            p["lid_thickness"],
            centered=(True, True, False),
        )
    )


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    return {"shell": _shell(p), "lid": _lid(p)}
`;

const COUPLER_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {
    "outer_diameter": 25.0,
    "length": 30.0,
    "bore_a": 8.0,
    "bore_b": 5.0,
}


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    body = cq.Workplane("XY").circle(p["outer_diameter"] / 2).extrude(p["length"])
    body = body.faces("<Z").workplane().hole(p["bore_a"], p["length"] / 2)
    body = body.faces(">Z").workplane().hole(p["bore_b"], p["length"] / 2)
    return {"coupler": body}
`;

const IMPOSSIBLE_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {"width": 40.0, "cutter": 120.0}


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    # The cutter swallows the body whole, so nothing is left to print. The
    # kernel does not raise for this; it returns an empty result.
    body = cq.Workplane("XY").box(p["width"], p["width"], p["width"])
    cutter = cq.Workplane("XY").box(p["cutter"], p["cutter"], p["cutter"])
    return {"broken": body.cut(cutter)}
`;

// `shell` returns the original solid rather than raising when the requested
// thickness leaves nothing to remove, so a request for a hollow enclosure can
// come back as a solid brick that passes every topology check.
const SILENTLY_SOLID_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {"width": 40.0, "wall": 30.0}


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    box = cq.Workplane("XY").box(p["width"], p["width"], p["width"])
    return {"shell": box.faces(">Z").shell(-p["wall"])}
`;

const FORBIDDEN_SOURCE = `import cadquery as cq
import os


def build_model(params):
    os.listdir("/")
    return {"body": cq.Workplane("XY").box(10, 10, 10)}
`;

const OVERSIZED_SOURCE = `import cadquery as cq

DEFAULT_PARAMS = {"length": 400.0, "width": 300.0, "height": 20.0}


def build_model(params):
    p = {**DEFAULT_PARAMS, **params}
    return {"panel": cq.Workplane("XY").box(p["length"], p["width"], p["height"])}
`;

async function createProject(harnessValue, toolContext, spec, parameters) {
  const result = await runCadTool(
    "cad_create_project",
    { name: spec.name, units: spec.units, design_spec: spec, parameters },
    toolContext,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.projectId;
}

// ---------------------------------------------------------------------------

test("parametric CAD, end to end", { skip, concurrency: false }, async (t) => {
  await startService();
  t.after(stopService);

  await t.test("1. a rectangular mounting bracket with four holes", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "mounting-bracket",
          description: "An 80 × 50 × 5 mm plate with four M4 clearance holes.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("length", "Length", 80, { unit: "mm", minimum: 20, maximum: 300 }),
            parameter("width", "Width", 50, { unit: "mm" }),
            parameter("thickness", "Thickness", 5, { unit: "mm" }),
            parameter("hole_diameter", "Hole diameter", 4.5, { unit: "mm" }),
            parameter("hole_inset", "Hole inset", 8, { unit: "mm" }),
            parameter("corner_radius", "Corner radius", 4, { unit: "mm", source: "default" }),
          ],
          components: [{ id: "bracket", name: "Bracket", quantity: 1, bodyRole: "primary" }],
          constraints: [
            { id: "h", type: "hole", description: "M4 clearance", expected: 4.5 },
          ],
          assumptions: [
            {
              id: "a1",
              description: "4 mm corner radius",
              reason: "Not stated; softens the corners for printing.",
              userEditable: true,
            },
          ],
          exportSettings: exportSettings(),
          declaredBoundingBox: { x: 80, y: 50, z: 5, tolerance: 0.4 },
          printerBed: { x: 220, y: 220, z: 250 },
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: BRACKET_SOURCE, parameters: {}, note: "first build" },
        toolContext,
      );
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.validationPassed, true, JSON.stringify(built.issues));
      assert.equal(built.status, "valid");
      assert.equal(built.revision, 1);
      assert.equal(built.measurements.solidCount, 1);
      // The measured envelope matches what the specification declared.
      assert.ok(Math.abs(built.measurements.boundingBox.x - 80) < 0.4);
      assert.ok(Math.abs(built.measurements.boundingBox.y - 50) < 0.4);
      assert.ok(Math.abs(built.measurements.boundingBox.z - 5) < 0.4);
      assert.equal(built.measurements.bodies[0].watertight, true);
      assert.equal(built.measurements.bodies[0].valid, true);

      // Every export exists, is non-empty, and parses as its format.
      const exported = await runCadTool("cad_export_model", { projectId }, toolContext);
      assert.equal(exported.ok, true);
      const formats = exported.exports.map((file) => file.format).sort();
      assert.deepEqual(formats, ["3mf", "glb", "report", "source", "spec", "step", "stl"]);

      const step = store.readCadFile({
        projectId,
        revision: 1,
        format: "step",
        database: harnessValue.database,
        storageRoot: harnessValue.storageRoot,
      });
      assert.ok(step.content.byteLength > 1000);
      assert.match(step.content.toString("utf8"), /ISO-10303-21/);
      assert.match(step.content.toString("utf8"), /MANIFOLD_SOLID_BREP/);

      const stl = store.readCadFile({
        projectId,
        revision: 1,
        format: "stl",
        database: harnessValue.database,
        storageRoot: harnessValue.storageRoot,
      }).content;
      assert.ok(stl.byteLength > 84);
      if (stl.subarray(0, 5).toString("utf8") === "solid") {
        assert.match(stl.toString("utf8"), /facet normal/);
      } else {
        const triangles = stl.readUInt32LE(80);
        assert.equal(stl.byteLength, 84 + triangles * 50);
        assert.ok(triangles > 12);
      }

      const glb = store.readCadFile({
        projectId,
        revision: 1,
        format: "glb",
        database: harnessValue.database,
        storageRoot: harnessValue.storageRoot,
      }).content;
      assert.equal(glb.subarray(0, 4).toString("utf8"), "glTF");

      const sourceFile = store.readCadFile({
        projectId,
        revision: 1,
        format: "source",
        database: harnessValue.database,
        storageRoot: harnessValue.storageRoot,
      }).content.toString("utf8");
      assert.equal(sourceFile, BRACKET_SOURCE);

      // The artifact the renderer reads validates and carries reproducibility data.
      const manifest = buildCadManifest({
        projectId,
        disclaimers: ["Validation here is geometric."],
        database: harnessValue.database,
      });
      const parsed = parseStoredCadArtifact(manifest);
      assert.equal(parsed.ok, true, JSON.stringify(parsed.issues ?? []));
      assert.equal(parsed.value.provenance.engine, "cadquery");
      assert.match(parsed.value.provenance.engineVersion, /^\d+\.\d+/);
      assert.match(parsed.value.provenance.kernelVersion, /^\d+\.\d+/);
      assert.match(parsed.value.provenance.pythonVersion, /^3\.\d+/);
      assert.equal(parsed.value.previewFile.format, "glb");
      assert.deepEqual(parsed.value.assumptions, ["4 mm corner radius"]);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("2. a two-part electronics enclosure with lid clearance", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "pi-enclosure",
          description: "A 92 × 65 × 28 mm internal enclosure with a removable lid.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("inner_width", "Internal width", 92, { unit: "mm" }),
            parameter("inner_depth", "Internal depth", 65, { unit: "mm" }),
            parameter("inner_height", "Internal height", 28, { unit: "mm" }),
            parameter("wall", "Wall thickness", 2.4, { unit: "mm" }),
            parameter("lid_clearance", "Lid clearance", 0.35, { unit: "mm" }),
            parameter("lid_thickness", "Lid thickness", 2.4, { unit: "mm" }),
            parameter("lid_gap", "Lid preview gap", 12, {
              unit: "mm",
              source: "derived",
              description: "How far the lid floats above the shell in the preview.",
            }),
          ],
          components: [
            { id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" },
            { id: "lid", name: "Lid", quantity: 1, bodyRole: "lid" },
          ],
          constraints: [
            { id: "w", type: "wall-thickness", description: "2.4 mm walls", expected: 2.4 },
            { id: "c", type: "clearance", description: "0.35 mm lid clearance", expected: 0.35 },
          ],
          assumptions: [],
          exportSettings: exportSettings(),
          printerBed: { x: 220, y: 220, z: 250 },
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: ENCLOSURE_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.measurements.solidCount, 2);
      // 92 + 2 × 2.4 = 96.8 outer width.
      assert.ok(Math.abs(built.measurements.boundingBox.x - 96.8) < 0.05);
      for (const body of built.measurements.bodies) {
        assert.equal(body.valid, true, body.name);
        assert.equal(body.watertight, true, body.name);
      }
      // A lid modelled beside its shell is a disconnected body — a warning about
      // intent, never a reason to fail a two-part design.
      const codes = Object.fromEntries(
        built.issues.map((issue) => [issue.code, issue.severity]),
      );
      assert.equal(codes.disconnected_bodies, "warning");
      assert.equal(built.validationPassed, true, JSON.stringify(built.issues));
      assert.equal(built.status, "valid-with-warnings");
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("3. a shaft coupler with configurable bore diameters", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "shaft-coupler",
          description: "A 25 mm coupler joining an 8 mm and a 5 mm shaft.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("outer_diameter", "Outer diameter", 25, { unit: "mm" }),
            parameter("length", "Length", 30, { unit: "mm" }),
            parameter("bore_a", "Bore A", 8, { unit: "mm", minimum: 2, maximum: 20 }),
            parameter("bore_b", "Bore B", 5, { unit: "mm", minimum: 2, maximum: 20 }),
          ],
          components: [{ id: "coupler", name: "Coupler", quantity: 1, bodyRole: "primary" }],
          constraints: [
            { id: "a", type: "hole", description: "8 mm bore", expected: 8 },
            { id: "b", type: "hole", description: "5 mm bore", expected: 5 },
          ],
          assumptions: [],
          exportSettings: exportSettings(),
          declaredBoundingBox: { x: 25, y: 25, z: 30, tolerance: 0.3 },
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: COUPLER_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.validationPassed, true, JSON.stringify(built.issues));
      assert.ok(Math.abs(built.measurements.boundingBox.z - 30) < 0.3);

      // Bores are the reason this part exists, so changing one is the real test
      // of parametric editing.
      const changed = await runCadTool(
        "cad_update_parameters",
        { projectId, parameters: { bore_a: 10 }, note: "10 mm motor shaft" },
        toolContext,
      );
      assert.equal(changed.ok, true, JSON.stringify(changed));
      assert.equal(changed.revision, 2);
      assert.deepEqual(changed.changed, [{ id: "bore_a", from: 8, to: 10 }]);
      // A wider bore removes material, so the coupler must weigh less.
      assert.ok(
        changed.measurements.volume < built.measurements.volume,
        "a larger bore did not remove material",
      );

      // A value outside its declared range is refused before anything is built.
      const rejected = await runCadTool(
        "cad_update_parameters",
        { projectId, parameters: { bore_a: 900 } },
        toolContext,
      );
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error, "parameter_out_of_range");

      // …and so is a parameter the design does not expose.
      const unknown = await runCadTool(
        "cad_update_parameters",
        { projectId, parameters: { flange_diameter: 40 } },
        toolContext,
      );
      assert.equal(unknown.ok, false);
      assert.equal(unknown.error, "unknown_parameters");
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("4. a deliberately impossible model fails validation", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "impossible-part",
          description: "A body cut away entirely by its own cutter.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("width", "Width", 40, { unit: "mm" }),
            parameter("cutter", "Cutter", 120, { unit: "mm" }),
          ],
          components: [{ id: "broken", name: "Broken", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: IMPOSSIBLE_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(built.ok, false, JSON.stringify(built));
      // The kernel refuses this either by returning nothing or by raising while
      // it tries. Both are a correct refusal; quietly reporting a good part is
      // the outcome that would be wrong.
      assert.ok(
        ["empty_result", "execution_error"].includes(built.error),
        JSON.stringify(built),
      );
      assert.ok(built.message.length > 10, JSON.stringify(built));
      assert.equal(built.retryable, true);

      // The project never advanced to a design nobody can print.
      const project = store.getCadProject(projectId, harnessValue.database);
      assert.equal(project.current_revision, 0);
      assert.equal(project.status, "draft");
      assert.equal(store.listCadRevisions(projectId, harnessValue.database).length, 0);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("4b. a hollowing operation that silently did nothing is caught", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "silently-solid",
          description: "An enclosure whose walls are thicker than its cavity.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("width", "Width", 40, { unit: "mm" }),
            parameter("wall", "Wall thickness", 30, { unit: "mm" }),
          ],
          components: [{ id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" }],
          constraints: [
            { id: "w", type: "wall-thickness", description: "30 mm walls", expected: 30 },
          ],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: SILENTLY_SOLID_SOURCE, parameters: {} },
        toolContext,
      );
      // The kernel produced a perfectly valid, watertight solid — it is simply
      // not the hollow part the design promised.
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.measurements.bodies[0].watertight, true);
      assert.equal(built.validationPassed, false, JSON.stringify(built.issues));
      assert.equal(built.status, "invalid");
      const hollow = built.issues.find((issue) => issue.code === "hollowing_had_no_effect");
      assert.ok(hollow, JSON.stringify(built.issues));
      assert.equal(hollow.severity, "error");
      assert.match(hollow.repairHint, /shell/);

      const project = store.getCadProject(projectId, harnessValue.database);
      assert.equal(project.current_revision, 0);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("5. a follow-up parameter change creates revision 2", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "revised-bracket",
          description: "A bracket revised after the first build.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("length", "Length", 80, { unit: "mm" }),
            parameter("width", "Width", 50, { unit: "mm" }),
            parameter("thickness", "Thickness", 5, { unit: "mm", minimum: 2, maximum: 20 }),
            parameter("hole_diameter", "Hole diameter", 4.5, { unit: "mm" }),
            parameter("hole_inset", "Hole inset", 8, { unit: "mm" }),
            parameter("corner_radius", "Corner radius", 4, { unit: "mm" }),
          ],
          components: [{ id: "bracket", name: "Bracket", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );
      const first = await runCadTool(
        "cad_generate_model",
        { projectId, source: BRACKET_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(first.ok, true, JSON.stringify(first));

      // "Make it 8 mm thick and use M5 holes" — without rewriting the program.
      const second = await runCadTool(
        "cad_update_parameters",
        {
          projectId,
          parameters: { thickness: 8, hole_diameter: 5.5 },
          note: "8 mm thick, M5 holes",
        },
        toolContext,
      );
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.revision, 2);
      assert.ok(Math.abs(second.measurements.boundingBox.z - 8) < 0.05);

      const project = store.getCadProject(projectId, harnessValue.database);
      assert.equal(project.current_revision, 2);
      assert.equal(project.latest_revision, 2);

      // Revision 1 is intact: its files, its parameters and its geometry.
      const history = store.revisionHistory(projectId, harnessValue.database);
      assert.equal(history.length, 2);
      assert.equal(history[0].revision, 1);
      assert.deepEqual(history[1].parameterDiff, [
        { id: "thickness", from: 5, to: 8 },
        { id: "hole_diameter", from: 4.5, to: 5.5 },
      ]);
      const originalStep = store.readCadFile({
        projectId,
        revision: 1,
        format: "step",
        database: harnessValue.database,
        storageRoot: harnessValue.storageRoot,
      });
      assert.ok(originalStep.content.byteLength > 1000);
      assert.deepEqual(store.readRevisionParameters(projectId, 1, harnessValue.database), {
        length: 80,
        width: 50,
        thickness: 5,
        hole_diameter: 4.5,
        hole_inset: 8,
        corner_radius: 4,
      });

      // The current manifest points at revision 2 and lists both.
      const manifest = buildCadManifest({
        projectId,
        disclaimers: ["Validation here is geometric."],
        database: harnessValue.database,
      });
      assert.equal(manifest.revision, 2);
      assert.equal(manifest.revisionHistory.length, 2);
      assert.equal(parseStoredCadArtifact(manifest).ok, true);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("6. generated Python containing a forbidden import is refused", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "forbidden-part",
          description: "A program that reaches for the filesystem.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [],
          components: [{ id: "body", name: "Body", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: FORBIDDEN_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(built.ok, false);
      assert.equal(built.error, "forbidden_source");
      assert.match(built.repairHint, /cadquery and math/);
      // Nothing was built, so no revision exists at all.
      assert.equal(store.listCadRevisions(projectId, harnessValue.database).length, 0);
      // The attempt still cost budget: a refused program is an attempt.
      assert.equal(built.attemptsRemaining, 2);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("7. a model exceeding the printer bed is reported as an error", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "oversized-panel",
          description: "A 400 × 300 mm panel on a 220 mm bed.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("length", "Length", 400, { unit: "mm" }),
            parameter("width", "Width", 300, { unit: "mm" }),
            parameter("height", "Height", 20, { unit: "mm" }),
          ],
          components: [{ id: "panel", name: "Panel", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
          printerBed: { x: 220, y: 220, z: 250 },
        },
        {},
      );

      const built = await runCadTool(
        "cad_generate_model",
        { projectId, source: OVERSIZED_SOURCE, parameters: {} },
        toolContext,
      );
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.validationPassed, false);
      assert.equal(built.status, "invalid");
      const bed = built.issues.filter((issue) => issue.code === "exceeds_printer_bed");
      assert.ok(bed.length >= 1);
      assert.equal(bed[0].severity, "error");
      assert.ok(bed[0].repairHint.length > 10);

      // The solid built fine — it just does not fit — so the geometry is
      // measured and reported rather than discarded.
      assert.ok(Math.abs(built.measurements.boundingBox.x - 400) < 0.05);

      // Shrinking it to fit is a parameter change, and it clears the error.
      const shrunk = await runCadTool(
        "cad_update_parameters",
        { projectId, parameters: { length: 200, width: 180 } },
        toolContext,
      );
      assert.equal(shrunk.ok, true, JSON.stringify(shrunk));
      assert.equal(shrunk.validationPassed, true, JSON.stringify(shrunk.issues));
      const project = store.getCadProject(projectId, harnessValue.database);
      // Revision 1 never became current, so revision 2 is the first the user opens.
      assert.equal(project.current_revision, 2);
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("the build budget stops a runaway turn", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue, { attemptsRemaining: 1 });
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "budget-test",
          description: "A part built until the budget runs out.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [parameter("width", "Width", 20, { unit: "mm" })],
          components: [{ id: "body", name: "Body", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );
      const source = `import cadquery as cq\n\nDEFAULT_PARAMS = {"width": 20.0}\n\n\ndef build_model(params):\n    p = {**DEFAULT_PARAMS, **params}\n    return {"body": cq.Workplane("XY").box(p["width"], p["width"], p["width"])}\n`;

      const first = await runCadTool(
        "cad_generate_model",
        { projectId, source, parameters: {} },
        toolContext,
      );
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.attemptsRemaining, 0);

      const second = await runCadTool(
        "cad_generate_model",
        { projectId, source, parameters: {} },
        toolContext,
      );
      assert.equal(second.ok, false);
      assert.equal(second.error, "attempt_budget_exhausted");
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("cad_get_project reopens a design without the model", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const projectId = await createProject(
        harnessValue,
        toolContext,
        {
          name: "reopen-test",
          description: "A design read back out of storage.",
          units: "mm",
          manufacturingProcess: "fdm",
          parameters: [
            parameter("length", "Length", 80, { unit: "mm" }),
            parameter("width", "Width", 50, { unit: "mm" }),
            parameter("thickness", "Thickness", 5, { unit: "mm" }),
            parameter("hole_diameter", "Hole diameter", 4.5, { unit: "mm" }),
            parameter("hole_inset", "Hole inset", 8, { unit: "mm" }),
            parameter("corner_radius", "Corner radius", 4, { unit: "mm" }),
          ],
          components: [{ id: "bracket", name: "Bracket", quantity: 1, bodyRole: "primary" }],
          constraints: [],
          assumptions: [],
          exportSettings: exportSettings(),
        },
        {},
      );
      await runCadTool(
        "cad_generate_model",
        { projectId, source: BRACKET_SOURCE, parameters: {} },
        toolContext,
      );

      const reopened = await runCadTool("cad_get_project", { projectId }, toolContext);
      assert.equal(reopened.ok, true);
      assert.equal(reopened.source, BRACKET_SOURCE);
      assert.equal(reopened.entrypoint, "build_model");
      assert.equal(reopened.currentRevision, 1);
      assert.equal(reopened.validation.passed, true);
      assert.equal(reopened.parameters.length, 80);
      assert.ok(reopened.disclaimers.some((line) => /geometric/i.test(line)));

      // Re-validating an unchanged specification reuses the recorded answer
      // rather than rebuilding.
      const revalidated = await runCadTool("cad_validate_model", { projectId }, toolContext);
      assert.equal(revalidated.ok, true);
      assert.equal(revalidated.revalidated, false);
      assert.equal(revalidated.passed, true);

      const views = await runCadTool("cad_render_views", { projectId }, toolContext);
      assert.equal(views.ok, true);
      assert.equal(views.views.length, 7);
      assert.equal(views.previewFormat, "glb");
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });

  await t.test("the Hardware Blueprint fallback is limited to a simple enclosure", async () => {
    const harnessValue = harness();
    const toolContext = context(harnessValue);
    try {
      const fallback = enclosureFallbackFromDesign({
        userBrief: "put this weather station in an enclosure with a lid",
        designTitle: "Weather station",
        controllerDefinitionId: "esp32-devkit-v1",
        controllerName: "ESP32 DevKit V1",
        peripherals: [],
        prototypeType: "pcb",
        process: "fdm",
        wallThickness: 2.4,
        clearance: 0.3,
        printerBed: { x: 220, y: 220, z: 250 },
      });
      assert.ok(fallback);
      const projectId = await createProject(
        harnessValue,
        toolContext,
        fallback.designSpec,
        fallback.parameters,
      );
      const built = await runCadTool(
        "cad_generate_model",
        {
          projectId,
          source: fallback.source,
          parameters: fallback.parameters,
          note: fallback.note,
        },
        toolContext,
      );
      assert.equal(built.ok, true, JSON.stringify(built));
      assert.equal(built.validationPassed, true, JSON.stringify(built.issues));
      assert.equal(built.measurements.solidCount, 2);
      assert.doesNotMatch(fallback.source, /clip_slot_width/);
      assert.match(fallback.designSpec.name, /weather station enclosure/i);
      const manifest = buildCadManifest({
        projectId,
        disclaimers: ["Validation here is geometric."],
        database: harnessValue.database,
      });
      assert.ok(manifest);
      assert.deepEqual(
        physicalDesignCoverageIssues(
          {
            userBrief: "put this weather station in an enclosure with a lid",
            designTitle: "Weather station",
            controllerDefinitionId: "esp32-devkit-v1",
            controllerName: "ESP32 DevKit V1",
            peripherals: [],
            prototypeType: "pcb",
          },
          manifest,
        ),
        [],
      );
      assert.equal(
        enclosureFallbackFromDesign({
          userBrief: "design AR glasses that fit onto my glasses",
          designTitle: "Universal Clip-On AR Glasses",
          controllerDefinitionId: "esp32-devkit-v1",
          controllerName: "ESP32 DevKit V1",
          peripherals: [],
          prototypeType: "pcb",
          process: "fdm",
          wallThickness: 2.4,
          clearance: 0.3,
          printerBed: { x: 220, y: 220, z: 250 },
        }),
        null,
      );
    } finally {
      harnessValue.database.close();
      fs.rmSync(harnessValue.root, { recursive: true, force: true });
    }
  });
});
