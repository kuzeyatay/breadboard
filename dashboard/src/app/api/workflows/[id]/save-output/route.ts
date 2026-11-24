// "Save to a workspace" in the run panel: the run's result becomes a Spaces file
// in the chosen Garden workspace, in the section that matches what it is.

import { NextRequest, NextResponse } from "next/server";
import { GardenFileError } from "@/lib/garden-files/store";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { OutputSaveError, saveRunOutputToSpaces } from "@/lib/workflows/output-to-spaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { runId?: unknown; gardenId?: unknown; title?: unknown };
    if (typeof body.runId !== "string" || typeof body.gardenId !== "string" || !body.gardenId) {
      return NextResponse.json({ error: "Choose a run and a workspace." }, { status: 400 });
    }
    const file = await saveRunOutputToSpaces({
      userId,
      workflowId: id,
      runId: body.runId,
      gardenId: body.gardenId,
      title: typeof body.title === "string" ? body.title : "",
    });
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    if (error instanceof OutputSaveError || error instanceof GardenFileError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return routeErrorResponse(error);
  }
}
