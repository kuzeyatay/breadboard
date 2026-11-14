import { gardenFileContext, fileError, fileJson } from "@/lib/garden-files/server.ts";
import { saveGardenNativeBytes } from "@/lib/garden-files/editor.ts";
import { GardenFileError } from "@/lib/garden-files/store.ts";
import { gardenFileContentResponse } from "@/lib/garden-files/content-response.ts";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gardenId: string; fileId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { gardenId, fileId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId);
    return gardenFileContentResponse(request, store, scope, fileId);
  } catch (error) { return fileError(error); }
}
export const HEAD = GET;
export async function PUT(request: Request, { params }: Context) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    if (!request.body) throw new GardenFileError(400, "file_body_missing", "No edited file was supplied.");
    return fileJson({ file: await saveGardenNativeBytes(store, scope, fileId, Number(request.headers.get("x-file-revision")), request.body, request.signal) });
  } catch (error) { return fileError(error); }
}
