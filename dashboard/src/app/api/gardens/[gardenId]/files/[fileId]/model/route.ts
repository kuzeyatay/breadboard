import { gardenFileContext, fileError } from "@/lib/garden-files/server.ts";
import { gardenModelPreview } from "@/lib/garden-files/model-preview.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ gardenId: string; fileId: string }> }) {
  try {
    const { gardenId, fileId } = await context.params;
    const { store, scope } = await gardenFileContext(gardenId);
    const bytes = await gardenModelPreview(store, scope, fileId, request.signal);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) { return fileError(error); }
}
