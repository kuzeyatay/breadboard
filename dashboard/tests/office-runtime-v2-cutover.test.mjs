import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(dashboardRoot);
const stateKey = "__breadboardOfficeRuntimeV2CutoverState";

function jobSnapshot() {
  return {
    jobId: "job_" + "a".repeat(64),
    jobType: "office-artifact",
    workerKind: "office-artifact-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_office_1",
    gardenId: "garden-one",
    conversationId: "conv_office_test",
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 3,
    progressTotal: 3,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
  };
}

async function loadRuntimeModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "office", "runtime-v2.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "office-runtime-v2-stubs",
        setup(build) {
          build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
            path: "supervisor-control",
            namespace: "office-runtime-stub",
          }));
          build.onResolve({ filter: /runtime-paths\.ts$/ }, () => ({
            path: "runtime-paths",
            namespace: "office-runtime-stub",
          }));
          build.onResolve({ filter: /agent-query\.ts$/ }, () => ({
            path: "agent-query",
            namespace: "office-runtime-stub",
          }));
          build.onResolve({ filter: /contract\.ts$/ }, () => ({
            path: "office-contract",
            namespace: "office-runtime-stub",
          }));
          build.onLoad({ filter: /supervisor-control/, namespace: "office-runtime-stub" }, () => ({
            loader: "js",
            contents: `
              const state = () => globalThis[${JSON.stringify(stateKey)}];
              export async function reserveRuntimeJobInput(authority, request) {
                state().reservations.push({ authority: structuredClone(authority), request: structuredClone(request) });
                return { uploadId: "upload_office_" + state().reservations.length, expiresAt: Date.now() + 10000, maximumBytes: request.declaredSizeBytes, ...request };
              }
              export async function uploadRuntimeJobInput(authority, reservation, body) {
                const reader = body.getReader();
                let size = 0;
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  size += value.byteLength;
                }
                state().uploads.push({ authority: structuredClone(authority), uploadId: reservation.uploadId, size });
                return { uploadId: reservation.uploadId, sizeBytes: size, sha256: "b".repeat(64), displayName: reservation.displayName, mediaType: reservation.mediaType };
              }
              export async function abandonRuntimeJobInput(authority, uploadId) {
                state().abandoned.push({ authority: structuredClone(authority), uploadId });
              }
              export async function submitRuntimeJob(authority, submission) {
                state().submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
                return structuredClone(state().job);
              }
              export async function inspectRuntimeJob() { throw new Error("terminal fixture must not poll"); }
              export async function cancelRuntimeJob() { throw new Error("terminal fixture must not cancel"); }
              export async function readRuntimeJobOutput(authority, jobId, kind) {
                state().outputs.push({ authority: structuredClone(authority), jobId, kind });
                return { jobId, kind, content: structuredClone(state().result) };
              }
            `,
          }));
          build.onLoad({ filter: /runtime-paths/, namespace: "office-runtime-stub" }, () => ({
            loader: "js",
            contents: `export const repositoryRoot = () => globalThis[${JSON.stringify(stateKey)}].dataRoot;`,
          }));
          build.onLoad({ filter: /agent-query/, namespace: "office-runtime-stub" }, () => ({
            loader: "js",
            contents: `export const describeOfficeExport = () => ({ ...globalThis[${JSON.stringify(stateKey)}].described });`,
          }));
          build.onLoad({ filter: /office-contract/, namespace: "office-runtime-stub" }, () => ({
            loader: "js",
            contents: `
              import path from "node:path";
              export const OFFICE_RUN_TIMEOUT_MS = 90000;
              export class OfficeCliError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
              export const resolveOfficeCli = () => "officecli";
              export const describeOfficeExport = () => ({ ...globalThis[${JSON.stringify(stateKey)}].described });
              export function containWorkspacePath(workspace, raw) {
                const root = path.resolve(workspace);
                const candidate = path.resolve(root, raw);
                if (candidate !== root && !candidate.startsWith(root + path.sep)) throw new Error("escaped workspace");
                return candidate;
              }
              export function validateOfficeCommand(command, workspace) { globalThis[${JSON.stringify(stateKey)}].validations.push({ command, workspace }); }
            `,
            resolveDir: dashboardRoot,
          }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#office-runtime-v2`);
}

async function loadColpaliIndexerModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "colpali", "indexer.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "colpali-indexer-stubs",
        setup(build) {
          for (const [filter, pathName] of [
            [/page-images\.ts$/, "page-images"],
            [/service\.ts$/, "service"],
            [/document-blob-store\.ts$/, "document-blob-store"],
          ]) {
            build.onResolve({ filter }, () => ({
              path: pathName,
              namespace: "colpali-indexer-stub",
            }));
          }
          build.onLoad({ filter: /page-images/, namespace: "colpali-indexer-stub" }, () => ({
            loader: "js",
            contents: "export async function renderDocumentPages() { throw new Error('not used'); }",
          }));
          build.onLoad({ filter: /service/, namespace: "colpali-indexer-stub" }, () => ({
            loader: "js",
            contents: "export async function colpaliIndex() { throw new Error('not used'); }",
          }));
          build.onLoad({ filter: /document-blob-store/, namespace: "colpali-indexer-stub" }, () => ({
            loader: "js",
            contents: "export function documentBlobPath() { throw new Error('not used'); }",
          }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#colpali-indexer`);
}

const runtime = await loadRuntimeModule();
const colpaliIndexer = await loadColpaliIndexerModule();

function freshState() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-office-runtime-client-"));
  const sourceDirectory = path.join(dataRoot, "source");
  fs.mkdirSync(sourceDirectory);
  const sourcePath = path.join(sourceDirectory, "report.docx");
  fs.writeFileSync(sourcePath, "sealed office source");
  const job = jobSnapshot();
  const stageDirectory = path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    "1",
    job.workerInstanceId,
    "workspace",
    "office-stage",
  );
  fs.mkdirSync(stageDirectory, { recursive: true });
  fs.writeFileSync(path.join(stageDirectory, "report.docx"), "sealed office source");
  fs.writeFileSync(path.join(stageDirectory, "preview.html"), "<!doctype html><body>preview</body>");
  const state = {
    dataRoot,
    sourcePath,
    stageDirectory,
    job,
    described: {
      filePath: sourcePath,
      relativeFile: "report.docx",
      kind: "document",
      title: "Runtime report",
      filename: "report.docx",
    },
    reservations: [],
    uploads: [],
    submissions: [],
    outputs: [],
    abandoned: [],
    validations: [],
    result: null,
  };
  globalThis[stateKey] = state;
  return state;
}

function envelope(state, result) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: state.job.jobId,
      attempt: state.job.attempt,
      workerInstanceId: state.job.workerInstanceId,
    },
    completionSequence: state.job.lastWorkerSequence,
    result,
  };
}

