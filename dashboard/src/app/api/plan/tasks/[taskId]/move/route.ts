import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId, readTaskMove } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

/**
 * Where a drag lands. Separate from PATCH because a move is the one edit that
 * re-sequences its neighbours, and because dropping a card in a final column is
 * how work gets marked done.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const userId = await requireUserId();
    const taskId = readId((await params).taskId, "task id");
    const body = await readJsonBody(request);
    const task = getPlanStore().moveTask(userId, taskId, readTaskMove(body));
    return NextResponse.json({ task });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
