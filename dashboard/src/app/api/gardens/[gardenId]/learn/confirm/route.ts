import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { confirmLearningMap, runTextbookGeneration } from "@/lib/learn";
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
    const learningMap = confirmLearningMap({
      gardenId: cluster.slug,
      learningMapId:
        typeof body.learningMapId === "string" && body.learningMapId.trim()
          ? body.learningMapId.trim()
          : undefined,
      contentPath,
    });

    if (body.generate === true) {
      const { baseURL } = resolveChatmockBaseUrl(request);
      const client = createChatmockClient(baseURL);
      const generation = await runTextbookGeneration({
        gardenId: cluster.slug,
        userId,
        client,
        contentPath,
        confirmedLearningMapId: learningMap.id,
        model:
          typeof body.model === "string" && body.model.trim()
            ? body.model.trim()
            : DEFAULT_MODEL,
        sourceOnly: body.sourceOnly !== false,
        includeSourceSnapshots: body.includeSourceSnapshots === true,
      });
      return NextResponse.json({ success: true, learningMap, generation });
    }

    return NextResponse.json({ success: true, learningMap });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
