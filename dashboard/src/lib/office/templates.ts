import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem } from "../external-runtime-filesystem.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "../garden-files/store.ts";
import { OFFICE_FOLDER, spacesKindForPath } from "./types.ts";

export function listSpaceTemplates(store: GardenFileStore, userId: number) {
  return store.database.prepare(`SELECT t.id,t.name,t.kind,t.extension FROM spaces_templates t
    JOIN garden_files f ON f.id=t.file_id AND f.owner_id=t.user_id AND f.deleted_at IS NULL
    WHERE t.user_id=? ORDER BY t.name`).all(userId) as Array<{id: string; name: string; kind: string; extension: string}>;
}

export function saveSpaceTemplate(store: GardenFileStore, userId: number, name: string, fileId: string) {
  const file = store.database.prepare("SELECT version, path FROM garden_files WHERE id=? AND owner_id=? AND kind='file' AND deleted_at IS NULL")
    .get(fileId, userId) as {version: number; path: string} | undefined;
  const info = file && spacesKindForPath(file.path);
  if (!file || !info || info.kind === "mp4") throw new GardenFileError(404, "template_source_missing", "Choose a document, design or page from your own Spaces files.");
  const extension = file.path.split(".").at(-1)!.toLowerCase();
  return store.database.prepare(`INSERT INTO spaces_templates(id,user_id,name,file_id,version,extension,kind) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,name) DO UPDATE SET file_id=excluded.file_id,version=excluded.version,extension=excluded.extension,kind=excluded.kind
    RETURNING id,name,kind,extension`).get(randomUUID(), userId, name, fileId, file.version, extension, info.kind);
}

/** Instantiate the saved revision; later edits to a copy belong to that copy's Garden. */
export async function createFromSpaceTemplate(store: GardenFileStore, destination: GardenFileScope, id: string, title: string, signal?: AbortSignal) {
  const source = store.database.prepare(`SELECT c.slug,c.id AS clusterId,t.version,t.file_id AS fileId,t.extension
    FROM spaces_templates t JOIN garden_files f ON f.id=t.file_id AND f.owner_id=t.user_id
    JOIN clusters c ON c.id=f.cluster_id AND c.user_id=t.user_id
    WHERE t.id=? AND t.user_id=? AND f.deleted_at IS NULL`).get(id, destination.userId) as
    {slug: string; clusterId: number; version: number; fileId: string; extension: string} | undefined;
  if (!source || destination.userId !== destination.ownerId) throw new GardenFileError(404, "template_missing", "Template not found.");
  const scope = { ...destination, gardenId: source.slug, clusterId: source.clusterId };
  const content = store.content(scope, source.fileId, source.version);
  const staged = await store.stage(externalRuntimeFilesystem.createReadStream(content.path), signal);
  return store.import(destination, `${OFFICE_FOLDER}/${title}.${source.extension}`, staged);
}
