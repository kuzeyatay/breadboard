// Per-garden spaced-repetition participation — the garden chat settings panel's
// half of the feature. Whether this garden contributes questions, and how many of
// the daily budget it may claim. The channel itself is a per-user choice and
// lives at ../../settings.

import { NextResponse } from "next/server";

import { getReviewStore } from "@/lib/review/instance.ts";
import { requireReadableClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clusterSlug: string }> },
) {
  try {
    const { clusterSlug } = await params;
    const { userId } = await requireReadableClusterFromSlug(clusterSlug);
    const store = getReviewStore();
    return NextResponse.json({
      garden: store.gardenSettings(userId, clusterSlug),
      user: store.userSettings(userId),
      stats: store.stats(userId, clusterSlug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clusterSlug: string }> },
) {
  try {
    const { clusterSlug } = await params;
    const { userId } = await requireReadableClusterFromSlug(clusterSlug);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getReviewStore();
    const garden = store.setGardenSettings(userId, clusterSlug, {
      ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      ...(body.dailyLimit !== undefined ? { dailyLimit: Number(body.dailyLimit) } : {}),
    });
    return NextResponse.json({
      garden,
      user: store.userSettings(userId),
      stats: store.stats(userId, clusterSlug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
