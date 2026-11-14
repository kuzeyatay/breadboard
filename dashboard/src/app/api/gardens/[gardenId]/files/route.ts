import { gardenFileContext, fileJson, fileError, readFileJson } from "@/lib/garden-files/server.ts";
import { GardenFileError, gardenFilePath } from "@/lib/garden-files/store.ts";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gardenId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { gardenId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId);
    const files = store.list(scope, new URL(request.url).searchParams.get("trash") === "1");
    return fileJson({ files, canEdit: scope.userId === scope.ownerId });
  } catch (error) { return fileError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { gardenId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const body = await readFileJson(request);
      if (body.kind !== "folder") throw new GardenFileError(400, "file_action_invalid", "Choose a file or folder to add.");
      return fileJson({ file: store.createFolder(scope, gardenFilePath(body.path)) }, 201);
    }
    let rawPath: string;
    try { rawPath = decodeURIComponent(request.headers.get("x-file-path") ?? ""); }
    catch { throw new GardenFileError(400, "file_path_invalid", "The file name could not be read."); }
    const filePath = gardenFilePath(rawPath);
    const expectedSize = Number(request.headers.get("x-file-size"));
    if (!request.headers.has("x-file-size") || !Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new GardenFileError(400, "file_size_invalid", "The file size could not be read.");
    if (expectedSize > store.maxBytes) throw new GardenFileError(413, "file_too_large", "This file exceeds the library's upload limit.");
    if (!request.body && expectedSize !== 0) throw new GardenFileError(400, "file_body_missing", "Choose a file to upload.");
    const stage = await store.stage(request.body ?? new ReadableStream({ start(controller) { controller.close(); } }), request.signal);
    try {
      if (stage.size !== expectedSize) throw new GardenFileError(400, "file_upload_incomplete", "The upload was interrupted. Try again.");
      return fileJson({ file: store.import(scope, filePath, stage, request.headers.get("x-file-import-key") ?? undefined) }, 201);
    } finally { store.discard(stage); }
  } catch (error) { return fileError(error); }
}
