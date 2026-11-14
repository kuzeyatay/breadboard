import { gardenFileContext, fileJson, fileError } from "@/lib/garden-files/server.ts";
import { gardenFilePreview } from "@/lib/garden-files/preview.ts";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ gardenId: string; fileId: string }> }) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId);
    return fileJson(await gardenFilePreview(store, scope, fileId));
  } catch (error) { return fileError(error); }
}
