import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { compileCustomInteractiveVisualizerPackage } from "../src/lib/hermes/interactive-visualizer-custom.ts";
import { precheckInteractiveVisualizerPackage } from "../src/lib/hermes/interactive-visualizer-plan.ts";
import { describeError } from "../src/lib/hermes/route-core.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/interactive-visualizer/coulomb-force-lab.json", import.meta.url), "utf8"));

// On 2026-09-10 Gemini answered the create schema with integer stand-ins for
// every nested object. The dashboard answered "Internal server error", so the
// model concluded the backend was offline.
test("placeholder packages are named field by field instead of becoming a 500", () => {
  const problems = precheckInteractiveVisualizerPackage({
    schemaVersion: 2, manifest: 0, files: 0, semanticTests: [0, 1], sourceReferences: [0],
    assumptions: [], limitations: [], assets: [],
  });
  assert.ok(problems.some(p => p.startsWith("package.manifest is a number placeholder")), problems);
  assert.ok(problems.some(p => p.startsWith("package.files is a number placeholder")), problems);
  assert.ok(problems.some(p => p.startsWith("package.semanticTests[0] is a number placeholder")), problems);
  assert.deepEqual(precheckInteractiveVisualizerPackage(fixture.package), []);
  assert.deepEqual(precheckInteractiveVisualizerPackage(2), ["package must be an object"]);
  assert.ok(precheckInteractiveVisualizerPackage({ ...fixture.package, files: { ...fixture.package.files, "main.js": " " } })
    .includes('package.files["main.js"] must be a non-empty string'));
});

async function loadService(state) {
  const key = "__visualizerSupersedeTest";
  globalThis[key] = state;
  const mocks = {
    "../db.ts": `export default globalThis.${key}.db;`,
    "./artifact-store.ts": ["activateArtifactVersion", "getArtifactById", "getArtifactVersion", "presentArtifact", "publishValidatedArtifactVersion", "recordArtifactPipelineEvent", "createArtifact", "addArtifactProvenance"]
      .map(name => `export const ${name} = (...args) => globalThis.${key}.${name}(...args);`).join("\n"),
    "./interactive-visualizer-browser.ts": `export const cancelInteractiveVisualizerWork = async () => true;
      export const runInteractiveVisualizerPublicationViaRuntime = input => globalThis.${key}.runInteractiveVisualizerPublicationViaRuntime(input);`,
  };
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/hermes/interactive-visualizer-service.ts", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "runtime-boundary", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : null);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path] }));
    } }],
  });
  const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  return { service, dispose: () => { delete globalThis[key]; } };
}

function schema(database) {
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
  database.prepare("INSERT INTO hermes_artifacts VALUES (?, ?, ?, 'generating', 0, ?, NULL, '')").run(
    "art_race", "interactive-visualizer", "interactive-visualizer-in-chat",
    JSON.stringify({ artifactType: "interactive-visualizer", lifecycleStatus: "planned" }));
  database.prepare("INSERT INTO hermes_interactive_visualizers VALUES (?, ?, '2d', 'planned', 0, NULL, 0, 0, NULL, '')")
    .run("art_race", JSON.stringify(fixture.plan));
}

