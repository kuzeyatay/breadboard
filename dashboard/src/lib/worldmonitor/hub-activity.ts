// Rolling headlines up onto hubs — the map's dots.
//
// Kept free of node imports so the client can run it too: the layer switches
// and the time range change which headlines count, and recomputing in the
// browser is what makes toggling a layer feel like a switch rather than a
// round trip.

import { GEO_HUB_BY_ID } from "./geo-hubs.ts";
import { THREAT_PRIORITY } from "./threat.ts";
import type { HubActivity, NewsItem, ThreatLevel } from "./types.ts";

export const LEVEL_WEIGHT: Record<ThreatLevel, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0.6,
  info: 0.15,
};

export function hubActivityFrom(items: NewsItem[]): HubActivity[] {
  const byHub = new Map<string, HubActivity>();

  for (const item of items) {
    for (const hubId of item.hubs) {
      const hub = GEO_HUB_BY_ID.get(hubId);
      if (!hub) continue;

      const weight = LEVEL_WEIGHT[item.threat.level];
      const existing = byHub.get(hubId);
      if (!existing) {
        byHub.set(hubId, {
          id: hub.id,
          name: hub.name,
          region: hub.region,
          country: hub.country,
          lat: hub.lat,
          lon: hub.lon,
          type: hub.type,
          count: 1,
          level: item.threat.level,
          weight,
          topHeadline: item.title,
        });
        continue;
      }

      existing.count += 1;
      existing.weight += weight;
      // The headline shown is the most severe one at this hub, not the newest:
      // a dot the reader clicks because it is red should explain the red.
      if (THREAT_PRIORITY[item.threat.level] > THREAT_PRIORITY[existing.level]) {
        existing.level = item.threat.level;
        existing.topHeadline = item.title;
      }
    }
  }

  return [...byHub.values()].sort((a, b) => b.weight - a.weight);
}
