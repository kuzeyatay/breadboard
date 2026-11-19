import { NextResponse } from "next/server";

import { requireUserId, RouteError } from "@/lib/server-auth";
import { getScreenTimeSettings, readScreenTime } from "@/lib/screen-time/store";
import type { GreetingActivity } from "@/app/new-tab/new-tab-greetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 2 * 60 * 60_000;
const MIN_TRACKED_MS = 10 * 60_000;

/**
 * The Terminal greeting's activity nod. Only the dominant Screen Time category
 * of the last two hours leaves the server, and only when the owner lets Screen
 * Time inform suggestions: no app names, titles or sites.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await getScreenTimeSettings(userId);
    if (!settings.enabled || !settings.useForSuggestions) return NextResponse.json({ activity: null });
    const end = Date.now(), start = end - WINDOW_MS;
    const { summary } = await readScreenTime(userId, { start, end, boundaries: [start, end], previousStart: start - 1, previousEnd: start });
    const top = summary.categories
      .filter((entry) => entry.id !== "other")
      .sort((a, b) => b.milliseconds - a.milliseconds)[0];
    if (!top || summary.total < MIN_TRACKED_MS || top.milliseconds < summary.total / 3) return NextResponse.json({ activity: null });
    const activity: GreetingActivity = {
      category: top.id as GreetingActivity["category"],
      focused: summary.longestSession >= 45 * 60_000,
      scattered: summary.switches >= 40,
    };
    return NextResponse.json({ activity }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ activity: null });
  }
}
