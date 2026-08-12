import { NextResponse } from "next/server";

import { buildSnapshot } from "@/lib/worldmonitor/aggregate";
import { chatmockFor, refineClassifications } from "@/lib/worldmonitor/chatmock";
import { FEED_PANELS } from "@/lib/worldmonitor/feeds";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * The live picture: fetch the catalog, classify, cluster, rank.
 *
 * `?panels=middleeast,asia` narrows the scope; `?refine=1` spends one ChatMock
 * call re-reading the headlines the keyword cascade was unsure about. The
 * refinement is opt-in per request rather than automatic, because a refresh
 * every few minutes should not quietly become a model call every few minutes.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);

    const requested = (url.searchParams.get("panels") ?? "")
      .split(",")
      .map((panel) => panel.trim())
      .filter((panel) => panel in FEED_PANELS);
    const perPanelLimit = Math.min(
      Math.max(Number(url.searchParams.get("depth")) || 6, 1),
      14,
    );

    const snapshot = await buildSnapshot({
      panels: requested,
      perPanelLimit,
    });

    if (url.searchParams.get("refine") === "1" && snapshot.items.length > 0) {
      const ctx = chatmockFor(request, userId, {
        model: url.searchParams.get("model"),
        reasoningEffort: url.searchParams.get("reasoningEffort"),
      });
      const refined = await refineClassifications(ctx, snapshot.items);
      if (refined.size > 0) {
        snapshot.items = snapshot.items.map((item) => {
          const classification = refined.get(item.id);
          return classification ? { ...item, threat: classification } : item;
        });
        // Level counts were computed before the second read; recount rather
        // than let the header disagree with the list under it.
        const levels = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        for (const item of snapshot.items) levels[item.threat.level] += 1;
        snapshot.levels = levels;
      }
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
