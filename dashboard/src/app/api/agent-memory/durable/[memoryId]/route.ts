import { NextResponse } from "next/server";
import {
  confirmDurableMemory,
  deleteDurableMemory,
  forgetDurableMemory,
  updateDurableMemoryContent,
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

/** Edit an active memory, or promote a candidate when no edit body is sent. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  try {
    const userId = await requireUserId();
    const memoryId = parseMemoryId((await params).memoryId);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (Object.hasOwn(body, "content")) {
      if (typeof body.content !== "string" || body.content.length > 1000) {
        throw new RouteError(
          400,
          "Memory text must be between 1 and 1,000 characters.",
        );
      }
      const update = updateDurableMemoryContent(
        userId,
        memoryId,
        body.content,
      );
      if (update.status === "rejected") {
        throw new RouteError(
          400,
          "Memory text cannot be empty or contain sensitive credentials.",
        );
      }
      if (update.status === "not_found") {
        throw new RouteError(404, "That active memory could not be found.");
      }
      if (update.status === "conflict") {
        throw new RouteError(409, "An equivalent active memory already exists.");
      }
      return NextResponse.json({
        ok: true,
        memoryId,
        content: update.content,
      });
    }
    if (!confirmDurableMemory(userId, memoryId)) {
      throw new RouteError(404, "That memory is already confirmed, or no longer exists.");
    }
    return NextResponse.json({ ok: true, memoryId });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
