import { requireUserId } from "@/lib/server-auth";
import { exportClusterArchive } from "@/lib/garden-transfer/export.ts";
import {
  transferDownloadResponse,
  transferErrorResponse,
} from "@/lib/garden-transfer/response.ts";

export const dynamic = "force-dynamic";

/**
 * Download a cluster as a `.cluster` file. The cluster is addressed by its full
 * materialized path in `?path=`, the same string `clusters.folder` holds.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const path = new URL(request.url).searchParams.get("path") ?? "";
    return transferDownloadResponse(exportClusterArchive(userId, path));
  } catch (error) {
    return transferErrorResponse(error);
  }
}
