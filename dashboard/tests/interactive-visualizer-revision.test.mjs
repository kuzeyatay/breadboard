import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { compileCustomInteractiveVisualizerPackage } from "../src/lib/hermes/interactive-visualizer-custom.ts";
import { interactiveVisualizerPlanForAttempt } from "../src/lib/hermes/interactive-visualizer-plan.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/interactive-visualizer/coulomb-force-lab.json", import.meta.url), "utf8"));

test("creation keeps the original mode contract; revision stages a new plan without mutating it", () => {
  const original = structuredClone(fixture.plan);
  const pkg = structuredClone(fixture.package);
  pkg.manifest.mode = "3d";
  const create = interactiveVisualizerPlanForAttempt({ plan: original, packageValue: pkg, operation: "create" });
  assert.equal(create.mode, "2d");
  assert.ok(compileCustomInteractiveVisualizerPackage(create, pkg).validation.errors.includes("manifest.mode must match the plan"));
  for (const mode of ["3d", "hybrid"]) {
    pkg.manifest.mode = mode;
    const revised = interactiveVisualizerPlanForAttempt({ plan: original, packageValue: pkg, operation: "revise", revisionPrompt: "Make it 3D" });
    assert.equal(revised.mode, mode);
    assert.equal(revised.rationale, "Make it 3D");
    assert.equal(compileCustomInteractiveVisualizerPackage(revised, pkg).validation.valid, true);
    assert.deepEqual(original, fixture.plan);
  }
  pkg.manifest.mode = "invalid";
  const invalid = interactiveVisualizerPlanForAttempt({ plan: original, packageValue: pkg, operation: "revise" });
  assert.equal(compileCustomInteractiveVisualizerPackage(invalid, pkg).validation.valid, false);
});

