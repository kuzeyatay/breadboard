// Projects and their revisions.
//
// The invariant this module exists to hold: `current_revision` only ever moves
// to a revision that validated. A failed regeneration is still recorded — the
// agent needs to see what it tried — but it never becomes the design the user
// opens, and it never replaces the last one that worked.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  CAD_FILE_DESCRIPTORS,
  CadStorageError,
  isProjectId,
  newProjectId,
  readRevisionFile,
  writeRevisionFile,
} from "./blob-store.ts";
import type {
  CADDesignSpec,
  CADExportFormat,
  CADFileReference,
  CADMeasurements,
  CADProvenance,
  CADRevisionSummary,
  CADStatus,
  CADValidationIssue,
} from "./types.ts";

export interface CadProjectRow {
  id: string;
  user_id: number;
  conversation_id: number;
  cluster_id: number | null;
  artifact_id: string | null;
  name: string;
  units: "mm" | "inch";
  process: "fdm" | "sla" | "sls" | "unknown";
  status: CADStatus;
  current_revision: number;
  latest_revision: number;
  design_spec_json: string;
  created_at: string;
  updated_at: string;
}

export interface CadRevisionRow {
  id: string;
  project_id: string;
  revision: number;
  parent_revision: number | null;
  status: CADStatus;
  instruction: string;
  source: string;
  entrypoint: string;
  parameters_json: string;
  parameter_diff_json: string;
  design_spec_json: string;
  measurements_json: string;
  validation_json: string;
  provenance_json: string;
  generation_log_json: string;
  model: string;
  created_at: string;
}

export interface CadRevisionFileRow {
  project_id: string;
  revision: number;
  format: CADExportFormat;
  filename: string;
  mime_type: string;
  relative_path: string;
  byte_size: number;
  sha256: string;
  linear_tolerance: number | null;
  angular_tolerance: number | null;
}

export type CadParameterValue = number | string | boolean;

function parseObject<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function createCadProject(input: {
  userId: number;
  conversationId: number;
  clusterId: number | null;
  name: string;
  units: "mm" | "inch";
  process: "fdm" | "sla" | "sls" | "unknown";
  designSpec?: unknown;
  database?: Database.Database;
}): CadProjectRow {
  const database = input.database ?? db;
  const id = newProjectId();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO cad_projects (
        id, user_id, conversation_id, cluster_id, artifact_id, name, units, process,
        status, current_revision, latest_revision, design_spec_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'draft', 0, 0, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.conversationId,
      input.clusterId,
      input.name.slice(0, 200),
      input.units,
      input.process,
      JSON.stringify(input.designSpec ?? {}),
      now,
      now,
    );
  return getCadProject(id, database)!;
}

export function getCadProject(
  projectId: string,
  database: Database.Database = db,
): CadProjectRow | null {
  if (!isProjectId(projectId)) return null;
  return (
    (database
      .prepare(`SELECT * FROM cad_projects WHERE id = ?`)
      .get(projectId) as CadProjectRow | undefined) ?? null
  );
}

export function getCadProjectForUser(input: {
  projectId: string;
  userId: number;
  database?: Database.Database;
}): CadProjectRow {
  const project = getCadProject(input.projectId, input.database ?? db);
  if (!project || project.user_id !== input.userId) {
    throw new CadStorageError(404, "cad_project_not_found", "That CAD project was not found.");
  }
  return project;
}

