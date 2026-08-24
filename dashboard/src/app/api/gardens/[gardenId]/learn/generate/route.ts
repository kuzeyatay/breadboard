import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { executeLearnOperationForRoute } from "breadboard-learn-operation-runtime";
import {
  InvalidLearnRouteBodyError,
  isLearnRouteConflict,
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
    const sourceOnly = body.sourceOnly !== false;
    const includeSourceSnapshots = body.includeSourceSnapshots === true;
    const includedSourceIds = Array.isArray(body.includedSourceIds)
      ? body.includedSourceIds.filter((sourceId: unknown): sourceId is string => typeof sourceId === "string")
      : undefined;
    const requestedMapId =
      typeof body.confirmedLearningMapId === "string" && body.confirmedLearningMapId.trim()
        ? body.confirmedLearningMapId.trim()
        : "";
    if (!requestedMapId) {
      return NextResponse.json(
        { error: "Generating Learn requires the exact confirmed Learning Map ID." },
        { status: 400 },
      );
    }
    // Treat the map's planning model as a concurrency token. Validate it in
    // Next before a worker can start, then let the worker validate the durable
    // map-to-planning-job binding again before creating a generation job.
    const model = selectedModelForUser(userId);
    const expectedModel = requireExpectedLearnModel(body, model, {
      requiresReplanOnConflict: true,
    });
    const { baseURL } = resolveChatmockBaseUrl(request);
    const execution = await executeLearnOperationForRoute({
      operation: "generate",
      gardenId: cluster.slug,
      userId,
      contentPath,
      baseURL,
      model,
      expectedModel,
      requestedConfirmedLearningMapId: requestedMapId,
      includedSourceIds,
      sourceOnly,
      includeSourceSnapshots,
    }, `generation for ${cluster.slug}`);

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

    return NextResponse.json({ success: true, generation: execution.value });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isLearnRouteConflict(error)) {
      return NextResponse.json(
        { error: error.message, requiresReplan: error.requiresReplan },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}
