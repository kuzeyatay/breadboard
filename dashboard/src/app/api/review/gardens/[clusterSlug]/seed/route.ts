// Build (or refresh) a garden's review cards from its published learning pages.
//
// Kept as an explicit action rather than something the tick does on its own: a
// large garden means a run of model calls to phrase the questions, and that
// should happen because someone asked for it, at a moment they are watching.
// Re-running is cheap and safe — a page whose prose has not changed keeps its
// card and its whole scheduling history.

import { NextResponse } from "next/server";

import { seedGarden } from "@/lib/review/cards.ts";
import { getReviewStore } from "@/lib/review/instance.ts";
import { requireReadableClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
// Phrasing questions for a few hundred pages runs well past the default budget.
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clusterSlug: string }> },
) {
  try {
    const { clusterSlug } = await params;
    const { userId } = await requireReadableClusterFromSlug(clusterSlug);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getReviewStore();

    const result = await seedGarden({
      store,
      userId,
      gardenSlug: clusterSlug,
      offline: body.offline === true,
    });

    return NextResponse.json({
      result,
      garden: store.gardenSettings(userId, clusterSlug),
      stats: store.stats(userId, clusterSlug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