/** The project this conversation is currently working on, if any. */
export function latestCadProjectForConversation(input: {
  userId: number;
  conversationId: number;
  database?: Database.Database;
}): CadProjectRow | null {
  const database = input.database ?? db;
  return (
    (database
      .prepare(
        `SELECT * FROM cad_projects
         WHERE user_id = ? AND conversation_id = ?
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(input.userId, input.conversationId) as CadProjectRow | undefined) ?? null
  );
}

/**
 * Newest durable plan that never reached a publishable revision.
 *
 * A model timeout after `cad_create_project` must not force the next retry to
 * repeat planning or leave the good specification orphaned. Callers may bind
 * by the generated design name when they share a conversation with other CAD
 * work (Hardware Blueprint does); the direct CAD agent simply resumes the
 * newest unbuilt plan unless the person explicitly asked for a fresh project.
 */
export function latestUnbuiltCadProjectForConversation(input: {
  userId: number;
  conversationId: number;
  name?: string;
  database?: Database.Database;
}): CadProjectRow | null {
  const database = input.database ?? db;
  const nameClause = input.name?.trim() ? " AND name = ?" : "";
  const values: Array<number | string> = [input.userId, input.conversationId];
  if (input.name?.trim()) values.push(input.name.trim());
  return (
    (database
      .prepare(
        `SELECT * FROM cad_projects
         WHERE user_id = ? AND conversation_id = ?
           AND current_revision = 0
           AND artifact_id IS NULL
           AND status IN ('draft', 'invalid')${nameClause}
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(...values) as CadProjectRow | undefined) ?? null
  );
}

export function setCadProjectArtifact(input: {
  projectId: string;
  artifactId: string;
  database?: Database.Database;
}): void {
  (input.database ?? db)
    .prepare(`UPDATE cad_projects SET artifact_id = ?, updated_at = ? WHERE id = ?`)
    .run(input.artifactId, new Date().toISOString(), input.projectId);
}

export function cadProjectForArtifact(
  artifactId: string,
  database: Database.Database = db,
): CadProjectRow | null {
  return (
    (database
      .prepare(`SELECT * FROM cad_projects WHERE artifact_id = ?`)
      .get(artifactId) as CadProjectRow | undefined) ?? null
  );
}

export function nextRevisionNumber(
  projectId: string,
  database: Database.Database = db,
): number {
  const row = database
    .prepare(`SELECT latest_revision FROM cad_projects WHERE id = ?`)
    .get(projectId) as { latest_revision: number } | undefined;
  if (!row) {
    throw new CadStorageError(404, "cad_project_not_found", "That CAD project was not found.");
  }
  return row.latest_revision + 1;
}

export interface RecordRevisionInput {
  projectId: string;
  revision: number;
  parentRevision: number | null;
  status: CADStatus;
  instruction: string;
  source: string;
  entrypoint: string;
  parameters: Record<string, CadParameterValue>;
  designSpec: CADDesignSpec;
  measurements: CADMeasurements;
  /**
   * The verdict, plus the expectations it was measured against. Storing the
   * expectations is what lets a later `cad_validate_model` tell a still-correct
   * answer from one the specification has moved past.
   */
  validation: {
    passed: boolean;
    checkedAt: string;
    issues: CADValidationIssue[];
    expectations?: unknown;
  };
  provenance: CADProvenance;
  generationLog: Array<{ at: string; stage: string; detail: string }>;
  model: string;
  /** Export bytes to persist alongside the revision. */
  files: Array<{
    format: CADExportFormat;
    content: Buffer | string;
    linearTolerance?: number;
    angularTolerance?: number;
  }>;
  database?: Database.Database;
  storageRoot?: string;
}

/**
 * Persist one revision: files first, then a single transaction that inserts the
 * rows and — only for a revision that validated — advances the project.
 */
export function recordCadRevision(input: RecordRevisionInput): {
  revision: CadRevisionRow;
  files: CADFileReference[];
} {
  const database = input.database ?? db;
  const project = getCadProject(input.projectId, database);
  if (!project) {
    throw new CadStorageError(404, "cad_project_not_found", "That CAD project was not found.");
  }
  const now = new Date().toISOString();
  // A first revision has no parent, so every parameter would read as an
  // addition. That is noise: the starting point of a design is not a change to
  // it, and the history panel should say so by showing nothing.
  const parameterDiff = input.parentRevision
    ? diffParameters(
        readRevisionParameters(input.projectId, input.parentRevision, database),
        input.parameters,
      )
    : [];

  const written = input.files.map((file) => {
    const stored = writeRevisionFile({
      projectId: input.projectId,
      revision: input.revision,
      format: file.format,
      content: file.content,
      ...(input.storageRoot ? { storageRoot: input.storageRoot } : {}),
    });
    return { ...stored, file };
  });

  const acceptable = input.status === "valid" || input.status === "valid-with-warnings";

  const transaction = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO cad_revisions (
          id, project_id, revision, parent_revision, status, instruction, source, entrypoint,
          parameters_json, parameter_diff_json, design_spec_json, measurements_json,
          validation_json, provenance_json, generation_log_json, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `cadr_${randomUUID().replaceAll("-", "")}`,
        input.projectId,
        input.revision,
        input.parentRevision,
        input.status,
        input.instruction.slice(0, 8_000),
        input.source,
        input.entrypoint,
        JSON.stringify(input.parameters),
        JSON.stringify(parameterDiff),
        JSON.stringify(input.designSpec),
        JSON.stringify(input.measurements),
        JSON.stringify(input.validation),
        JSON.stringify(input.provenance),
        JSON.stringify(input.generationLog),
        input.model.slice(0, 200),
        now,
      );

    for (const entry of written) {
      database
        .prepare(
          `INSERT OR REPLACE INTO cad_revision_files (
            project_id, revision, format, filename, mime_type, relative_path,
            byte_size, sha256, linear_tolerance, angular_tolerance, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.projectId,
          input.revision,
          entry.format,
          entry.filename,
          entry.mimeType,
          entry.relativePath,
          entry.byteSize,
          entry.sha256,
          entry.file.linearTolerance ?? null,
          entry.file.angularTolerance ?? null,
          now,
        );
    }

    // `latest_revision` always advances so a revision number is never reused.
    // `current_revision` and the project's status only follow a build that
    // validated: an invalid regeneration must not replace a working design.
    database
      .prepare(
        `UPDATE cad_projects
         SET latest_revision = MAX(latest_revision, ?),
             current_revision = CASE WHEN ? THEN ? ELSE current_revision END,
             status = CASE WHEN ? THEN ? ELSE status END,
             design_spec_json = CASE WHEN ? THEN ? ELSE design_spec_json END,
             name = CASE WHEN ? THEN ? ELSE name END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.revision,
        acceptable ? 1 : 0,
        input.revision,
        acceptable ? 1 : 0,
        input.status,
        acceptable ? 1 : 0,
        JSON.stringify(input.designSpec),
        acceptable ? 1 : 0,
        input.designSpec.name.slice(0, 200),
        now,
        input.projectId,
      );
  });
  transaction.immediate();

  return {
    revision: getCadRevision(input.projectId, input.revision, database)!,
    files: listRevisionFiles(input.projectId, input.revision, database),
  };
}

