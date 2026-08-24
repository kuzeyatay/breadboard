import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type Database from "better-sqlite3";
import { editDocument } from "../genoffice/agent-query.ts";
import { OfficeCliError, runOfficeCli } from "../office/officecli.ts";
import {
  artifactDeliveryFile,
  ArtifactStoreError,
  importArtifactVersion,
  presentArtifact,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
  type ArtifactRow,
} from "./artifact-store.ts";
import {
  artifactEditorMode,
  type ArtifactEditorBlock,
  type ArtifactEditorMode,
} from "./artifact-editor-types.ts";

const MAX_TEXT_EDITOR_BYTES = 5 * 1024 * 1024;
const MAX_OFFICE_EDITOR_BYTES = 128 * 1024 * 1024;
const MAX_EDITOR_PATCHES = 2_000;
const MAX_SPREADSHEET_CELLS = 2_000;
const OFFICE_EDITOR_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  OFFICECLI_NO_AUTO_RESIDENT: "1",
};

export interface ArtifactEditorPayload {
  mode: ArtifactEditorMode;
  artifact: ReturnType<typeof presentArtifact>;
  content?: string;
  blocks?: ArtifactEditorBlock[];
  truncated?: boolean;
}

export interface ArtifactEditorPatch {
  anchor: string;
  text: string;
}

export interface ArtifactEditorStoreOptions {
  database?: Database.Database;
  storageRoot?: string;
}

function modeForRow(artifact: ArtifactRow): ArtifactEditorMode {
  const mode = artifactEditorMode(presentArtifact(artifact));
  if (!mode) {
    throw new ArtifactStoreError(
      422,
      "artifact_editor_unsupported",
      "This artifact uses a specialist viewer or a format that cannot be edited safely.",
    );
  }
  return mode;
}

function temporaryWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifact-editor-"));
}

function removeTemporaryWorkspace(workspace: string): void {
  fs.rmSync(workspace, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
}

function stagedArtifactFile(
  artifact: ArtifactRow,
  workspace: string,
  options: ArtifactEditorStoreOptions,
): string {
  const delivery = artifactDeliveryFile(
    artifact,
    artifact.current_version,
    options.storageRoot,
    options.database,
  );
  const filename = path.basename(artifact.filename || delivery.filename);
  const staged = path.join(workspace, filename);
  fs.copyFileSync(delivery.absolutePath, staged);
  return staged;
}

function readEditableText(filePath: string): string {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_TEXT_EDITOR_BYTES) {
    throw new ArtifactStoreError(
      413,
      "artifact_editor_too_large",
      "This text artifact is too large for the document editor.",
    );
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.includes(0)) {
    throw new ArtifactStoreError(422, "artifact_editor_binary", "This artifact is not editable text.");
  }
  return bytes.toString("utf8");
}

function parseOfficeJson<T>(output: string, operation: string): T {
  let parsed: { success?: boolean; data?: T; error?: { error?: string } };
  try {
    parsed = JSON.parse(output) as typeof parsed;
  } catch {
    throw new OfficeCliError(500, "officecli_invalid_output", `${operation} returned invalid JSON.`);
  }
  if (!parsed.success || parsed.data === undefined) {
    throw new OfficeCliError(
      422,
      "officecli_edit_failed",
      parsed.error?.error || `${operation} failed.`,
    );
  }
  return parsed.data;
}

async function inspectSpreadsheet(
  artifact: ArtifactRow,
  workspace: string,
  options: ArtifactEditorStoreOptions,
): Promise<{ blocks: ArtifactEditorBlock[]; truncated: boolean }> {
  const staged = stagedArtifactFile(artifact, workspace, options);
  return inspectSpreadsheetFile(staged, workspace);
}