test("a 3D revision publishes its plan only after validation and restores the 2D plan on rollback", async () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE hermes_artifacts (id TEXT PRIMARY KEY, renderer_id TEXT, source_skill TEXT,
      status TEXT, current_version INTEGER, metadata_json TEXT, error_json TEXT, updated_at TEXT);
    CREATE TABLE hermes_artifact_versions (artifact_id TEXT, version INTEGER, status TEXT, metadata_json TEXT);
    CREATE TABLE hermes_interactive_visualizers (artifact_id TEXT PRIMARY KEY, plan_json TEXT, mode TEXT,
      lifecycle_status TEXT, active_version INTEGER, current_job_id TEXT, repair_attempt INTEGER,
      cancellation_requested INTEGER, last_error_json TEXT, updated_at TEXT);
    CREATE TABLE hermes_interactive_visualizer_jobs (id TEXT PRIMARY KEY, artifact_id TEXT, run_id TEXT,
      candidate_version INTEGER, attempt INTEGER, operation TEXT, status TEXT, revision_prompt TEXT,
      package_json TEXT, started_at TEXT, completed_at TEXT, validation_json TEXT, tests_json TEXT,
      manifest_json TEXT, error_json TEXT);
  `);
  const oldMetadata = { artifactType: "interactive-visualizer", interactiveVisualizer: {
    plan: fixture.plan, manifest: { mode: "2d" },
  } };
  database.prepare("INSERT INTO hermes_artifacts VALUES (?, ?, ?, 'ready', 1, ?, NULL, '')").run(
    "art_revision", "interactive-visualizer", "interactive-visualizer-in-chat", JSON.stringify(oldMetadata));
  database.prepare("INSERT INTO hermes_artifact_versions VALUES (?, 1, 'ready', ?)").run("art_revision", JSON.stringify(oldMetadata));
  database.prepare("INSERT INTO hermes_interactive_visualizers VALUES (?, ?, '2d', 'ready', 1, NULL, 0, 0, NULL, '')").run("art_revision", JSON.stringify(fixture.plan));
  const getArtifact = () => database.prepare("SELECT * FROM hermes_artifacts").get();
  const getPlan = () => JSON.parse(database.prepare("SELECT plan_json FROM hermes_interactive_visualizers").get().plan_json);
  let browserPasses = false;
  let browserCalls = 0;
  const state = {
    db: database,
    getArtifactById: getArtifact,
    getArtifactVersion: (_id, version) => database.prepare("SELECT * FROM hermes_artifact_versions WHERE version = ?").get(version),
    presentArtifact: a => a,
    recordArtifactPipelineEvent: () => {},
    publishValidatedArtifactVersion: input => {
      assert.equal(getPlan().mode, "2d", "the active plan stays untouched while publication is staged");
      database.prepare("INSERT INTO hermes_artifact_versions VALUES (?, ?, 'ready', ?)").run(input.artifact.id, input.version, JSON.stringify(input.metadata));
      database.prepare("UPDATE hermes_artifacts SET current_version = ?, metadata_json = ?").run(input.version, JSON.stringify(input.metadata));
      return getArtifact();
    },
    activateArtifactVersion: input => {
      const target = state.getArtifactVersion(input.artifact.id, input.version);
      database.prepare("UPDATE hermes_artifacts SET current_version = ?, metadata_json = ?").run(input.version, target.metadata_json);
      return getArtifact();
    },
    runInteractiveVisualizerPublicationViaRuntime: async input => {
      assert.deepEqual(getPlan(), fixture.plan);
      const compiled = compileCustomInteractiveVisualizerPackage(input.plan, input.packageValue);
      if (!compiled.validation.valid) return { ...compiled, tests: null };
      browserCalls++;
      return { ...compiled, customPackage: true, bundleHtml: "<main>3D scene</main>", bundleHash: "b".repeat(64),
        tests: { passed: browserPasses, checks: [{ name: "WebGL", passed: browserPasses, detail: "test renderer" }], viewports: ["1280x800"], screenshotCreated: true } };
    },
  };
  const key = "__visualizerRevisionTest";
  globalThis[key] = state;
  const mocks = {
    "../db.ts": `export default globalThis.${key}.db;`,
    "./artifact-store.ts": ["activateArtifactVersion", "getArtifactById", "getArtifactVersion", "presentArtifact", "publishValidatedArtifactVersion", "recordArtifactPipelineEvent", "createArtifact", "addArtifactProvenance"]
      .map(name => `export const ${name} = (...args) => globalThis.${key}.${name}(...args);`).join("\n"),
    "./interactive-visualizer-browser.ts": `export const cancelInteractiveVisualizerWork = async () => true;
      export const runInteractiveVisualizerPublicationViaRuntime = input => globalThis.${key}.runInteractiveVisualizerPublicationViaRuntime(input);`,
  };
  try {
    const result = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/hermes/interactive-visualizer-service.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "runtime-boundary", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : null);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path] }));
      } }],
    });
    const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
    const pkg = structuredClone(fixture.package);
    pkg.manifest.mode = "3d";
    const context = { userId: 1, runtimeSessionId: 1, conversationId: 1, runId: "run_revision", assistantMessageId: 1, sourceSkill: "interactive-visualizer-in-chat" };
    const revise = packageValue => service.generateInteractiveVisualizer({ context, artifact: getArtifact(), operation: "revise", packageValue, revisionPrompt: "Make it 3D" });
    const invalid = structuredClone(pkg); invalid.files["main.js"] += '\nfetch("https://example.com");';
    assert.equal((await revise(invalid)).validation.valid, false);
    assert.equal(browserCalls, 0);
    assert.deepEqual(getPlan(), fixture.plan);
    assert.equal((await revise(pkg)).tests.passed, false);
    assert.equal(getArtifact().status, "ready");
    assert.equal(getArtifact().current_version, 1);
    assert.deepEqual(getPlan(), fixture.plan);
    browserPasses = true;
    const ready = await revise(pkg);
    assert.equal(ready.manifest.mode, "3d");
    assert.equal(getPlan().mode, "3d");
    assert.equal(getArtifact().current_version, 2);
    service.rollbackInteractiveVisualizer({ context, artifact: getArtifact(), version: 1 });
    assert.deepEqual(getPlan(), fixture.plan);
    assert.equal(getArtifact().current_version, 1);
  } finally {
    delete globalThis[key]; database.close();
  }
});
