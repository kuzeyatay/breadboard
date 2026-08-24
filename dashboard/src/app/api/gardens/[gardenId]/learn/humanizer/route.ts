import { NextResponse } from "next/server";
import { setHermesUserSettings } from "@/lib/hermes/runtime-store";
import { executeLearnOperationForRoute } from "breadboard-learn-operation-runtime";
import {
  InvalidLearnRouteBodyError,
  isLearnRouteConflict,
  readLearnRouteJsonObject,
} from "@/lib/learn-route-errors";
import { getLearnStatusSnapshotForRoute } from "breadboard-learn-status-runtime";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

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
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    const enabled = body.enabled;
    const expectedVersionId =
      typeof body.expectedVersionId === "string" && body.expectedVersionId.trim()
        ? body.expectedVersionId.trim()
        : undefined;

    // This route is also the authoritative server-side preference update. The
    // browser hook mirrors it independently for chat, but a network race must
    // not make this explicit Learn action observe the old value.
    setHermesUserSettings(userId, { humanizerAuto: enabled });
    const execution = await executeLearnOperationForRoute(
      {
        operation: "humanizer",
        gardenId: cluster.slug,
        userId,
        contentPath,
        enabled,
        expectedVersionId,
      },
      `${enabled ? "humanization" : "AI-copy restore"} for ${cluster.slug}`,
    );

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
    const snapshot = await getLearnStatusSnapshotForRoute({
      gardenId: cluster.slug,
      contentPath,
    });
    return NextResponse.json({
      success: true,
      accepted: false,
      result: execution.value,
      ...snapshot,
    });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isLearnRouteConflict(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
