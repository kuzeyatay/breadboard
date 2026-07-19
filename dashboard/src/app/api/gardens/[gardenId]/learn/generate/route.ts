import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  getLearnStatusSnapshot,
  LEARN_MODEL,
  runTextbookGeneration,
} from "@/lib/learn";
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
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const model = LEARN_MODEL;
    const sourceOnly = body.sourceOnly !== false;
    const includeSourceSnapshots = body.includeSourceSnapshots === true;
    const includedSourceIds = Array.isArray(body.includedSourceIds)
      ? body.includedSourceIds.filter((sourceId: unknown): sourceId is string => typeof sourceId === "string")
      : undefined;
    const requestedMapId =
      typeof body.confirmedLearningMapId === "string" && body.confirmedLearningMapId.trim()
        ? body.confirmedLearningMapId.trim()
        : undefined;
    const status = getLearnStatusSnapshot({
      gardenId: cluster.slug,
      contentPath,
    });
    const mayResumeFailedInitialGeneration =
      !status.latestTextbookVersionId &&
      status.hasTextbook &&
      status.job?.mode === "generate" &&
      status.job.status === "failed";
    if (
      (status.latestTextbookVersionId || status.hasTextbook) &&
      !mayResumeFailedInitialGeneration
    ) {
      return NextResponse.json(
        {
          error:
            "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
        },
        { status: 409 },
      );
    }
    const requestedSourceIdSet = includedSourceIds ? new Set(includedSourceIds) : null;
    const confirmedSelectionMatches =
      !requestedSourceIdSet ||
      (requestedSourceIdSet.size === status.selectedSourceIds.length &&
        status.selectedSourceIds.every((sourceId) => requestedSourceIdSet.has(sourceId)));
    if (
      !status.confirmedLearningMapId ||
      (requestedMapId && requestedMapId !== status.confirmedLearningMapId) ||
      !confirmedSelectionMatches
    ) {
      return NextResponse.json(
        {
          error:
            "Generate requires the current confirmed Learning Map and matching source selection. Start planning explicitly for a new garden.",
        },
        { status: 409 },
      );
    }
    const generation = await runTextbookGeneration({
      gardenId: cluster.slug,
      userId,
      client,
      contentPath,
      confirmedLearningMapId: status.confirmedLearningMapId,
      model,
      sourceOnly,
      includeSourceSnapshots,
    });

    return NextResponse.json({ success: true, generation });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
