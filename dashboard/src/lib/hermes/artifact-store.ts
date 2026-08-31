import crypto, { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimePortableRealpath,
} from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { withTransientFileOpenRetry } from "../resilient-fs.ts";
import { artifactRenderer } from "./artifact-renderers.ts";
import {
  ArtifactImportError,
  inspectArtifactImport,
} from "./artifact-import.ts";
import { isChatHighlight } from "../conversations/highlights.ts";
import { scrubbed } from "../watermarks/scrub-text.ts";
import { scrubFileInPlaceViaRuntime } from "../watermarks/scrub-file.ts";
import type { WatermarkRuntimeControl } from "../runtime-v2/watermark-job.ts";
import {
  renderMarkdownArtifactViaRuntime,
  type RuntimeV2OfficeControl,
} from "../office/runtime-v2.ts";
import {
  ARTIFACT_KINDS,
  type ArtifactEventType,
  type ArtifactKind,
  type ArtifactStatus,
  type PresentedArtifact,
  type PresentedArtifactEvent,
} from "./artifact-types.ts";

export const MAX_ARTIFACT_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

export interface ArtifactRow {
  id: string;
  user_id: number;
  runtime_session_id: number;
  hermes_session_id: string;
  conversation_id: number;
  conversation_public_id?: string;
  cluster_id: number | null;
  garden_slug?: string | null;
  originating_run_id: string;
  originating_message_id: number | null;
  /**
   * Response id used only by transcript presentation. A legacy Garden row can
   * have been rebound by an older startup backfill even though the artifact's
   * durable origin remains the original canonical response.
   */
  presentation_message_id?: number | null;
  originating_tool_call_id: string | null;
  source_surface: "dashboard_terminal" | "garden_chat";
  kind: ArtifactKind;
  renderer_id: string;
  title: string;
  filename: string;
  mime_type: string;
  status: ArtifactStatus;
  current_version: number;
  parent_artifact_id: string | null;
  source_skill: string | null;
  source_mcp_server: string | null;
  source_mcp_tool: string | null;
  source_hermes_tool: string | null;
  preview_location: string | null;
  output_location: string | null;
  byte_size: number | null;
  content_hash: string | null;
  metadata_json: string;
  highlight: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  previous_version_id: string | null;
  status: ArtifactStatus;
  source_location: string;
  preview_location: string | null;
  output_location: string | null;
  mime_type: string;
  byte_size: number | null;
  content_hash: string | null;
  metadata_json: string;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export class ArtifactStoreError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ArtifactStoreError";
    this.status = status;
    this.code = code;
  }
}

export interface CreateArtifactInput {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  runId: string;
  assistantMessageId: number | null;
  toolCallId?: string | null;
  surface: "dashboard_terminal" | "garden_chat";
  kind: ArtifactKind;
  rendererId: string;
  title: string;
  filename?: string;
  mimeType?: string;
  content: string;
  metadata?: Record<string, unknown>;
  parentArtifactId?: string | null;
  sourceSkill?: string | null;
  sourceMcpServer?: string | null;
  sourceMcpTool?: string | null;
  sourceHermesTool?: string | null;
  database?: Database.Database;
  storageRoot?: string;
}

export interface CreateImportedArtifactInput extends Omit<
  CreateArtifactInput,
  "rendererId" | "mimeType" | "content"
> {
  authorizedRoot: string;
  filePath: string;
  /**
   * Optional pre-rendered HTML preview for a binary format the store cannot
   * preview itself (a .docx/.pptx/.xlsx snapshot rendered by an external
   * tool). Must live inside the same authorized workspace as the file.
   */
  previewFilePath?: string | null;
  /**
   * An import is `ready` by default: the file exists, so the artifact is
   * finished the moment it is stored. `generating` is for the one case where
   * that is not true — a file adopted as the *starting point* of a run that
   * will publish the real version (the video editor takes the untouched source
   * this way). It renders as a loading card rather than as a result, which is
   * the honest reading while the run is still going, and it is what keeps a
   * failed run from leaving a finished-looking copy of its own input behind.
   */
  status?: Extract<ArtifactStatus, "ready" | "generating">;
  /**
   * Strip AI provenance metadata from the imported copy. On by default, because
   * the overwhelming majority of imports are files Breadboard just produced —
   * a generated image, an authored document — and those are exactly what the
   * user meant by wanting no watermarks on their own output.
   *
   * Pass `false` for a file Breadboard merely *fetched* on the user's behalf.
   * A downloaded paper's XMP carries its authors, DOI and license; stripping
   * that is not hygiene, it is destroying somebody else's bibliographic record.
   */
  scrubProvenance?: boolean;
  /** Cancellation/test seam for the Rust-owned automatic scrub job. */
  signal?: AbortSignal;
  watermarkRuntimeControl?: WatermarkRuntimeControl;
}

function storageRoot(configured?: string): string {
  const root = path.resolve(configured ?? path.join(dashboardDataDir(), "artifacts"));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeJson(value: unknown, fallback: Record<string, unknown> = {}): string {
  const clean = sanitizeMetadata(value);
  const serialized = JSON.stringify(clean);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw new ArtifactStoreError(413, "artifact_metadata_too_large", "Artifact metadata is too large.");
  }
  return serialized || JSON.stringify(fallback);
}

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 8_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/(?:secret|password|credential|authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token)/i.test(key)) continue;
    result[key.slice(0, 100)] = sanitizeMetadata(item, depth + 1);
  }
  return result;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function publicError(value: string | null): { code: string; message: string } | null {
  const parsed = parseObject(value);
  return typeof parsed.code === "string" && typeof parsed.message === "string"
    ? { code: parsed.code, message: parsed.message }
    : null;
}

/**
 * Every string that becomes artifact content passes through here — create,
 * update, append and the validated-publish path all call it — which makes it
 * the one place invisible-Unicode marks can be removed from written artifacts
 * without depending on each producer to remember.
 *
 * The scrub runs before the size check so the ceiling is measured against what
 * is actually stored, and it only ever removes invisible characters: no visible
 * character, no code, no math and no anchor is touched. See scrub-text.ts.
 */
function validateContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new ArtifactStoreError(400, "invalid_artifact_content", "Artifact content must be text for this renderer.");
  }
  const clean = scrubbed(content);
  if (Buffer.byteLength(clean, "utf8") > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new ArtifactStoreError(413, "artifact_too_large", `Artifact content exceeds ${MAX_ARTIFACT_CONTENT_BYTES} bytes.`);
  }
  return clean;
}

function sanitizeFilename(value: string | undefined, title: string, extension: string): string {
  const supplied = value?.trim();
  if (supplied && (supplied !== path.basename(supplied) || supplied.includes("..") || /[\\/\0]/.test(supplied))) {
    throw new ArtifactStoreError(400, "invalid_artifact_filename", "Artifact filenames may not contain paths or traversal segments.");
  }
  const fallback = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "artifact";
  const base = (supplied ? path.parse(supplied).name : fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 100) || "artifact";
  return `${base}${extension}`;
}

function artifactRelativeDirectory(userId: number, artifactId: string, version: number): string {
  return path.posix.join(String(userId), artifactId, `v${version}`);
}

function resolveStoredPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0")) {
    throw new ArtifactStoreError(500, "invalid_artifact_storage", "Artifact storage metadata is invalid.");
  }
  const target = path.resolve(root, ...relative.split("/"));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ArtifactStoreError(500, "invalid_artifact_storage", "Artifact storage escaped its controlled root.");
  }
  return target;
}

function atomicWrite(target: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  if (typeof content === "string") fs.writeFileSync(temporary, content, "utf8");
  else fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
}

function atomicPromoteFile(source: string, target: string): void {
  const sourceMetadata = fs.lstatSync(source);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.size < 1) {
    throw new ArtifactStoreError(500, "artifact_stage_invalid", "The rendered artifact stage is unavailable.");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function hashFile(file: string): { byteSize: number; contentHash: string } {
  const content = fs.readFileSync(file);
  return { byteSize: content.byteLength, contentHash: crypto.createHash("sha256").update(content).digest("hex") };
}

function isDirectDurableFile(file: string): boolean {
  try {
    const metadata = fs.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) return false;
    const canonical = fs.realpathSync.native(file);
    const resolved = path.resolve(file);
    return process.platform === "win32"
      ? canonical.toLowerCase() === resolved.toLowerCase()
      : canonical === resolved;
  } catch {
    return false;
  }
}

function durableReadyArtifactAvailable(artifact: ArtifactRow, root: string): boolean {
  if (!artifact.output_location || !artifact.preview_location || !artifact.content_hash) return false;
  try {
    const output = resolveStoredPath(root, artifact.output_location);
    const preview = resolveStoredPath(root, artifact.preview_location);
    if (!isDirectDurableFile(output) || !isDirectDurableFile(preview)) return false;
    return hashFile(output).contentHash === artifact.content_hash;
  } catch {
    return false;
  }
}

export interface PublishValidatedArtifactVersionInput {
  artifact: ArtifactRow;
  version: number;
  expectedCurrentVersion: number;
  sourceContent: string;
  outputContent: string;
  metadata: Record<string, unknown>;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
  storageRoot?: string;
}

/**
 * Publish one already-validated artifact candidate without exposing a partial
 * version. Files are atomically written before the single database transaction
 * makes them current. Failed candidates never call this function.
 */
