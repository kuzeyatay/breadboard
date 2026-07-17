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
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
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
      const planning = await runLearnPlanning({
        gardenId: cluster.slug,
        userId,
        client,
        model,
        contentPath,
        includedSourceIds,
        sourceOnly,
        includeSourceSnapshots,
      });
      return NextResponse.json({ success: true, planning });
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
