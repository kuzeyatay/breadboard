import { NextResponse } from "next/server";
import {
  confirmDurableMemory,
  deleteDurableMemory,
  forgetDurableMemory,
} from "@/lib/conversations/memory-inspection";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function parseMemoryId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RouteError(400, "A valid memory id is required.");
  }
  return id;
}

/** Forget (`state = superseded`) or permanently delete an already-forgotten row. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  try {
    const userId = await requireUserId();
    const memoryId = parseMemoryId((await params).memoryId);
    const permanent = new URL(request.url).searchParams.get("permanent") === "1";

    const changed = permanent
      ? deleteDurableMemory(userId, memoryId)
      : forgetDurableMemory(userId, memoryId);
    if (!changed) {
      throw new RouteError(
        404,
        permanent
          ? "That memory is not forgotten yet, or no longer exists."
          : "That memory was already forgotten, or no longer exists.",
      );
    }
    return NextResponse.json({ ok: true, memoryId, permanent });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Promote a candidate memory to confirmed. */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  try {
    const userId = await requireUserId();
    const memoryId = parseMemoryId((await params).memoryId);
    if (!confirmDurableMemory(userId, memoryId)) {
      throw new RouteError(404, "That memory is already confirmed, or no longer exists.");
    }
    return NextResponse.json({ ok: true, memoryId });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
