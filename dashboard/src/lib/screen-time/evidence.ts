import { createHash } from "node:crypto";
import type { RecommendationEvidence } from "../recommendations/types.ts";
import { formatDuration, type UsageItem } from "./model.ts";

/** Time spent is evidence of interest, never proof of progress or unfinished work. */
export function activityRecommendationEvidence(tabs: readonly UsageItem[]): RecommendationEvidence[] {
  return tabs.filter(item => item.milliseconds >= 60000 && !/^(new tab|terminal|home|screen time|settings|breadboard)(?:\s*[·—|\-]\s*breadboard)?$/i.test(item.name))
    .slice(0, 5).map(item => ({
      id: `screen-time:${createHash("sha256").update(item.id).digest("hex").slice(0, 16)}`,
      source: "screen-time", title: item.name,
      summary: `Observed foreground activity: ${formatDuration(item.milliseconds)} across ${item.visits} visits in the past 24 hours, in ${item.subtitle}. This does not show whether the task is unfinished, completed, or productive. Offer an optional revisit only when useful.`,
      timestamp: new Date(item.end).toISOString(),
    }));
}
