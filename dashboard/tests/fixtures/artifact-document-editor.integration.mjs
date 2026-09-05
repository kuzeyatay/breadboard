import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import "../helpers/genoffice-node-loader.mjs";

import { ensureArtifactSchema } from "../../src/lib/hermes/artifact-schema.ts";
import {
  artifactDeliveryFile,
  createArtifact,
  createImportedArtifact,
  listArtifactVersions,
  readArtifactSource,
  renderArtifact,
} from "../../src/lib/hermes/artifact-store.ts";
import {
  loadArtifactEditor,
  saveArtifactEditor,
} from "../../src/lib/hermes/artifact-document-editor.ts";
import { saveArtifactOfficeBytes } from "../../src/lib/hermes/artifact-office-save.ts";
import { saveArtifactPdfBytes } from "../../src/lib/hermes/artifact-pdf-save.ts";
import { artifactEditorMode } from "../../src/lib/hermes/artifact-editor-types.ts";
import {
  parseGenOfficeAiHistory,
  parseGenOfficeAiReply,
} from "../../src/lib/hermes/genoffice-ai.ts";
import { buildContext, findQuote } from "../../src/vendor/human-review/anchor-text.ts";
import { createOfficeRuntimeFixture } from "../helpers/office-runtime-fixture.mjs";

