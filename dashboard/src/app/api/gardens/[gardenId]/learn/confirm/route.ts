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
    const learningMapId =
      typeof body.learningMapId === "string" ? body.learningMapId.trim() : "";
    if (!learningMapId) {
      return NextResponse.json(
        { error: "Confirming Learn requires the exact proposed Learning Map ID." },
        { status: 400 },
      );
    }
    // Capture the current selection and validate the model reviewed by the UI
    // synchronously, before either confirmation path can mutate state or spawn
    // a worker. The returned value is the one handed to generation below.
    const model = selectedModelForUser(userId);
    const expectedModel = requireExpectedLearnModel(body, model);
    if (body.generate === true) {
      const { baseURL } = resolveChatmockBaseUrl(request);
      const execution = await executeLearnOperationForRoute<{
        learningMap: unknown;
        generation: unknown;
      }>({
        operation: "confirm_generate",
        gardenId: cluster.slug,
        userId,
        contentPath,
        baseURL,
        model,
        expectedModel,
        proposedLearningMapId: learningMapId,
        sourceOnly: body.sourceOnly !== false,
        includeSourceSnapshots: body.includeSourceSnapshots === true,
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
      return NextResponse.json({
        success: true,
        ...execution.value,
      });
    }

    const execution = await executeLearnOperationForRoute({
      operation: "confirm",
      gardenId: cluster.slug,
      userId,
      contentPath,
      expectedModel,
      proposedLearningMapId: learningMapId,
    }, `confirmation for ${cluster.slug}`);
    if (execution.accepted) {
      throw new Error("Confirm-only unexpectedly entered a background handoff.");
    }
    return NextResponse.json({ success: true, learningMap: execution.value });
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
