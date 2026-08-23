import { NextResponse } from "next/server";
import {
  getLearnStatusSnapshot,
  LearnPipelineConflictError,
  switchFinishedLearnHumanizer,
} from "@/lib/learn";
import { handOffLearnTask } from "@/lib/learn-background";
import { setHermesUserSettings } from "@/lib/hermes/runtime-store";
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

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    const expectedVersionId =
      typeof body.expectedVersionId === "string" && body.expectedVersionId.trim()
        ? body.expectedVersionId.trim()
        : undefined;

    // This route is also the authoritative server-side preference update. The
    // browser hook mirrors it independently for chat, but a network race must
    // not make this explicit Learn action observe the old value.
    setHermesUserSettings(userId, { humanizerAuto: body.enabled });
    const execution = await handOffLearnTask(
      switchFinishedLearnHumanizer({
        gardenId: cluster.slug,
        userId,
        contentPath,
        enabled: body.enabled,
        expectedVersionId,
      }),
      `${body.enabled ? "humanization" : "AI-copy restore"} for ${cluster.slug}`,
    );

    if (execution.accepted) {
      return NextResponse.json(
        {
          success: true,
          accepted: true,
          ...getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath }),
        },
        { status: 202 },
      );
    }
    return NextResponse.json({
      success: true,
      accepted: false,
      result: execution.value,
      ...getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath }),
    });
  } catch (error) {
    if (error instanceof LearnPipelineConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
