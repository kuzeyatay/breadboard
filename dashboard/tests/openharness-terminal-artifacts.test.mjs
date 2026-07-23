import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import AdmZip from "adm-zip";

import { authorizeTerminalCommand, runAuthorizedTerminalCommand } from "../src/lib/openharness/terminal-execution.ts";
import { planTask } from "../src/lib/openharness/task-plan.ts";
import { brokerCapabilities } from "../src/lib/openharness/capability-broker.ts";
import { ensureArtifactSchema } from "../src/lib/openharness/artifact-schema.ts";
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  addArtifactProvenance,
  artifactFile,
  createArtifact,
  getArtifactForUser,
  listArtifactEventsAfter,
  listArtifactVersions,
  presentArtifact,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
} from "../src/lib/openharness/artifact-store.ts";
import { resolveSkillCompatibility } from "../src/lib/openharness/skill-compatibility.ts";

function grantFor(surface) {
  return brokerCapabilities({
    plan: planTask({ request: "Create a substantial report", authenticated: true }),
    surface,
    userId: 1,
    grants: [],
    workspaceRoot: "/runtime/session",
  });
}

test("dedicated Terminal authorizes ordinary inspection and focused verification", async () => {
  for (const command of ["pwd", "git status", "rg artifact dashboard/src", "npm run test -- focused"]) {
    assert.equal(authorizeTerminalCommand(command).allowed, true, command);
  }
  const pwd = await runAuthorizedTerminalCommand("pwd");
  assert.equal(pwd.exitCode, 0);
  assert.equal(pwd.cwd, ".");
  assert.ok(pwd.stdout.trim());
  const git = await runAuthorizedTerminalCommand("git status --short");
  assert.equal(git.exitCode, 0);
  const focused = await runAuthorizedTerminalCommand("node --test --experimental-strip-types dashboard/tests/ai-models.test.mjs");
  assert.equal(focused.exitCode, 0, focused.stderr || focused.stdout);
});

test("Terminal policy rejects escapes, destructive operations, and executable rg flags", () => {
  for (const command of [
    "Get-Content ../secret.txt",
    "Get-Content C:\\Windows\\win.ini",
    "git reset --hard",
    "Remove-Item file.txt",
    "npm install left-pad",
    "rg --pre malicious.exe pattern .",
    "Get-Content $env:USERPROFILE",
  ]) assert.equal(authorizeTerminalCommand(command).allowed, false, command);
});

test("surface broker grants terminal/artifact tools only to their authenticated surfaces", () => {
  const terminal = grantFor("dashboard_terminal").allowedTools;
  const garden = grantFor("garden_chat").allowedTools;
  const quartz = grantFor("quartz_ai").allowedTools;
  assert.equal(terminal.terminal_execute_command, true);
  assert.equal(terminal.artifact_create, true);
  assert.equal(garden.terminal_execute_command, false);
  assert.equal(garden.bash, false);
  assert.equal(garden.artifact_create, true);
  assert.equal(quartz.terminal_execute_command, false);
  assert.equal(quartz.bash, false);
  assert.equal(quartz.artifact_create, false);
  assert.equal(quartz.artifact_read, false);
  const forged = brokerCapabilities({
    plan: planTask({ request: "Run git status and make a PDF", authenticated: false, isolated: true }),
    surface: "quartz_ai",
    userId: null,
    grants: [],
    workspaceRoot: "/runtime/quartz",
    isolated: true,
  });
  assert.equal(forged.allowedTools.terminal_execute_command, false);
  assert.equal(forged.allowedTools.artifact_create, false);
});

