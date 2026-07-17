import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { LearnRepairPendingMapError, runLearnRepairOperation } from "@/lib/learn";
import { InvalidLearnOperationRequestError, parseStartLearnOperationRequest } from "@/lib/learn-operation-mode";
import { DEFAULT_MODEL, createChatmockClient } from "@/lib/knowledge";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Legacy URL retained for clients/bookmarks. Its semantics are now repair. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) return NextResponse.json({ error: "QUARTZ_CONTENT_PATH not configured" }, { status: 500 });
    const body = await request.json().catch(() => ({}));
    let operation;
    try {
      operation = parseStartLearnOperationRequest(cluster.slug, body, { legacyDefault: "repair" });
    } catch (error) {
      if (error instanceof InvalidLearnOperationRequestError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    if (operation.mode !== "repair") {
      return NextResponse.json({ error: "The Regenerate endpoint accepts repair mode only. Use the separate rebuild action for full_rebuild." }, { status: 400 });
    }
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    const result = await runLearnRepairOperation({
      gardenId: cluster.slug, userId, client, model, contentPath, request: operation,
    });
    return NextResponse.json({ success: true, operation: "repair", repair: result.repair, job: result.job });
  } catch (error) {
    if (error instanceof LearnRepairPendingMapError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
