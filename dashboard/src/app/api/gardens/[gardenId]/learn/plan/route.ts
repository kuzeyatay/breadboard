import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { runLearnPipeline } from "@/lib/learn";
import { DEFAULT_MODEL, createChatmockClient } from "@/lib/knowledge";
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
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const result = await runLearnPipeline({
      gardenId: cluster.slug,
      userId,
      mode: "plan",
      client,
      contentPath,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL,
      sourceOnly: body.sourceOnly !== false,
      includeSourceSnapshots: body.includeSourceSnapshots === true,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
