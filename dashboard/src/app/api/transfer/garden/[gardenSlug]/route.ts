import { requireUserId } from "@/lib/server-auth";
import { exportGardenArchive } from "@/lib/garden-transfer/export.ts";
import {
  transferDownloadResponse,
  transferErrorResponse,
} from "@/lib/garden-transfer/response.ts";

export const dynamic = "force-dynamic";

/** Download one garden as a `.garden` file. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenSlug: string }> },
) {
  try {
    const userId = await requireUserId();
    const { gardenSlug } = await params;
    return transferDownloadResponse(exportGardenArchive(userId, gardenSlug));
  } catch (error) {
    return transferErrorResponse(error);
  }
}
