import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    const taskId = readId((await params).taskId, "task id");
    return NextResponse.json({ comments: getPlanStore().listComments(userId, taskId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Always recorded as a `user` comment. The assistant's own notes are written
 * server-side by the `plan_comment_task` tool, so the author field cannot be
 * spoofed from the browser.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    const taskId = readId((await params).taskId, "task id");
    const body = await readJsonBody(request);
    const comment = getPlanStore().addComment(
      userId,
      taskId,
      typeof body.content === "string" ? body.content : "",
      "user",
    );
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
