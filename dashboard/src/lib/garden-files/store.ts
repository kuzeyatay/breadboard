import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { gardenFileCapabilities, GARDEN_FILE_IMPORT_LIMIT, type GardenFileEntry, type GardenFileVersion } from "./types.ts";

export class GardenFileError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = "GardenFileError"; this.status = status; this.code = code; }
}

export interface GardenFileScope { gardenId: string; clusterId: number; ownerId: number; userId: number | null }
interface FileRow {
  id: string; cluster_id: number; owner_id: number; kind: "file" | "folder"; path: string; path_key: string;
  visibility: "private" | "garden"; version: number; revision: number; size: number; mime_type: string;
  created_at: string; updated_at: string; deleted_at: string | null; deletion_id: string | null;
}
interface VersionRow { file_id: string; version: number; blob: string; size: number; sha256: string; created_at: string }
export interface StagedGardenFile { blob: string; size: number; sha256: string }

export function ensureGardenFileSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS garden_files (
      id TEXT PRIMARY KEY, cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('file','folder')), path TEXT NOT NULL, path_key TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','garden')),
      version INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      size INTEGER NOT NULL DEFAULT 0, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, deletion_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS garden_files_live_path ON garden_files(cluster_id,path_key) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS garden_files_listing ON garden_files(cluster_id,deleted_at,visibility);
    CREATE TABLE IF NOT EXISTS garden_file_versions (
      file_id TEXT NOT NULL REFERENCES garden_files(id) ON DELETE CASCADE, version INTEGER NOT NULL,
      blob TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(file_id,version)
    );
    CREATE TABLE IF NOT EXISTS garden_file_imports (
      cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      import_key TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES garden_files(id) ON DELETE CASCADE,
      PRIMARY KEY(cluster_id,import_key)
    );
  `);
}

/** A logical path, never a user-supplied path on the host filesystem. */
export function gardenFilePath(value: unknown, allowRoot = false): string {
  if (typeof value !== "string") throw new GardenFileError(400, "file_path_invalid", "Choose a file name.");
  const normalized = value.normalize("NFC").replace(/\\/g, "/");
  if (allowRoot && normalized === "") return "";
  const parts = normalized.split("/");
  if (normalized.length > 2048 || parts.length > 24 || parts.some(part => !part || part === "." || part === ".." || part.length > 255 || /[\u0000-\u001f\u007f:]/.test(part) || part !== part.trim())) {
    throw new GardenFileError(400, "file_path_invalid", "Use a name without slashes, empty segments, or control characters.");
  }
  return normalized;
}

const pathKey = (value: string) => value.normalize("NFC").toLowerCase();
const parentPath = (value: string) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const leafName = (value: string) => value.slice(value.lastIndexOf("/") + 1);
const inside = (value: string, folder: string) => pathKey(value) === pathKey(folder) || pathKey(value).startsWith(`${pathKey(folder)}/`);

/** One store for all originals; renderers never own or mutate these bytes. */
export class GardenFileStore {
  readonly root: string;
  readonly database: Database.Database;
  readonly maxBytes: number;
  readonly reservedPath: (scope: GardenFileScope, value: string, allowDirectory?: boolean) => boolean;
  constructor(database: Database.Database, root: string, maxBytes = GARDEN_FILE_IMPORT_LIMIT, reservedPath: (scope: GardenFileScope, value: string, allowDirectory?: boolean) => boolean = () => false) {
    this.database = database;
    this.maxBytes = maxBytes;
    this.reservedPath = reservedPath;
    this.root = path.resolve(root);
    ensureGardenFileSchema(database);
  }

  private own(scope: GardenFileScope): void {
    if (scope.userId !== scope.ownerId) throw new GardenFileError(403, "file_read_only", "Only the garden owner can change files.");
  }

  private row(scope: GardenFileScope, id: string, includeDeleted = false): FileRow {
    const row = this.database.prepare("SELECT * FROM garden_files WHERE id = ? AND cluster_id = ? AND owner_id = ?").get(id, scope.clusterId, scope.ownerId) as FileRow | undefined;
    if (!row || (row.deleted_at && !includeDeleted) || (scope.userId !== scope.ownerId && (row.visibility !== "garden" || row.deleted_at))) {
      throw new GardenFileError(404, "file_not_found", "That file is no longer available.");
    }
    return row;
  }

  private present(scope: GardenFileScope, row: FileRow): GardenFileEntry {
    const capabilities = gardenFileCapabilities(leafName(row.path), row.size);
    return { id: row.id, gardenId: scope.gardenId, kind: row.kind, path: row.path, name: leafName(row.path), folder: parentPath(row.path), size: row.size,
      mimeType: row.mime_type, version: row.version, revision: row.revision, visibility: row.visibility, createdAt: row.created_at,
      updatedAt: row.updated_at, deletedAt: row.deleted_at, canEdit: scope.userId === scope.ownerId, capabilities };
  }

  get(scope: GardenFileScope, id: string, includeDeleted = false): GardenFileEntry { return this.present(scope, this.row(scope, id, includeDeleted)); }

  list(scope: GardenFileScope, trash = false): GardenFileEntry[] {
    if (trash) this.own(scope);
    const rows = this.database.prepare(`SELECT * FROM garden_files WHERE cluster_id = ? AND owner_id = ? AND deleted_at IS ${trash ? "NOT " : ""}NULL${scope.userId === scope.ownerId ? "" : " AND visibility = 'garden' AND kind = 'file'"} ORDER BY path_key`).all(scope.clusterId, scope.ownerId) as FileRow[];
    return rows.map(row => this.present(scope, row));
  }

  private checkRevision(row: FileRow, revision: number): void {
    if (!Number.isSafeInteger(revision) || row.revision !== revision) throw new GardenFileError(409, "file_revision_conflict", "This file changed elsewhere. Reload it before saving; your changes are still here.");
  }

  private available(scope: GardenFileScope, candidate: string, exceptId?: string): boolean {
    const row = this.database.prepare("SELECT id FROM garden_files WHERE cluster_id = ? AND path_key = ? AND deleted_at IS NULL").get(scope.clusterId, pathKey(candidate)) as { id: string } | undefined;
    return row ? row.id === exceptId : !this.reservedPath(scope, candidate);
  }

  private unused(scope: GardenFileScope, candidate: string): string {
    const folder = parentPath(candidate), name = leafName(candidate), dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    let result = candidate, suffix = 1;
    while (!this.available(scope, result)) result = `${folder ? `${folder}/` : ""}${base} (${++suffix})${ext}`;
    return gardenFilePath(result);
  }

  private ensureParents(scope: GardenFileScope, candidate: string): void {
    const parts = candidate.split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index++) {
      const folder = parts.slice(0, index).join("/");
      if (this.reservedPath(scope, folder, true)) throw new GardenFileError(409, "file_parent_conflict", "A file is already using that folder name.");
      const found = this.database.prepare("SELECT kind FROM garden_files WHERE cluster_id = ? AND path_key = ? AND deleted_at IS NULL").get(scope.clusterId, pathKey(folder)) as { kind: string } | undefined;
      if (found?.kind === "file") throw new GardenFileError(409, "file_parent_conflict", "A file is already using that folder name.");
      if (!found) this.insert(scope, folder, "folder");
    }
  }

  private insert(scope: GardenFileScope, filePath: string, kind: "file" | "folder"): FileRow {
    const id = `gf_${randomUUID().replaceAll("-", "")}`, now = new Date().toISOString();
    this.database.prepare("INSERT INTO garden_files (id,cluster_id,owner_id,kind,path,path_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, scope.clusterId, scope.ownerId, kind, filePath, pathKey(filePath), now, now);
    return this.row(scope, id);
  }

  createFolder(scope: GardenFileScope, filePath: string): GardenFileEntry {
    this.own(scope);
    const normalized = gardenFilePath(filePath);
    return this.database.transaction(() => {
      this.ensureParents(scope, `${normalized}/placeholder`);
      const row = this.database.prepare("SELECT * FROM garden_files WHERE cluster_id = ? AND path_key = ? AND deleted_at IS NULL").get(scope.clusterId, pathKey(normalized)) as FileRow;
      return this.present(scope, row);
    }).immediate();
  }

  /** Stream to an unpublished blob. A cancelled/failed upload never becomes a file. */
  async stage(body: ReadableStream<Uint8Array> | Readable, signal?: AbortSignal): Promise<StagedGardenFile> {
    fs.mkdirSync(path.join(this.root, "blobs"), { recursive: true });
    const blob = randomUUID().replaceAll("-", ""), target = this.blobPath(blob);
    const handle = await fs.promises.open(target, "wx");
    const hash = createHash("sha256");
    let size = 0;
    try {
      const stream = body instanceof Readable ? body : Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0], { signal });
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > this.maxBytes) throw new GardenFileError(413, "file_too_large", "This file exceeds the library's upload limit.");
        hash.update(bytes);
        let offset = 0;
        while (offset < bytes.length) offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten;
      }
      signal?.throwIfAborted();
      await handle.sync();
      return { blob, size, sha256: hash.digest("hex") };
    } catch (error) {
      await handle.close();
      fs.rmSync(target, { force: true });
      throw error;
    } finally { await handle.close().catch(() => undefined); }
  }

  discard(stage: StagedGardenFile): void {
    const used = this.database.prepare("SELECT 1 FROM garden_file_versions WHERE blob = ? LIMIT 1").get(stage.blob);
    if (!used) fs.rmSync(this.blobPath(stage.blob), { force: true });
  }

  blobPath(blob: string): string {
    if (!/^[a-f0-9]{32}$/.test(blob)) throw new GardenFileError(400, "file_blob_invalid", "Invalid file reference.");
    return path.join(this.root, "blobs", blob);
  }

  import(scope: GardenFileScope, filePath: string, stage: StagedGardenFile, importKey?: string): GardenFileEntry {
    this.own(scope);
    const normalized = gardenFilePath(filePath);
    if (importKey !== undefined && (!/^[a-zA-Z0-9_-]{1,120}$/.test(importKey))) throw new GardenFileError(400, "file_import_invalid", "Invalid upload reference.");
    try {
      return this.database.transaction(() => {
        if (importKey) {
          const previous = this.database.prepare("SELECT file_id FROM garden_file_imports WHERE cluster_id = ? AND import_key = ?").get(scope.clusterId, importKey) as { file_id: string } | undefined;
          if (previous) return this.get(scope, previous.file_id, true);
        }
        const destination = this.unused(scope, normalized);
        this.ensureParents(scope, destination);
        const row = this.insert(scope, destination, "file");
        this.appendVersion(row, stage);
        if (importKey) this.database.prepare("INSERT INTO garden_file_imports VALUES (?,?,?)").run(scope.clusterId, importKey, row.id);
        return this.get(scope, row.id);
      }).immediate();
    } finally { this.discard(stage); }
  }

  private appendVersion(row: FileRow, stage: StagedGardenFile): void {
    if (!fs.existsSync(this.blobPath(stage.blob))) throw new GardenFileError(409, "file_upload_missing", "Upload this file again.");
    const now = new Date().toISOString(), version = row.version + 1;
    this.database.prepare("INSERT INTO garden_file_versions VALUES (?,?,?,?,?,?)").run(row.id, version, stage.blob, stage.size, stage.sha256, now);
    this.database.prepare("UPDATE garden_files SET version = ?, revision = revision + 1, size = ?, mime_type = ?, updated_at = ? WHERE id = ?").run(version, stage.size, gardenFileCapabilities(leafName(row.path), stage.size).mimeType, now, row.id);
  }

  save(scope: GardenFileScope, id: string, revision: number, stage: StagedGardenFile): GardenFileEntry {
    this.own(scope);
    try {
      return this.database.transaction(() => {
        const row = this.row(scope, id); this.checkRevision(row, revision);
        if (row.kind !== "file") throw new GardenFileError(400, "file_is_folder", "Choose a file to edit.");
        const current = this.versionRow(row);
        if (current.sha256 !== stage.sha256) this.appendVersion(row, stage);
        return this.get(scope, id);
      }).immediate();
    } finally { this.discard(stage); }
  }

  private versionRow(row: FileRow, version = row.version): VersionRow {
    const found = this.database.prepare("SELECT * FROM garden_file_versions WHERE file_id = ? AND version = ?").get(row.id, version) as VersionRow | undefined;
    if (!found) throw new GardenFileError(404, "file_version_missing", "That file version is unavailable.");
    return found;
  }

  content(scope: GardenFileScope, id: string, version?: number): { entry: GardenFileEntry; path: string; version: GardenFileVersion } {
    const row = this.row(scope, id);
    // Sharing grants the current document, not private revision history.
    if (version !== undefined && version !== row.version) this.own(scope);
    const record = this.versionRow(row, version);
    return { entry: this.present(scope, row), path: this.blobPath(record.blob), version: { version: record.version, size: record.size, sha256: record.sha256, createdAt: record.created_at } };
  }

  versions(scope: GardenFileScope, id: string): GardenFileVersion[] {
    this.own(scope); this.row(scope, id);
    return (this.database.prepare("SELECT * FROM garden_file_versions WHERE file_id = ? ORDER BY version DESC").all(id) as VersionRow[]).map(row => ({ version: row.version, size: row.size, sha256: row.sha256, createdAt: row.created_at }));
  }

  restoreVersion(scope: GardenFileScope, id: string, revision: number, version: number): GardenFileEntry {
    this.own(scope);
    return this.database.transaction(() => {
      const row = this.row(scope, id); this.checkRevision(row, revision);
      const prior = this.versionRow(row, version);
      this.appendVersion(row, prior);
      return this.get(scope, id);
    }).immediate();
  }

  move(scope: GardenFileScope, id: string, revision: number, destination: string): GardenFileEntry {
    this.own(scope); const normalized = gardenFilePath(destination);
    return this.database.transaction(() => {
      const row = this.row(scope, id); this.checkRevision(row, revision);
      if (row.kind === "folder" && inside(normalized, row.path) && pathKey(normalized) !== pathKey(row.path)) throw new GardenFileError(400, "file_move_cycle", "A folder cannot be moved inside itself.");
      if (pathKey(normalized) !== pathKey(row.path) && this.reservedPath(scope, normalized)) throw new GardenFileError(409, "file_name_conflict", "A note or folder with that name already exists.");
      const children = row.kind === "folder" ? this.list(scope).filter(file => inside(file.path, row.path)) : [this.present(scope, row)];
      const ids = new Set(children.map(file => file.id));
      for (const child of children) {
        const next = normalized + child.path.slice(row.path.length);
        const found = this.database.prepare("SELECT id FROM garden_files WHERE cluster_id = ? AND path_key = ? AND deleted_at IS NULL").get(scope.clusterId, pathKey(next)) as { id: string } | undefined;
        if (found && !ids.has(found.id)) throw new GardenFileError(409, "file_name_conflict", "An item with that name already exists.");
      }
      this.ensureParents(scope, normalized);
      const now = new Date().toISOString();
      for (const child of children) {
        const next = normalized + child.path.slice(row.path.length);
        this.database.prepare("UPDATE garden_files SET path = ?, path_key = ?, revision = revision + 1, updated_at = ?, mime_type = ? WHERE id = ?").run(next, pathKey(next), now, gardenFileCapabilities(leafName(next), child.size).mimeType, child.id);
      }
      return this.get(scope, id);
    }).immediate();
  }

  copy(scope: GardenFileScope, id: string, destination?: string): GardenFileEntry {
    this.own(scope);
    return this.database.transaction(() => {
      const row = this.row(scope, id), target = this.unused(scope, gardenFilePath(destination ?? row.path));
      if (row.kind === "folder" && inside(target, row.path)) throw new GardenFileError(400, "file_copy_cycle", "Choose a destination outside this folder.");
      const children = row.kind === "folder" ? this.list(scope).filter(file => inside(file.path, row.path)) : [this.present(scope, row)];
      this.ensureParents(scope, target);
      let result: FileRow | undefined;
      for (const child of children.sort((a, b) => a.path.length - b.path.length)) {
        const copied = this.insert(scope, target + child.path.slice(row.path.length), child.kind);
        if (child.id === id) result = copied;
        if (child.kind === "file") this.appendVersion(copied, this.versionRow(this.row(scope, child.id)));
      }
      return this.get(scope, result!.id);
    }).immediate();
  }

  share(scope: GardenFileScope, id: string, revision: number, visibility: "private" | "garden"): GardenFileEntry {
    this.own(scope);
    if (visibility !== "private" && visibility !== "garden") throw new GardenFileError(400, "file_visibility_invalid", "Choose who can read this file.");
    return this.database.transaction(() => {
      const row = this.row(scope, id); this.checkRevision(row, revision);
      if (row.kind !== "file") throw new GardenFileError(400, "file_share_folder", "Share individual files from this folder.");
      this.database.prepare("UPDATE garden_files SET visibility = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(visibility, new Date().toISOString(), id);
      return this.get(scope, id);
    }).immediate();
  }

  trash(scope: GardenFileScope, id: string, revision: number): GardenFileEntry {
    this.own(scope);
    return this.database.transaction(() => {
      const row = this.row(scope, id); this.checkRevision(row, revision);
      const deletionId = randomUUID(), now = new Date().toISOString();
      const entries = row.kind === "folder" ? this.list(scope).filter(file => inside(file.path, row.path)) : [this.present(scope, row)];
      for (const entry of entries) this.database.prepare("UPDATE garden_files SET deleted_at = ?, deletion_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(now, deletionId, now, entry.id);
      return this.get(scope, id, true);
    }).immediate();
  }

  restoreDestination(scope: GardenFileScope, id: string): string {
    this.own(scope);
    const row = this.row(scope, id, true);
    return row.deleted_at ? this.unused(scope, row.path) : row.path;
  }

  restore(scope: GardenFileScope, id: string): GardenFileEntry {
    this.own(scope);
    return this.database.transaction(() => {
      const row = this.row(scope, id, true);
      if (!row.deleted_at) return this.get(scope, id);
      const target = this.unused(scope, row.path), rows = (this.database.prepare("SELECT * FROM garden_files WHERE cluster_id = ? AND deletion_id = ?").all(scope.clusterId, row.deletion_id) as FileRow[]).filter(file => inside(file.path, row.path));
      this.ensureParents(scope, target);
      for (const item of rows.sort((a, b) => a.path.length - b.path.length)) {
        const next = target + item.path.slice(row.path.length);
        if (!this.available(scope, next)) throw new GardenFileError(409, "file_restore_conflict", "A file in this folder already exists. Rename it before restoring this folder.");
        this.database.prepare("UPDATE garden_files SET path = ?, path_key = ?, deleted_at = NULL, deletion_id = NULL, visibility = 'private', revision = revision + 1, updated_at = ? WHERE id = ?").run(next, pathKey(next), new Date().toISOString(), item.id);
      }
      return this.get(scope, id);
    }).immediate();
  }
}