export function publishValidatedArtifactVersion(
  input: PublishValidatedArtifactVersionInput,
): ArtifactRow {
  const database = input.database ?? db;
  const root = storageRoot(input.storageRoot);
  const source = validateContent(input.sourceContent);
  const output = validateContent(input.outputContent);
  const relativeDirectory = artifactRelativeDirectory(
    input.artifact.user_id,
    input.artifact.id,
    input.version,
  );
  const sourceLocation = path.posix.join(relativeDirectory, "source.json");
  const outputLocation = path.posix.join(relativeDirectory, input.artifact.filename);
  const sourcePath = resolveStoredPath(root, sourceLocation);
  const outputPath = resolveStoredPath(root, outputLocation);
  atomicWrite(sourcePath, source);
  atomicWrite(outputPath, output);
  const { byteSize, contentHash } = hashFile(outputPath);
  const now = new Date().toISOString();
  const metadata = safeJson(input.metadata);
  const transaction = database.transaction(() => {
    const current = database.prepare(`
      SELECT current_version, status FROM hermes_artifacts WHERE id = ?
    `).get(input.artifact.id) as { current_version: number; status: ArtifactStatus } | undefined;
    if (!current || current.current_version !== input.expectedCurrentVersion) {
      throw new ArtifactStoreError(
        409,
        "artifact_version_conflict",
        "The artifact changed while this candidate was being validated.",
      );
    }
    const existing = database.prepare(`
      SELECT id FROM hermes_artifact_versions WHERE artifact_id = ? AND version = ?
    `).get(input.artifact.id, input.version) as { id: string } | undefined;
    if (existing) {
      database.prepare(`
        UPDATE hermes_artifact_versions
        SET status = 'ready', source_location = ?, preview_location = ?,
            output_location = ?, mime_type = ?, byte_size = ?, content_hash = ?,
            metadata_json = ?, error_json = NULL, updated_at = ?
        WHERE artifact_id = ? AND version = ?
      `).run(
        sourceLocation,
        outputLocation,
        outputLocation,
        input.artifact.mime_type,
        byteSize,
        contentHash,
        metadata,
        now,
        input.artifact.id,
        input.version,
      );
    } else {
      const previous = database.prepare(`
        SELECT id FROM hermes_artifact_versions
        WHERE artifact_id = ? AND version = ?
      `).get(input.artifact.id, input.expectedCurrentVersion) as { id: string } | undefined;
      database.prepare(`
        INSERT INTO hermes_artifact_versions (
          id, artifact_id, version, previous_version_id, status, source_location,
          preview_location, output_location, mime_type, byte_size, content_hash,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `artv_${randomUUID()}`,
        input.artifact.id,
        input.version,
        previous?.id ?? null,
        sourceLocation,
        outputLocation,
        outputLocation,
        input.artifact.mime_type,
        byteSize,
        contentHash,
        metadata,
        now,
        now,
      );
      insertEvent(
        database,
        input.artifact.id,
        input.runId,
        input.artifact.conversation_id,
        input.artifact.cluster_id,
        input.assistantMessageId,
        "artifact.version_created",
        "ready",
        input.version,
        { previousVersion: input.expectedCurrentVersion },
      );
    }
    database.prepare(`
      UPDATE hermes_artifacts
      SET status = 'ready', current_version = ?, preview_location = ?,
          output_location = ?, mime_type = ?, byte_size = ?, content_hash = ?,
          metadata_json = ?, error_json = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      input.version,
      outputLocation,
      outputLocation,
      input.artifact.mime_type,
      byteSize,
      contentHash,
      metadata,
      now,
      input.artifact.id,
    );
    insertEvent(
      database,
      input.artifact.id,
      input.runId,
      input.artifact.conversation_id,
      input.artifact.cluster_id,
      input.assistantMessageId,
      "artifact.preview_ready",
      "ready",
      input.version,
      { mimeType: input.artifact.mime_type, renderer: input.artifact.renderer_id },
    );
    insertEvent(
      database,
      input.artifact.id,
      input.runId,
      input.artifact.conversation_id,
      input.artifact.cluster_id,
      input.assistantMessageId,
      "artifact.completed",
      "ready",
      input.version,
      { byteSize, contentHash },
    );
  });
  transaction.immediate();
  return getArtifactById(input.artifact.id, database)!;
}

export function activateArtifactVersion(input: {
  artifact: ArtifactRow;
  version: number;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
}): ArtifactRow {
  const database = input.database ?? db;
  const target = getArtifactVersion(input.artifact.id, input.version, database);
  if (
    target.status !== "ready" ||
    !target.preview_location ||
    !target.output_location ||
    !target.content_hash
  ) {
    throw new ArtifactStoreError(
      409,
      "artifact_version_not_ready",
      "Only a previously validated ready version can be restored.",
    );
  }
  const now = new Date().toISOString();
  const transaction = database.transaction(() => {
    database.prepare(`
      UPDATE hermes_artifacts
      SET status = 'ready', current_version = ?, preview_location = ?,
          output_location = ?, mime_type = ?, byte_size = ?, content_hash = ?,
          metadata_json = ?, error_json = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      target.version,
      target.preview_location,
      target.output_location,
      target.mime_type,
      target.byte_size,
      target.content_hash,
      target.metadata_json,
      now,
      input.artifact.id,
    );
    insertEvent(
      database,
      input.artifact.id,
      input.runId,
      input.artifact.conversation_id,
      input.artifact.cluster_id,
      input.assistantMessageId,
      "artifact.updated",
      "ready",
      target.version,
      { mode: "rollback", fromVersion: input.artifact.current_version },
    );
    insertEvent(
      database,
      input.artifact.id,
      input.runId,
      input.artifact.conversation_id,
      input.artifact.cluster_id,
      input.assistantMessageId,
      "artifact.completed",
      "ready",
      target.version,
      { rollback: true, contentHash: target.content_hash },
    );
  });
  transaction.immediate();
  return getArtifactById(input.artifact.id, database)!;
}

export function recordArtifactPipelineEvent(input: {
  artifact: ArtifactRow;
  runId: string;
  assistantMessageId: number | null;
  type: ArtifactEventType;
  status?: ArtifactStatus;
  version?: number;
  payload: Record<string, unknown>;
  database?: Database.Database;
}): void {
  insertEvent(
    input.database ?? db,
    input.artifact.id,
    input.runId,
    input.artifact.conversation_id,
    input.artifact.cluster_id,
    input.assistantMessageId,
    input.type,
    input.status ?? input.artifact.status,
    input.version ?? input.artifact.current_version,
    input.payload,
  );
}

function sourceExtension(rendererId: string): string {
  return rendererId === "interactive-visualizer" ||
    rendererId === "hardware-blueprint" ||
    rendererId === "vimax-production" ||
    rendererId === "vox-director-production" ||
    rendererId === "gadget"
    ? ".json"
    : rendererId === "html" || rendererId === "presentation-html"
      ? ".html"
      : rendererId === "text" || rendererId === "code"
        ? ".txt"
        : rendererId === "json"
          ? ".json"
          : rendererId === "csv"
            ? ".csv"
            : rendererId === "svg"
              ? ".svg"
        : ".md";
}

export function createArtifact(input: CreateArtifactInput): ArtifactRow {
  const database = input.database ?? db;
  const conversation = database.prepare(`
    SELECT user_id, surface, default_garden_id FROM conversations WHERE id = ?
  `).get(input.conversationId) as {
    user_id: number;
    surface: string;
    default_garden_id: number | null;
  } | undefined;
  if (
    !conversation || conversation.user_id !== input.userId ||
    conversation.surface !== input.surface ||
    !["dashboard_terminal", "garden_chat"].includes(conversation.surface) ||
    (input.surface === "garden_chat" && conversation.default_garden_id !== input.clusterId) ||
    (input.surface === "dashboard_terminal" && input.clusterId !== null)
  ) {
    throw new ArtifactStoreError(403, "artifact_conversation_scope_mismatch", "Artifact conversation scope is invalid.");
  }
  if (!ARTIFACT_KINDS.includes(input.kind)) {
    throw new ArtifactStoreError(400, "invalid_artifact_kind", "Artifact kind is not recognized.");
  }
  const renderer = artifactRenderer(input.rendererId);
  if (!renderer || renderer.kind !== input.kind) {
    throw new ArtifactStoreError(422, "renderer_unavailable", `Renderer ${input.rendererId} is not available for ${input.kind}.`);
  }
  if (input.mimeType && input.mimeType.toLowerCase() !== renderer.mimeType.toLowerCase()) {
    throw new ArtifactStoreError(400, "invalid_artifact_mime", `The MIME type must be ${renderer.mimeType}.`);
  }
  const content = validateContent(input.content);
  const title = input.title.trim().slice(0, 240);
  if (!title) throw new ArtifactStoreError(400, "artifact_title_required", "Artifact title is required.");
  const artifactId = `art_${randomUUID()}`;
  const versionId = `artv_${randomUUID()}`;
  const version = 1;
  const filename = sanitizeFilename(input.filename, title, renderer.extension);
  const relativeDirectory = artifactRelativeDirectory(input.userId, artifactId, version);
  const sourceLocation = path.posix.join(relativeDirectory, `source${sourceExtension(input.rendererId)}`);
  const root = storageRoot(input.storageRoot);
  atomicWrite(resolveStoredPath(root, sourceLocation), content);
  const now = new Date().toISOString();
  const metadata = safeJson(input.metadata ?? {});
  const transaction = database.transaction(() => {
    database.prepare(`
      INSERT INTO hermes_artifacts (
        id, user_id, runtime_session_id, hermes_session_id, conversation_id, cluster_id,
        originating_run_id, originating_message_id, originating_tool_call_id, source_surface,
        kind, renderer_id, title, filename, mime_type, status, current_version,
        parent_artifact_id, source_skill, source_mcp_server, source_mcp_tool,
        source_hermes_tool, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactId, input.userId, input.runtimeSessionId, input.hermesSessionId,
      input.conversationId, input.clusterId, input.runId, input.assistantMessageId,
      input.toolCallId ?? null, input.surface, input.kind, input.rendererId, title, filename,
      renderer.mimeType, input.parentArtifactId ?? null, input.sourceSkill ?? null,
      input.sourceMcpServer ?? null, input.sourceMcpTool ?? null,
      input.sourceHermesTool ?? "artifact_create", metadata, now, now,
    );
    database.prepare(`
      INSERT INTO hermes_artifact_versions (
        id, artifact_id, version, status, source_location, mime_type, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 1, 'generating', ?, ?, ?, ?, ?)
    `).run(versionId, artifactId, sourceLocation, renderer.mimeType, metadata, now, now);
    insertEvent(database, artifactId, input.runId, input.conversationId, input.clusterId,
      input.assistantMessageId, "artifact.created", "generating", version,
      { title, kind: input.kind, renderer: input.rendererId, filename });
  });
  transaction.immediate();
  return getArtifactById(artifactId, database)!;
}

/**
 * Copy one already-generated file from the server-authorized runtime root into
 * durable artifact storage. The caller supplies only a relative/contained path;
 * this function resolves real paths, rejects symlinks and traversal, verifies
 * file signatures, then publishes the copy atomically.
 */
export async function createImportedArtifact(
  input: CreateImportedArtifactInput,
): Promise<ArtifactRow> {
  const database = input.database ?? db;
  const conversation = database.prepare(`
    SELECT user_id, surface, default_garden_id FROM conversations WHERE id = ?
  `).get(input.conversationId) as {
    user_id: number;
    surface: string;
    default_garden_id: number | null;
  } | undefined;
  if (
    !conversation ||
    conversation.user_id !== input.userId ||
    conversation.surface !== input.surface ||
    !["dashboard_terminal", "garden_chat"].includes(conversation.surface) ||
    (input.surface === "garden_chat" &&
      conversation.default_garden_id !== input.clusterId) ||
    (input.surface === "dashboard_terminal" && input.clusterId !== null)
  ) {
    throw new ArtifactStoreError(
      403,
      "artifact_conversation_scope_mismatch",
      "Artifact conversation scope is invalid.",
    );
  }
  if (!ARTIFACT_KINDS.includes(input.kind)) {
    throw new ArtifactStoreError(
      400,
      "invalid_artifact_kind",
      "Artifact kind is not recognized.",
    );
  }

  let authorizedRoot: string;
  let sourcePath: string;
  try {
    authorizedRoot = withTransientFileOpenRetry(() =>
      externalRuntimePortableRealpath(path.resolve(input.authorizedRoot)));
    const requested = path.isAbsolute(input.filePath)
      ? path.resolve(input.filePath)
      : path.resolve(authorizedRoot, input.filePath);
    if (withTransientFileOpenRetry(() => fs.lstatSync(requested)).isSymbolicLink()) {
      throw new ArtifactStoreError(
        400,
        "artifact_import_symlink",
        "Symbolic links cannot be imported as artifacts.",
      );
    }
    sourcePath = withTransientFileOpenRetry(() => externalRuntimePortableRealpath(requested));
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError(
      404,
      "artifact_import_not_found",
      "The generated file was not found in the authorized workspace.",
    );
  }
  const relativeSource = path.relative(authorizedRoot, sourcePath);
  if (
    !relativeSource ||
    relativeSource.startsWith("..") ||
    path.isAbsolute(relativeSource)
  ) {
    throw new ArtifactStoreError(
      403,
      "artifact_import_outside_workspace",
      "Artifacts can only be imported from the authorized workspace.",
    );
  }

  let previewSourcePath: string | null = null;
  if (input.previewFilePath) {
    try {
      const requested = path.isAbsolute(input.previewFilePath)
        ? path.resolve(input.previewFilePath)
        : path.resolve(authorizedRoot, input.previewFilePath);
      if (withTransientFileOpenRetry(() => fs.lstatSync(requested)).isSymbolicLink()) {
        throw new ArtifactStoreError(
          400,
          "artifact_import_symlink",
          "Symbolic links cannot be imported as artifacts.",
        );
      }
      previewSourcePath = withTransientFileOpenRetry(() =>
        externalRuntimePortableRealpath(requested));
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError(
        404,
        "artifact_import_not_found",
        "The preview file was not found in the authorized workspace.",
      );
    }
    const relativePreview = path.relative(authorizedRoot, previewSourcePath);
    if (
      !relativePreview ||
      relativePreview.startsWith("..") ||
      path.isAbsolute(relativePreview)
    ) {
      throw new ArtifactStoreError(
        403,
        "artifact_import_outside_workspace",
        "Artifacts can only be imported from the authorized workspace.",
      );
    }
    const previewStat = fs.statSync(previewSourcePath);
    if (!previewStat.isFile() || previewStat.size <= 0 || previewStat.size > 16 * 1024 * 1024) {
      throw new ArtifactStoreError(
        422,
        "artifact_import_preview_invalid",
        "The preview must be a non-empty HTML file of at most 16 MiB.",
      );
    }
    const previewHead = Buffer.alloc(Math.min(4_096, previewStat.size));
    const previewDescriptor = fs.openSync(previewSourcePath, "r");
    try {
      fs.readSync(previewDescriptor, previewHead, 0, previewHead.length, 0);
    } finally {
      fs.closeSync(previewDescriptor);
    }
    if (
      previewHead.includes(0) ||
      !/<(?:!doctype\s+html|html|head|body|div|table|svg)[\s>]/i.test(previewHead.toString("utf8"))
    ) {
      throw new ArtifactStoreError(
        422,
        "artifact_import_preview_invalid",
        "The preview must be an HTML document.",
      );
    }
  }

  let inspected;
  try {
    inspected = inspectArtifactImport(sourcePath, input.kind);
  } catch (error) {
    if (error instanceof ArtifactImportError) {
      throw new ArtifactStoreError(422, error.code, error.message);
    }
    throw error;
  }
  const renderer = artifactRenderer(inspected.rendererId);
  if (!renderer || renderer.kind !== input.kind) {
    throw new ArtifactStoreError(
      422,
      "renderer_unavailable",
      `The ${input.kind} import profile is unavailable.`,
    );
  }
  const title = input.title.trim().slice(0, 240);
  if (!title) {
    throw new ArtifactStoreError(
      400,
      "artifact_title_required",
      "Artifact title is required.",
    );
  }
  const artifactId = `art_${randomUUID()}`;
  const versionId = `artv_${randomUUID()}`;
  const filename = sanitizeFilename(
    input.filename ?? path.basename(sourcePath),
    title,
    inspected.extension,
  );
  const relativeDirectory = artifactRelativeDirectory(
    input.userId,
    artifactId,
    1,
  );
  const sourceLocation = path.posix.join(relativeDirectory, "source.json");
  const outputLocation = path.posix.join(relativeDirectory, filename);
  const previewLocation = inspected.previewAvailable
    ? outputLocation
    : previewSourcePath
      ? path.posix.join(relativeDirectory, "preview.html")
      : null;
  const root = storageRoot(input.storageRoot);
  const storedSourcePath = resolveStoredPath(root, sourceLocation);
  const storedOutputPath = resolveStoredPath(root, outputLocation);
  atomicWrite(
    storedSourcePath,
    JSON.stringify({
      importedFilename: path.basename(sourcePath),
      kind: input.kind,
      mimeType: inspected.mimeType,
    }),
  );
  fs.mkdirSync(path.dirname(storedOutputPath), { recursive: true });
  const temporary = `${storedOutputPath}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
  // Scrub the staged copy, never the caller's original: the source may be a
  // file in the user's own workspace that they still want as it was. Doing it
  // before the rename also means the verification below runs on the bytes that
  // will actually be stored, so a scrub that somehow changed the format is
  // caught here rather than shipped.
  if (input.scrubProvenance !== false) {
    await scrubFileInPlaceViaRuntime(temporary, {
      scope: {
        userId: input.userId,
        gardenId: input.clusterId === null ? null : String(input.clusterId),
        conversationId: String(input.conversationId),
      },
      signal: input.signal,
      control: input.watermarkRuntimeControl,
    });
  }
  fs.renameSync(temporary, storedOutputPath);
  try {
    const copied = inspectArtifactImport(storedOutputPath, input.kind);
    if (
      copied.rendererId !== inspected.rendererId ||
      copied.mimeType !== inspected.mimeType
    ) {
      throw new ArtifactStoreError(
        409,
        "artifact_import_changed",
        "The generated file changed while it was being imported.",
      );
    }
  } catch (error) {
    if (fs.existsSync(storedOutputPath)) fs.rmSync(storedOutputPath);
    if (error instanceof ArtifactStoreError) throw error;
    if (error instanceof ArtifactImportError) {
      throw new ArtifactStoreError(422, error.code, error.message);
    }
    throw error;
  }
  if (previewSourcePath && previewLocation && previewLocation !== outputLocation) {
    try {
      atomicWrite(
        resolveStoredPath(root, previewLocation),
        fs.readFileSync(previewSourcePath),
      );
    } catch (error) {
      if (fs.existsSync(storedOutputPath)) fs.rmSync(storedOutputPath);
      throw error;
    }
  }
  const { byteSize, contentHash } = hashFile(storedOutputPath);
  const now = new Date().toISOString();
  const metadata = safeJson({
    ...(input.metadata ?? {}),
    imported: true,
    importFormat: inspected.extension.slice(1),
  });
  // The status belongs to the artifact, not to this version: version one holds
  // a real, complete file either way, and saying otherwise would make a
  // rollback to it look like a rollback to something unfinished.
  const status = input.status ?? "ready";
  const transaction = database.transaction(() => {
    database.prepare(`
      INSERT INTO hermes_artifacts (
        id, user_id, runtime_session_id, hermes_session_id, conversation_id,
        cluster_id, originating_run_id, originating_message_id,
        originating_tool_call_id, source_surface, kind, renderer_id, title,
        filename, mime_type, status, current_version, parent_artifact_id,
        source_skill, source_mcp_server, source_mcp_tool,
        source_hermes_tool, preview_location, output_location, byte_size,
        content_hash, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactId,
      input.userId,
      input.runtimeSessionId,
      input.hermesSessionId,
      input.conversationId,
      input.clusterId,
      input.runId,
      input.assistantMessageId,
      input.toolCallId ?? null,
      input.surface,
      input.kind,
      inspected.rendererId,
      title,
      filename,
      inspected.mimeType,
      status,
      input.parentArtifactId ?? null,
      input.sourceSkill ?? null,
      input.sourceMcpServer ?? null,
      input.sourceMcpTool ?? null,
      input.sourceHermesTool ?? "artifact_import",
      previewLocation,
      outputLocation,
      byteSize,
      contentHash,
      metadata,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO hermes_artifact_versions (
        id, artifact_id, version, status, source_location, preview_location,
        output_location, mime_type, byte_size, content_hash, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, 1, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      artifactId,
      sourceLocation,
      previewLocation,
      outputLocation,
      inspected.mimeType,
      byteSize,
      contentHash,
      metadata,
      now,
      now,
    );
    insertEvent(
      database,
      artifactId,
      input.runId,
      input.conversationId,
      input.clusterId,
      input.assistantMessageId,
      "artifact.created",
      status,
      1,
      {
        title,
        kind: input.kind,
        renderer: inspected.rendererId,
        filename,
        imported: true,
      },
    );
    if (previewLocation) {
      insertEvent(
        database,
        artifactId,
        input.runId,
        input.conversationId,
        input.clusterId,
        input.assistantMessageId,
        "artifact.preview_ready",
        "ready",
        1,
        { mimeType: inspected.mimeType },
      );
    }
    insertEvent(
      database,
      artifactId,
      input.runId,
      input.conversationId,
      input.clusterId,
      input.assistantMessageId,
      "artifact.completed",
      "ready",
      1,
      { byteSize, contentHash, imported: true },
    );
  });
  try {
    transaction.immediate();
  } catch (error) {
    try {
      fs.rmSync(path.dirname(storedOutputPath), {
        recursive: true,
        force: true,
      });
    } catch {
      // The failed DB transaction is the authoritative state.
    }
    throw error;
  }
  return getArtifactById(artifactId, database)!;
}

export interface ImportArtifactVersionInput {
  artifact: ArtifactRow;
  /** The workspace the file must live inside. Nothing outside it is read. */
  authorizedRoot: string;
  filePath: string;
  /** Optional HTML snapshot for Office formats whose bytes are not browser-renderable. */
  previewFilePath?: string | null;
  runId: string;
  assistantMessageId: number | null;
  /** Merged over the artifact's existing metadata, as an update would be. */
  metadata?: Record<string, unknown>;
  /** Replaces the artifact's title when the new version is of something else. */
  title?: string;
  /** As on an import: off only for a file Breadboard fetched rather than made. */
  scrubProvenance?: boolean;
  signal?: AbortSignal;
  watermarkRuntimeControl?: WatermarkRuntimeControl;
  database?: Database.Database;
  storageRoot?: string;
}

/**
 * Publish a new version of an *imported* artifact from a file on disk.
 *
 * `updateArtifactContent` cannot do this: it round-trips through a string,
 * which is right for a renderer that owns its source and wrong for anything
 * whose source is bytes. A re-rendered video is a new version of the same
 * artifact — same id, same conversation, same place in the transcript, one more
 * entry in its history — and without this it would have had to become a new
 * artifact each time, scattering one video across a dozen cards.
 *
 * The file is copied and hashed in a stream rather than read whole: media
 * versions are hundreds of megabytes, and the buffered path would hold all of
 * it in memory for the length of the copy.
 */
export async function importArtifactVersion(input: ImportArtifactVersionInput): Promise<ArtifactRow> {
  const database = input.database ?? db;
  const artifact = input.artifact;
  if (artifact.status === "archived") {
    throw new ArtifactStoreError(409, "artifact_archived", "Archived artifacts cannot be changed.");
  }

  let authorizedRoot: string;
  let sourcePath: string;
  try {
    authorizedRoot = withTransientFileOpenRetry(() =>
      externalRuntimePortableRealpath(path.resolve(input.authorizedRoot)));
    const requested = path.isAbsolute(input.filePath)
      ? path.resolve(input.filePath)
      : path.resolve(authorizedRoot, input.filePath);
    if (withTransientFileOpenRetry(() => fs.lstatSync(requested)).isSymbolicLink()) {
      throw new ArtifactStoreError(
        400,
        "artifact_import_symlink",
        "Symbolic links cannot be imported as artifacts.",
      );
    }
    sourcePath = withTransientFileOpenRetry(() => externalRuntimePortableRealpath(requested));
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError(
      404,
      "artifact_import_not_found",
      "The generated file was not found in the authorized workspace.",
    );
  }
  const relativeSource = path.relative(authorizedRoot, sourcePath);
  if (!relativeSource || relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    throw new ArtifactStoreError(
      403,
      "artifact_import_outside_workspace",
      "Artifacts can only be imported from the authorized workspace.",
    );
  }

  let previewSourcePath: string | null = null;
  if (input.previewFilePath) {
    try {
      const requested = path.isAbsolute(input.previewFilePath)
        ? path.resolve(input.previewFilePath)
        : path.resolve(authorizedRoot, input.previewFilePath);
      if (withTransientFileOpenRetry(() => fs.lstatSync(requested)).isSymbolicLink()) {
        throw new ArtifactStoreError(
          400,
          "artifact_import_symlink",
          "Symbolic links cannot be imported as artifacts.",
        );
      }
      previewSourcePath = withTransientFileOpenRetry(() =>
        externalRuntimePortableRealpath(requested));
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError(
        404,
        "artifact_import_not_found",
        "The preview file was not found in the authorized workspace.",
      );
    }
    const relativePreview = path.relative(authorizedRoot, previewSourcePath);
    const previewStat = fs.statSync(previewSourcePath);
    if (
      !relativePreview ||
      relativePreview.startsWith("..") ||
      path.isAbsolute(relativePreview) ||
      !previewStat.isFile() ||
      previewStat.size <= 0 ||
      previewStat.size > 16 * 1024 * 1024
    ) {
      throw new ArtifactStoreError(
        422,
        "artifact_import_preview_invalid",
        "The preview must be a non-empty HTML file inside the workspace and at most 16 MiB.",
      );
    }
    const head = fs.readFileSync(previewSourcePath).subarray(0, 4_096);
    if (
      head.includes(0) ||
      !/<(?:!doctype\s+html|html|head|body|div|table|svg)[\s>]/i.test(head.toString("utf8"))
    ) {
      throw new ArtifactStoreError(422, "artifact_import_preview_invalid", "The preview must be an HTML document.");
    }
  }

  let inspected;
  try {
    inspected = inspectArtifactImport(sourcePath, artifact.kind);
  } catch (error) {
    if (error instanceof ArtifactImportError) {
      throw new ArtifactStoreError(422, error.code, error.message);
    }
    throw error;
  }
  if (inspected.rendererId !== artifact.renderer_id) {
    throw new ArtifactStoreError(
      422,
      "artifact_version_format_changed",
      "A new version has to be the same kind of file as the artifact it replaces.",
    );
  }

  // The next version is one past the *highest* version, not one past the
  // current one. After a rollback those differ, and reusing a number that
  // already exists would collide with the row it belongs to — losing the
  // version someone rolled back from, which is the one they may want again.
  const highestVersion =
    (database.prepare(`
      SELECT MAX(version) AS version FROM hermes_artifact_versions WHERE artifact_id = ?
    `).get(artifact.id) as { version: number | null } | undefined)?.version ??
    artifact.current_version;
  const nextVersion = Math.max(highestVersion, artifact.current_version) + 1;
  const root = storageRoot(input.storageRoot);
  const relativeDirectory = artifactRelativeDirectory(artifact.user_id, artifact.id, nextVersion);
  const sourceLocation = path.posix.join(relativeDirectory, "source.json");
  const outputLocation = path.posix.join(relativeDirectory, artifact.filename);
  const previewLocation = inspected.previewAvailable
    ? outputLocation
    : previewSourcePath
      ? path.posix.join(relativeDirectory, "preview.html")
      : null;
  const storedOutputPath = resolveStoredPath(root, outputLocation);

  atomicWrite(
    resolveStoredPath(root, sourceLocation),
    JSON.stringify({
      importedFilename: path.basename(sourcePath),
      kind: artifact.kind,
      mimeType: inspected.mimeType,
    }),
  );
  fs.mkdirSync(path.dirname(storedOutputPath), { recursive: true });
  const temporary = `${storedOutputPath}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
  // Same rule as the first import: scrub the staged copy, before the hash is
  // taken, so the recorded hash describes the bytes that were actually stored.
  if (input.scrubProvenance !== false) {
    await scrubFileInPlaceViaRuntime(temporary, {
      scope: {
        userId: artifact.user_id,
        gardenId: artifact.cluster_id === null ? null : String(artifact.cluster_id),
        conversationId: String(artifact.conversation_id),
      },
      signal: input.signal,
      control: input.watermarkRuntimeControl,
    });
  }
  fs.renameSync(temporary, storedOutputPath);

  if (previewSourcePath && previewLocation && previewLocation !== outputLocation) {
    atomicWrite(resolveStoredPath(root, previewLocation), fs.readFileSync(previewSourcePath));
  }

  const { byteSize, contentHash } = hashFileStreaming(storedOutputPath);
  const now = new Date().toISOString();
  const title = input.title?.trim().slice(0, 240) || artifact.title;
  const metadata = safeJson({
    ...parseObject(artifact.metadata_json),
    ...(input.metadata ?? {}),
  });

  const transaction = database.transaction(() => {
    const current = database.prepare(`
      SELECT current_version FROM hermes_artifacts WHERE id = ?
    `).get(artifact.id) as { current_version: number } | undefined;
    if (!current || current.current_version !== artifact.current_version) {
      throw new ArtifactStoreError(
        409,
        "artifact_version_conflict",
        "The artifact changed while this version was being rendered.",
      );
    }
    const previous = database.prepare(`
      SELECT id FROM hermes_artifact_versions WHERE artifact_id = ? AND version = ?
    `).get(artifact.id, artifact.current_version) as { id: string } | undefined;
    database.prepare(`
      INSERT INTO hermes_artifact_versions (
        id, artifact_id, version, previous_version_id, status, source_location,
        preview_location, output_location, mime_type, byte_size, content_hash,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `artv_${randomUUID()}`,
      artifact.id,
      nextVersion,
      previous?.id ?? null,
      sourceLocation,
      previewLocation,
      outputLocation,
      inspected.mimeType,
      byteSize,
      contentHash,
      metadata,
      now,
      now,
    );
    database.prepare(`
      UPDATE hermes_artifacts
      SET status = 'ready', current_version = ?, title = ?, preview_location = ?,
          output_location = ?, mime_type = ?, byte_size = ?, content_hash = ?,
          metadata_json = ?, error_json = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      nextVersion,
      title,
      previewLocation,
      outputLocation,
      inspected.mimeType,
      byteSize,
      contentHash,
      metadata,
      now,
      artifact.id,
    );
    insertEvent(database, artifact.id, input.runId, artifact.conversation_id,
      artifact.cluster_id, input.assistantMessageId, "artifact.version_created",
      "ready", nextVersion, { previousVersion: artifact.current_version, imported: true });
    insertEvent(database, artifact.id, input.runId, artifact.conversation_id,
      artifact.cluster_id, input.assistantMessageId, "artifact.completed",
      "ready", nextVersion, { byteSize, contentHash, imported: true });
  });

  try {
    transaction.immediate();
  } catch (error) {
    try {
      fs.rmSync(path.dirname(storedOutputPath), { recursive: true, force: true });
    } catch {
      // The failed DB transaction is the authoritative state.
    }
    throw error;
  }
  return getArtifactById(artifact.id, database)!;
}

function hashFileStreaming(file: string): { byteSize: number; contentHash: string } {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let byteSize = 0;
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      byteSize += read;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { byteSize, contentHash: hash.digest("hex") };
}

export function getArtifactById(id: string, database: Database.Database = db): ArtifactRow | null {
  const row = database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM hermes_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.id = ?
  `).get(id) as ArtifactRow | undefined;
  return row ?? null;
}

export function hasReadyArtifactForRun(input: {
  runId: string;
  conversationId: number;
  assistantClientMessageId: string;
  kind: string;
  rendererId: string;
  sourceSkill: string;
  readyEventType: string;
  previewRequired?: boolean;
  database?: Database.Database;
}): boolean {
  const database = input.database ?? db;
  const row = database.prepare(`
    SELECT 1
    FROM hermes_artifacts AS artifact
    JOIN hermes_artifact_events AS event
      ON event.artifact_id = artifact.id
      AND event.version = artifact.current_version
    JOIN conversation_messages AS message
      ON message.id = event.assistant_message_id
    WHERE event.run_id = ?
      AND event.event_type = ?
      AND event.status = 'ready'
      AND message.conversation_id = ?
      AND message.client_message_id = ?
      AND artifact.status = 'ready'
      AND artifact.kind = ?
      AND artifact.renderer_id = ?
      AND artifact.source_skill = ?
      AND (? = 0 OR (
        artifact.preview_location IS NOT NULL
        AND artifact.preview_location <> ''
      ))
    LIMIT 1
  `).get(
    input.runId,
    input.readyEventType,
    input.conversationId,
    input.assistantClientMessageId,
    input.kind,
    input.rendererId,
    input.sourceSkill,
    input.previewRequired === true ? 1 : 0,
  );
  return Boolean(row);
}

export function getArtifactForUser(input: {
  artifactId: string;
  userId: number;
  conversationPublicId: string;
  database?: Database.Database;
}): ArtifactRow {
  const database = input.database ?? db;
  const row = database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM hermes_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.id = ? AND a.user_id = ? AND c.public_id = ?
      AND c.surface IN ('dashboard_terminal','garden_chat')
      AND a.source_surface IN ('dashboard_terminal','garden_chat')
  `).get(input.artifactId, input.userId, input.conversationPublicId) as ArtifactRow | undefined;
  if (!row) throw new ArtifactStoreError(404, "artifact_not_found", "Artifact not found.");
  return row;
}

export function listArtifactsForUser(input: {
  userId: number;
  conversationPublicId?: string;
  gardenSlug?: string;
  sourceSurface?: ArtifactRow["source_surface"];
  database?: Database.Database;
}): ArtifactRow[] {
  const database = input.database ?? db;
  if (!input.conversationPublicId && !input.gardenSlug && !input.sourceSurface) {
    throw new ArtifactStoreError(400, "artifact_scope_required", "A conversation, Garden, or surface scope is required.");
  }
  const artifacts = database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM hermes_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.user_id = ?
      AND c.surface IN ('dashboard_terminal','garden_chat')
      AND a.source_surface IN ('dashboard_terminal','garden_chat')
      AND (? IS NULL OR c.public_id = ?)
      AND (? IS NULL OR cl.slug = ?)
      AND (? IS NULL OR (c.surface = ? AND a.source_surface = ?))
    ORDER BY a.updated_at DESC, a.id DESC
  `).all(
    input.userId,
    input.conversationPublicId ?? null, input.conversationPublicId ?? null,
    input.gardenSlug ?? null, input.gardenSlug ?? null,
    input.sourceSurface ?? null, input.sourceSurface ?? null, input.sourceSurface ?? null,
  ) as ArtifactRow[];
  return input.conversationPublicId
    ? reconcileLegacyGardenArtifactOwners(artifacts, database)
    : artifacts;
}

