import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { executeLearnOperationForRoute } from "breadboard-learn-operation-runtime";
import {
  InvalidLearnRouteBodyError,
  isLearnRouteConflict,
  parseExplicitLearnPlanSelection,
  parseLearnUserInstruction,
  readLearnRouteJsonObject,
  requireExpectedLearnModel,
} from "@/lib/learn-route-errors";
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

    const body = await readLearnRouteJsonObject(request);
    const { includedSourceIds, syllabusSourceId } =
      parseExplicitLearnPlanSelection(body);
    const userInstruction = parseLearnUserInstruction(body);
    const { baseURL } = resolveChatmockBaseUrl(request);
    const selectedModel = selectedModelForUser(userId);
    // Planning normally follows the live user preference. Automated callers
    // may additionally provide the same preference as an optimistic token so
    // a last-second picker change fails closed instead of silently dispatching
    // a different model.
    const model = Object.prototype.hasOwnProperty.call(body, "expectedModel")
      ? requireExpectedLearnModel(body, selectedModel)
      : selectedModel;
    const execution = await executeLearnOperationForRoute({
      operation: "plan",
      gardenId: cluster.slug,
      userId,
      contentPath,
      baseURL,
      model,
      includedSourceIds,
      syllabusSourceId,
      sourceOnly: body.sourceOnly !== false,
      includeSourceSnapshots: body.includeSourceSnapshots === true,
      autoConfirmTopicMap: body.skipManualReview === true,
      userInstruction,
    }, `planning for ${cluster.slug}`);

    if (execution.accepted) {
      return NextResponse.json(
        {
          success: true,
          accepted: true,
          jobId: execution.jobId ?? null,
        },
        { status: 202 },
      );
    }

    return NextResponse.json({ success: true, result: execution.value });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isLearnRouteConflict(error)) {
      return NextResponse.json(
        { error: error.message, requiresReplan: error.requiresReplan === true },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}
