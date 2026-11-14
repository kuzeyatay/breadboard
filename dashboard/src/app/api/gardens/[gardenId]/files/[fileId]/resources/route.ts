import { gardenFileContext, fileError } from "@/lib/garden-files/server.ts";
import { gardenFileResource } from "@/lib/garden-files/resources.ts";
import { gardenFileContentResponse } from "@/lib/garden-files/content-response.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ gardenId: string; fileId: string }> }) {
  try {
    const { gardenId, fileId } = await context.params, { store, scope } = await gardenFileContext(gardenId);
    const resource = gardenFileResource(store, scope, fileId, new URL(request.url).searchParams.get("path") ?? "");
    return gardenFileContentResponse(new Request(new URL("./content", request.url), { headers: request.headers, signal: request.signal }), store, scope, resource.id);
  } catch (error) { return fileError(error); }
}