const LEGACY_ARTIFACT_OWNER_MATCH_MS = 5 * 60 * 1_000;

function storedTimestampMs(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

/**
 * Recover the response id that the Garden transcript currently presents.
 *
 * Older builds recopied a compatibility `chat_messages` row each time its id
 * changed, replacing a perfectly valid canonical binding with a duplicate.
 * Artifact ownership itself remains immutable; this alias only lets the card
 * follow the equivalent, currently visible response until those old rows age
 * out of local data.
 */
function reconcileLegacyGardenArtifactOwners(
  artifacts: ArtifactRow[],
  database: Database.Database,
): ArtifactRow[] {
  const candidates = artifacts.filter(
    (artifact) =>
      artifact.source_surface === "garden_chat" &&
      artifact.originating_message_id !== null,
  );
  if (candidates.length === 0) return artifacts;

  const conversationIds = Array.from(
    new Set(candidates.map((artifact) => artifact.conversation_id)),
  );
  const ownerIds = Array.from(
    new Set(
      candidates.flatMap((artifact) =>
        artifact.originating_message_id === null
          ? []
          : [artifact.originating_message_id],
      ),
    ),
  );
  const conversationSlots = conversationIds.map(() => "?").join(",");
  const ownerSlots = ownerIds.map(() => "?").join(",");
  const visible = database.prepare(`
    SELECT session.conversation_id, legacy.canonical_message_id,
           legacy.content, legacy.created_at
    FROM chat_messages AS legacy
    JOIN chat_sessions AS session ON session.id = legacy.session_id
    JOIN conversation_messages AS canonical
      ON canonical.id = legacy.canonical_message_id
    WHERE session.conversation_id IN (${conversationSlots})
      AND legacy.role = 'assistant'
      AND canonical.role = 'assistant'
      AND canonical.conversation_id = session.conversation_id
  `).all(...conversationIds) as Array<{
    conversation_id: number;
    canonical_message_id: number;
    content: string;
    created_at: string;
  }>;
  const owners = database.prepare(`
    SELECT id, conversation_id, content, created_at
    FROM conversation_messages
    WHERE id IN (${ownerSlots}) AND role = 'assistant'
  `).all(...ownerIds) as Array<{
    id: number;
    conversation_id: number;
    content: string;
    created_at: string;
  }>;

  const visibleIds = new Set(visible.map((message) => message.canonical_message_id));
  const ownerById = new Map(owners.map((message) => [message.id, message]));
  return artifacts.map((artifact) => {
    const ownerId = artifact.originating_message_id;
    if (ownerId === null || visibleIds.has(ownerId)) return artifact;
    const owner = ownerById.get(ownerId);
    if (!owner) return artifact;
    const ownerTime = storedTimestampMs(owner.created_at);
    const replacement = visible
      .filter(
        (message) =>
          message.conversation_id === owner.conversation_id &&
          message.content === owner.content,
      )
      .map((message) => ({
        message,
        distance: Math.abs(storedTimestampMs(message.created_at) - ownerTime),
      }))
      .filter((match) => Number.isFinite(match.distance))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!replacement || replacement.distance > LEGACY_ARTIFACT_OWNER_MATCH_MS) {
      return artifact;
    }
    return {
      ...artifact,
      presentation_message_id: replacement.message.canonical_message_id,
    };
  });
}

