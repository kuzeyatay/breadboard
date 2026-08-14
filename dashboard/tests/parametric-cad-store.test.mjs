// Project persistence: revisions are immutable, a failed build never replaces a
// working design, and a stored design reopens without the model or the service.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const Database = (await import("better-sqlite3")).default;
const { ensureCadSchema } = await import("../src/lib/cad/schema.ts");
const { ensureArtifactSchema } = await import("../src/lib/hermes/artifact-schema.ts");
const store = await import("../src/lib/cad/project-store.ts");
const blobs = await import("../src/lib/cad/blob-store.ts");
const { parseStoredCadArtifact } = await import("../src/lib/cad/schemas.ts");

test("the project store does not expose a draft-replacement escape hatch", () => {
  assert.equal("replaceUnbuiltCadProjectSpec" in store, false);
});

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cad-store-"));
  const database = new Database(path.join(root, "cad.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1), (2);
    INSERT INTO conversations VALUES (12, 'conv_terminal', 1, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20);
  `);
  ensureArtifactSchema(database);
  ensureCadSchema(database);
  return { root, database, storageRoot: path.join(root, "cad-projects") };
}

function spec(projectId, overrides = {}) {
  return {
    schemaVersion: 1,
    projectId,
    name: "test-plate",
    description: "A plate.",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [
      { id: "width", label: "Width", value: 60, editable: true, source: "user" },
      { id: "wall", label: "Wall", value: 2.4, editable: true, source: "default" },
    ],
    components: [{ id: "plate", name: "Plate", quantity: 1, bodyRole: "primary" }],
    constraints: [],
    assumptions: [
      { id: "a1", description: "2.4 mm walls", reason: "not stated", userEditable: true },
    ],
    exportSettings: {
      stlLinearTolerance: 0.05,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: true,
    },
    ...overrides,
  };
}

function measurements(x = 60, y = 40, z = 6) {
  return {
    boundingBox: { x, y, z, unit: "mm" },
    volume: x * y * z,
    surfaceArea: 2 * (x * y + y * z + x * z),
    solidCount: 1,
    triangleCount: 12,
    bodies: [
      {
        name: "plate",
        volume: x * y * z,
        surfaceArea: 2 * (x * y + y * z + x * z),
        boundingBox: { x, y, z },
        valid: true,
        watertight: true,
      },
    ],
  };
}

function provenance() {
  return {
    engine: "cadquery",
    engineVersion: "2.6.0",
    kernel: "opencascade",
    kernelVersion: "7.8.1",
    pythonVersion: "3.12.13",
    serviceVersion: "1.0.0",
    model: "test-model",
    generatedAt: new Date().toISOString(),
  };
}

function recordRevision(context, project, revision, options = {}) {
  return store.recordCadRevision({
    projectId: project.id,
    revision,
    parentRevision: options.parentRevision ?? (revision > 1 ? revision - 1 : null),
    status: options.status ?? "valid",
    instruction: options.instruction ?? `revision ${revision}`,
    source: options.source ?? `def build_model(params):\n    return None  # r${revision}\n`,
    entrypoint: "build_model",
    parameters: options.parameters ?? { width: 60, wall: 2.4 },
    designSpec: options.spec ?? spec(project.id),
    measurements: options.measurements ?? measurements(),
    validation: options.validation ?? {
      passed: (options.status ?? "valid") !== "invalid",
      checkedAt: new Date().toISOString(),
      issues: options.issues ?? [],
    },
    provenance: provenance(),
    generationLog: [{ at: new Date().toISOString(), stage: "execute", detail: "ok" }],
    model: "test-model",
    files: options.files ?? [
      { format: "step", content: "ISO-10303-21;\nENDSEC;\n" },
      { format: "stl", content: Buffer.from([0x73, 0x6f, 0x6c, 0x69, 0x64]) },
      { format: "glb", content: Buffer.from("glTF-fake") },
      { format: "source", content: options.source ?? "def build_model(params):\n    return None\n" },
      { format: "spec", content: JSON.stringify(options.spec ?? spec(project.id)) },
      { format: "report", content: "{}" },
    ],
    database: context.database,
    storageRoot: context.storageRoot,
  });
}

function createProject(context) {
  return store.createCadProject({
    userId: 1,
    conversationId: 12,
    clusterId: null,
    name: "test-plate",
    units: "mm",
    process: "fdm",
    database: context.database,
  });
}

