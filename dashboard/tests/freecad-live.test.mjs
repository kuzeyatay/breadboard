// Opt-in: actual MCP stdio server -> FreeCAD -> STEP measurement -> durable
// revisions and native documents. No model, geometry or bridge mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { freecadAvailability } from "../src/lib/cad/freecad/config.ts";
import { executeFreeCADMcp } from "../src/lib/cad/freecad/mcp.ts";
import { ensureCadSchema } from "../src/lib/cad/schema.ts";
import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import { runCadTool } from "../src/lib/cad/tools.ts";
import { cadDefaults } from "../src/lib/cad/defaults.ts";
import { buildCadManifest } from "../src/lib/cad/artifact.ts";
import { parseStoredCadArtifact } from "../src/lib/cad/schemas.ts";
import { applyParameterUpdate } from "../src/lib/cad/parameter-action.ts";
import { readCadFile, getCadProject } from "../src/lib/cad/project-store.ts";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = `import FreeCAD as App
import Part, Sketcher
DEFAULT_PARAMS = {'diameter': 40.0, 'hole': 10.0, 'height': 5.0}
def build_model(doc, params):
    body = doc.addObject('PartDesign::Body', 'Washer')
    sketch = body.newObject('Sketcher::SketchObject', 'Profile')
    for radius in [params['diameter'] / 2, params['hole'] / 2]:
        index = sketch.addGeometry(Part.Circle(App.Vector(0, 0, 0), App.Vector(0, 0, 1), radius), False)
        sketch.addConstraint(Sketcher.Constraint('Diameter', index, radius * 2))
    doc.recompute()
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sketch
    pad.Length = params['height']
    doc.recompute()
    return {'washer': body}
`;

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test("FreeCAD MCP builds, reopens and revises a native sketch/pad document with measured exports", {
  skip: process.env.BREADBOARD_TEST_FREECAD !== "1" ? "set BREADBOARD_TEST_FREECAD=1 after setup:freecad" : false,
  timeout: 240_000,
}, async (t) => {
  const available = freecadAvailability();
  assert.ok(available.available, available.message);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-freecad-live-"));
  const database = new Database(path.join(scratch, "cad.sqlite"));
  const port = await unusedPort();
  const secret = `freecad-test-${crypto.randomUUID()}`;
  const env = { ...process.env, BREADBOARD_REPO_ROOT: root, CAD_SERVICE_URL: `http://127.0.0.1:${port}`, CAD_SERVICE_SECRET: secret };
  const python = path.join(root, ".runtime", "cad-venv", ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
  assert.ok(fs.existsSync(python), "run npm run setup:cad");
  const service = spawn(python, ["-m", "breadboard_cad", "serve", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(root, "cad-service"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, BREADBOARD_CAD_SECRET: secret, BREADBOARD_CAD_WORKSPACE: path.join(scratch, "service"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  let log = "";
  service.stdout.on("data", (part) => { log = (log + part).slice(-4000); });
  service.stderr.on("data", (part) => { log = (log + part).slice(-4000); });
  t.after(async () => {
    database.close();
    if (service.exitCode === null) {
      const closed = new Promise((resolve) => service.once("exit", resolve));
      service.kill();
      await closed;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  let healthy = false;
  for (const deadline = Date.now() + 60_000; Date.now() < deadline;) {
    try {
      const response = await fetch(`${env.CAD_SERVICE_URL}/health`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) });
      if (response.ok) { healthy = true; break; }
    } catch { /* service starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(healthy, log);
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1);
    INSERT INTO conversations VALUES(12, 'conv_freecad_test', 1, 'dashboard_terminal', NULL);
  `);
  ensureArtifactSchema(database);
  ensureCadSchema(database);
  const storageRoot = path.join(scratch, "projects");
  const ctx = { userId: 1, conversationId: 12, clusterId: null, model: "live-test", instruction: "Make a FreeCAD washer",
    safety: { level: "supported" }, defaults: cadDefaults("fdm"), database, storageRoot, env, engine: "freecad", attemptsRemaining: 4 };
  const spec = { name: "FreeCAD washer", description: "Washer with native sketch and pad", units: "mm", manufacturingProcess: "fdm",
    parameters: Object.entries({ diameter: 40, hole: 10, height: 5 }).map(([id, value]) => ({ id, label: id, value, editable: true, source: "user" })),
    components: [{ id: "washer", name: "Washer", quantity: 1, bodyRole: "primary" }], constraints: [], assumptions: [],
    exportSettings: { stlLinearTolerance: 0.06, stlAngularTolerance: 0.25, generateStep: true, generateStl: true, generateGlb: true, generate3mf: true } };
  const created = await runCadTool("cad_create_project", { name: spec.name, units: "mm", design_spec: spec, parameters: {} }, ctx);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.match(created.next, /FreeCAD/);
  const projectId = created.projectId;
  const built = await runCadTool("cad_generate_model", { projectId, source, parameters: {}, timeoutMs: 60_000 }, ctx);
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.validationPassed, true, JSON.stringify(built));
  assert.equal(built.measurements.solidCount, 1);
  assert.ok(Math.abs(built.measurements.volume - Math.PI * (20 ** 2 - 5 ** 2) * 5) < 0.1);
  const manifest = buildCadManifest({ projectId, revision: built.revision, database, disclaimers: [] });
  assert.equal(manifest.provenance.engine, "freecad");
  assert.ok(parseStoredCadArtifact(manifest));
  const nativeExport = await runCadTool("cad_export_model", { projectId, formats: ["fcstd", "freecad-source"] }, ctx);
  assert.equal(nativeExport.ok, true, JSON.stringify(nativeExport));
  assert.deepEqual(nativeExport.exports.map((item) => item.format).sort(), ["fcstd", "freecad-source"]);
  for (const format of ["fcstd", "freecad-source", "step", "stl", "glb", "3mf"]) {
    const bytes = readCadFile({ projectId, revision: 1, format, database, storageRoot }).content;
    assert.ok(bytes.length > 10, format);
  }
  const nativePath = path.join(scratch, "roundtrip.FCStd");
  fs.writeFileSync(nativePath, readCadFile({ projectId, revision: 1, format: "fcstd", database, storageRoot }).content);
  const reopened = await executeFreeCADMcp({ timeoutMs: 30_000, code: `import FreeCAD as App\ndoc=App.openDocument(${JSON.stringify(nativePath)})\ndoc.recompute()\nassert doc.Profile.TypeId == 'Sketcher::SketchObject'\nassert doc.Pad.TypeId == 'PartDesign::Pad'\nassert len(doc.Washer.Shape.Solids)==1\nprint('NATIVE_FEATURES_OK')\nApp.closeDocument(doc.Name)` });
  assert.match(reopened, /NATIVE_FEATURES_OK/);
  // The parameter panel must recover FreeCAD from stored provenance.
  const changed = await applyParameterUpdate({ userId: 1, projectId, conversationPublicId: "conv_freecad_test",
    values: { height: 8 }, database, storageRoot, env });
  assert.equal(changed.manifest.provenance.engine, "freecad");
  assert.ok(Math.abs(changed.manifest.measurements.boundingBox.z - 8) < 0.01);
  assert.equal(changed.revision, 2);
  const oversized = await runCadTool("cad_generate_model", { projectId,
    source: source.replace("pad.Length = params['height']", "pad.Length = params['height'] * 100"),
    parameters: {}, timeoutMs: 60_000 }, ctx);
  assert.equal(oversized.ok, true, JSON.stringify(oversized));
  assert.equal(oversized.validationPassed, false);
  assert.ok(oversized.issues.some((issue) => issue.code === "exceeds_printer_bed" && issue.severity === "error"));
  assert.equal(getCadProject(projectId, database).current_revision, 2);
  const failed = await runCadTool("cad_generate_model", { projectId, source: "import os\ndef build_model(doc, params): return {}", parameters: {} }, ctx);
  assert.equal(failed.ok, false);
  assert.equal(getCadProject(projectId, database).current_revision, 2);
});

test("aborting a real FreeCAD MCP build terminates the owned child", {
  skip: process.env.BREADBOARD_TEST_FREECAD !== "1", timeout: 30_000,
}, async () => {
  const controller = new AbortController();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "freecad-cancel-"));
  const pidPath = path.join(scratch, "pid.txt");
  const started = Date.now();
  const pending = executeFreeCADMcp({ code: `import os, pathlib, time\npathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\ntime.sleep(60)`, timeoutMs: 65_000, signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error.code === "execution_aborted");
  try {
    while (!fs.existsSync(pidPath) && Date.now() - started < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(pidPath), "the actual FreeCAD child must be running before cancellation");
    const pid = Number(fs.readFileSync(pidPath, "utf8"));
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
    assert.ok(Date.now() - started < 25_000);
  } finally {
    controller.abort();
    await rejected;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
