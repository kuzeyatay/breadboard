import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { LEARN_MODEL, rebuildEntireGarden } from "@/lib/learn";
import { InvalidLearnOperationRequestError, isFullRebuildRequest, parseStartLearnOperationRequest } from "@/lib/learn-operation-mode";
import { createChatmockClient } from "@/lib/knowledge";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

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
      operation = parseStartLearnOperationRequest(cluster.slug, body);
    } catch (error) {
      if (error instanceof InvalidLearnOperationRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    if (!isFullRebuildRequest(operation)) {
      return NextResponse.json({ error: "Full rebuild requires mode=full_rebuild and explicit confirmation." }, { status: 400 });
    }
    const includedSourceIds = Array.isArray(body.includedSourceIds)
      ? body.includedSourceIds.filter((entry: unknown): entry is string => typeof entry === "string")
      : undefined;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const job = await rebuildEntireGarden(cluster.slug, {
      userId, client, contentPath, includedSourceIds,
      model: LEARN_MODEL,
      sourceOnly: body.sourceOnly !== false,
      includeSourceSnapshots: body.includeSourceSnapshots === true,
      forceFullRebuild: true,
    });
    return NextResponse.json({ success: true, operation: "full_rebuild", job });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