const officeRuntime = createOfficeRuntimeFixture();
test.after(() => officeRuntime.cleanup());

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-document-editor-test-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT);
    INSERT INTO users VALUES (1);
    INSERT INTO conversations VALUES (10, 'conv_editor', 1, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_editor', 20);
  `);
  ensureArtifactSchema(database);
  return {
    root,
    workspace: path.join(root, "workspace"),
    storage: path.join(root, "storage"),
    database,
  };
}

function shared(input, overrides = {}) {
  return {
    userId: 1,
    runtimeSessionId: 20,
    hermesSessionId: "session_editor",
    conversationId: 10,
    clusterId: null,
    runId: "run_editor",
    assistantMessageId: null,
    surface: "dashboard_terminal",
    title: "Editable artifact",
    database: input.database,
    storageRoot: input.storage,
    ...overrides,
  };
}

function options(input) {
  return {
    database: input.database,
    storageRoot: input.storage,
    officeRuntimeControl: officeRuntime.control,
  };
}

test("editor modes and Human Review anchors cover every document family", () => {
  const base = { status: "ready", metadata: { imported: true } };
  assert.equal(artifactEditorMode({ ...base, kind: "document", renderer: "document-file", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "office-blocks");
  assert.equal(artifactEditorMode({ ...base, kind: "presentation", renderer: "presentation-file", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), "office-blocks");
  assert.equal(artifactEditorMode({ ...base, kind: "spreadsheet", renderer: "spreadsheet-file", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "spreadsheet-cells");
  assert.equal(artifactEditorMode({ ...base, kind: "pdf", renderer: "pdf-file", mimeType: "application/pdf" }), "pdf");
  assert.equal(artifactEditorMode({ ...base, kind: "data", renderer: "data-file", mimeType: "application/json; charset=utf-8" }), "file-text");
  assert.equal(artifactEditorMode({ status: "ready", metadata: {}, kind: "markdown", renderer: "markdown", mimeType: "text/markdown" }), "source");

  const context = buildContext("alpha repeated beta repeated gamma", 20, 28);
  assert.deepEqual(findQuote("intro alpha repeated beta repeated gamma", context), {
    start: 26,
    end: 34,
    exact: true,
  });
});

test("source documents save and render a traceable new artifact version", async () => {
  const input = fixture();
  try {
    let artifact = createArtifact(shared(input, {
      kind: "markdown",
      rendererId: "markdown",
      filename: "report.md",
      content: "# Report\n\nFirst version.",
    }));
    artifact = await renderArtifact({ artifact, runId: "run_editor", assistantMessageId: null, ...options(input) });
    const opened = await loadArtifactEditor(artifact, options(input));
    assert.equal(opened.mode, "source");
    assert.match(opened.content, /First version/);

    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      content: "# Report\n\nHuman-edited second version.",
    }, options(input));
    assert.equal(saved.status, "ready");
    assert.equal(saved.current_version, 2);
    assert.match(readArtifactSource(saved, 1, input.storage, input.database), /First version/);
    assert.match(readArtifactSource(saved, 2, input.storage, input.database), /Human-edited/);
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("visual HTML autosave keeps the original and renders the changed page as a new version", async () => {
  const input = fixture();
  try {
    const first = "<!doctype html><html><head><title>Landing</title></head><body><h1>Before</h1><button>Start</button></body></html>";
    let artifact = createArtifact(shared(input, {
      kind: "html",
      rendererId: "html",
      filename: "landing.html",
      content: first,
    }));
    artifact = await renderArtifact({ artifact, runId: "run_editor", assistantMessageId: null, ...options(input) });
    const opened = await loadArtifactEditor(artifact, options(input));
    assert.equal(opened.mode, "source");
    assert.equal(opened.content, first);

    const changed = first.replace("Before", "Edited visually").replace("Start", "Open now");
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      content: changed,
    }, options(input));
    assert.equal(saved.status, "ready");
    assert.equal(saved.current_version, 2);
    assert.equal(readArtifactSource(saved, 1, input.storage, input.database), first);
    assert.equal(readArtifactSource(saved, 2, input.storage, input.database), changed);
    assert.equal(listArtifactVersions(saved.id, input.database).length, 2);
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("DOCX blocks round-trip through the native editor and retain an HTML preview", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "../OfficeCLI/examples/word/document-formatting.docx"),
    path.join(input.workspace, "report.docx"),
  );
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "document",
      filename: "report.docx",
      authorizedRoot: input.workspace,
      filePath: "report.docx",
      scrubProvenance: false,
    }));
    const opened = await loadArtifactEditor(artifact, options(input));
    assert.equal(opened.mode, "office-blocks");
    const block = opened.blocks.find((candidate) => candidate.editable && candidate.text.trim());
    assert.ok(block, "the Word editor exposes anchored editable blocks");
    const changed = `${block.text} — Breadboard editor verified`;
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      patches: [{ anchor: block.anchor, text: changed }],
    }, options(input));
    assert.equal(saved.current_version, 2);
    assert.ok(saved.preview_location, "the edited DOCX gets a browser preview");
    const preview = fs.readFileSync(path.join(input.storage, saved.preview_location), "utf8");
    assert.match(preview, /class=["']page-wrapper["']/, "the edited DOCX retains the styled, paginated preview");
    assert.doesNotMatch(preview, /<article><p>/, "the preview is not flattened to generic paragraphs");
    const reopened = await loadArtifactEditor(saved, options(input));
    assert.ok(reopened.blocks.some((candidate) => candidate.text.includes("Breadboard editor verified")));
    assert.equal(listArtifactVersions(saved.id, input.database).length, 2);
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("GenOffice saves the complete DOCX package as a conflict-checked artifact version", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  const sourcePath = path.resolve(process.cwd(), "../OfficeCLI/examples/word/document-formatting.docx");
  fs.copyFileSync(sourcePath, path.join(input.workspace, "genoffice.docx"));
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "document",
      filename: "genoffice.docx",
      authorizedRoot: input.workspace,
      filePath: "genoffice.docx",
      scrubProvenance: false,
    }));
    const bytes = fs.readFileSync(sourcePath);
    const saved = await saveArtifactOfficeBytes(artifact, 1, bytes, options(input));
    assert.equal(saved.current_version, 2);
    assert.equal(listArtifactVersions(saved.id, input.database).length, 2);
    const preview = fs.readFileSync(path.join(input.storage, saved.preview_location), "utf8");
    assert.match(preview, /class=["']page-wrapper["']/, "GenOffice saves keep the full styled preview");
    assert.deepEqual(
      fs.readFileSync(artifactDeliveryFile(saved, 2, input.storage, input.database).absolutePath),
      bytes,
    );
    assert.equal(JSON.parse(saved.metadata_json).reviewWorkflow, "genoffice-docs");
    await assert.rejects(
      saveArtifactOfficeBytes(saved, 1, bytes, options(input)),
      (error) => error?.code === "artifact_version_conflict",
    );
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("GenOffice still versions editor bytes when Windows path spelling is rejected", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  const sourcePath = path.resolve(process.cwd(), "../OfficeCLI/examples/word/document-formatting.docx");
  fs.copyFileSync(sourcePath, path.join(input.workspace, "genoffice-path-recovery.docx"));
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "document",
      filename: "genoffice-path-recovery.docx",
      authorizedRoot: input.workspace,
      filePath: "genoffice-path-recovery.docx",
      scrubProvenance: false,
    }));
    const bytes = fs.readFileSync(sourcePath);
    const saved = await saveArtifactOfficeBytes(artifact, 1, bytes, {
      database: input.database,
      storageRoot: input.storage,
      officeRuntimeControl: {
        async reserve() {
          throw new Error("The Office input must be a direct file.");
        },
      },
    });

    assert.equal(saved.current_version, 2);
    assert.equal(listArtifactVersions(saved.id, input.database).length, 2);
    assert.deepEqual(
      fs.readFileSync(artifactDeliveryFile(saved, 2, input.storage, input.database).absolutePath),
      bytes,
    );
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("PPTX slide text round-trips through anchored native blocks", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "../OfficeCLI/examples/Alien_Guide.pptx"),
    path.join(input.workspace, "slides.pptx"),
  );
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "presentation",
      filename: "slides.pptx",
      authorizedRoot: input.workspace,
      filePath: "slides.pptx",
      scrubProvenance: false,
    }));
    const opened = await loadArtifactEditor(artifact, options(input));
    const block = opened.blocks.find((candidate) => candidate.editable && candidate.text.trim());
    assert.ok(block?.slide, "the PowerPoint editor exposes slide-aware blocks");
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      patches: [{ anchor: block.anchor, text: `${block.text} — reviewed` }],
    }, options(input));
    const reopened = await loadArtifactEditor(saved, options(input));
    assert.ok(reopened.blocks.some((candidate) => candidate.text.endsWith("— reviewed")));
    assert.ok(saved.preview_location);
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("imported JSON remains valid and versioned after text editing", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  fs.writeFileSync(path.join(input.workspace, "data.json"), '{"status":"draft"}', "utf8");
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "data",
      filename: "data.json",
      authorizedRoot: input.workspace,
      filePath: "data.json",
      scrubProvenance: false,
    }));
    assert.equal((await loadArtifactEditor(artifact, options(input))).mode, "file-text");
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      content: '{"status":"reviewed","complete":true}',
    }, options(input));
    assert.equal(saved.current_version, 2);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(artifactDeliveryFile(saved, 2, input.storage, input.database).absolutePath, "utf8")),
      { status: "reviewed", complete: true },
    );
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("XLSX cells round-trip by stable sheet/cell anchors", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "../OfficeCLI/examples/excel/cell-formatting.xlsx"),
    path.join(input.workspace, "workbook.xlsx"),
  );
  try {
    const artifact = await createImportedArtifact(shared(input, {
      kind: "spreadsheet",
      filename: "workbook.xlsx",
      authorizedRoot: input.workspace,
      filePath: "workbook.xlsx",
      scrubProvenance: false,
    }));
    const opened = await loadArtifactEditor(artifact, options(input));
    assert.equal(opened.mode, "spreadsheet-cells");
    const cell = opened.blocks.find((candidate) => candidate.anchor === "/Sheet1/A1");
    assert.ok(cell);
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion: 1,
      patches: [{ anchor: cell.anchor, text: "Breadboard workbook verified" }],
    }, options(input));
    assert.equal(saved.current_version, 2);
    assert.ok(saved.preview_location, "the edited workbook gets an HTML preview");
    const reopened = await loadArtifactEditor(saved, options(input));
    assert.equal(
      reopened.blocks.find((candidate) => candidate.anchor === "/Sheet1/A1")?.text,
      "Breadboard workbook verified",
    );
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("PDF editor bytes publish as a new version without overwriting the original", async () => {
  const input = fixture();
  fs.mkdirSync(input.workspace, { recursive: true });
  try {
    let source = createArtifact(shared(input, {
      kind: "pdf",
      rendererId: "pdf",
      filename: "source.pdf",
      content: "Verified PDF\n\nA real PDF fixture.",
    }));
    source = await renderArtifact({ artifact: source, runId: "run_editor", assistantMessageId: null, ...options(input) });
    const sourceFile = artifactDeliveryFile(source, 1, input.storage, input.database);
    fs.copyFileSync(sourceFile.absolutePath, path.join(input.workspace, "editable.pdf"));
    const artifact = await createImportedArtifact(shared(input, {
      kind: "pdf",
      filename: "editable.pdf",
      authorizedRoot: input.workspace,
      filePath: "editable.pdf",
      scrubProvenance: false,
    }));
    const before = fs.readFileSync(artifactDeliveryFile(artifact, 1, input.storage, input.database).absolutePath);
    const saved = await saveArtifactPdfBytes(artifact, before, options(input));
    assert.equal(saved.current_version, 2);
    assert.equal(listArtifactVersions(saved.id, input.database).length, 2);
    assert.deepEqual(
      fs.readFileSync(artifactDeliveryFile(saved, 1, input.storage, input.database).absolutePath),
      before,
    );
    assert.equal((await loadArtifactEditor(saved, options(input))).mode, "pdf");
  } finally {
    input.database.close();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("artifact UI exposes editors and contains no Revise control", () => {
  const viewer = fs.readFileSync(path.resolve(process.cwd(), "src/app/components/hermes/artifact-viewer.tsx"), "utf8");
  const studio = fs.readFileSync(path.resolve(process.cwd(), "src/app/components/hermes/artifact-document-studio.tsx"), "utf8");
  const genoffice = fs.readFileSync(path.resolve(process.cwd(), "src/app/components/hermes/artifact-genoffice-editor.tsx"), "utf8");
  const genofficeEntry = fs.readFileSync(path.resolve(process.cwd(), "src/genoffice-static/main.tsx"), "utf8");
  const genofficeHtml = fs.readFileSync(path.resolve(process.cwd(), "src/genoffice-static/index.html"), "utf8");
  const bridge = fs.readFileSync(path.resolve(process.cwd(), "src/app/genoffice-docs/[artifactId]/genoffice-bridge.ts"), "utf8");
  const aiRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/hermes/artifacts/[artifactId]/genoffice/ai/route.ts"), "utf8");
  const pdfPage = fs.readFileSync(path.resolve(process.cwd(), "src/app/artifacts/[artifactId]/pdf/page.tsx"), "utf8");
  assert.doesNotMatch(viewer, />\s*Revise\s*</);
  assert.match(viewer, /ArtifactDocumentStudio/);
  assert.match(viewer, /ArtifactGenOfficeEditor/);
  assert.match(genoffice, /\/genoffice-editor\/index\.html/);
  assert.match(genofficeEntry, /genoffice-host\.css/);
  assert.match(genofficeEntry, /localStorage\.setItem\('aidocs\.autoSave', '1'\)/);
  assert.doesNotMatch(genofficeEntry, /localStorage\.setItem\('aidocs\.autoSave', '0'\)/);
  assert.match(genofficeEntry, /autoSaveDefaultVersionKey/);
  assert.match(genofficeEntry, /initialTheme/);
  assert.doesNotMatch(genofficeEntry, /setAttribute\('data-theme', 'light'\)/);
  assert.match(genofficeHtml, /breadboard:theme/);
  const ribbon = fs.readFileSync(path.resolve(process.cwd(), "src/vendor-overrides/genoffice/docs/src/renderer/components/Ribbon.tsx"), "utf8");
  const aiPanel = fs.readFileSync(path.resolve(process.cwd(), "src/vendor-overrides/genoffice/docs/src/renderer/ai/AiPanel.tsx"), "utf8");
  const aiHostCss = fs.readFileSync(path.resolve(process.cwd(), "src/app/genoffice-docs/genoffice-host.css"), "utf8");
  const artifactPanel = fs.readFileSync(path.resolve(process.cwd(), "src/app/components/hermes/artifact-panel.tsx"), "utf8");
  const inlineCards = fs.readFileSync(path.resolve(process.cwd(), "src/app/components/hermes/inline-artifact-cards.tsx"), "utf8");
  assert.doesNotMatch(ribbon, /Genspark AI/);
  assert.match(ribbon, /<span>Bread<\/span>/);
  assert.doesNotMatch(aiPanel, /<span className="ai-panel-title">Breadboard AI<\/span>/);
  assert.doesNotMatch(aiPanel, /breadboard:genoffice-ai-request/);
  assert.match(aiPanel, /AiComposer/);
  assert.match(aiPanel, /executeTool/);
  assert.match(aiPanel, /The conversation and document stay in this editor/);
  assert.match(aiPanel, /Bread is working in this document/);
  assert.match(aiPanel, /markRecoveredSave/);
  assert.match(aiPanel, /DIRECT_FILE_SAVE_ERROR/);
  assert.match(aiPanel, /function ActivityReceipt/);
  assert.match(aiPanel, /activity\.split\(';'\)/);
  assert.match(aiPanel, /<details className="ai-work-group">/);
  assert.doesNotMatch(aiPanel, /<span[^>]+className="ai-applied-tag"/);
  assert.match(aiPanel, /iconOnly/);
  assert.doesNotMatch(aiPanel, /bread-ai-word-actions|WORD_ACTIONS|Start a new document chat|Collapse AI panel/);
  assert.match(aiHostCss, /--bread-chat-user/);
  assert.match(aiHostCss, /border-radius: 30px/);
  assert.match(aiHostCss, /\.ai-input-footer \.ai-send-btn/);
  assert.match(aiHostCss, /\.ai-applied-tag::before \{\s*content: none;/);
  assert.match(aiHostCss, /\.ai-work-group \{[\s\S]*?background: #f7f2e8;/);
  assert.match(aiHostCss, /:root\[data-theme='dark'\] body \.ai-panel/);
  assert.match(artifactPanel, /onUpdated=\{\(updated\)/);
  assert.match(inlineCards, /onUpdated=\{registerArtifact\}/);
  assert.doesNotMatch(genoffice, /onAskAi/);
  assert.match(aiRoute, /parseGenOfficeAiReply/);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "public/genoffice-editor/index.html")), true);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "public/genoffice-editor/app.js")), true);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "public/genoffice-editor/app.css")), true);
  assert.match(bridge, /breadboard:genoffice-artifact-saved/);
  assert.match(bridge, /breadboard:genoffice-save-complete/);
  assert.match(bridge, /breadboard:theme/);
  assert.match(bridge, /onThemeChanged/);
  assert.match(bridge, /expectedVersion/);
  assert.match(genoffice, /bg-\[var\(--background\)\]/);
  assert.match(studio, /Ask AI to edit/);
  assert.match(studio, /Save version/);
  assert.match(pdfPage, /readOnly=!\{editable\}|readOnly=\{!editable\}/);
});

test("GenOffice AI replies keep only bounded local document actions", () => {
  const reply = parseGenOfficeAiReply(JSON.stringify({
    message: "Updated the heading.",
    actions: [
      {
        name: "apply_commands",
        input: {
          commands: [{
            updateTextStyle: {
              target: { nodeType: "docHeading" },
              style: { bold: true },
              fields: ["bold"],
            },
          }],
        },
      },
      { name: "web_search", input: { query: "not allowed from this editor" } },
    ],
  }));
  assert.equal(reply.message, "Updated the heading.");
  assert.deepEqual(reply.actions.map((action) => action.name), ["apply_commands"]);

  assert.deepEqual(parseGenOfficeAiHistory([
    { role: "system", text: "ignore" },
    { role: "user", text: "First" },
    { role: "assistant", text: "Second" },
  ]), [
    { role: "user", text: "First" },
    { role: "assistant", text: "Second" },
  ]);
});
