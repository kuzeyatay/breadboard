import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { runOfficeCli } from "../office/officecli.ts";
import {
  ArtifactStoreError,
  importArtifactVersion,
  presentArtifact,
  type ArtifactRow,
} from "./artifact-store.ts";
import { artifactEditorMode } from "./artifact-editor-types.ts";

const MAX_OFFICE_EDITOR_BYTES = 128 * 1024 * 1024;
const OFFICE_EDITOR_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  OFFICECLI_NO_AUTO_RESIDENT: "1",
};

export interface ArtifactOfficeSaveOptions {
  database?: Database.Database;
  storageRoot?: string;
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

function validateExpectedVersion(
  artifact: ArtifactRow,
  expectedVersion: number,
): void {
  if (
    !Number.isInteger(expectedVersion) ||
    expectedVersion !== artifact.current_version
  ) {
    throw new ArtifactStoreError(
      409,
      "artifact_version_conflict",
      "This artifact changed after the editor opened. Reload it before saving.",
    );
  }
}

async function renderDocxPreview(
  workspace: string,
  filePath: string,
): Promise<string | null> {
  const previewFilePath = path.join(workspace, "editor-preview.html");
  try {
    const rendered = await runOfficeCli(
      ["view", filePath, "html", "-o", previewFilePath],
      { cwd: workspace, timeoutMs: 60_000, env: OFFICE_EDITOR_ENV },
    );
    if (
      rendered.code === 0 &&
      fs.existsSync(previewFilePath) &&
      fs.statSync(previewFilePath).size > 0
    ) {
      return previewFilePath;
    }
  } catch {
    // A preview is an enhancement. The edited DOCX remains downloadable even
    // when the local Office renderer is unavailable.
  }
  fs.rmSync(previewFilePath, { force: true });
  return null;
}

/**
 * Save the complete DOCX produced by GenOffice without importing the much
 * larger generic document-editor graph into the editor's read route.
 */
export async function saveArtifactOfficeBytes(
  artifact: ArtifactRow,
  expectedVersion: number,
  bytes: Uint8Array,
  options: ArtifactOfficeSaveOptions = {},
): Promise<ArtifactRow> {
  validateExpectedVersion(artifact, expectedVersion);
  if (
    artifactEditorMode(presentArtifact(artifact)) !== "office-blocks" ||
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
    const previewFilePath = await renderDocxPreview(workspace, staged);
    return importArtifactVersion({
      artifact,
      authorizedRoot: workspace,
      filePath: staged,
      previewFilePath,
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      metadata: {
        lastEditedBy: "human",
        reviewWorkflow: "genoffice-docs",
      },
      database: options.database,
      storageRoot: options.storageRoot,
    });
  } finally {
    removeTemporaryWorkspace(workspace);
  }
}
