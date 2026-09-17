import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import AdmZip from "adm-zip";

import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  archiveMimeType,
  inferArtifactKindForFile,
  inspectArtifactImport,
  listZipEntries,
} from "../src/lib/hermes/artifact-import.ts";
import { inventoryFolder, stageFolderArchive } from "../src/lib/hermes/artifact-folder.ts";
import {
  artifactFile,
  createImportedArtifact,
  listArtifactEventsAfter,
  presentArtifact,
} from "../src/lib/hermes/artifact-store.ts";
import { artifactRenderer } from "../src/lib/hermes/artifact-renderers.ts";
import { ARTIFACT_KINDS } from "../src/lib/hermes/artifact-types.ts";
import {
  findProducedEntries,
  MAX_FOLDER_FILE_CARDS,
  PRODUCED_FILE_SCAN_TOOL,
  publishProducedFilesForRun,
} from "../src/lib/hermes/produced-artifacts.ts";
import {
  ARTIFACT_CATEGORIES,
  artifactCategory,
  artifactKindLabel,
} from "../src/lib/generated/artifact-reference.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-produced-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER,
      client_message_id TEXT,
      role TEXT NOT NULL DEFAULT 'assistant',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2025-01-01T00:00:00.000Z'
    );
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY, conversation_id INTEGER);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT,
      created_at TEXT, canonical_message_id INTEGER
    );
    INSERT INTO users VALUES (1);
    INSERT INTO clusters VALUES (7, 'physics', 1);
    INSERT INTO conversations VALUES (12, 'conv_terminal', 1, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20);
    INSERT INTO conversation_messages(id, conversation_id, client_message_id) VALUES (100, 12, 'client_one');
  `);
  ensureArtifactSchema(database);
  return { root, database, storage: path.join(root, "storage") };
}

function importInput(fixture, overrides = {}) {
  return {
    userId: 1,
    runtimeSessionId: 20,
    hermesSessionId: "oh_session",
    conversationId: 12,
    clusterId: null,
    runId: "run_one",
    assistantMessageId: 100,
    surface: "dashboard_terminal",
    database: fixture.database,
    storageRoot: fixture.storage,
    scrubProvenance: false,
    ...overrides,
  };
}

function zipBytes(entries) {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    archive.addFile(name, Buffer.from(content));
  }
  return archive.toBuffer();
}

test("the folder kind is a first-class artifact kind with a renderer and a category", () => {
  assert.ok(ARTIFACT_KINDS.includes("folder"));
  assert.equal(ARTIFACT_KINDS[ARTIFACT_KINDS.length - 1], "folder", "new kinds are appended for the CHECK migration");
  assert.equal(artifactRenderer("folder-archive")?.kind, "folder");
  assert.equal(artifactRenderer("binary-file")?.kind, "unknown");
  assert.equal(artifactKindLabel({ kind: "folder" }), "Folder");
  assert.equal(artifactKindLabel({ kind: "unknown" }), "File");
  assert.ok(ARTIFACT_CATEGORIES.includes("Files & folders"));
  assert.equal(artifactCategory({ kind: "folder" }), "Files & folders");
  assert.equal(artifactCategory({ kind: "unknown" }), "Files & folders");
});

test("every produced file resolves to a kind from its extension", () => {
  assert.equal(inferArtifactKindForFile("erlangb.m"), "code");
  assert.equal(inferArtifactKindForFile("lab.tex"), "code");
  assert.equal(inferArtifactKindForFile("notebook.ipynb"), "data");
  assert.equal(inferArtifactKindForFile("config.yaml"), "data");
  assert.equal(inferArtifactKindForFile("report.pdf"), "pdf");
  assert.equal(inferArtifactKindForFile("deck.pptx"), "presentation");
  assert.equal(inferArtifactKindForFile("photo.tiff"), "image");
  assert.equal(inferArtifactKindForFile("clip.mp4"), "video");
  assert.equal(inferArtifactKindForFile("part.stl"), "model");
  assert.equal(inferArtifactKindForFile("lab.mlx"), "unknown");
  assert.equal(inferArtifactKindForFile("package.zip"), "unknown");
  assert.equal(inferArtifactKindForFile("README"), "unknown");
  assert.equal(archiveMimeType("bundle.tgz"), "application/gzip");
  assert.equal(archiveMimeType("bundle.txt"), null);
});

test("inspection accepts scripts, archives, folders and any other produced file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-inspect-"));
  try {
    const script = path.join(root, "erlangb.m");
    fs.writeFileSync(script, "function B = erlangb(A, N)\nB = 1;\nend\n");
    const code = inspectArtifactImport(script, "code");
    assert.equal(code.rendererId, "code");
    assert.equal(code.extension, ".m");

    const live = path.join(root, "lab.mlx");
    fs.writeFileSync(live, zipBytes({ "matlab/document.xml": "<w:document/>" }));
    const binary = inspectArtifactImport(live, "unknown");
    assert.equal(binary.rendererId, "binary-file");
    assert.equal(binary.mimeType, "application/octet-stream");
    assert.equal(binary.extension, ".mlx");
    assert.equal(binary.previewAvailable, false);

    const archive = path.join(root, "package.zip");
    fs.writeFileSync(archive, zipBytes({ "a.txt": "a", "sub/b.txt": "b" }));
    assert.equal(inspectArtifactImport(archive, "unknown").rendererId, "archive-file");
    assert.equal(inspectArtifactImport(archive, "folder").rendererId, "folder-archive");
    assert.deepEqual(
      listZipEntries(archive).entries.map((entry) => entry.path).sort(),
      ["a.txt", "sub/b.txt"],
    );

    const notGzip = path.join(root, "bundle.tgz");
    fs.writeFileSync(notGzip, "plain text pretending");
    assert.throws(() => inspectArtifactImport(notGzip, "unknown"), /gzip/);

    const rtf = path.join(root, "memo.rtf");
    fs.writeFileSync(rtf, "{\\rtf1\\ansi Hello}");
    assert.equal(inspectArtifactImport(rtf, "document").mimeType, "application/rtf");

    const notebook = path.join(root, "analysis.ipynb");
    fs.writeFileSync(notebook, JSON.stringify({ cells: [] }));
    assert.equal(inspectArtifactImport(notebook, "data").rendererId, "data-file");

    const log = path.join(root, "run.log");
    fs.writeFileSync(log, "started\n");
    assert.equal(inspectArtifactImport(log, "text").extension, ".log");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a produced directory is imported as one folder artifact that remembers its path", async () => {
  const fixture = artifactFixture();
  const workspace = path.join(fixture.root, "workspace");
  const folder = path.join(workspace, "erlang_lab_submission");
  fs.mkdirSync(path.join(folder, "figures"), { recursive: true });
  fs.mkdirSync(path.join(folder, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(folder, "erlangb.m"), "function B = erlangb(A, N)\nend\n");
  fs.writeFileSync(path.join(folder, "erlangc.m"), "function C = erlangc(A, N)\nend\n");
  fs.writeFileSync(path.join(folder, "figures", "q1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  fs.writeFileSync(path.join(folder, "node_modules", "junk", "index.js"), "// ignored");
  fs.writeFileSync(path.join(folder, ".hidden"), "ignored");
  try {
    const inventory = inventoryFolder(folder);
    assert.deepEqual(
      inventory.entries.map((entry) => entry.path),
      ["erlangb.m", "erlangc.m", "figures/q1.png"],
    );

    const artifact = await createImportedArtifact({
      ...importInput(fixture),
      kind: "folder",
      title: "erlang_lab_submission",
      authorizedRoot: workspace,
      filePath: folder,
    });
    assert.equal(artifact.kind, "folder");
    assert.equal(artifact.renderer_id, "folder-archive");
    assert.equal(artifact.mime_type, "application/zip");
    assert.equal(artifact.filename, "erlang_lab_submission.zip");
    assert.equal(artifact.status, "ready");

    const presented = presentArtifact(artifact);
    assert.equal(presented.metadata.folderPath, fs.realpathSync(folder));
    assert.equal(presented.metadata.folderName, "erlang_lab_submission");
    assert.equal(presented.metadata.entryCount, 3);
    assert.deepEqual(
      presented.metadata.entries.map((entry) => entry.path),
      ["erlangb.m", "erlangc.m", "figures/q1.png"],
    );
    assert.equal(presented.previewAvailable, false);
    assert.equal(presented.downloadAvailable, true);

    const stored = artifactFile({
      artifact,
      version: 1,
      purpose: "download",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    const names = new AdmZip(stored.path).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName.replace(/\\/g, "/")).sort();
    assert.deepEqual(names, ["erlangb.m", "erlangc.m", "figures/q1.png"]);
    // The staged ZIP does not outlive the import.
    const staging = path.join(fixture.storage, ".staging");
    assert.ok(!fs.existsSync(staging) || fs.readdirSync(staging).length === 0);

    // An empty directory is not a deliverable.
    const empty = path.join(workspace, "empty");
    fs.mkdirSync(empty);
    await assert.rejects(
      () => createImportedArtifact({
        ...importInput(fixture),
        kind: "folder",
        title: "empty",
        authorizedRoot: workspace,
        filePath: empty,
      }),
      /no files/,
    );
    // Nothing outside the authorized root, directory or not.
    await assert.rejects(
      () => createImportedArtifact({
        ...importInput(fixture),
        kind: "folder",
        title: "outside",
        authorizedRoot: workspace,
        filePath: fixture.root,
      }),
      /authorized workspace/,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("staging a folder archive writes exactly the inventory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-stage-"));
  try {
    const folder = path.join(root, "pkg");
    fs.mkdirSync(path.join(folder, "deep", "er"), { recursive: true });
    fs.writeFileSync(path.join(folder, "a.txt"), "a");
    fs.writeFileSync(path.join(folder, "deep", "er", "b.txt"), "b");
    const target = path.join(root, "out", "pkg.zip");
    const inventory = stageFolderArchive(folder, target);
    assert.equal(inventory.totalFiles, 2);
    const names = new AdmZip(target).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName.replace(/\\/g, "/")).sort();
    assert.deepEqual(names, ["a.txt", "deep/er/b.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the sweep finds only what changed after the run began, grouped by produced folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-sweep-"));
  try {
    const downloads = path.join(root, "Downloads");
    fs.mkdirSync(path.join(downloads, "old-project"), { recursive: true });
    fs.writeFileSync(path.join(downloads, "old.pdf"), "%PDF-1.4 old");
    fs.writeFileSync(path.join(downloads, "old-project", "keep.txt"), "old");
    await sleep(50);
    const since = Date.now();
    await sleep(50);

    fs.writeFileSync(path.join(downloads, "new.csv"), "a,b\n1,2\n");
    fs.writeFileSync(path.join(downloads, "old-project", "added.m"), "x = 1;\n");
    fs.writeFileSync(path.join(downloads, "partial.crdownload"), "…");
    fs.mkdirSync(path.join(downloads, "erlang_lab", "nested"), { recursive: true });
    fs.writeFileSync(path.join(downloads, "erlang_lab", "erlangb.m"), "b\n");
    fs.writeFileSync(path.join(downloads, "erlang_lab", "nested", "notes.md"), "# n\n");
    fs.mkdirSync(path.join(downloads, ".breadboard"), { recursive: true });
    fs.writeFileSync(path.join(downloads, ".breadboard", "state.json"), "{}");

    const found = findProducedEntries({ roots: [downloads, downloads], since });
    const relative = (candidate) => path.relative(downloads, candidate.absolutePath).replace(/\\/g, "/");
    assert.deepEqual(found.folders.map(relative), ["erlang_lab"]);
    assert.deepEqual(
      found.files.map(relative).sort(),
      ["erlang_lab/erlangb.m", "erlang_lab/nested/notes.md", "new.csv", "old-project/added.m"],
    );
    assert.equal(found.truncated, false);
    assert.ok(found.files.every((candidate) => candidate.root === fs.realpathSync(downloads)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a finished turn publishes its produced files and folders as artifacts owned by the response", async () => {
  const fixture = artifactFixture();
  const workspace = path.join(fixture.root, "workspace");
  const downloads = path.join(fixture.root, "Downloads");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, "earlier.txt"), "before the run");
  try {
    // The sweep allows two seconds of clock skew before the run's start, so a
    // file that must read as "earlier" has to be older than that.
    await sleep(2_300);
    const startedAt = new Date().toISOString();
    await sleep(50);

    // What the model wrote: a package folder in Downloads, a stray script, a
    // live script the store cannot read, and a file already published by the
    // model itself.
    const pkg = path.join(downloads, "erlang_lab_submission");
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, "erlangb.m"), "function B = erlangb(A, N)\nend\n");
    fs.writeFileSync(path.join(pkg, "erlangc.m"), "function C = erlangc(A, N)\nend\n");
    fs.writeFileSync(path.join(pkg, "answers.csv"), "q,a\n1,0.075\n");
    fs.writeFileSync(path.join(downloads, "lab.mlx"), zipBytes({ "matlab/document.xml": "<w:document/>" }));
    fs.writeFileSync(path.join(workspace, "scratch.txt"), "workspace output\n");
    fs.writeFileSync(path.join(workspace, "published.md"), "# already published\n");
    const modelImport = await createImportedArtifact({
      ...importInput(fixture),
      kind: "markdown",
      title: "Published by the model",
      authorizedRoot: workspace,
      filePath: "published.md",
    });

    const report = await publishProducedFilesForRun({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      runId: "run_one",
      startedAt,
      assistantMessageId: 100,
      workspaceRoot: workspace,
      authorizedRoots: [workspace, downloads],
      database: fixture.database,
      storageRoot: fixture.storage,
    });

    const byFilename = new Map(report.imported.map((artifact) => [artifact.filename, artifact]));
    assert.deepEqual(
      [...byFilename.keys()].sort(),
      ["answers.csv", "erlang_lab_submission.zip", "erlangb.m", "erlangc.m", "lab.mlx", "scratch.txt"],
    );
    assert.ok(report.skipped.some((entry) => entry.path.endsWith("published.md") && entry.reason === "already_published"));
    assert.ok(!report.skipped.some((entry) => entry.path.endsWith("earlier.txt")));

    const folder = byFilename.get("erlang_lab_submission.zip");
    assert.equal(folder.kind, "folder");
    assert.equal(folder.title, "erlang_lab_submission");
    assert.equal(folder.originating_message_id, 100);
    assert.equal(folder.source_hermes_tool, PRODUCED_FILE_SCAN_TOOL);
    assert.equal(JSON.parse(folder.metadata_json).folderPath, fs.realpathSync(pkg));
    assert.equal(JSON.parse(folder.metadata_json).producedFile, true);

    assert.equal(byFilename.get("erlangb.m").kind, "code");
    assert.equal(byFilename.get("erlangb.m").title, "erlangb");
    assert.equal(byFilename.get("answers.csv").kind, "spreadsheet");
    assert.equal(byFilename.get("lab.mlx").kind, "unknown");
    assert.equal(byFilename.get("lab.mlx").renderer_id, "binary-file");
    assert.equal(byFilename.get("scratch.txt").kind, "text");
    for (const artifact of report.imported) {
      assert.equal(artifact.status, "ready");
      assert.equal(artifact.originating_run_id, "run_one");
    }
    // Cards arrive through the same event stream as the answer.
    const events = listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database });
    assert.ok(events.some((event) => event.artifactId === folder.id && event.type === "artifact.completed"));

    // Running the sweep again publishes nothing twice.
    const again = await publishProducedFilesForRun({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      runId: "run_one",
      startedAt,
      assistantMessageId: 100,
      workspaceRoot: workspace,
      authorizedRoots: [workspace, downloads],
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(again.imported.length, 0);
    assert.ok(again.skipped.every((entry) => entry.reason === "already_published"));
    assert.equal(modelImport.kind, "markdown");
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a large produced folder gets one card rather than one per file", async () => {
  const fixture = artifactFixture();
  const workspace = path.join(fixture.root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  try {
    await sleep(50);
    const startedAt = new Date().toISOString();
    await sleep(50);
    const project = path.join(workspace, "generated-site");
    fs.mkdirSync(project);
    for (let index = 0; index < MAX_FOLDER_FILE_CARDS + 4; index += 1) {
      fs.writeFileSync(path.join(project, `page-${index}.html`), `<html><body><p>${index}</p></body></html>`);
    }
    const report = await publishProducedFilesForRun({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      runId: "run_one",
      startedAt,
      assistantMessageId: 100,
      workspaceRoot: workspace,
      authorizedRoots: [],
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(report.imported.length, 1);
    assert.equal(report.imported[0].kind, "folder");
    assert.equal(JSON.parse(report.imported[0].metadata_json).entryCount, MAX_FOLDER_FILE_CARDS + 4);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the chat wires the sweep and the cards to the file explorer", () => {
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const eventStream = read("../src/lib/hermes/event-stream.ts");
  const gardenAdapter = read("../src/lib/hermes/garden-chat-adapter.ts");
  const cards = read("../src/app/components/hermes/inline-artifact-cards.tsx");
  const viewer = read("../src/app/components/hermes/artifact-viewer.tsx");
  const preload = read("../../desktop/src/preload/preload.ts");
  const lifecycle = read("../../desktop/src/main/app-lifecycle.ts");
  // Published before the stream closes, on both chat surfaces.
  assert.match(eventStream, /await publishProducedFilesForTurn\(/);
  assert.match(eventStream, /produced-artifacts-turn\.ts/);
  assert.match(gardenAdapter, /await publishProducedFilesForTurn\(/);
  assert.ok(eventStream.indexOf("await publishProducedFilesForTurn(") < eventStream.indexOf('finalize("idle")'));
  // A folder card opens the folder; the viewer lists it and offers the ZIP.
  assert.match(cards, /Open \$\{artifact\.title\} in the file explorer/);
  assert.match(cards, /artifact\.kind === "folder" \? artifactLocalPath/);
  assert.match(viewer, /ArtifactEntriesView/);
  assert.match(viewer, /Open folder/);
  assert.match(viewer, /Show in folder/);
  assert.match(viewer, /kind === "folder"/);
  // The desktop bridge reveals files and opens folders, never launches files.
  assert.match(preload, /openLocalPath/);
  assert.match(lifecycle, /IPC_CHANNELS\.openLocalPath/);
  assert.match(read("../../desktop/src/main/local-path-opener.ts"), /A file is only ever revealed, never launched/);
});