/**
 * Every ready image in the user's archive, newest first.
 *
 * Unlike `listArtifactsForUser` this takes no scope on purpose. It answers
 * "which of my pictures could I attach to this?" — a Socials Manager post is the case it
 * exists for — and a post is rarely written in the same chat that happens to
 * hold the artwork, so a conversation scope would hide most of the user's own
 * images from them. Ownership remains the only thing that grants access.
 */
export function listImageArtifactsForUser(input: {
  userId: number;
  limit?: number;
  database?: Database.Database;
}): ArtifactRow[] {
  const database = input.database ?? db;
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 200), 1), 500);
  return database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM hermes_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.user_id = ?
      AND c.surface IN ('dashboard_terminal','garden_chat')
      AND a.source_surface IN ('dashboard_terminal','garden_chat')
      AND a.kind IN ('image','diagram')
      AND a.status = 'ready'
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `).all(input.userId, limit) as ArtifactRow[];
}

export function listArtifactVersions(artifactId: string, database: Database.Database = db): ArtifactVersionRow[] {
  return database.prepare(`
    SELECT * FROM hermes_artifact_versions
    WHERE artifact_id = ? ORDER BY version DESC
  `).all(artifactId) as ArtifactVersionRow[];
}

export function getArtifactVersion(artifactId: string, version: number, database: Database.Database = db): ArtifactVersionRow {
  const row = database.prepare(`
    SELECT * FROM hermes_artifact_versions WHERE artifact_id = ? AND version = ?
  `).get(artifactId, version) as ArtifactVersionRow | undefined;
  if (!row) throw new ArtifactStoreError(404, "artifact_version_not_found", "Artifact version not found.");
  return row;
}

export function readArtifactSource(artifact: ArtifactRow, version = artifact.current_version, configuredRoot?: string, database: Database.Database = db): string {
  const row = getArtifactVersion(artifact.id, version, database);
  return fs.readFileSync(resolveStoredPath(storageRoot(configuredRoot), row.source_location), "utf8");
}

export interface ArtifactDeliveryFile {
  absolutePath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  /** True when this is the rendered output (a PDF, an image) rather than source. */
  rendered: boolean;
}

/**
 * The single file that best represents an artifact when it leaves Breadboard —
 * the rendered output where one exists, the source otherwise.
 *
 * This is the only sanctioned way to turn an artifact into a path an outbound
 * channel may read, which is why it resolves through the same controlled root
 * as every other read here instead of handing back whatever the row stored.
 */
export function artifactDeliveryFile(
  artifact: ArtifactRow,
  version = artifact.current_version,
  configuredRoot?: string,
  database: Database.Database = db,
): ArtifactDeliveryFile {
  const row = getArtifactVersion(artifact.id, version, database);
  const root = storageRoot(configuredRoot);
  const rendered = Boolean(row.output_location);
  const absolutePath = resolveStoredPath(root, row.output_location ?? row.source_location);
  let stats: Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    throw new ArtifactStoreError(
      404,
      "artifact_file_missing",
      "The artifact's file is no longer on disk.",
    );
  }
  if (!stats.isFile()) {
    throw new ArtifactStoreError(
      500,
      "invalid_artifact_storage",
      "Artifact storage does not point at a file.",
    );
  }
  return {
    absolutePath,
    filename: artifact.filename || path.basename(absolutePath),
    mimeType: (rendered ? artifact.mime_type : row.mime_type) || "application/octet-stream",
    byteSize: stats.size,
    rendered,
  };
}

export function updateArtifactContent(input: {
  artifact: ArtifactRow;
  content: string;
  mode: "replace" | "append" | "fork";
  runId: string;
  assistantMessageId: number | null;
  toolCallId?: string | null;
  metadata?: Record<string, unknown>;
  database?: Database.Database;
  storageRoot?: string;
}): ArtifactRow {
  const database = input.database ?? db;
  if (input.artifact.status === "archived") throw new ArtifactStoreError(409, "artifact_archived", "Archived artifacts cannot be changed.");
  const root = storageRoot(input.storageRoot);
  const existing = readArtifactSource(input.artifact, input.artifact.current_version, input.storageRoot, database);
  const nextContent = validateContent(input.mode === "append" ? `${existing}${input.content}` : input.content);
  const createVersion = input.mode === "fork" || input.artifact.status === "ready";
  const nextVersion = createVersion ? input.artifact.current_version + 1 : input.artifact.current_version;
  const previous = getArtifactVersion(input.artifact.id, input.artifact.current_version, database);
  const relativeDirectory = artifactRelativeDirectory(input.artifact.user_id, input.artifact.id, nextVersion);
  const sourceLocation = createVersion
    ? path.posix.join(relativeDirectory, `source${sourceExtension(input.artifact.renderer_id)}`)
    : previous.source_location;
  atomicWrite(resolveStoredPath(root, sourceLocation), nextContent);
  const now = new Date().toISOString();
  const metadata = safeJson({ ...parseObject(input.artifact.metadata_json), ...(input.metadata ?? {}) });
  const transaction = database.transaction(() => {
    if (createVersion) {
      database.prepare(`
        INSERT INTO hermes_artifact_versions (
          id, artifact_id, version, previous_version_id, status, source_location,
          mime_type, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'generating', ?, ?, ?, ?, ?)
      `).run(`artv_${randomUUID()}`, input.artifact.id, nextVersion, previous.id,
        sourceLocation, input.artifact.mime_type, metadata, now, now);
      insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
        input.artifact.cluster_id, input.assistantMessageId, "artifact.version_created",
        "generating", nextVersion, { previousVersion: input.artifact.current_version });
    } else {
      database.prepare(`
        UPDATE hermes_artifact_versions
        SET status = 'generating', preview_location = NULL, output_location = NULL,
            byte_size = NULL, content_hash = NULL, metadata_json = ?, error_json = NULL,
            updated_at = ? WHERE artifact_id = ? AND version = ?
      `).run(metadata, now, input.artifact.id, nextVersion);
    }
    database.prepare(`
      UPDATE hermes_artifacts
      SET status = 'generating', current_version = ?, preview_location = NULL,
          output_location = NULL, byte_size = NULL, content_hash = NULL,
          metadata_json = ?, error_json = NULL, updated_at = ? WHERE id = ?
    `).run(nextVersion, metadata, now, input.artifact.id);
    insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
      input.artifact.cluster_id, input.assistantMessageId, "artifact.updated", "generating",
      nextVersion, { mode: input.mode });
  });
  transaction.immediate();
  return getArtifactById(input.artifact.id, database)!;
}

async function renderArtifactInner(input: {
  artifact: ArtifactRow;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
  storageRoot?: string;
  signal?: AbortSignal;
  officeRuntimeControl?: RuntimeV2OfficeControl;
}): Promise<ArtifactRow> {
  const database = input.database ?? db;
  const renderer = artifactRenderer(input.artifact.renderer_id);
  if (!renderer) throw new ArtifactStoreError(422, "renderer_unavailable", `Renderer ${input.artifact.renderer_id} is unavailable.`);
  const version = getArtifactVersion(input.artifact.id, input.artifact.current_version, database);
  const content = readArtifactSource(input.artifact, version.version, input.storageRoot, database);
  const validation = await renderer.validate(content);
  if (!validation.ok) {
    return failArtifact(input.artifact, input.runId, input.assistantMessageId,
      "renderer_validation_failed", validation.error, database);
  }
  const root = storageRoot(input.storageRoot);
  const directory = path.dirname(resolveStoredPath(root, version.source_location));
  const now = new Date().toISOString();
  database.prepare(`UPDATE hermes_artifacts SET status = 'generating', updated_at = ? WHERE id = ?`).run(now, input.artifact.id);
  insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
    input.artifact.cluster_id, input.assistantMessageId, "artifact.rendering", "generating",
    version.version, { renderer: renderer.id });
  const runtimeStage = { cleanup: null as (() => void) | null };
  try {
    const metadata = parseObject(input.artifact.metadata_json);
    let rendered: { outputPath: string; previewPath: string; mimeType: string };
    if (renderer.id === "docx" || renderer.id === "pdf") {
      const rendererId = renderer.id;
      if (!input.artifact.conversation_public_id) {
        throw new ArtifactStoreError(
          403,
          "artifact_conversation_scope_mismatch",
          "The artifact conversation scope is unavailable.",
        );
      }
      const staged = await renderMarkdownArtifactViaRuntime(
        {
          userId: input.artifact.user_id,
          gardenId: input.artifact.garden_slug ?? null,
          conversationId: input.artifact.conversation_public_id,
        },
        {
          rendererId,
          content,
          filename: input.artifact.filename,
          title: input.artifact.title,
          metadata,
        },
        {
          idempotencySeed: `${input.artifact.id}:${version.version}:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`,
          signal: input.signal,
          control: input.officeRuntimeControl,
        },
      );
      runtimeStage.cleanup = staged.cleanup;
      const outputPath = path.join(directory, input.artifact.filename);
      const previewPath = rendererId === "docx"
        ? path.join(directory, "preview.html")
        : outputPath;
      atomicPromoteFile(staged.outputPath, outputPath);
      if (rendererId === "docx") atomicPromoteFile(staged.previewPath, previewPath);
      rendered = { outputPath, previewPath, mimeType: staged.mimeType };
    } else {
      rendered = await renderer.render(content, {
          directory,
          filename: input.artifact.filename,
          title: input.artifact.title,
          metadata,
        });
    }
    const outputRelative = path.relative(root, rendered.outputPath).split(path.sep).join("/");
    const previewRelative = path.relative(root, rendered.previewPath).split(path.sep).join("/");
    resolveStoredPath(root, outputRelative);
    resolveStoredPath(root, previewRelative);
    const { byteSize, contentHash } = hashFile(rendered.outputPath);
    const finish = database.transaction(() => {
      database.prepare(`
        UPDATE hermes_artifact_versions
        SET status = 'ready', preview_location = ?, output_location = ?, mime_type = ?,
            byte_size = ?, content_hash = ?, error_json = NULL, updated_at = ?
        WHERE artifact_id = ? AND version = ?
      `).run(previewRelative, outputRelative, rendered.mimeType, byteSize, contentHash,
        now, input.artifact.id, version.version);
      database.prepare(`
        UPDATE hermes_artifacts
        SET status = 'ready', preview_location = ?, output_location = ?, mime_type = ?,
            byte_size = ?, content_hash = ?, error_json = NULL, updated_at = ? WHERE id = ?
      `).run(previewRelative, outputRelative, rendered.mimeType, byteSize, contentHash,
        now, input.artifact.id);
      insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
        input.artifact.cluster_id, input.assistantMessageId, "artifact.preview_ready", "ready",
        version.version, { mimeType: rendered.mimeType });
      insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
        input.artifact.cluster_id, input.assistantMessageId, "artifact.completed", "ready",
        version.version, { byteSize, contentHash });
    });
    finish.immediate();
    await publishReadyArtifactToGarden(input.artifact.id, content, rendered.outputPath, database);
    return getArtifactById(input.artifact.id, database)!;
  } catch (error) {
    return failArtifact(input.artifact, input.runId, input.assistantMessageId,
      "artifact_render_failed", error instanceof Error ? error.message : "Rendering failed.", database);
  } finally {
    runtimeStage.cleanup?.();
  }
}

export function renderArtifact(input: {
  artifact: ArtifactRow;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
  storageRoot?: string;
  signal?: AbortSignal;
  officeRuntimeControl?: RuntimeV2OfficeControl;
}): Promise<ArtifactRow> {
  const database = input.database ?? db;
  const current = getArtifactById(input.artifact.id, database);
  if (current?.status === "ready") {
    const root = storageRoot(input.storageRoot);
    if (durableReadyArtifactAvailable(current, root)) return Promise.resolve(current);
  }
  // Office renderers (docx/pdf) run as Runtime V2 jobs and carry their own
  // admission inside renderMarkdownArtifactViaRuntime. Every other renderer is
  // a local validate-and-write of the stored source (see artifact-renderers.ts)
  // with no process to supervise, so nothing is leased here. The control
  // plane exposes no /v1/capabilities/<id>/lease route at all — a lease
  // attempt answered 404 and surfaced as an opaque 500 from artifact_render,
  // which is how HTML artifacts sat at "generating" forever.
  return renderArtifactInner(input);
}

/** Shallow-merges a metadata patch into an artifact (null values are removed). */
function mergeArtifactMetadata(
  database: Database.Database,
  artifactId: string,
  patch: Record<string, unknown>,
): void {
  const row = getArtifactById(artifactId, database);
  if (!row) return;
  const merged: Record<string, unknown> = { ...parseObject(row.metadata_json), ...patch };
  for (const key of Object.keys(merged)) {
    if (merged[key] === null || merged[key] === undefined) delete merged[key];
  }
  database.prepare(`UPDATE hermes_artifacts SET metadata_json = ?, updated_at = ? WHERE id = ?`)
    .run(safeJson(merged), new Date().toISOString(), artifactId);
}

// Mirrors a freshly rendered garden-chat artifact into the user's garden (best
// effort). Records where it landed in the artifact's metadata so the chat card
// can open a PDF in the full viewer and a delete can clean it up. Never throws.
async function publishReadyArtifactToGarden(
  artifactId: string,
  content: string,
  renderedFilePath: string,
  database: Database.Database,
): Promise<void> {
  const row = getArtifactById(artifactId, database);
  if (!row || row.status !== "ready" || row.source_surface !== "garden_chat" || !row.garden_slug) {
    return;
  }
  try {
    const { publishArtifactToGarden, isPublishableRenderer } = await import("./artifact-garden.ts");
    if (!isPublishableRenderer(row.renderer_id)) return;
    const existing = parseObject(row.metadata_json);
    const ref = await publishArtifactToGarden({
      userId: row.user_id,
      clusterSlug: row.garden_slug,
      artifactId: row.id,
      title: row.title,
      rendererId: row.renderer_id,
      markdownSource: content,
      renderedFilePath,
      existingSlug: typeof existing.gardenDocumentSlug === "string" ? existing.gardenDocumentSlug : undefined,
    });
    if (!ref) return;
    mergeArtifactMetadata(database, row.id, {
      gardenDocumentSlug: ref.documentSlug,
      gardenClusterSlug: ref.clusterSlug,
      gardenSourcePdf: ref.sourcePdf ?? null,
      gardenDownloadAsset: ref.downloadAsset ?? null,
      gardenOpenPath: ref.sourcePdf
        ? `/gardens/${ref.clusterSlug}/pdf/${ref.documentSlug}`
        : null,
    });
  } catch {
    // Publishing is best-effort; the artifact stays available in chat regardless.
  }
}

/**
 * The artifacts one turn produced.
 *
 * Deleting a transcript row would otherwise only clear the pointer back to it
 * (`ON DELETE SET NULL`), and an artifact with no owning message renders in the
 * unassigned pile at the end of the chat — so the file a deleted answer created
 * would not disappear, it would move.
 */
export function listArtifactIdsForMessages(
  messageIds: readonly number[],
  database: Database.Database = db,
): string[] {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT id FROM hermes_artifacts
       WHERE originating_message_id IN (${placeholders})`,
    )
    .all(...messageIds) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/**
 * Deletes an artifact the user owns: unpublishes any garden note/asset it
 * created (best effort), removes its stored files, and drops all DB rows.
 * Returns the presented artifact as it was before deletion.
 */