export function getCadRevision(
  projectId: string,
  revision: number,
  database: Database.Database = db,
): CadRevisionRow | null {
  return (
    (database
      .prepare(`SELECT * FROM cad_revisions WHERE project_id = ? AND revision = ?`)
      .get(projectId, revision) as CadRevisionRow | undefined) ?? null
  );
}

export function listCadRevisions(
  projectId: string,
  database: Database.Database = db,
): CadRevisionRow[] {
  return database
    .prepare(`SELECT * FROM cad_revisions WHERE project_id = ? ORDER BY revision ASC`)
    .all(projectId) as CadRevisionRow[];
}

export function revisionHistory(
  projectId: string,
  database: Database.Database = db,
): CADRevisionSummary[] {
  return listCadRevisions(projectId, database).map((row) => {
    const validation = parseObject<{ passed?: boolean; issues?: CADValidationIssue[] }>(
      row.validation_json,
      {},
    );
    const measurements = parseObject<Partial<CADMeasurements>>(row.measurements_json, {});
    const issues = validation.issues ?? [];
    return {
      revision: row.revision,
      parentRevision: row.parent_revision,
      status: row.status,
      instruction: row.instruction,
      parameterDiff: parseObject<Array<{ id: string; from: unknown; to: unknown }>>(
        row.parameter_diff_json,
        [],
      ),
      createdAt: row.created_at,
      validationPassed: Boolean(validation.passed),
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      ...(measurements.boundingBox
        ? {
            boundingBox: {
              x: measurements.boundingBox.x,
              y: measurements.boundingBox.y,
              z: measurements.boundingBox.z,
            },
          }
        : {}),
    };
  });
}

