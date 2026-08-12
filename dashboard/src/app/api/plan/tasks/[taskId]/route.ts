import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId, readTaskPatch } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

/** The card plus everything the detail panel shows: comments and links. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    const taskId = readId((await params).taskId, "task id");
    const store = getPlanStore();
    return NextResponse.json({
      task: store.getTask(userId, taskId),
      comments: store.listComments(userId, taskId),
      relations: store.listRelations(userId, taskId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    const taskId = readId((await params).taskId, "task id");
    const body = await readJsonBody(request);
    const task = getPlanStore().updateTask(userId, taskId, readTaskPatch(body));
    return NextResponse.json({ task });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    getPlanStore().deleteTask(userId, readId((await params).taskId, "task id"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
