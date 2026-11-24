import "server-only";

import db from "../db.ts";
import { gardenFiles } from "../garden-files/repository.ts";
import { GardenFileError, type GardenFileScope } from "../garden-files/store.ts";
import type { GardenFileEntry } from "../garden-files/types.ts";
import { OFFICE_FOLDER } from "../office/types.ts";

/** A Garden the user owns, as a file-store scope; Bread's tool calls have no request session to derive it from. */
export function ownedGardenScope(userId: number, gardenId: string): { store: ReturnType<typeof gardenFiles>; scope: GardenFileScope; name: string } {
  const row = db.prepare("SELECT id, slug, name, user_id FROM clusters WHERE slug = ? AND user_id = ?").get(gardenId, userId) as { id: number; slug: string; name: string; user_id: number } | undefined;
  if (!row) throw new GardenFileError(404, "garden_not_found", "That workspace was not found.");
  return { store: gardenFiles(), scope: { gardenId: row.slug, clusterId: row.id, ownerId: row.user_id, userId }, name: row.name };
}

/** The Garden a Spaces editor opened without a file (a chat image or video) shares its assistant with. */
export function defaultSpacesGarden(userId: number): { slug: string; name: string } | null {
  return (db.prepare("SELECT slug, name FROM clusters WHERE user_id = ? ORDER BY COALESCE(last_viewed_at, created_at) DESC LIMIT 1").get(userId) as { slug: string; name: string } | undefined)
    ?? (db.prepare("SELECT slug, name FROM clusters WHERE user_id = ? ORDER BY id LIMIT 1").get(userId) as { slug: string; name: string } | undefined) ?? null;
}

export interface SpacesTarget { gardenId: string; fileId?: string | null; title?: string; extension: string }

/** Studio output into Spaces: a new version of the open file, or a new file in the Spaces folder. */
export async function saveToSpaces(userId: number, target: SpacesTarget, bytes: ReadableStream<Uint8Array>): Promise<GardenFileEntry> {
  const { store, scope } = ownedGardenScope(userId, target.gardenId);
  const stage = await store.stage(bytes);
  try {
    if (target.fileId) {
      const current = store.get(scope, target.fileId);
      return store.save(scope, current.id, current.revision, stage);
    }
    const title = (target.title ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
    return store.import(scope, `${OFFICE_FOLDER}/${title}.${target.extension}`, stage);
  } finally { store.discard(stage); }
}

let linksReady = false;
function links() {
  if (!linksReady) {
    db.exec("CREATE TABLE IF NOT EXISTS spaces_design_links (file_id TEXT PRIMARY KEY, design_id TEXT NOT NULL, version INTEGER NOT NULL)");
    linksReady = true;
  }
  return db;
}

/** The layered Doory design behind a Spaces image, while the image is still the version Design last saved. */
export function linkedDesign(fileId: string, version: number): string | null {
  const row = links().prepare("SELECT design_id, version FROM spaces_design_links WHERE file_id = ?").get(fileId) as { design_id: string; version: number } | undefined;
  return row && row.version === version ? row.design_id : null;
}

export function linkDesign(fileId: string, designId: string, version: number): void {
  links().prepare("INSERT INTO spaces_design_links (file_id, design_id, version) VALUES (?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET design_id = excluded.design_id, version = excluded.version")
    .run(fileId, designId, version);
}
