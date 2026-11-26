import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem } from "../external-runtime-filesystem.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "../garden-files/store.ts";
import { OFFICE_FOLDER, spacesKindForPath } from "./types.ts";

export function listSpaceTemplates(store: GardenFileStore, userId: number) {
  return store.database.prepare(`SELECT t.id,t.name,t.kind,t.extension FROM spaces_templates t
    WHERE t.user_id=? ORDER BY t.name`).all(userId) as Array<{id: string; name: string; kind: string; extension: string}>;
}

export function saveSpaceTemplate(store: GardenFileStore, userId: number, name: string, fileId: string) {
  const file = store.database.prepare(`SELECT v.blob,f.path FROM garden_files f JOIN garden_file_versions v ON v.file_id=f.id AND v.version=f.version
    WHERE f.id=? AND f.owner_id=? AND f.kind='file' AND f.deleted_at IS NULL`)
    .get(fileId, userId) as {blob: string; path: string} | undefined;
  const info = file && spacesKindForPath(file.path);
  if (!file || !info || info.kind === "mp4") throw new GardenFileError(404, "template_source_missing", "Choose a document, design or page from your own Spaces files.");
  const extension = file.path.split(".").at(-1)!.toLowerCase();
  return store.database.prepare(`INSERT INTO spaces_templates(id,user_id,name,blob,extension,kind) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,name) DO UPDATE SET blob=excluded.blob,extension=excluded.extension,kind=excluded.kind
    RETURNING id,name,kind,extension`).get(randomUUID(), userId, name, file.blob, extension, info.kind);
}

/** Instantiate the saved revision; later edits to a copy belong to that copy's Garden. */
export async function createFromSpaceTemplate(store: GardenFileStore, destination: GardenFileScope, id: string, title: string, signal?: AbortSignal) {
  const source = store.database.prepare("SELECT blob,extension FROM spaces_templates WHERE id=? AND user_id=?")
    .get(id, destination.userId) as {blob:string;extension:string} | undefined;
  if (!source || destination.userId !== destination.ownerId) throw new GardenFileError(404, "template_missing", "Template not found.");
  const staged = await store.stage(externalRuntimeFilesystem.createReadStream(store.blobPath(source.blob)), signal);
  return store.import(destination, `${OFFICE_FOLDER}/${title}.${source.extension}`, staged);
}
