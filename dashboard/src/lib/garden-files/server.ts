import { requireOwnedClusterFromSlug, requireReadableClusterFromSlug, requireReadableClusterFromSlugOrPublic, routeErrorResponse, RouteError } from "../server-auth.ts";
import { GardenFileError, GardenFileStore, type GardenFileScope } from "./store.ts";
import { gardenFiles } from "./repository.ts";
import { isGardenMutationBusyError } from "../garden-mutation-lease.ts";
export { gardenFiles } from "./repository.ts";

export async function gardenFileContext(gardenId: string, write = false): Promise<{ store: GardenFileStore; scope: GardenFileScope }> {
  const { cluster, userId } = await (write ? requireOwnedClusterFromSlug(gardenId) : requireReadableClusterFromSlug(gardenId).catch(error => {
    // Public visibility must not erase an owner's authenticated identity.
    if (error instanceof RouteError && error.status === 401) return requireReadableClusterFromSlugOrPublic(gardenId);
    throw error;
  }));
  return { store: gardenFiles(), scope: { gardenId: cluster.slug, clusterId: cluster.id, ownerId: cluster.user_id, userId } };
}

export const fileJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export function fileError(error: unknown): Response {
  if (error instanceof GardenFileError) return fileJson({ error: error.message, code: error.code }, error.status);
  if (isGardenMutationBusyError(error)) return fileJson({ error: error.message, code: error.code }, error.status);
  return routeErrorResponse(error);
}

export async function readFileJson(request: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  if (!request.body) throw new GardenFileError(400, "file_request_empty", "No changes were supplied.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new GardenFileError(413, "file_request_too_large", "The changes are too large to save here.");
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof GardenFileError) throw error;
    throw new GardenFileError(400, "file_request_invalid", "The file changes could not be read.");
  } finally { reader.releaseLock(); }
}
