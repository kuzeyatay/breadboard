import { gardenFileContext, fileJson, fileError } from "@/lib/garden-files/server.ts";
import { exportGardenFile } from "@/lib/garden-files/export.ts";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: { params: Promise<{ gardenId: string; fileId: string }> }) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    return fileJson({ path: exportGardenFile(store, scope, fileId) });
  } catch (error) { return fileError(error); }
}
