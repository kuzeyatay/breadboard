import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type Database from "better-sqlite3";
import {
  editSpreadsheetViaRuntime,
  inspectSpreadsheetViaRuntime,
  prepareOfficeExportViaRuntime,
  runDocumentEditViaRuntime,
  type RuntimeOfficeWriteStaging,
  type RuntimeV2OfficeControl,
  type RuntimeV2OfficeScope,
} from "../office/runtime-v2.ts";
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
  signal?: AbortSignal;
  officeRuntimeControl?: RuntimeV2OfficeControl;
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

function deliveredArtifactFile(
  artifact: ArtifactRow,
  options: ArtifactEditorStoreOptions,
): string {
  return artifactDeliveryFile(
    artifact,
    artifact.current_version,
    options.storageRoot,
    options.database,
  ).absolutePath;
}

function officeRuntimeScope(artifact: ArtifactRow): RuntimeV2OfficeScope {
  if (!artifact.conversation_public_id) {
    throw new ArtifactStoreError(
      403,
      "artifact_conversation_scope_mismatch",
      "The artifact conversation scope is unavailable.",
    );
  }
  return {
    userId: artifact.user_id,
    gardenId: artifact.garden_slug ?? null,
    conversationId: artifact.conversation_public_id,
  };
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

async function inspectSpreadsheet(
  artifact: ArtifactRow,
  options: ArtifactEditorStoreOptions,
): Promise<{ blocks: ArtifactEditorBlock[]; truncated: boolean }> {
  return inspectSpreadsheetViaRuntime(
    officeRuntimeScope(artifact),
    deliveredArtifactFile(artifact, options),
    {
      idempotencySeed: `${artifact.id}:${artifact.current_version}:inspect-spreadsheet`,
      signal: options.signal,
      control: options.officeRuntimeControl,
    },
  );
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

  if (mode === "spreadsheet-cells") {
    const inspected = await inspectSpreadsheet(artifact, options);
    return { mode, artifact: presented, ...inspected };
  }
  const delivery = deliveredArtifactFile(artifact, options);
  const inspected = await runDocumentEditViaRuntime(
    officeRuntimeScope(artifact),
    path.dirname(delivery),
    { file: path.basename(delivery) },
    {
      idempotencySeed: `${artifact.id}:${artifact.current_version}:inspect-document`,
      signal: options.signal,
      control: options.officeRuntimeControl,
    },
  );
  if ("cleanup" in inspected || inspected.operation !== "inspect") {
    throw new ArtifactStoreError(500, "artifact_editor_inspect_failed", "The Office editor returned no blocks.");
  }
  return {
    mode,
    artifact: presented,
    blocks: inspected.blocks,
    truncated: inspected.truncated,
  };
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
  staged: Pick<RuntimeOfficeWriteStaging<unknown>, "filePath" | "previewFilePath" | "cleanup">,
  options: ArtifactEditorStoreOptions,
  reviewWorkflow = "human-review",
): Promise<ArtifactRow> {
  if (!fs.existsSync(staged.filePath)) {
    throw new ArtifactStoreError(
      500,
      "artifact_editor_output_missing",
      "The native document editor did not write its output file.",
    );
  }
  try {
    return await importArtifactVersion({
      artifact,
      authorizedRoot: path.dirname(staged.filePath),
      filePath: staged.filePath,
      previewFilePath: staged.previewFilePath,
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      metadata: {
        lastEditedBy: "human",
        reviewWorkflow,
      },
      database: options.database,
      storageRoot: options.storageRoot,
    });
  } finally {
    staged.cleanup();
  }
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
    const preview = await prepareOfficeExportViaRuntime(
      officeRuntimeScope(artifact),
      workspace,
      { file: path.basename(staged), title: artifact.title },
      {
        idempotencySeed: `${artifact.id}:${artifact.current_version}:genoffice-docs`,
        signal: options.signal,
        control: options.officeRuntimeControl,
      },
    );
    return await importEditedOffice(artifact, preview, options, "genoffice-docs");
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}

async function saveOfficeBlocks(
  artifact: ArtifactRow,
  patches: ArtifactEditorPatch[],
  options: ArtifactEditorStoreOptions,
): Promise<ArtifactRow> {
  const source = deliveredArtifactFile(artifact, options);
  const staged = await runDocumentEditViaRuntime(
    officeRuntimeScope(artifact),
    path.dirname(source),
    {
      file: path.basename(source),
      output: `edited${path.extname(source)}`,
      title: artifact.title,
      patches,
    },
    {
      idempotencySeed: `${artifact.id}:${artifact.current_version}:edit-document`,
      signal: options.signal,
      control: options.officeRuntimeControl,
    },
  );
  if (!("cleanup" in staged)) {
    throw new ArtifactStoreError(422, "artifact_editor_no_changes", "No Office document changes were supplied.");
  }
  return importEditedOffice(artifact, staged, options);
}

async function saveSpreadsheetCells(
  artifact: ArtifactRow,
  patches: ArtifactEditorPatch[],
  options: ArtifactEditorStoreOptions,
): Promise<ArtifactRow> {
  const source = deliveredArtifactFile(artifact, options);
  const staged = await editSpreadsheetViaRuntime(
    officeRuntimeScope(artifact),
    source,
    patches,
    {
      title: artifact.title,
      idempotencySeed: `${artifact.id}:${artifact.current_version}:edit-spreadsheet`,
      signal: options.signal,
      control: options.officeRuntimeControl,
    },
  );
  return importEditedOffice(artifact, staged, options);
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
      signal: options.signal,
      officeRuntimeControl: options.officeRuntimeControl,
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
      return await importArtifactVersion({
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
    return await importArtifactVersion({
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
