import { gardenFileContext, fileJson, fileError, readFileJson } from "@/lib/garden-files/server.ts";
import { loadGardenFileEditor, saveGardenFileEditor, saveGardenNativeBytes } from "@/lib/garden-files/editor.ts";
import { GardenFileError } from "@/lib/garden-files/store.ts";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gardenId: string; fileId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    return fileJson(await loadGardenFileEditor(store, scope, fileId, request.signal));
  } catch (error) { return fileError(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      if (!request.body) throw new GardenFileError(400, "file_body_missing", "No edited file was supplied.");
      const file = await saveGardenNativeBytes(store, scope, fileId, Number(request.headers.get("x-file-revision")), request.body, request.signal, request.headers.get("x-file-copy") === "1");
      return fileJson({ file });
    }
    const body = await readFileJson(request, 16 * 1024 * 1024);
    return fileJson({ file: await saveGardenFileEditor(store, scope, fileId, { revision: Number(body.revision), content: body.content, patches: body.patches, copy: body.copy === true, baseVersion: Number(body.baseVersion) }, request.signal) });
  } catch (error) { return fileError(error); }
}
