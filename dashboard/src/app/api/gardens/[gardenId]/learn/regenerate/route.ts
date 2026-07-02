import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  getLearnStatusSnapshot,
  runLearnPlanning,
  runTextbookGeneration,
} from "@/lib/learn";
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
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;
    const sourceOnly = body.sourceOnly !== false;
    const includeSourceSnapshots = body.includeSourceSnapshots === true;
    const status = getLearnStatusSnapshot({
      gardenId: cluster.slug,
      contentPath,
    });

    if (!status.confirmedLearningMapId) {
      const planning = await runLearnPlanning({
        gardenId: cluster.slug,
        userId,
        client,
        model,
        contentPath,
        sourceOnly,
        includeSourceSnapshots,
      });
      return NextResponse.json({ success: true, planning });
    }

    const generation = await runTextbookGeneration({
      gardenId: cluster.slug,
      userId,
      client,
      model,
      contentPath,
      confirmedLearningMapId: status.confirmedLearningMapId,
      mode: "regenerate",
      sourceOnly,
      includeSourceSnapshots,
    });
    return NextResponse.json({ success: true, generation });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