test("office_run preserves the command response while submitting exact session authority", async () => {
  const state = freshState();
  state.result = envelope(state, {
    operation: "command",
    command: "help",
    exitCode: 0,
    output: "OfficeCLI help",
    truncated: false,
    timedOut: false,
    file: null,
  });
  try {
    const result = await runtime.runOfficeCommandViaRuntime(
      {
        userId: 17,
        gardenId: "garden-one",
        conversationId: "conv_office_test",
        runtimeSessionId: 41,
      },
      "C:\\authorized-workspace",
      { command: "help" },
      { idempotencySeed: "tool-call-1" },
    );
    assert.deepEqual(result, {
      command: "help",
      exitCode: 0,
      output: "OfficeCLI help",
      truncated: false,
      timedOut: false,
      file: null,
    });
    assert.deepEqual(state.validations, [{ command: "help", workspace: "C:\\authorized-workspace" }]);
    assert.equal(state.submissions.length, 1);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 17,
      gardenId: "garden-one",
      conversationId: "conv_office_test",
    });
    assert.equal(state.submissions[0].submission.jobType, "office-artifact");
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      operation: "command",
      runtimeSessionId: 41,
      command: "help",
    });
    assert.equal(state.submissions[0].submission.inputUploads, undefined);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("office_export sends bytes only through a sealed upload and returns fenced file references", async () => {
  const state = freshState();
  const outputRelativePath = path.relative(
    state.dataRoot,
    path.join(state.stageDirectory, "report.docx"),
  ).split(path.sep).join("/");
  const previewRelativePath = path.relative(
    state.dataRoot,
    path.join(state.stageDirectory, "preview.html"),
  ).split(path.sep).join("/");
  state.result = envelope(state, {
    operation: "export",
    relativeFile: "report.docx",
    kind: "document",
    title: "Runtime report",
    filename: "report.docx",
    outputRelativePath,
    previewRelativePath,
  });
  try {
    const staged = await runtime.prepareOfficeExportViaRuntime(
      { userId: 17, gardenId: "garden-one", conversationId: "conv_office_test" },
      path.dirname(state.sourcePath),
      { file: "report.docx", title: "Runtime report" },
      { idempotencySeed: "run-1:tool-call-2" },
    );
    assert.equal(state.reservations.length, 1);
    assert.equal(state.uploads[0].size, Buffer.byteLength("sealed office source"));
    assert.equal(state.submissions.length, 1);
    const submission = state.submissions[0].submission;
    assert.deepEqual(submission.inputUploads, [{ uploadId: "upload_office_1" }]);
    assert.deepEqual(submission.requestPayload, {
      operation: "export",
      relativeFile: "report.docx",
      title: "Runtime report",
    });
    assert.doesNotMatch(JSON.stringify(submission.requestPayload), /sealed office source|sourcePath|filePath/u);
    assert.equal(staged.filePath, path.join(state.stageDirectory, "report.docx"));
    assert.equal(staged.previewFilePath, path.join(state.stageDirectory, "preview.html"));
    assert.equal(fs.readFileSync(staged.filePath, "utf8"), "sealed office source");
    staged.cleanup();
    staged.cleanup();
    assert.equal(fs.existsSync(state.stageDirectory), false, "cleanup is exact and idempotent");
    assert.equal(fs.existsSync(state.sourcePath), true, "the source document is preserved");
    assert.deepEqual(state.abandoned, []);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("spreadsheet edits use two sealed blobs and return only staged file references", async () => {
  const state = freshState();
  const spreadsheet = path.join(path.dirname(state.sourcePath), "book.xlsx");
  fs.writeFileSync(spreadsheet, "PK\u0003\u0004spreadsheet", "binary");
  const output = path.join(state.stageDirectory, "edited.xlsx");
  fs.writeFileSync(output, "PK\u0003\u0004edited", "binary");
  state.result = envelope(state, {
    operation: "spreadsheet",
    action: "patch",
    outputWorkspaceRelativePath: "edited.xlsx",
    outputRelativePath: path.relative(state.dataRoot, output).split(path.sep).join("/"),
    previewRelativePath: path.relative(
      state.dataRoot,
      path.join(state.stageDirectory, "preview.html"),
    ).split(path.sep).join("/"),
  });
  try {
    const staged = await runtime.editSpreadsheetViaRuntime(
      { userId: 17, gardenId: "garden-one", conversationId: "conv_office_test" },
      spreadsheet,
      [{ anchor: "Sheet1!A1", text: "updated" }],
      { title: "Budget", idempotencySeed: "spreadsheet-edit-1" },
    );
    assert.equal(state.reservations.length, 2);
    assert.deepEqual(state.submissions[0].submission.inputUploads, [
      { uploadId: "upload_office_1" },
      { uploadId: "upload_office_2" },
    ]);
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      operation: "spreadsheet",
      action: "patch",
      title: "Budget",
    });
    assert.doesNotMatch(JSON.stringify(state.submissions[0].submission.requestPayload), /updated|Sheet1/u);
    assert.deepEqual(staged.result, { patched: ["Sheet1!A1"] });
    assert.equal(staged.filePath, output);
    staged.cleanup();
    assert.equal(fs.existsSync(state.stageDirectory), false);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("user-global ColPali work carries no caller path and accepts the full 300-page bound", async () => {
  const state = freshState();
  const page = path.join(state.stageDirectory, "page-1.png");
  fs.writeFileSync(page, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  state.job.gardenId = null;
  state.job.conversationId = null;
  state.result = envelope(state, {
    operation: "page-images",
    pages: [{
      pageNumber: 1,
      relativePath: path.relative(state.dataRoot, page).split(path.sep).join("/"),
    }],
    unsupported: "",
  });
  try {
    const staged = await runtime.renderOfficePagesViaRuntime(
      { userId: 17, gardenId: null, conversationId: null },
      state.sourcePath,
      "docx",
      { maximumPages: 300, width: 1200, idempotencySeed: "blob-1:pages" },
    );
    assert.deepEqual(state.submissions[0].authority, {
      userId: 17,
      gardenId: null,
      conversationId: null,
    });
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      operation: "page-images",
      format: "docx",
      maximumPages: 300,
      width: 1200,
    });
    assert.doesNotMatch(JSON.stringify(state.submissions[0].submission.requestPayload), /source|path|blob-1/iu);
    assert.deepEqual(staged.pages, [{ pageNumber: 1, filePath: page }]);
    staged.cleanup();
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("document-skill segmentation uses a sealed staged result under user-global authority", async () => {
  const state = freshState();
  state.job.gardenId = null;
  state.job.conversationId = null;
  const structure = {
    chapters: [{ number: 1, title: "One", start: 0, end: 20, kind: "numbered" }],
    chaptersDetected: 1,
    hasToc: false,
    headingSample: ["One"],
    estimatedTokens: 5,
    fromClone: true,
  };
  fs.writeFileSync(path.join(state.stageDirectory, "operation.json"), JSON.stringify({ value: structure }));
  state.result = envelope(state, {
    operation: "skill-segment",
    dataRelativePath: path.relative(
      state.dataRoot,
      path.join(state.stageDirectory, "operation.json"),
    ).split(path.sep).join("/"),
  });
  try {
    const value = await runtime.segmentDocumentSkillViaRuntime(
      { userId: 17, gardenId: null, conversationId: null },
      "Chapter 1\nUseful text.",
      { idempotencySeed: "document-hash:segment" },
    );
    assert.deepEqual(value, structure);
    assert.deepEqual(state.submissions[0].submission.requestPayload, { operation: "skill-segment" });
    assert.equal(state.uploads.length, 1);
    assert.doesNotMatch(JSON.stringify(state.submissions[0].submission.requestPayload), /Useful text/u);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("markdown DOCX rendering returns bounded stage references and idempotent cleanup", async () => {
  const state = freshState();
  const outputRelativePath = path.relative(
    state.dataRoot,
    path.join(state.stageDirectory, "report.docx"),
  ).split(path.sep).join("/");
  const previewRelativePath = path.relative(
    state.dataRoot,
    path.join(state.stageDirectory, "preview.html"),
  ).split(path.sep).join("/");
  state.result = envelope(state, {
    operation: "artifact-render",
    rendererId: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    outputRelativePath,
    previewRelativePath,
  });
  try {
    const staged = await runtime.renderMarkdownArtifactViaRuntime(
      { userId: 17, gardenId: "garden-one", conversationId: "conv_office_test" },
      {
        rendererId: "docx",
        content: "# Runtime report",
        filename: "report.docx",
        title: "Runtime report",
        metadata: { theme: "editorial" },
      },
      { idempotencySeed: "artifact-1:version-1" },
    );
    assert.equal(staged.outputPath, path.join(state.stageDirectory, "report.docx"));
    assert.equal(staged.previewPath, path.join(state.stageDirectory, "preview.html"));
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      operation: "artifact-render",
      rendererId: "docx",
      title: "Runtime report",
      filename: "report.docx",
      metadata: { theme: "editorial" },
    });
    assert.doesNotMatch(JSON.stringify(state.submissions[0].submission.requestPayload), /# Runtime report/u);
    staged.cleanup();
    staged.cleanup();
    assert.equal(fs.existsSync(state.stageDirectory), false);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("standalone Markdown PDF rendering seals the folder bundle under exact Garden authority", async () => {
  const state = freshState();
  state.job.conversationId = null;
  const output = path.join(state.stageDirectory, "folder-notes.pdf");
  fs.writeFileSync(output, "%PDF-1.7\nsealed runtime PDF\n");
  state.result = envelope(state, {
    operation: "markdown-pdf",
    mimeType: "application/pdf",
    outputRelativePath: path.relative(state.dataRoot, output).split(path.sep).join("/"),
  });
  try {
    const staged = await runtime.renderMarkdownPdfDownloadViaRuntime(
      { userId: 17, gardenId: "garden-one", conversationId: null },
      {
        documents: [
          { content: "# One\nFirst note", title: "One" },
          { content: "# Two\nSecond note", title: "Two" },
        ],
        title: "Folder notes",
        filename: "folder-notes.pdf",
      },
      { idempotencySeed: "folder-pdf-1" },
    );
    assert.equal(staged.filePath, output);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 17,
      gardenId: "garden-one",
      conversationId: null,
    });
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      operation: "markdown-pdf",
      filename: "folder-notes.pdf",
      documentCount: 2,
    });
    assert.doesNotMatch(
      JSON.stringify(state.submissions[0].submission.requestPayload),
      /First note|Second note/u,
    );
    assert.equal(state.uploads.length, 1);
    staged.cleanup();
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime output references cannot escape the exact job attempt", async () => {
  const state = freshState();
  state.result = envelope(state, {
    operation: "export",
    relativeFile: "report.docx",
    kind: "document",
    title: "Runtime report",
    filename: "report.docx",
    outputRelativePath: `runtime/jobs/${state.job.jobId}/attempts/1/other-worker/workspace/office-stage/report.docx`,
    previewRelativePath: null,
  });
  try {
    await assert.rejects(
      runtime.prepareOfficeExportViaRuntime(
        { userId: 17, gardenId: "garden-one", conversationId: "conv_office_test" },
        path.dirname(state.sourcePath),
        { file: "report.docx", title: "Runtime report" },
      ),
      /outside its fenced attempt/u,
    );
    assert.equal(fs.existsSync(state.sourcePath), true);
  } finally {
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("all Next Office-family callers have no direct process or heavy renderer fallback", () => {
  const read = (...segments) => fs.readFileSync(path.join(dashboardRoot, ...segments), "utf8");
  const officeRoute = read("src", "app", "api", "hermes", "tools", "office", "route.ts");
  const documentRoute = read("src", "app", "api", "hermes", "tools", "document", "route.ts");
  const markdownPdfRoute = read("src", "app", "api", "markdown-to-pdf", "route.ts");
  const genofficeRoute = read("src", "app", "api", "hermes", "artifacts", "[artifactId]", "genoffice", "route.ts");
  const markdownPdfRenderer = read("src", "lib", "markdown-render", "pdf.ts");
  const editor = read("src", "lib", "hermes", "artifact-document-editor.ts");
  const officeSave = read("src", "lib", "hermes", "artifact-office-save.ts");
  const artifactStore = read("src", "lib", "hermes", "artifact-store.ts");
  const renderers = read("src", "lib", "hermes", "artifact-renderers.ts");
  const pages = read("src", "lib", "colpali", "page-images.ts");
  const indexer = read("src", "lib", "colpali", "indexer.ts");
  const skillBuilder = read("src", "lib", "document-skills", "builder.ts");
  const skillService = read("src", "lib", "document-skills", "service.ts");
  const skillValidation = read("src", "lib", "document-skills", "validate.ts");
  const skillBuildRoute = read("src", "app", "api", "document-skills", "build", "route.ts");
  const client = read("src", "lib", "office", "runtime-v2.ts");
  const contract = read("src", "lib", "office", "contract.ts");
  const worker = fs.readFileSync(path.join(dashboardRoot, "scripts", "runtime-v2-office-artifact-worker.mjs"), "utf8");
  for (const source of [
    officeRoute,
    documentRoute,
    markdownPdfRoute,
    genofficeRoute,
    editor,
    officeSave,
    artifactStore,
    renderers,
    pages,
    indexer,
    skillBuilder,
    skillService,
    skillValidation,
    skillBuildRoute,
    client,
    contract,
  ]) {
    assert.doesNotMatch(
      source,
      /node:child_process|\bspawn\s*\(|\brunOfficeCli\s*\(|\beditDocument\s*\(|\bconvertPdfDocument\s*\(|\brenderMarkdownTo(?:Docx|Pdf)\s*\(/u,
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*\/office\/(?:officecli|agent-query)\.ts["']/u);
  }
  assert.match(officeRoute, /runOfficeCommandViaRuntime/u);
  assert.match(officeRoute, /prepareOfficeExportViaRuntime/u);
  assert.match(documentRoute, /runDocumentEditViaRuntime/u);
  assert.match(documentRoute, /runPdfToDocxViaRuntime/u);
  assert.match(markdownPdfRoute, /renderMarkdownPdfDownloadViaRuntime/u);
  assert.doesNotMatch(markdownPdfRoute, /markdown-render\/pdf|renderMarkdownToPdf/u);
  assert.match(markdownPdfRoute, /requireReadableCluster\(userId, clusterSlug\)\.slug/u);
  assert.match(markdownPdfRoute, /Readable\.toWeb\(fs\.createReadStream\(filePath\)\)/u);
  assert.ok(
    markdownPdfRoute.indexOf("directPdf(durablePath)") <
      markdownPdfRoute.indexOf("renderMarkdownPdfDownloadViaRuntime("),
  );
  assert.ok(markdownPdfRoute.indexOf("promotePdf(staged.filePath") < markdownPdfRoute.indexOf("staged?.cleanup()"));
  assert.match(markdownPdfRenderer, /!clusterSlug \|\| parts\[0\] !== clusterSlug/u);
  assert.match(genofficeRoute, /\{ signal: request\.signal \}/u);
  assert.match(officeSave, /signal: options\.signal/u);
  assert.match(editor, /inspectSpreadsheetViaRuntime/u);
  assert.match(editor, /editSpreadsheetViaRuntime/u);
  assert.match(pages, /renderOfficePagesViaRuntime/u);
  assert.match(indexer, /documentBlobPath/u);
  assert.match(indexer, /sameBlobPath/u);
  assert.match(artifactStore, /renderMarkdownArtifactViaRuntime/u);
  assert.match(skillBuilder, /segmentDocumentSkillViaRuntime/u);
  assert.match(skillService, /extractDocumentSkillViaRuntime/u);
  assert.match(skillValidation, /validateDocumentSkillViaRuntime/u);
  assert.match(skillBuildRoute, /const origin: DocumentSkillOrigin = garden/u);
  assert.match(skillBuildRoute, /gardenId: garden\?\.clusterSlug \?\? null/u);
  for (const source of [skillBuilder, skillService, skillValidation]) {
    assert.doesNotMatch(source, /from\s+["']\.\/(?:bridge|validate-worker)\.ts["']/u);
  }
  assert.doesNotMatch(client, /from\s+["']\.\/(?:officecli|agent-query)\.ts["']/u);
  assert.match(client, /submitRuntimeJob/u);
  assert.match(client, /uploadRuntimeJobInput/u);
  assert.match(worker, /inputBlobs/u);
  assert.match(worker, /OFFICECLI_NO_AUTO_RESIDENT/u);
  assert.match(worker, /QUARTZ_CONTENT_PATH = path\.join\(launch\.dataRoot, "quartz", "content"\)/u);
  assert.match(worker, /cancellationAcknowledged/u);
  assert.match(worker, /DatabaseSync/u);
  assert.match(worker, /document-skills", "bridge\.ts/u);
  assert.match(worker, /document-skills", "validate-worker\.ts/u);
});

test("Office rendering is a fresh bounded packaged manifest worker", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "desktop", "runtime-v2", "manifests", "workers.json"),
    "utf8",
  ));
  const worker = manifest.workers.find(({ kind }) => kind === "office-artifact-node");
  assert.ok(worker);
  assert.deepEqual(worker.jobTypes, ["office-artifact"]);
  assert.equal(worker.resourceClass, "document-processing");
  assert.equal(worker.maximumConcurrency, 1);
  assert.equal(worker.minimumInputBlobs, 0);
  assert.equal(worker.maximumInputBlobs, 2);
  assert.equal(worker.workspacePolicy, "private-per-job");
  assert.equal(worker.exitAfterJob, true);
  assert.ok(worker.capabilityIds.includes("workflow:document-skills"));
  assert.ok(worker.capabilityIds.includes("workflow:colpali-visual-retrieval"));
  assert.ok(worker.capabilityIds.includes("registry:artifact-renderers"));
  assert.equal(worker.allowedEntrypoint, "dashboard/scripts/runtime-v2-office-artifact-worker.mjs");
  const packaging = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  assert.match(packaging, /"runtime-v2-office-artifact-worker\.mjs"/u);
});

test("artifact callers durably promote Runtime staging before exact cleanup", () => {
  const officeRoute = fs.readFileSync(path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "office", "route.ts"), "utf8");
  const documentRoute = fs.readFileSync(path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "document", "route.ts"), "utf8");
  const editor = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "hermes", "artifact-document-editor.ts"), "utf8");
  const officeSave = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "hermes", "artifact-office-save.ts"), "utf8");
  const artifactStore = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"), "utf8");

  for (const source of [officeRoute, officeSave]) assert.match(source, /prepareOfficeExportViaRuntime/u);
  assert.match(documentRoute, /promoteRuntimeOfficeOutput/u);
  assert.match(editor, /(?:runDocumentEditViaRuntime|editSpreadsheetViaRuntime)/u);
  for (const source of [officeRoute, documentRoute, editor, officeSave]) {
    assert.match(source, /(?:createImportedArtifact|importArtifactVersion)\s*\(/u);
    assert.match(source, /\.cleanup\(\)/u);
  }
  assert.ok(documentRoute.indexOf("createImportedArtifact(") < documentRoute.lastIndexOf("staged.cleanup()"));
  assert.ok(editor.indexOf("importArtifactVersion(") < editor.indexOf("staged.cleanup()"));
  assert.match(artifactStore, /atomicPromoteFile\(staged\.outputPath/u);
  assert.match(artifactStore, /SET status = 'ready'/u);
  assert.ok(artifactStore.indexOf("atomicPromoteFile(staged.outputPath") < artifactStore.indexOf("finish.immediate()"));
  assert.ok(artifactStore.indexOf("finish.immediate()") < artifactStore.indexOf("runtimeStage.cleanup?.()"));
});

test("office_export recovery returns the durable artifact after Runtime retention", () => {
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "office", "route.ts"),
    "utf8",
  );
  assert.match(route, /function completedOfficeExport/u);
  assert.match(route, /user_id = \?[\s\S]*runtime_session_id = \?[\s\S]*conversation_id = \?[\s\S]*originating_run_id = \?[\s\S]*originating_tool_call_id = \?/u);
  assert.match(route, /source_hermes_tool = 'office_export'[\s\S]*status = 'ready'/u);
  assert.match(route, /officePreviewRendered/u);
  assert.ok(
    route.indexOf("completedOfficeExport({") < route.indexOf("prepareOfficeExportViaRuntime("),
    "durable artifact recovery must run before a retained Runtime result is consulted",
  );
});

test("document writes recover the exact promoted artifact before resubmitting Runtime work", () => {
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "document", "route.ts"),
    "utf8",
  );
  assert.match(route, /function completedDocumentWrite/u);
  assert.match(route, /user_id = \?[\s\S]*runtime_session_id = \?[\s\S]*conversation_id = \?[\s\S]*originating_run_id = \?[\s\S]*originating_tool_call_id = \?/u);
  assert.match(route, /source_skill = 'office'[\s\S]*source_hermes_tool = \?[\s\S]*status = 'ready'/u);
  assert.ok(route.indexOf("completedDocumentWrite({") < route.indexOf("runDocumentEditViaRuntime("));
  assert.ok(route.indexOf("promoteRuntimeOfficeOutput(") < route.indexOf("createImportedArtifact("));
  assert.ok(route.indexOf("createImportedArtifact(") < route.lastIndexOf("staged.cleanup()"));
});

test("markdown artifacts recover only hash-verified durable files after Runtime retention", () => {
  const store = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"),
    "utf8",
  );
  assert.match(store, /function durableReadyArtifactAvailable/u);
  assert.match(store, /isDirectDurableFile\(output\)/u);
  assert.match(store, /hashFile\(output\)\.contentHash === artifact\.content_hash/u);
  assert.ok(store.indexOf("durableReadyArtifactAvailable(current, root)") < store.indexOf("renderArtifactInner(input)"));
  assert.match(store, /idempotencySeed: `\$\{input\.artifact\.id\}:\$\{version\.version\}:\$\{crypto\.createHash/u);
});

test("ColPali recovery trusts only a complete bounded hash manifest", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "colpali-page-cache-"));
  try {
    const blob = path.join(directory, "doc_0123456789abcdef0123456789abcdef.docx");
    fs.writeFileSync(blob, "PK\u0003\u0004fixture", "binary");
    fs.mkdirSync(colpaliIndexer.pageCacheDirectory(blob));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    fs.writeFileSync(colpaliIndexer.pageImagePath(blob, 1), bytes);
    assert.equal(
      await colpaliIndexer.readCachedPage(blob, 1),
      null,
      "a partial cache has no recovery authority",
    );

    const manifestPath = path.join(colpaliIndexer.pageCacheDirectory(blob), "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      protocolVersion: 1,
      pages: [{ pageNumber: 1, sizeBytes: bytes.byteLength, sha256: "0".repeat(64) }],
    }));
    assert.equal(
      await colpaliIndexer.readCachedPage(blob, 1),
      null,
      "a forged cache digest is rejected",
    );

    fs.writeFileSync(manifestPath, JSON.stringify({
      protocolVersion: 1,
      pages: [{
        pageNumber: 1,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }],
    }));
    assert.equal(await colpaliIndexer.readCachedPage(blob, 1), bytes.toString("base64"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ColPali and document skills publish recovery checkpoints atomically", () => {
  const indexer = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "colpali", "indexer.ts"), "utf8");
  const status = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "colpali", "index-status.ts"), "utf8");
  const skillStore = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "document-skills", "store.ts"), "utf8");
  assert.match(indexer, /PAGE_CACHE_PROTOCOL_VERSION/u);
  assert.ok(indexer.indexOf("for (const entry of pending) await fsp.rename") < indexer.indexOf("await fsp.rename(temporaryManifest, manifestPath)"));
  assert.match(indexer, /createHash\("sha256"\).*page\.sha256/u);
  for (const source of [status, skillStore]) {
    assert.match(source, /fs\.fsyncSync\(descriptor\)/u);
    assert.match(source, /fs\.renameSync\(temporary, target\)/u);
  }
});
