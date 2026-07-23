import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { artifactRenderer } from "./artifact-renderers.ts";
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
  openharness_session_id: string;
  conversation_id: number;
  conversation_public_id?: string;
  cluster_id: number | null;
  garden_slug?: string | null;
  originating_run_id: string;
  originating_message_id: number | null;
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
  source_openharness_tool: string | null;
  preview_location: string | null;
  output_location: string | null;
  byte_size: number | null;
  content_hash: string | null;
  metadata_json: string;
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
  openHarnessSessionId: string;
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
  sourceOpenHarnessTool?: string | null;
  database?: Database.Database;
  storageRoot?: string;
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

function validateContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new ArtifactStoreError(400, "invalid_artifact_content", "Artifact content must be text for this renderer.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new ArtifactStoreError(413, "artifact_too_large", `Artifact content exceeds ${MAX_ARTIFACT_CONTENT_BYTES} bytes.`);
  }
  return content;
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

function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, target);
}

function hashFile(file: string): { byteSize: number; contentHash: string } {
  const content = fs.readFileSync(file);
  return { byteSize: content.byteLength, contentHash: crypto.createHash("sha256").update(content).digest("hex") };
}

function sourceExtension(rendererId: string): string {
  return rendererId === "html" ? ".html" : rendererId === "text" ? ".txt" : ".md";
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
      INSERT INTO openharness_artifacts (
        id, user_id, runtime_session_id, openharness_session_id, conversation_id, cluster_id,
        originating_run_id, originating_message_id, originating_tool_call_id, source_surface,
        kind, renderer_id, title, filename, mime_type, status, current_version,
        parent_artifact_id, source_skill, source_mcp_server, source_mcp_tool,
        source_openharness_tool, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactId, input.userId, input.runtimeSessionId, input.openHarnessSessionId,
      input.conversationId, input.clusterId, input.runId, input.assistantMessageId,
      input.toolCallId ?? null, input.surface, input.kind, input.rendererId, title, filename,
      renderer.mimeType, input.parentArtifactId ?? null, input.sourceSkill ?? null,
      input.sourceMcpServer ?? null, input.sourceMcpTool ?? null,
      input.sourceOpenHarnessTool ?? "artifact_create", metadata, now, now,
    );
    database.prepare(`
      INSERT INTO openharness_artifact_versions (
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

export function getArtifactById(id: string, database: Database.Database = db): ArtifactRow | null {
  const row = database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM openharness_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.id = ?
  `).get(id) as ArtifactRow | undefined;
  return row ?? null;
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
    FROM openharness_artifacts a
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
  database?: Database.Database;
}): ArtifactRow[] {
  const database = input.database ?? db;
  if (!input.conversationPublicId && !input.gardenSlug) {
    throw new ArtifactStoreError(400, "artifact_scope_required", "A conversation or Garden scope is required.");
  }
  return database.prepare(`
    SELECT a.*, c.public_id AS conversation_public_id, cl.slug AS garden_slug
    FROM openharness_artifacts a
    JOIN conversations c ON c.id = a.conversation_id
    LEFT JOIN clusters cl ON cl.id = a.cluster_id
    WHERE a.user_id = ?
      AND c.surface IN ('dashboard_terminal','garden_chat')
      AND a.source_surface IN ('dashboard_terminal','garden_chat')
      AND (? IS NULL OR c.public_id = ?)
      AND (? IS NULL OR cl.slug = ?)
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT 200
  `).all(
    input.userId,
    input.conversationPublicId ?? null, input.conversationPublicId ?? null,
    input.gardenSlug ?? null, input.gardenSlug ?? null,
  ) as ArtifactRow[];
}

export function listArtifactVersions(artifactId: string, database: Database.Database = db): ArtifactVersionRow[] {
  return database.prepare(`
    SELECT * FROM openharness_artifact_versions
    WHERE artifact_id = ? ORDER BY version DESC
  `).all(artifactId) as ArtifactVersionRow[];
}

export function getArtifactVersion(artifactId: string, version: number, database: Database.Database = db): ArtifactVersionRow {
  const row = database.prepare(`
    SELECT * FROM openharness_artifact_versions WHERE artifact_id = ? AND version = ?
  `).get(artifactId, version) as ArtifactVersionRow | undefined;
  if (!row) throw new ArtifactStoreError(404, "artifact_version_not_found", "Artifact version not found.");
  return row;
}

