import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  getLearnStatusSnapshot,
  LearnPipelineConflictError,
  rebuildEntireGarden,
} from "@/lib/learn";
import { InvalidLearnOperationRequestError, isFullRebuildRequest, parseStartLearnOperationRequest } from "@/lib/learn-operation-mode";
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
    const syllabusSourceId =
      typeof body.syllabusSourceId === "string" && body.syllabusSourceId.trim()
        ? body.syllabusSourceId.trim()
        : undefined;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = createChatmockClient(baseURL);
    const execution = await handOffLearnTask(rebuildEntireGarden(cluster.slug, {
      userId, client, contentPath, includedSourceIds, syllabusSourceId,
      model: selectedModelForUser(userId),
      sourceOnly: body.sourceOnly !== false,
      includeSourceSnapshots: body.includeSourceSnapshots === true,
      forceFullRebuild: true,
    }), `full rebuild for ${cluster.slug}`);
    if (execution.accepted) {
      return NextResponse.json(
        {
          success: true,
          accepted: true,
          operation: "full_rebuild",
          job: getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath }).job,
        },
        { status: 202 },
      );
    }
    return NextResponse.json({
      success: true,
      operation: "full_rebuild",
      job: execution.value,
    });
  } catch (error) {
    if (error instanceof LearnPipelineConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