// Reproduces the 17:48-17:50 sequence: the tool socket timed out, the model
// resent identical arguments, the resend cancelled the first Runtime job, and
// the first handler then flagged the artifact as cancelled by the user two
// seconds before the second job's passing package arrived.
test("a superseded attempt cannot make the newer attempt discard its own publication", async () => {
  const database = new Database(":memory:");
  schema(database);
  const getArtifact = () => database.prepare("SELECT * FROM hermes_artifacts").get();
  const row = () => database.prepare("SELECT * FROM hermes_interactive_visualizers").get();
  const pending = new Map();
  const state = {
    db: database,
    getArtifactById: getArtifact,
    getArtifactVersion: (_id, version) => database.prepare("SELECT * FROM hermes_artifact_versions WHERE version = ?").get(version),
    presentArtifact: a => a,
    recordArtifactPipelineEvent: () => {},
    publishValidatedArtifactVersion: input => {
      database.prepare("INSERT INTO hermes_artifact_versions VALUES (?, ?, 'ready', ?)").run(input.artifact.id, input.version, JSON.stringify(input.metadata));
      database.prepare("UPDATE hermes_artifacts SET current_version = ?, status = 'ready', metadata_json = ?").run(input.version, JSON.stringify(input.metadata));
      return getArtifact();
    },
    activateArtifactVersion: () => getArtifact(),
    runInteractiveVisualizerPublicationViaRuntime: input => new Promise((resolve, reject) => {
      pending.set(input.localJobId, { resolve, reject, input });
    }),
  };
  const { service, dispose } = await loadService(state);
  try {
    const context = { userId: 1, runtimeSessionId: 1, conversationId: 1, runId: "run_race", assistantMessageId: 1, sourceSkill: "interactive-visualizer-in-chat" };
    const generate = () => service.generateInteractiveVisualizer({ context, artifact: getArtifact(), operation: "create", packageValue: fixture.package });

    const first = generate();
    await new Promise(r => setImmediate(r));
    const [firstJobId] = pending.keys();
    const second = generate();
    await new Promise(r => setImmediate(r));
    const secondJobId = [...pending.keys()].find(id => id !== firstJobId);
    assert.equal(row().current_job_id, secondJobId, "the resend owns the artifact row");

    // The resend cancelled the first Runtime job; its handler fails now.
    pending.get(firstJobId).reject(new Error(
      "Interactive visualizer job was cancelled by the user or superseded by a newer attempt.",
    ));
    const firstResult = await first;
    assert.equal(firstResult.failureCategory, "cancelled");
    assert.equal(row().cancellation_requested, 0, "a superseded attempt must not flag the artifact");
    assert.equal(row().current_job_id, secondJobId);
    assert.notEqual(row().lifecycle_status, "cancelled");
    assert.equal(database.prepare("SELECT status FROM hermes_interactive_visualizer_jobs WHERE id = ?").get(firstJobId).status, "cancelled");

    // The second job passes the worker and must publish.
    const compiled = compileCustomInteractiveVisualizerPackage(pending.get(secondJobId).input.plan, fixture.package);
    assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("; "));
    pending.get(secondJobId).resolve({ ...compiled, customPackage: true, bundleHtml: "<main>ok</main>", bundleHash: "b".repeat(64),
      tests: { passed: true, checks: [{ name: "browser mount", passed: true, detail: "ok" }], viewports: ["1280x800"], screenshotCreated: true } });
    const secondResult = await second;
    assert.equal(secondResult.failureCategory, undefined, JSON.stringify(secondResult.artifact?.error_json ?? secondResult));
    assert.ok(secondResult.manifest);
    assert.equal(getArtifact().status, "ready");
    assert.equal(getArtifact().current_version, 1);
    assert.equal(row().lifecycle_status, "ready");
    assert.equal(row().active_version, 1);
  } finally {
    dispose(); database.close();
  }
});

test("invalid plans and placeholder packages answer 400 with the field list before any job exists", async () => {
  const database = new Database(":memory:");
  schema(database);
  const getArtifact = () => database.prepare("SELECT * FROM hermes_artifacts").get();
  let runtimeCalls = 0;
  const state = {
    db: database,
    getArtifactById: getArtifact,
    getArtifactVersion: () => null,
    presentArtifact: a => a,
    recordArtifactPipelineEvent: () => {},
    publishValidatedArtifactVersion: () => { throw new Error("must not publish"); },
    activateArtifactVersion: () => getArtifact(),
    createArtifact: () => { throw new Error("must not create an artifact for an invalid plan"); },
    addArtifactProvenance: () => {},
    runInteractiveVisualizerPublicationViaRuntime: async () => { runtimeCalls++; throw new Error("must not reach the Runtime"); },
  };
  const { service, dispose } = await loadService(state);
  try {
    const context = { userId: 1, runtimeSessionId: 1, conversationId: 1, runId: "run_input", assistantMessageId: 1, sourceSkill: "interactive-visualizer-in-chat" };
    const placeholderPlan = { ...fixture.plan, controls: [0, 1, 2], outputs: [0], animation: 0 };
    const placeholderPackage = { ...fixture.package, manifest: 0, files: 0, semanticTests: [0, 1] };

    await assert.rejects(
      service.createInteractiveVisualizer({ context, title: "Surface charge", plan: fixture.plan, packageValue: placeholderPackage }),
      error => {
        assert.equal(error.name, "InteractiveVisualizerInputError");
        const described = describeError(error);
        assert.equal(described.status, 400);
        assert.match(String(described.body.error), /package\.files is a number placeholder/);
        assert.match(String(described.body.error), /package\.manifest is a number placeholder/);
        return true;
      },
    );
    await assert.rejects(
      service.createInteractiveVisualizer({ context, title: "Surface charge", plan: placeholderPlan, packageValue: fixture.package }),
      error => {
        assert.equal(describeError(error).status, 400);
        assert.match(error.message, /plan\.controls\[0\] must be an object/);
        return true;
      },
    );
    await assert.rejects(
      service.generateInteractiveVisualizer({ context, artifact: getArtifact(), operation: "create", packageValue: placeholderPackage }),
      error => describeError(error).status === 400,
    );
    assert.equal(runtimeCalls, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hermes_interactive_visualizer_jobs").get().n, 0);
    assert.equal(database.prepare("SELECT repair_attempt FROM hermes_interactive_visualizers").get().repair_attempt, 0);
  } finally {
    dispose(); database.close();
  }
});
