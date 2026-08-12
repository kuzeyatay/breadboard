import { NextResponse } from "next/server";
import {
  clearMemoryProfile,
  editMemoryProfile,
  synthesizeMemoryProfile,
} from "@/lib/conversations/memory-profile";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const userId = await requireUserId();
    // Opening Settings -> Memory calls this automatically. Keep the normal
    // evidence thresholds so repeatedly opening the tab cannot spend a model
    // call when the profile is already fresh.
    const outcome = await synthesizeMemoryProfile({ userId });
    if (outcome.result === "failed") {
      throw new RouteError(503, outcome.reason ?? "The memory summary could not be updated.");
    }
    return NextResponse.json(outcome);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (Object.hasOwn(body, "summary")) {
      if (typeof body.summary !== "string" || body.summary.length > 6_000) {
        throw new RouteError(400, "The memory summary must be between 24 and 6,000 characters.");
      }
      const profile = editMemoryProfile(userId, body.summary);
      if (!profile) {
        throw new RouteError(
          400,
          "The memory summary is too short or contains content that cannot be stored.",
        );
      }
      return NextResponse.json({ ok: true, profile });
    }

    throw new RouteError(400, "A valid memory summary is required.");
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ ok: true, profile: clearMemoryProfile(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