test("a project starts empty and its first valid revision becomes current", () => {
  const context = harness();
  try {
    const project = createProject(context);
    assert.match(project.id, /^cadp_[0-9a-f]{32}$/);
    assert.equal(project.current_revision, 0);
    assert.equal(project.latest_revision, 0);
    assert.equal(project.status, "draft");
    assert.equal(store.nextRevisionNumber(project.id, context.database), 1);

    const { files } = recordRevision(context, project, 1);
    const after = store.getCadProject(project.id, context.database);
    assert.equal(after.current_revision, 1);
    assert.equal(after.latest_revision, 1);
    assert.equal(after.status, "valid");
    assert.equal(files.length, 6);
    for (const file of files) {
      assert.equal(file.projectId, project.id);
      assert.equal(file.revision, 1);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(file.byteSize > 0);
    }
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("an invalid regeneration never replaces the last working design", () => {
  const context = harness();
  try {
    const project = createProject(context);
    recordRevision(context, project, 1);
    recordRevision(context, project, 2, {
      status: "invalid",
      issues: [{ code: "not_watertight", severity: "error", message: "open body" }],
      validation: {
        passed: false,
        checkedAt: new Date().toISOString(),
        issues: [{ code: "not_watertight", severity: "error", message: "open body" }],
      },
    });

    const after = store.getCadProject(project.id, context.database);
    // The failed attempt is recorded — the agent needs to see it — but the
    // design a user opens is still the one that worked.
    assert.equal(after.latest_revision, 2);
    assert.equal(after.current_revision, 1);
    assert.equal(after.status, "valid");
    assert.equal(store.listCadRevisions(project.id, context.database).length, 2);

    // …and the next attempt gets a fresh number rather than reusing 2.
    assert.equal(store.nextRevisionNumber(project.id, context.database), 3);
    recordRevision(context, project, 3, { status: "valid-with-warnings" });
    const healed = store.getCadProject(project.id, context.database);
    assert.equal(healed.current_revision, 3);
    assert.equal(healed.status, "valid-with-warnings");
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("artifact publication refuses an invalid or non-current CAD revision", async () => {
  const context = harness();
  try {
    const { buildCadManifest, publishCadDesign } = await import("../src/lib/cad/artifact.ts");
    const project = createProject(context);
    recordRevision(context, project, 1);
    recordRevision(context, project, 2, {
      status: "invalid",
      validation: {
        passed: false,
        checkedAt: new Date().toISOString(),
        issues: [{ code: "not_watertight", severity: "error", message: "open body" }],
      },
    });
    const invalid = buildCadManifest({
      projectId: project.id,
      revision: 2,
      disclaimers: ["Geometric validation only."],
      database: context.database,
    });
    assert.ok(invalid);
    assert.equal(invalid.status, "invalid");

    const artifactContext = {
      userId: 1,
      conversationPublicId: "conv_terminal",
      runtimeSessionId: 20,
      hermesSessionId: "session",
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      runId: "run_one",
      assistantMessageId: null,
    };
    const before = context.database
      .prepare("SELECT COUNT(*) AS count FROM hermes_artifacts")
      .get().count;
    assert.equal(
      await publishCadDesign({
        context: artifactContext,
        manifest: invalid,
        database: context.database,
      }),
      null,
    );

    // Caller metadata cannot turn a failed stored revision into a publishable
    // one: the publication boundary re-reads the current revision from storage.
    const forged = {
      ...invalid,
      status: "valid",
      validation: { ...invalid.validation, passed: true, issues: [] },
    };
    assert.equal(
      await publishCadDesign({
        context: artifactContext,
        manifest: forged,
        database: context.database,
      }),
      null,
    );
    const after = context.database
      .prepare("SELECT COUNT(*) AS count FROM hermes_artifacts")
      .get().count;
    assert.equal(after, before, "an invalid CAD attempt created an artifact");
    assert.equal(store.getCadProject(project.id, context.database).current_revision, 1);
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("earlier revisions and their files remain readable", () => {
  const context = harness();
  try {
    const project = createProject(context);
    recordRevision(context, project, 1, { parameters: { width: 60, wall: 2.4 } });
    recordRevision(context, project, 2, {
      parameters: { width: 80, wall: 3 },
      measurements: measurements(80, 40, 6),
      files: [
        { format: "step", content: "ISO-10303-21;\nR2\n" },
        { format: "source", content: "def build_model(params):\n    return None  # r2\n" },
      ],
    });

    const first = store.readCadFile({
      projectId: project.id,
      revision: 1,
      format: "step",
      database: context.database,
      storageRoot: context.storageRoot,
    });
    assert.match(first.content.toString("utf8"), /ENDSEC/);
    const second = store.readCadFile({
      projectId: project.id,
      revision: 2,
      format: "step",
      database: context.database,
      storageRoot: context.storageRoot,
    });
    assert.match(second.content.toString("utf8"), /R2/);

    assert.deepEqual(store.readRevisionParameters(project.id, 1, context.database), {
      width: 60,
      wall: 2.4,
    });
    assert.deepEqual(store.readRevisionParameters(project.id, 2, context.database), {
      width: 80,
      wall: 3,
    });
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("a parameter change is recorded as a diff on the revision", () => {
  const context = harness();
  try {
    const project = createProject(context);
    recordRevision(context, project, 1, { parameters: { width: 60, wall: 2.4 } });
    recordRevision(context, project, 2, {
      parameters: { width: 60, wall: 3, fillet: 2 },
      instruction: "Parameter change: wall=3",
    });

    const history = store.revisionHistory(project.id, context.database);
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].parameterDiff, []);
    assert.deepEqual(history[1].parameterDiff, [
      { id: "wall", from: 2.4, to: 3 },
      { id: "fillet", from: null, to: 2 },
    ]);
    assert.equal(history[1].parentRevision, 1);
    assert.equal(history[1].instruction, "Parameter change: wall=3");
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("parameter diffing reports additions, changes and removals", () => {
  assert.deepEqual(store.diffParameters({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(store.diffParameters({ a: 1 }, { a: 2 }), [{ id: "a", from: 1, to: 2 }]);
  assert.deepEqual(store.diffParameters({}, { a: 2 }), [{ id: "a", from: null, to: 2 }]);
  assert.deepEqual(store.diffParameters({ a: 1 }, {}), [{ id: "a", from: 1, to: null }]);
});

test("a stored design rebuilds into a manifest that validates", async () => {
  const context = harness();
  try {
    const { buildCadManifest } = await import("../src/lib/cad/artifact.ts");
    const project = createProject(context);
    recordRevision(context, project, 1);
    recordRevision(context, project, 2, { instruction: "wider" });

    const manifest = buildCadManifest({
      projectId: project.id,
      disclaimers: ["Validation here is geometric."],
      database: context.database,
    });
    assert.ok(manifest);
    assert.equal(manifest.revision, 2);
    assert.equal(manifest.projectId, project.id);
    assert.equal(manifest.revisionHistory.length, 2);
    assert.equal(manifest.previewFile?.format, "glb");
    assert.deepEqual(
      manifest.exports.map((file) => file.format).sort(),
      ["3mf", "glb", "report", "source", "spec", "step", "stl"].filter((format) =>
        manifest.exports.some((file) => file.format === format),
      ),
    );
    assert.deepEqual(manifest.assumptions, ["2.4 mm walls"]);

    const parsed = parseStoredCadArtifact(manifest);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.issues ?? []));
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("another user cannot reach a project", () => {
  const context = harness();
  try {
    const project = createProject(context);
    assert.throws(
      () => store.getCadProjectForUser({ projectId: project.id, userId: 2, database: context.database }),
      (error) => error.code === "cad_project_not_found",
    );
    assert.doesNotThrow(() =>
      store.getCadProjectForUser({ projectId: project.id, userId: 1, database: context.database }),
    );
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("storage paths are derived, never supplied", () => {
  assert.equal(blobs.isProjectId("cadp_" + "a".repeat(32)), true);
  assert.equal(blobs.isProjectId("../../etc"), false);
  assert.equal(blobs.isProjectId("cadp_short"), false);

  assert.equal(
    blobs.revisionRelativePath("cadp_" + "a".repeat(32), 7, "step"),
    `cadp_${"a".repeat(32)}/revisions/0007/model.step`,
  );
  assert.throws(() => blobs.revisionRelativePath("cadp_" + "a".repeat(32), 0, "step"));
  assert.throws(() => blobs.revisionRelativePath("cadp_" + "a".repeat(32), 1, "exe"));
  assert.throws(() => blobs.revisionRelativePath("../escape", 1, "step"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cad-paths-"));
  try {
    assert.throws(
      () => blobs.resolveStoredCadPath(root, "../outside.txt"),
      (error) => error.code === "invalid_cad_storage",
    );
    assert.throws(
      () => blobs.resolveStoredCadPath(root, path.resolve(root, "x")),
      (error) => error.code === "invalid_cad_storage",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a file that changed on disk is refused rather than served", () => {
  const context = harness();
  try {
    const project = createProject(context);
    recordRevision(context, project, 1);
    const target = path.join(
      context.storageRoot,
      ...blobs.revisionRelativePath(project.id, 1, "step").split("/"),
    );
    fs.writeFileSync(target, "tampered");
    assert.throws(
      () =>
        store.readCadFile({
          projectId: project.id,
          revision: 1,
          format: "step",
          database: context.database,
          storageRoot: context.storageRoot,
        }),
      (error) => error.code === "cad_file_corrupt",
    );
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("deleting a project removes its rows and its files", () => {
  const context = harness();
  try {
    const project = createProject(context);
    recordRevision(context, project, 1);
    const directory = path.join(context.storageRoot, project.id);
    assert.ok(fs.existsSync(directory));

    store.deleteCadProject(project.id, context.database);
    blobs.removeProjectFiles(project.id, context.storageRoot);

    assert.equal(store.getCadProject(project.id, context.database), null);
    assert.equal(store.listCadRevisions(project.id, context.database).length, 0);
    assert.equal(fs.existsSync(directory), false);
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("deleting the artifact takes the CAD project with it", async () => {
  const artifactStore = fs.readFileSync(
    path.join(process.cwd(), "src/lib/hermes/artifact-store.ts"),
    "utf8",
  );
  assert.match(artifactStore, /renderer_id === "parametric-cad"/);
  assert.match(artifactStore, /deleteCadProject/);
  assert.match(artifactStore, /removeProjectFiles/);
});

test("a design published as an artifact forks a version per revision", async () => {
  const context = harness();
  try {
    const {
      createArtifact,
      readArtifactSource,
      renderArtifact,
      updateArtifactContent,
    } = await import("../src/lib/hermes/artifact-store.ts");
    const { buildCadManifest } = await import("../src/lib/cad/artifact.ts");
    const artifactStorage = path.join(context.root, "artifacts");

    const project = createProject(context);
    recordRevision(context, project, 1);
    const first = buildCadManifest({
      projectId: project.id,
      disclaimers: ["Validation here is geometric."],
      database: context.database,
    });

    const created = createArtifact({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "session",
      conversationId: 12,
      clusterId: null,
      runId: "run_one",
      assistantMessageId: null,
      surface: "dashboard_terminal",
      kind: "data",
      rendererId: "parametric-cad",
      title: `CAD: ${first.title}`,
      filename: "parametric-cad.json",
      content: `${JSON.stringify(first, null, 2)}\n`,
      metadata: { parametricCad: true, cadProjectId: project.id, cadRevision: 1 },
      sourceHermesTool: "cad_generate_model",
      database: context.database,
      storageRoot: artifactStorage,
    });
    const rendered = await renderArtifact({
      artifact: created,
      runId: "run_one",
      assistantMessageId: null,
      database: context.database,
      storageRoot: artifactStorage,
    });
    assert.equal(rendered.status, "ready", JSON.stringify(rendered.error_json));
    assert.equal(rendered.current_version, 1);

    recordRevision(context, project, 2, {
      instruction: "wall 3 mm",
      parameters: { width: 60, wall: 3 },
      measurements: measurements(60, 40, 7),
    });
    const second = buildCadManifest({
      projectId: project.id,
      disclaimers: ["Validation here is geometric."],
      database: context.database,
    });
    const forked = updateArtifactContent({
      artifact: rendered,
      content: `${JSON.stringify(second, null, 2)}\n`,
      mode: "fork",
      runId: "run_one",
      assistantMessageId: null,
      metadata: { cadRevision: 2 },
      database: context.database,
      storageRoot: artifactStorage,
    });
    const published = await renderArtifact({
      artifact: forked,
      runId: "run_one",
      assistantMessageId: null,
      database: context.database,
      storageRoot: artifactStorage,
    });
    assert.equal(published.current_version, 2);
    assert.equal(published.status, "ready");

    // Both versions reopen, and version 1 still describes the original design.
    const v2 = parseStoredCadArtifact(
      JSON.parse(readArtifactSource(published, 2, artifactStorage, context.database)),
    );
    assert.equal(v2.ok, true, JSON.stringify(v2.issues ?? []));
    assert.equal(v2.value.revision, 2);
    assert.equal(v2.value.parameters.wall, 3);

    const v1 = parseStoredCadArtifact(
      JSON.parse(readArtifactSource(published, 1, artifactStorage, context.database)),
    );
    assert.equal(v1.ok, true);
    assert.equal(v1.value.revision, 1);
    assert.equal(v1.value.parameters.wall, 2.4);
  } finally {
    context.database.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});