export function readRevisionParameters(
  projectId: string,
  revision: number,
  database: Database.Database = db,
): Record<string, CadParameterValue> {
  const row = getCadRevision(projectId, revision, database);
  return row ? parseObject<Record<string, CadParameterValue>>(row.parameters_json, {}) : {};
}

export function listRevisionFiles(
  projectId: string,
  revision: number,
  database: Database.Database = db,
): CADFileReference[] {
  const rows = database
    .prepare(
      `SELECT * FROM cad_revision_files WHERE project_id = ? AND revision = ? ORDER BY format`,
    )
    .all(projectId, revision) as CadRevisionFileRow[];
  return rows.map((row) => ({
    projectId: row.project_id,
    revision: row.revision,
    format: row.format,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    ...(row.linear_tolerance === null ? {} : { linearTolerance: row.linear_tolerance }),
    ...(row.angular_tolerance === null ? {} : { angularTolerance: row.angular_tolerance }),
  }));
}

/**
 * Read one stored file back, by (project, revision, format) only.
 *
 * The download route calls this with values it has already authorized. There is
 * no path parameter anywhere in the chain: the relative path comes from the
 * database row, and the blob store re-checks that it stays inside the root.
 */
export function readCadFile(input: {
  projectId: string;
  revision: number;
  format: CADExportFormat;
  database?: Database.Database;
  storageRoot?: string;
}): { content: Buffer; filename: string; mimeType: string } {
  const database = input.database ?? db;
  const row = database
    .prepare(
      `SELECT * FROM cad_revision_files WHERE project_id = ? AND revision = ? AND format = ?`,
    )
    .get(input.projectId, input.revision, input.format) as CadRevisionFileRow | undefined;
  if (!row) {
    throw new CadStorageError(404, "cad_file_unavailable", "That CAD file is not available.");
  }
  const content = readRevisionFile({
    relativePath: row.relative_path,
    expectedSha256: row.sha256,
    ...(input.storageRoot ? { storageRoot: input.storageRoot } : {}),
  });
  return {
    content,
    filename: row.filename,
    mimeType: row.mime_type || CAD_FILE_DESCRIPTORS[input.format].mimeType,
  };
}

/** What changed between two parameter sets, in the order the new set lists. */
export function diffParameters(
  before: Record<string, CadParameterValue>,
  after: Record<string, CadParameterValue>,
): Array<{ id: string; from: unknown; to: unknown }> {
  const diff: Array<{ id: string; from: unknown; to: unknown }> = [];
  for (const [id, value] of Object.entries(after)) {
    if (!(id in before)) {
      diff.push({ id, from: null, to: value });
    } else if (before[id] !== value) {
      diff.push({ id, from: before[id], to: value });
    }
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) diff.push({ id, from: before[id], to: null });
  }
  return diff;
}

export function deleteCadProject(
  projectId: string,
  database: Database.Database = db,
): void {
  if (!isProjectId(projectId)) return;
  const transaction = database.transaction(() => {
    database.prepare(`DELETE FROM cad_revision_files WHERE project_id = ?`).run(projectId);
    database.prepare(`DELETE FROM cad_revisions WHERE project_id = ?`).run(projectId);
    database.prepare(`DELETE FROM cad_projects WHERE id = ?`).run(projectId);
  });
  transaction.immediate();
}
