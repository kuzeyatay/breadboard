import { getRecallSettings } from "@/lib/recall/settings";
import type { RecommendationEvidence } from "@/lib/recommendations/types";
import { getScreenTimeSettings, readScreenTime } from "./store.ts";
import { activityRecommendationEvidence } from "./evidence.ts";
export { activityRecommendationEvidence } from "./evidence.ts";

export async function screenTimeRecommendationEvidence(userId: number): Promise<RecommendationEvidence[]> {
  const access = getRecallSettings(userId);
  const settings = await getScreenTimeSettings(userId);
  if (!access.agentAccess || !settings.enabled || !settings.useForSuggestions) return [];
  const end = Date.now(), start = end - 86400000;
  const result = await readScreenTime(userId, { start, end, boundaries: [start, end], previousStart: start - 86400000, previousEnd: start });
  // Respect a revocation or exclusion edit which occurred while the files were being read.
  const latest = await getScreenTimeSettings(userId);
  if (!getRecallSettings(userId).agentAccess || JSON.stringify(latest) !== JSON.stringify(settings)) return [];
  return activityRecommendationEvidence(result.summary.tabs);
}