export function readArtifactSource(artifact: ArtifactRow, version = artifact.current_version, configuredRoot?: string, database: Database.Database = db): string {
  const row = getArtifactVersion(artifact.id, version, database);
  return fs.readFileSync(resolveStoredPath(storageRoot(configuredRoot), row.source_location), "utf8");
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
        INSERT INTO openharness_artifact_versions (
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
        UPDATE openharness_artifact_versions
        SET status = 'generating', preview_location = NULL, output_location = NULL,
            byte_size = NULL, content_hash = NULL, metadata_json = ?, error_json = NULL,
            updated_at = ? WHERE artifact_id = ? AND version = ?
      `).run(metadata, now, input.artifact.id, nextVersion);
    }
    database.prepare(`
      UPDATE openharness_artifacts
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

export async function renderArtifact(input: {
  artifact: ArtifactRow;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
  storageRoot?: string;
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
  database.prepare(`UPDATE openharness_artifacts SET status = 'generating', updated_at = ? WHERE id = ?`).run(now, input.artifact.id);
  insertEvent(database, input.artifact.id, input.runId, input.artifact.conversation_id,
    input.artifact.cluster_id, input.assistantMessageId, "artifact.rendering", "generating",
    version.version, { renderer: renderer.id });
  try {
    const rendered = await renderer.render(content, { directory, filename: input.artifact.filename });
    const outputRelative = path.relative(root, rendered.outputPath).split(path.sep).join("/");
    const previewRelative = path.relative(root, rendered.previewPath).split(path.sep).join("/");
    resolveStoredPath(root, outputRelative);
    resolveStoredPath(root, previewRelative);
    const { byteSize, contentHash } = hashFile(rendered.outputPath);
    const finish = database.transaction(() => {
      database.prepare(`
        UPDATE openharness_artifact_versions
        SET status = 'ready', preview_location = ?, output_location = ?, mime_type = ?,
            byte_size = ?, content_hash = ?, error_json = NULL, updated_at = ?
        WHERE artifact_id = ? AND version = ?
      `).run(previewRelative, outputRelative, rendered.mimeType, byteSize, contentHash,
        now, input.artifact.id, version.version);
      database.prepare(`
        UPDATE openharness_artifacts
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
    return getArtifactById(input.artifact.id, database)!;
  } catch (error) {
    return failArtifact(input.artifact, input.runId, input.assistantMessageId,
      "artifact_render_failed", error instanceof Error ? error.message : "Rendering failed.", database);
  }
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
    database.prepare(`UPDATE openharness_artifacts SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?`)
      .run(error, now, artifact.id);
    database.prepare(`UPDATE openharness_artifact_versions SET status = 'failed', error_json = ?, updated_at = ? WHERE artifact_id = ? AND version = ?`)
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
    INSERT INTO openharness_artifact_events (
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
    FROM openharness_artifact_events e
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
  return {
    id: row.id,
    conversationId: row.conversation_public_id ?? "",
    gardenId: row.garden_slug ?? null,
    runId: row.originating_run_id,
    assistantMessageId: row.originating_message_id === null ? null : `msg_${row.originating_message_id}`,
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
    sourceOpenHarnessTool: row.source_openharness_tool,
    previewAvailable: Boolean(row.preview_location),
    downloadAvailable: row.status === "ready" && Boolean(row.output_location),
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    metadata: parseObject(row.metadata_json),
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
    INSERT INTO openharness_artifact_provenance (
      artifact_id, version, source_kind, source_server, source_tool,
      invocation_id, resource_metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.artifactId, input.version, input.sourceKind, input.sourceServer ?? null,
    input.sourceTool ?? null, input.invocationId ?? null,
    safeJson(input.resourceMetadata ?? {}), new Date().toISOString());
}

/** Attach the upstream OpenHarness call id once the normalized tool event arrives. */
export function associateArtifactToolCall(
  runId: string,
  toolName: string,
  toolCallId: string,
  database: Database.Database = db,
): void {
  if (!toolName.startsWith("artifact_")) return;
  const candidate = database.prepare(`
    SELECT id FROM openharness_artifacts
    WHERE originating_run_id = ? AND originating_tool_call_id IS NULL
      AND source_openharness_tool = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(runId, toolName) as { id: string } | undefined;
  if (candidate) {
    database.prepare(`UPDATE openharness_artifacts SET originating_tool_call_id = ? WHERE id = ?`)
      .run(toolCallId.slice(0, 200), candidate.id);
  }
}
