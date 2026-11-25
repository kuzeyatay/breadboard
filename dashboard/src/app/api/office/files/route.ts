import db from "@/lib/db";
import { fileError, fileJson, gardenFileContext, gardenFiles, readFileJson } from "@/lib/garden-files/server.ts";
import { GardenFileError } from "@/lib/garden-files/store.ts";
import { blankOfficeFile } from "@/lib/office/blank.ts";
import { createFromSpaceTemplate, listSpaceTemplates } from "@/lib/office/templates.ts";
import { scheduleOfficeMirrors } from "@/lib/office/quartz-mirror.ts";
import { OFFICE_FOLDER, officeKind, spacesKindForPath, type OfficeFile, type OfficeWorkspace } from "@/lib/office/types.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Spaces files are ordinary Garden files: this lists them across every Garden the user owns. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    // A Garden workspace's Spaces section asks for its own files only.
    const only = new URL(request.url).searchParams.get("garden");
    const gardens = (db.prepare("SELECT id, slug, name, user_id FROM clusters WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(userId) as { id: number; slug: string; name: string; user_id: number }[])
      .filter(garden => !only || garden.slug === only);
    const store = gardenFiles(), files: OfficeFile[] = [];
    for (const garden of gardens) {
      // ponytail: full per-garden listing then filter; add an extension index to garden_files if libraries grow huge.
      const scope = { gardenId: garden.slug, clusterId: garden.id, ownerId: garden.user_id, userId };
      scheduleOfficeMirrors(store, scope);
      for (const entry of store.list(scope)) {
        const info = entry.kind === "file" ? spacesKindForPath(entry.path) : null;
        if (info) files.push({ id: entry.id, gardenId: garden.slug, gardenName: garden.name, name: entry.name, path: entry.path, size: entry.size, revision: entry.revision, updatedAt: entry.updatedAt, tab: info.tab });
      }
    }
    files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const workspaces: OfficeWorkspace[] = gardens.map(({ slug, name }) => ({ slug, name }));
    return fileJson({ files, workspaces, templates: listSpaceTemplates(store, userId) });
  } catch (error) { return fileError(error); }
}

/** Create a blank document, page, whiteboard or design in a Garden's Spaces folder. Videos start in Video Studio instead. */
export async function POST(request: Request) {
  try {
    const body = await readFileJson(request);
    const info = officeKind(body.kind);
    if (!info || info.kind === "mp4") throw new GardenFileError(400, "office_kind_invalid", "Choose a document type.");
    if (typeof body.gardenId !== "string" || !body.gardenId) throw new GardenFileError(400, "office_garden_missing", "Choose a workspace for the document.");
    const whiteboard = info.kind === "affine" && body.whiteboard === true;
    const title = (typeof body.title === "string" ? body.title : "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || `Untitled ${whiteboard ? "whiteboard" : info.noun}`;
    const { store, scope } = await gardenFileContext(body.gardenId, true);
    if (typeof body.templateId === "string") {
      const file = await createFromSpaceTemplate(store, scope, body.templateId, title, request.signal);
      return fileJson({ file }, 201);
    }
    const bytes = await blankOfficeFile(info.kind, title, { whiteboard });
    const stage = await store.stage(new Blob([bytes as BlobPart]).stream(), request.signal);
    try {
      return fileJson({ file: store.import(scope, `${OFFICE_FOLDER}/${title}.${info.kind}`, stage) }, 201);
    } finally { store.discard(stage); }
  } catch (error) { return fileError(error); }
}
