import { gardenFileContext, fileJson, fileError, readFileJson } from "@/lib/garden-files/server.ts";
import { GardenFileError, gardenFilePath } from "@/lib/garden-files/store.ts";
import { gardenFileFolderAction } from "@/lib/garden-files/folder-actions.ts";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gardenId: string; fileId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { gardenId, fileId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId);
    return fileJson({ file: store.get(scope, fileId) });
  } catch (error) { return fileError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { gardenId, fileId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    const body = await readFileJson(request), revision = Number(body.revision);
    if (["move", "copy", "trash", "restore"].includes(String(body.action))) {
      const folder = await gardenFileFolderAction(store, scope, fileId, String(body.action), revision, body.path === undefined ? undefined : gardenFilePath(body.path));
      if (folder) return fileJson({ file: folder });
    }
    let file;
    switch (body.action) {
      case "move": file = store.move(scope, fileId, revision, gardenFilePath(body.path)); break;
      case "copy": file = store.copy(scope, fileId, body.path === undefined ? undefined : gardenFilePath(body.path)); break;
      case "trash": file = store.trash(scope, fileId, revision); break;
      case "restore": file = store.restore(scope, fileId); break;
      case "share": {
        if (body.visibility !== "private" && body.visibility !== "garden") throw new GardenFileError(400, "file_visibility_invalid", "Choose who can read this file.");
        file = store.share(scope, fileId, revision, body.visibility); break;
      }
      case "restore-version": file = store.restoreVersion(scope, fileId, revision, Number(body.version)); break;
      default: throw new GardenFileError(400, "file_action_invalid", "That file action is not available.");
    }
    return fileJson({ file });
  } catch (error) { return fileError(error); }
}