export async function deleteArtifact(input: {
  artifactId: string;
  userId: number;
  conversationPublicId: string;
  database?: Database.Database;
  storageRoot?: string;
}): Promise<PresentedArtifact> {
  const database = input.database ?? db;
  const artifact = getArtifactForUser({
    artifactId: input.artifactId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    database,
  });
  const metadata = parseObject(artifact.metadata_json);
  const presented = presentArtifact(artifact);

  if (
    artifact.source_surface === "garden_chat" &&
    artifact.garden_slug &&
    artifact.cluster_id !== null &&
    typeof metadata.gardenDocumentSlug === "string"
  ) {
    try {
      const { unpublishArtifactFromGarden } = await import("./artifact-garden.ts");
      await unpublishArtifactFromGarden({
        userId: input.userId,
        clusterId: artifact.cluster_id,
        clusterSlug: artifact.garden_slug,
        documentSlug: metadata.gardenDocumentSlug,
        sourcePdf: typeof metadata.gardenSourcePdf === "string" ? metadata.gardenSourcePdf : undefined,
        downloadAsset: typeof metadata.gardenDownloadAsset === "string" ? metadata.gardenDownloadAsset : undefined,
      });
    } catch {
      // The artifact is still removed from chat even if garden cleanup fails.
    }
  }

  // A parametric CAD design keeps its exports outside the artifact tree (six
  // files per revision, four of them binary), so deleting the artifact has to
  // take the project with it or the bytes would outlive everything that
  // referenced them.
  if (artifact.renderer_id === "parametric-cad" && typeof metadata.cadProjectId === "string") {
    try {
      const { deleteCadProject } = await import("../cad/project-store.ts");
      const { removeProjectFiles } = await import("../cad/blob-store.ts");
      deleteCadProject(metadata.cadProjectId, database);
      removeProjectFiles(metadata.cadProjectId);
    } catch {
      // The artifact is still removed from chat even if CAD cleanup fails.
    }
  }

  const remove = database.transaction(() => {
    database.prepare(`DELETE FROM hermes_artifact_events WHERE artifact_id = ?`).run(artifact.id);
    database.prepare(`DELETE FROM hermes_artifact_provenance WHERE artifact_id = ?`).run(artifact.id);
    database.prepare(`DELETE FROM hermes_artifact_versions WHERE artifact_id = ?`).run(artifact.id);
    database.prepare(`DELETE FROM hermes_artifacts WHERE id = ?`).run(artifact.id);
  });
  remove.immediate();

  try {
    const dir = resolveStoredPath(
      storageRoot(input.storageRoot),
      path.posix.join(String(artifact.user_id), artifact.id),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Stored files may already be gone; the DB rows are what matter for the UI.
  }

  return presented;
}

/**
 * Point an artifact at the assistant turn it belongs to, so the chat renders it
 * under that response instead of in the unassigned pile at the end. External
 * agents need this because they produce artifacts from a background run: the
 * owning turn is only resolvable once it exists, and a forked revision belongs
 * to the turn that asked for it rather than the one that first created it.
 */
export function setArtifactOriginatingMessage(input: {
  artifactId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
}): void {
  if (input.assistantMessageId === null) return;
  const database = input.database ?? db;
  database.prepare(`
    UPDATE hermes_artifacts
    SET originating_message_id = ?, updated_at = ?
    WHERE id = ?
  `).run(input.assistantMessageId, new Date().toISOString(), input.artifactId);
}

/**
 * Mark one artifact with a palette color, or clear it with null.
 *
 * Ownership is re-checked here rather than trusted from the caller, and the
 * write deliberately leaves updated_at alone: the archive is ordered by it, so
 * marking a months-old artifact must not push it back to the top of the list.
 */
export function setArtifactHighlight(input: {
  artifactId: string;
  userId: number;
  conversationPublicId: string;
  highlight: string | null;
  database?: Database.Database;
}): ArtifactRow {
  const database = input.database ?? db;
  const artifact = getArtifactForUser({
    artifactId: input.artifactId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    database,
  });
  database.prepare("UPDATE hermes_artifacts SET highlight = ? WHERE id = ?")
    .run(input.highlight, artifact.id);
  return getArtifactById(artifact.id, database)!;
}

function failArtifact(
  artifact: ArtifactRow,
  runId: string,
  assistantMessageId: number | null,
  code: string,
  message: string,
  database: Database.Database,
): ArtifactRow {
  const safeMessage = message.replace(/[A-Za-z]:[\\/][^\s]+|\/(?:home|Users)\/[^\s]+/gi, "[redacted path]").slice(0, 500);
  const error = JSON.stringify({ code, message: safeMessage });
  const now = new Date().toISOString();
  const transaction = database.transaction(() => {
    database.prepare(`UPDATE hermes_artifacts SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?`)
      .run(error, now, artifact.id);
    database.prepare(`UPDATE hermes_artifact_versions SET status = 'failed', error_json = ?, updated_at = ? WHERE artifact_id = ? AND version = ?`)
      .run(error, now, artifact.id, artifact.current_version);
    insertEvent(database, artifact.id, runId, artifact.conversation_id, artifact.cluster_id,
      assistantMessageId, "artifact.failed", "failed", artifact.current_version,
      { error: { code, message: safeMessage } });
  });
  transaction.immediate();
  return getArtifactById(artifact.id, database)!;
}

function insertEvent(
  database: Database.Database,
  artifactId: string,
  runId: string,
  conversationId: number,
  clusterId: number | null,
  assistantMessageId: number | null,
  type: ArtifactEventType,
  status: ArtifactStatus,
  version: number,
  payload: Record<string, unknown>,
): void {
  database.prepare(`
    INSERT INTO hermes_artifact_events (
      artifact_id, run_id, conversation_id, cluster_id, assistant_message_id,
      event_type, status, version, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(artifactId, runId, conversationId, clusterId, assistantMessageId,
    type, status, version, safeJson(payload), new Date().toISOString());
}

export function listArtifactEventsAfter(input: {
  runId: string;
  afterId: number;
  database?: Database.Database;
}): PresentedArtifactEvent[] {
  const database = input.database ?? db;
  const rows = database.prepare(`
    SELECT e.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM hermes_artifact_events e
    JOIN conversations c ON c.id = e.conversation_id
    LEFT JOIN clusters cl ON cl.id = e.cluster_id
    WHERE e.run_id = ? AND e.id > ?
    ORDER BY e.id LIMIT 500
  `).all(input.runId, input.afterId) as Array<{
    id: number; artifact_id: string; run_id: string; conversation_public_id: string;
    garden_slug: string | null; assistant_message_id: number | null; event_type: ArtifactEventType;
    status: ArtifactStatus; version: number; payload_json: string; created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    artifactId: row.artifact_id,
    runId: row.run_id,
    conversationId: row.conversation_public_id,
    gardenId: row.garden_slug,
    assistantMessageId: row.assistant_message_id === null ? null : `msg_${row.assistant_message_id}`,
    status: row.status,
    version: row.version,
    timestamp: row.created_at,
    payload: parseObject(row.payload_json),
  }));
}

export function presentArtifact(row: ArtifactRow): PresentedArtifact {
  const assistantMessageId = row.presentation_message_id === undefined
    ? row.originating_message_id
    : row.presentation_message_id;
  return {
    id: row.id,
    conversationId: row.conversation_public_id ?? "",
    gardenId: row.garden_slug ?? null,
    runId: row.originating_run_id,
    assistantMessageId: assistantMessageId === null ? null : `msg_${assistantMessageId}`,
    toolCallId: row.originating_tool_call_id,
    kind: row.kind,
    renderer: row.renderer_id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    status: row.status,
    version: row.current_version,
    parentArtifactId: row.parent_artifact_id,
    sourceSkill: row.source_skill,
    sourceMcpServer: row.source_mcp_server,
    sourceMcpTool: row.source_mcp_tool,
    sourceHermesTool: row.source_hermes_tool,
    previewAvailable: Boolean(row.preview_location),
    downloadAvailable: row.status === "ready" && Boolean(row.output_location),
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    metadata: parseObject(row.metadata_json),
    // A slug from an older palette presents as unmarked rather than as a color
    // the archive cannot paint.
    highlight: isChatHighlight(row.highlight) ? row.highlight : null,
    error: publicError(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function artifactFile(input: {
  artifact: ArtifactRow;
  version: number;
  purpose: "preview" | "download";
  database?: Database.Database;
  storageRoot?: string;
}): { path: string; mimeType: string; filename: string } {
  const version = getArtifactVersion(input.artifact.id, input.version, input.database ?? db);
  const location = input.purpose === "preview" ? version.preview_location : version.output_location;
  if (!location) throw new ArtifactStoreError(404, "artifact_file_unavailable", "This artifact file is not available.");
  const file = resolveStoredPath(storageRoot(input.storageRoot), location);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new ArtifactStoreError(404, "artifact_file_unavailable", "This artifact file is not available.");
  }
  const mimeType = input.purpose === "preview" && file.toLowerCase().endsWith(".html")
    ? "text/html; charset=utf-8"
    : version.mime_type;
  return { path: file, mimeType, filename: input.artifact.filename };
}

export function addArtifactProvenance(input: {
  artifactId: string;
  version: number;
  sourceKind: "mcp" | "skill" | "tool" | "resource";
  sourceServer?: string;
  sourceTool?: string;
  invocationId?: string;
  resourceMetadata?: Record<string, unknown>;
  database?: Database.Database;
}): void {
  const database = input.database ?? db;
  database.prepare(`
    INSERT INTO hermes_artifact_provenance (
      artifact_id, version, source_kind, source_server, source_tool,
      invocation_id, resource_metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.artifactId, input.version, input.sourceKind, input.sourceServer ?? null,
    input.sourceTool ?? null, input.invocationId ?? null,
    safeJson(input.resourceMetadata ?? {}), new Date().toISOString());
}

/** Attach the upstream Hermes call id once the normalized tool event arrives. */
export function associateArtifactToolCall(
  runId: string,
  toolName: string,
  toolCallId: string,
  database: Database.Database = db,
): void {
  if (!toolName.startsWith("artifact_")) return;
  const candidate = database.prepare(`
    SELECT id FROM hermes_artifacts
    WHERE originating_run_id = ? AND originating_tool_call_id IS NULL
      AND source_hermes_tool = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(runId, toolName) as { id: string } | undefined;
  if (candidate) {
    database.prepare(`UPDATE hermes_artifacts SET originating_tool_call_id = ? WHERE id = ?`)
      .run(toolCallId.slice(0, 200), candidate.id);
  }
}