function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifacts-"));
  const filename = path.join(root, "artifacts.sqlite");
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE openharness_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE openharness_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (7, 'physics', 1);
    INSERT INTO conversations VALUES (10, 'conv_garden', 1, 'garden_chat', 7);
    INSERT INTO conversations VALUES (11, 'conv_quartz', 1, 'quartz_ai', 7);
    INSERT INTO openharness_runtime_sessions VALUES (20);
    INSERT INTO openharness_runs VALUES ('run_one', 20), ('run_two', 20);
  `);
  ensureArtifactSchema(database);
  return { root, filename, storage: path.join(root, "storage"), database };
}

function createInput(fixture, overrides = {}) {
  return {
    userId: 1,
    runtimeSessionId: 20,
    openHarnessSessionId: "oh_session",
    conversationId: 10,
    clusterId: 7,
    runId: "run_one",
    assistantMessageId: null,
    surface: "garden_chat",
    kind: "markdown",
    rendererId: "markdown",
    title: "Study report",
    filename: "study-report.md",
    content: "# Study report\n\nGrounded content.",
    database: fixture.database,
    storageRoot: fixture.storage,
    ...overrides,
  };
}

test("artifact lifecycle persists, streams safe events, and preserves revisions", async () => {
  const fixture = artifactFixture();
  try {
    let artifact = createArtifact(createInput(fixture));
    assert.equal(artifact.status, "generating");
    artifact = await renderArtifact({ artifact, runId: "run_one", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(artifact.status, "ready");
    assert.match(readArtifactSource(artifact, 1, fixture.storage, fixture.database), /^# Study report/);
    const presented = presentArtifact(artifact);
    assert.equal(presented.previewAvailable, true);
    assert.equal(presented.downloadAvailable, true);
    assert.equal(JSON.stringify(presented).includes(fixture.storage), false);
    const events = listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database });
    assert.deepEqual(events.map((event) => event.type), [
      "artifact.created", "artifact.rendering", "artifact.preview_ready", "artifact.completed",
    ]);

    artifact = updateArtifactContent({
      artifact,
      content: "# Study report\n\nRevised content.",
      mode: "replace",
      runId: "run_two",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(artifact.current_version, 2);
    artifact = await renderArtifact({ artifact, runId: "run_two", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(listArtifactVersions(artifact.id, fixture.database).length, 2);
    assert.match(readArtifactSource(artifact, 1, fixture.storage, fixture.database), /Grounded content/);
    assert.match(readArtifactSource(artifact, 2, fixture.storage, fixture.database), /Revised content/);

    fixture.database.close();
    const reopened = new Database(fixture.filename);
    ensureArtifactSchema(reopened);
    const survived = getArtifactForUser({ artifactId: artifact.id, userId: 1, conversationPublicId: "conv_garden", database: reopened });
    assert.equal(survived.current_version, 2);
    assert.throws(() => getArtifactForUser({ artifactId: artifact.id, userId: 2, conversationPublicId: "conv_garden", database: reopened }), /not found/i);
    reopened.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("DOCX, PDF, and sandbox-source HTML renderers produce real files", async () => {
  const fixture = artifactFixture();
  try {
    const cases = [
      { kind: "document", rendererId: "docx", filename: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: "Title\nBody" },
      { kind: "pdf", rendererId: "pdf", filename: "report.pdf", mimeType: "application/pdf", content: "Title\nBody" },
      { kind: "html", rendererId: "html", filename: "report.html", mimeType: "text/html; charset=utf-8", content: "<!doctype html><main><h1>Safe preview</h1></main>" },
    ];
    let index = 0;
    for (const item of cases) {
      const runId = index === 0 ? "run_one" : "run_two";
      if (index > 1) fixture.database.prepare("INSERT INTO openharness_runs VALUES (?, 20)").run("run_three");
      const effectiveRun = index > 1 ? "run_three" : runId;
      let artifact = createArtifact(createInput(fixture, { ...item, runId: effectiveRun, title: `${item.kind} report` }));
      artifact = await renderArtifact({ artifact, runId: effectiveRun, assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
      const output = artifactFile({ artifact, version: 1, purpose: "download", database: fixture.database, storageRoot: fixture.storage });
      const bytes = fs.readFileSync(output.path);
      if (item.rendererId === "docx") {
        const zip = new AdmZip(bytes);
        assert.ok(zip.getEntry("word/document.xml"));
        assert.ok(zip.getEntry("[Content_Types].xml"));
      } else if (item.rendererId === "pdf") assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      else assert.match(bytes.toString("utf8"), /<main>/);
      index += 1;
    }
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact validation rejects traversal, bad MIME, oversized data, and unsupported video", () => {
  const fixture = artifactFixture();
  try {
    assert.throws(() => createArtifact(createInput(fixture, { filename: "../escape.md" })), /paths|traversal/i);
    assert.throws(() => createArtifact(createInput(fixture, { mimeType: "application/pdf" })), /MIME type/i);
    assert.throws(() => createArtifact(createInput(fixture, { content: "x".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1) })), /exceeds/i);
    assert.throws(() => createArtifact(createInput(fixture, { kind: "video", rendererId: "video" })), /not available/i);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("malformed renderer input fails safely and emits artifact.failed", async () => {
  const fixture = artifactFixture();
  try {
    const draft = createArtifact(createInput(fixture, { content: "" }));
    const failed = await renderArtifact({ artifact: draft, runId: "run_one", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(failed.status, "failed");
    assert.match(presentArtifact(failed).error.message, /empty/i);
    assert.equal(listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database }).at(-1).type, "artifact.failed");
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a Quartz conversation cannot read an artifact even when the owner is authenticated", () => {
  const fixture = artifactFixture();
  try {
    assert.throws(() => createArtifact(createInput(fixture, { conversationId: 11 })), /scope is invalid/i);
    const artifact = createArtifact(createInput(fixture));
    fixture.database.prepare("UPDATE openharness_artifacts SET conversation_id = 11 WHERE id = ?").run(artifact.id);
    assert.throws(
      () => getArtifactForUser({ artifactId: artifact.id, userId: 1, conversationPublicId: "conv_quartz", database: fixture.database }),
      /not found/i,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("MCP provenance is structured and secret-like metadata is removed", () => {
  const fixture = artifactFixture();
  try {
    const artifact = createArtifact(createInput(fixture));
    addArtifactProvenance({ artifactId: artifact.id, version: 1, sourceKind: "mcp", sourceServer: "research", sourceTool: "search", invocationId: "call_1", resourceMetadata: { url: "https://example.test", accessToken: "never-store" }, database: fixture.database });
    const row = fixture.database.prepare("SELECT * FROM openharness_artifact_provenance WHERE artifact_id = ?").get(artifact.id);
    assert.equal(row.source_server, "research");
    assert.equal(row.source_tool, "search");
    assert.equal(JSON.parse(row.resource_metadata).accessToken, undefined);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skill compatibility requires a non-coding executable path", () => {
  const documentManifest = `---\nname: report-writer\ndescription: Creates document artifacts\nbreadboard:\n  category: document\n  surfaces: [garden_chat, interactive_terminal]\n  requiredTools: [artifact_create, artifact_update, artifact_render]\n  requiredArtifactKinds: [document, pdf]\n  requiredRuntimes: [docx-renderer, pdf-renderer]\n---`;
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: documentManifest, surface: "garden_chat" }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: documentManifest.replace("pdf-renderer", "pptx-renderer"), surface: "garden_chat" }).availability, "unavailable");
  const mcpManifest = documentManifest.replace(/\n---$/, "\n  requiredMcpServers: [research]\n---");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: mcpManifest, surface: "garden_chat" }).availability, "unavailable");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_coding_conditional", manifest: documentManifest, surface: "dashboard_terminal" }).availability, "incompatible");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: "---\nname: vague\n---", surface: "garden_chat" }).availability, "needs_review");
});

test("Garden UI places Artifacts directly below Videos and Quartz contains no artifact UI", () => {
  const workspace = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const videos = workspace.indexOf("Videos");
  const artifacts = workspace.indexOf("Artifacts", videos);
  assert.ok(videos >= 0 && artifacts > videos);
  assert.ok(workspace.slice(videos, artifacts).length < 5_000, "Artifacts should be the next sidebar section after Videos");
  assert.match(workspace, /artifact\.created/);
  assert.match(workspace, /artifactDismissedRuns/);
  const panel = fs.readFileSync(new URL("../src/app/components/openharness/artifact-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /sandbox=""/);
  assert.match(panel, /downloadAvailable/);
  const quartzPrompt = fs.readFileSync(new URL("../../openharness-config/system/quartz-assistant.md", import.meta.url), "utf8");
  const sharedPrompt = fs.readFileSync(new URL("../../openharness-config/system/assistant.md", import.meta.url), "utf8");
  assert.doesNotMatch(`${sharedPrompt}\n${quartzPrompt}`, /artifact/i);
});
