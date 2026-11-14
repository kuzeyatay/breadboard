import { gardenFileContext, fileJson, fileError } from "@/lib/garden-files/server.ts";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ gardenId: string; fileId: string }> }) {
  try {
    const { gardenId, fileId } = await params;
    const { store, scope } = await gardenFileContext(gardenId, true);
    return fileJson({ versions: store.versions(scope, fileId) });
  } catch (error) { return fileError(error); }
}
