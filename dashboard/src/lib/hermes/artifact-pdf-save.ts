import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  ArtifactStoreError,
  importArtifactVersion,
  presentArtifact,
  type ArtifactRow,
} from "./artifact-store.ts";
import { artifactEditorMode } from "./artifact-editor-types.ts";

const MAX_PDF_EDITOR_BYTES = 128 * 1024 * 1024;

export interface ArtifactPdfSaveOptions {
  database?: Database.Database;
  storageRoot?: string;
}

/** Keep PDF writes independent from the Office and GenOffice editor graph. */
export async function saveArtifactPdfBytes(
  artifact: ArtifactRow,
  bytes: Uint8Array,
  options: ArtifactPdfSaveOptions = {},
): Promise<ArtifactRow> {
  if (artifactEditorMode(presentArtifact(artifact)) !== "pdf") {
    throw new ArtifactStoreError(
      422,
      "artifact_editor_pdf_unsupported",
      "This artifact is not an editable PDF file.",
    );
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PDF_EDITOR_BYTES) {
    throw new ArtifactStoreError(
      413,
      "artifact_editor_pdf_size",
      "The edited PDF is empty or too large.",
    );
  }

  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-artifact-editor-"),
  );
  try {
    const staged = path.join(workspace, path.basename(artifact.filename));
    fs.writeFileSync(staged, bytes);
    return importArtifactVersion({
      artifact,
      authorizedRoot: workspace,
      filePath: staged,
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      metadata: {
        lastEditedBy: "human",
        reviewWorkflow: "human-review-pdf",
      },
      database: options.database,
      storageRoot: options.storageRoot,
    });
  } finally {
    fs.rmSync(workspace, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      retryDelay: 100,
    });
  }
}