async function inspectSpreadsheetFile(
  staged: string,
  workspace: string,
): Promise<{ blocks: ArtifactEditorBlock[]; truncated: boolean }> {
  const result = await runOfficeCli(
    ["view", staged, "text", "--max-lines", "1000", "--json"],
    { cwd: workspace, timeoutMs: 60_000, env: OFFICE_EDITOR_ENV },
  );
  if (result.code !== 0 || result.timedOut || result.truncated) {
    throw new OfficeCliError(
      result.timedOut ? 504 : 422,
      "spreadsheet_inspect_failed",
      result.stderr.trim() || "The spreadsheet could not be opened for editing.",
    );
  }
  const data = parseOfficeJson<{
    sheets?: Array<{
      name?: string;
      rows?: Array<{ cells?: Record<string, unknown> }>;
    }>;
  }>(result.stdout, "Spreadsheet inspection");
  const blocks: ArtifactEditorBlock[] = [];
  let total = 0;
  for (const sheet of data.sheets ?? []) {
    const sheetName = typeof sheet.name === "string" ? sheet.name : "Sheet";
    for (const row of sheet.rows ?? []) {
      for (const [cell, value] of Object.entries(row.cells ?? {})) {
        total += 1;
        if (blocks.length >= MAX_SPREADSHEET_CELLS) continue;
        blocks.push({
          anchor: `/${sheetName}/${cell}`,
          kind: "cell",
          text: value === null || value === undefined ? "" : String(value),
          editable: true,
          sheet: sheetName,
          cell,
        });
      }
    }
  }
  return { blocks, truncated: total > blocks.length };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function writeNativePreview(
  workspace: string,
  filePath: string,
): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  let sections = "";
  if (extension === ".xlsx") {
    const inspected = await inspectSpreadsheetFile(filePath, workspace);
    const sheets = new Map<string, ArtifactEditorBlock[]>();
    for (const block of inspected.blocks) {
      const key = block.sheet ?? "Sheet";
      sheets.set(key, [...(sheets.get(key) ?? []), block]);
    }
    sections = [...sheets.entries()].map(([sheet, cells]) => `
      <section><h2>${escapeHtml(sheet)}</h2><table><thead><tr><th>Cell</th><th>Value</th></tr></thead><tbody>
      ${cells.map((cell) => `<tr><th>${escapeHtml(cell.cell ?? cell.anchor)}</th><td>${escapeHtml(cell.text)}</td></tr>`).join("")}
      </tbody></table></section>`).join("");
  } else {
    const inspected = await editDocument(workspace, { file: path.relative(workspace, filePath) });
    if (inspected.operation !== "inspect") {
      throw new ArtifactStoreError(500, "artifact_editor_preview_failed", "The edited document could not be previewed.");
    }
    if (inspected.format === "pptx") {
      const slides = new Map<number, typeof inspected.blocks>();
      for (const block of inspected.blocks) {
        const slide = block.slide ?? 1;
        slides.set(slide, [...(slides.get(slide) ?? []), block]);
      }
      sections = [...slides.entries()].map(([slide, blocks]) => `
        <section class="slide"><h2>Slide ${slide}</h2>${blocks.map((block) => `<p>${escapeHtml(block.text)}</p>`).join("")}</section>`).join("");
    } else {
      sections = `<article>${inspected.blocks.map((block) => `<p>${escapeHtml(block.text)}</p>`).join("")}</article>`;
    }
  }
  const preview = path.join(workspace, "editor-preview.html");
  fs.writeFileSync(preview, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:32px;background:#f3f4f6;color:#1f2937;font:16px/1.55 system-ui,sans-serif}article,section{max-width:900px;margin:0 auto 24px;padding:32px;background:white;box-shadow:0 8px 28px #0002}p{white-space:pre-wrap}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}.slide{aspect-ratio:16/9;overflow:auto}</style></head><body>${sections}</body></html>`, "utf8");
  return preview;
}

export async function loadArtifactEditor(
  artifact: ArtifactRow,
  options: ArtifactEditorStoreOptions = {},
): Promise<ArtifactEditorPayload> {
  const mode = modeForRow(artifact);
  const presented = presentArtifact(artifact);
  if (mode === "source") {
    return {
      mode,
      artifact: presented,
      content: readArtifactSource(
        artifact,
        artifact.current_version,
        options.storageRoot,
        options.database,
      ),
    };
  }
  if (mode === "file-text") {
    return {
      mode,
      artifact: presented,
      content: readEditableText(artifactDeliveryFile(
        artifact,
        artifact.current_version,
        options.storageRoot,
        options.database,
      ).absolutePath),
    };
  }
  if (mode === "pdf") {
    const delivery = artifactDeliveryFile(
      artifact,
      artifact.current_version,
      options.storageRoot,
      options.database,
    );
    const parser = new PDFParse({ data: fs.readFileSync(delivery.absolutePath) });
    try {
      const extracted = await parser.getText({ pageJoiner: "\n\n" });
      return { mode, artifact: presented, content: extracted.text.slice(0, 500_000) };
    } finally {
      await parser.destroy();
    }
  }

  const workspace = temporaryWorkspace();
  try {
    if (mode === "spreadsheet-cells") {
      const inspected = await inspectSpreadsheet(artifact, workspace, options);
      return { mode, artifact: presented, ...inspected };
    }
    const staged = stagedArtifactFile(artifact, workspace, options);
    const inspected = await editDocument(workspace, { file: path.basename(staged) });
    if (inspected.operation !== "inspect") {
      throw new ArtifactStoreError(500, "artifact_editor_inspect_failed", "The Office editor returned no blocks.");
    }
    return {
      mode,
      artifact: presented,
      blocks: inspected.blocks,
      truncated: inspected.truncated,
    };
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}

function validateExpectedVersion(artifact: ArtifactRow, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion !== artifact.current_version) {
    throw new ArtifactStoreError(
      409,
      "artifact_version_conflict",
      "This artifact changed after the editor opened. Reload it before saving.",
    );
  }
}

function validatePatches(value: ArtifactEditorPatch[]): ArtifactEditorPatch[] {
  if (!Array.isArray(value) || value.length > MAX_EDITOR_PATCHES) {
    throw new ArtifactStoreError(400, "artifact_editor_patches_invalid", "Too many document edits were submitted.");
  }
  return value.map((patch) => {
    if (
      !patch ||
      typeof patch.anchor !== "string" ||
      !patch.anchor ||
      typeof patch.text !== "string" ||
      patch.text.length > 100_000
    ) {
      throw new ArtifactStoreError(400, "artifact_editor_patch_invalid", "A document edit is invalid.");
    }
    return { anchor: patch.anchor, text: patch.text };
  });
}

async function importEditedOffice(
  artifact: ArtifactRow,
  workspace: string,
  filePath: string,
  options: ArtifactEditorStoreOptions,
  reviewWorkflow = "human-review",
): Promise<ArtifactRow> {
  if (!fs.existsSync(filePath)) {
    throw new ArtifactStoreError(
      500,
      "artifact_editor_output_missing",
      "The native document editor did not write its output file.",
    );
  }
  const previewFilePath = await writeNativePreview(workspace, filePath);
  return importArtifactVersion({
    artifact,
    authorizedRoot: workspace,
    filePath,
    previewFilePath,
    runId: artifact.originating_run_id,
    assistantMessageId: null,
    metadata: {
      lastEditedBy: "human",
      reviewWorkflow,
    },
    database: options.database,
    storageRoot: options.storageRoot,
  });
}

/**
 * Save a complete DOCX produced by GenOffice rather than reducing the edit to
 * extracted text-block patches. The existing artifact stays immutable and the
 * new package is imported as the next version after a conflict check.
 */
export async function saveArtifactOfficeBytes(
  artifact: ArtifactRow,
  expectedVersion: number,
  bytes: Uint8Array,
  options: ArtifactEditorStoreOptions = {},
): Promise<ArtifactRow> {
  validateExpectedVersion(artifact, expectedVersion);
  if (
    modeForRow(artifact) !== "office-blocks" ||
    artifact.renderer_id !== "document-file" ||
    path.extname(artifact.filename).toLowerCase() !== ".docx"
  ) {
    throw new ArtifactStoreError(
      422,
      "artifact_editor_docx_unsupported",
      "This artifact is not an editable Word document.",
    );
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_OFFICE_EDITOR_BYTES) {
    throw new ArtifactStoreError(
      413,
      "artifact_editor_docx_size",
      "The edited Word document is empty or too large.",
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ArtifactStoreError(
      400,
      "artifact_editor_docx_invalid",
      "The GenOffice editor returned an invalid Word document.",
    );
  }

  const workspace = temporaryWorkspace();
  try {
    const staged = path.join(workspace, path.basename(artifact.filename));
    fs.writeFileSync(staged, bytes);
    return await importEditedOffice(artifact, workspace, staged, options, "genoffice-docs");
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}

async function saveOfficeBlocks(
  artifact: ArtifactRow,
  patches: ArtifactEditorPatch[],
  options: ArtifactEditorStoreOptions,
): Promise<ArtifactRow> {
  const workspace = temporaryWorkspace();
  try {
    const source = stagedArtifactFile(artifact, workspace, options);
    const extension = path.extname(source);
    const output = `edited${extension}`;
    const result = await editDocument(workspace, {
      file: path.basename(source),
      output,
      title: artifact.title,
      patches,
    });
    if (result.operation !== "patch") {
      throw new ArtifactStoreError(422, "artifact_editor_no_changes", "No Office document changes were supplied.");
    }
    // Keep the workspace alive until preview generation and import have both
    // finished; returning the bare promise would run `finally` immediately.
    return await importEditedOffice(artifact, workspace, result.outputPath, options);
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}

async function saveSpreadsheetCells(
  artifact: ArtifactRow,
  patches: ArtifactEditorPatch[],
  options: ArtifactEditorStoreOptions,
): Promise<ArtifactRow> {
  const workspace = temporaryWorkspace();
  try {
    const { blocks } = await inspectSpreadsheet(artifact, workspace, options);
    const allowed = new Set(blocks.map((block) => block.anchor));
    for (const patch of patches) {
      if (!allowed.has(patch.anchor)) {
        throw new ArtifactStoreError(400, "artifact_editor_cell_invalid", "A spreadsheet cell is outside the editable range.");
      }
    }
    const source = path.join(workspace, path.basename(artifact.filename));
    const commands = patches.map((patch) => ({
      command: "set",
      path: patch.anchor,
      props: { value: patch.text },
    }));
    const result = await runOfficeCli(
      ["batch", source, "--commands", JSON.stringify(commands), "--json"],
      { cwd: workspace, timeoutMs: 90_000, env: OFFICE_EDITOR_ENV },
    );
    if (result.code !== 0 || result.timedOut) {
      throw new OfficeCliError(
        result.timedOut ? 504 : 422,
        "spreadsheet_edit_failed",
        result.stderr.trim() || result.stdout.trim() || "The spreadsheet edits could not be saved.",
      );
    }
    parseOfficeJson(result.stdout, "Spreadsheet editing");
    return await importEditedOffice(artifact, workspace, source, options);
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}

export async function saveArtifactEditor(input: {
  artifact: ArtifactRow;
  expectedVersion: number;
  content?: string;
  patches?: ArtifactEditorPatch[];
}, options: ArtifactEditorStoreOptions = {}): Promise<ArtifactRow> {
  validateExpectedVersion(input.artifact, input.expectedVersion);
  const mode = modeForRow(input.artifact);
  if (mode === "pdf") {
    throw new ArtifactStoreError(400, "artifact_editor_pdf_bytes_required", "PDF edits must be saved by the PDF editor.");
  }
  if (mode === "source") {
    if (typeof input.content !== "string") {
      throw new ArtifactStoreError(400, "artifact_editor_content_required", "Document content is required.");
    }
    const updated = updateArtifactContent({
      artifact: input.artifact,
      content: input.content,
      mode: "fork",
      runId: input.artifact.originating_run_id,
      assistantMessageId: null,
      metadata: { lastEditedBy: "human", reviewWorkflow: "human-review" },
      database: options.database,
      storageRoot: options.storageRoot,
    });
    const rendered = await renderArtifact({
      artifact: updated,
      runId: updated.originating_run_id,
      assistantMessageId: null,
      database: options.database,
      storageRoot: options.storageRoot,
    });
    if (rendered.status !== "ready") {
      throw new ArtifactStoreError(
        422,
        rendered.error_json ? "artifact_editor_render_failed" : "artifact_editor_render_incomplete",
        "The edited document could not be rendered. Its previous version is still available.",
      );
    }
    return rendered;
  }
  if (mode === "file-text") {
    if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > MAX_TEXT_EDITOR_BYTES) {
      throw new ArtifactStoreError(400, "artifact_editor_content_invalid", "Document content is missing or too large.");
    }
    const workspace = temporaryWorkspace();
    try {
      const staged = path.join(workspace, path.basename(input.artifact.filename));
      fs.writeFileSync(staged, input.content, "utf8");
      return importArtifactVersion({
        artifact: input.artifact,
        authorizedRoot: workspace,
        filePath: staged,
        runId: input.artifact.originating_run_id,
        assistantMessageId: null,
        metadata: { lastEditedBy: "human", reviewWorkflow: "human-review" },
        database: options.database,
        storageRoot: options.storageRoot,
      });
    } finally {
      removeTemporaryWorkspace(workspace);
    }
  }
  const patches = validatePatches(input.patches ?? []);
  if (!patches.length) {
    throw new ArtifactStoreError(422, "artifact_editor_no_changes", "Make at least one change before saving.");
  }
  return mode === "office-blocks"
    ? saveOfficeBlocks(input.artifact, patches, options)
    : saveSpreadsheetCells(input.artifact, patches, options);
}

export async function saveArtifactPdfBytes(
  artifact: ArtifactRow,
  bytes: Uint8Array,
  options: ArtifactEditorStoreOptions = {},
): Promise<ArtifactRow> {
  if (modeForRow(artifact) !== "pdf") {
    throw new ArtifactStoreError(422, "artifact_editor_pdf_unsupported", "This artifact is not an editable PDF file.");
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > 128 * 1024 * 1024) {
    throw new ArtifactStoreError(413, "artifact_editor_pdf_size", "The edited PDF is empty or too large.");
  }
  const workspace = temporaryWorkspace();
  try {
    const staged = path.join(workspace, path.basename(artifact.filename));
    fs.writeFileSync(staged, bytes);
    return importArtifactVersion({
      artifact,
      authorizedRoot: workspace,
      filePath: staged,
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      metadata: { lastEditedBy: "human", reviewWorkflow: "human-review-pdf" },
      database: options.database,
      storageRoot: options.storageRoot,
    });
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}
