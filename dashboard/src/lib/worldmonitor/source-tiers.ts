// Ported from the worldmonitor clone (github.com/koala73/worldmonitor, AGPL-3.0).
// `source-tiers.json` is upstream's `shared/source-tiers.json`, carried over
// byte for byte so a feed keeps the authority rating its editors gave it.
//
// Tier 1: wire services, official government and international bodies
// Tier 2: major established outlets
// Tier 3: specialty, regional and think-tank sources
// Tier 4: aggregators and blogs

import sourceTiers from "./source-tiers.json" with { type: "json" };

export const SOURCE_TIERS: Record<string, number> = sourceTiers as Record<
  string,
  number
>;

/** Unlisted sources land in tier 4, same as upstream. */
export function getSourceTier(sourceName: string): number {
  return SOURCE_TIERS[sourceName] ?? 4;
}

const TIER_LABELS: Record<number, string> = {
  1: "Wire / official",
  2: "Major outlet",
  3: "Specialist",
  4: "Aggregator",
};

export function sourceTierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? TIER_LABELS[4]!;
}
