import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  confirmLearningMap,
  getLearnStatusSnapshot,
  LearnPipelineConflictError,
  runTextbookGeneration,
} from "@/lib/learn";
import { createChatmockClient } from "@/lib/knowledge";
import { handOffLearnTask } from "@/lib/learn-background";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";
import { selectedModelForUser } from "@/lib/selected-model";

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
    const status = getLearnStatusSnapshot({
      gardenId: cluster.slug,
      contentPath,
    });
    if (status.latestTextbookVersionId || status.hasTextbook) {
      return NextResponse.json(
        {
          error:
            "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
        },
        { status: 409 },
      );
    }
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
      const execution = await handOffLearnTask(runTextbookGeneration({
        gardenId: cluster.slug,
        userId,
        client,
        contentPath,
        confirmedLearningMapId: learningMap.id,
        model: selectedModelForUser(userId),
        sourceOnly: body.sourceOnly !== false,
        includeSourceSnapshots: body.includeSourceSnapshots === true,
      }), `generation for ${cluster.slug}`);
      if (execution.accepted) {
        return NextResponse.json(
          {
            success: true,
            accepted: true,
            learningMap,
            job: getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath }).job,
          },
          { status: 202 },
        );
      }
      return NextResponse.json({
        success: true,
        learningMap,
        generation: execution.value,
      });
    }

    return NextResponse.json({ success: true, learningMap });
  } catch (error) {
    if (error instanceof LearnPipelineConflictError) {
      return NextResponse.json(
        { error: error.message, requiresReplan: error.requiresReplan },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}
