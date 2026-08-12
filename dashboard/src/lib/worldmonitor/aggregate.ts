// Turning fetched feeds into a situational picture.
//
// Every headline is classified by the ported keyword cascade, pinned to the geo
// hubs it names, and grouped with the other sources carrying the same story.
// What comes out is one snapshot: ranked items, hub activity for the map, level
// and category counts, and a single escalation number for the header.

import { createHash } from "node:crypto";

import { FEED_PANELS, type Feed } from "./feeds.ts";
import { inferGeoHubsFromTitle } from "./geo-match.ts";
import { hubActivityFrom, LEVEL_WEIGHT } from "./hub-activity.ts";
import { loadFeeds, type FeedResult, type RawItem } from "./rss.ts";
import { getSourceTier } from "./source-tiers.ts";
import { clusterTexts } from "./story-identity.ts";
import { classifyByKeyword } from "./threat.ts";
import type { FeedHealth, MonitorSnapshot, NewsItem, ThreatLevel } from "./types.ts";

/**
 * Headlines older than this leave the window entirely. Set to a week so the
 * time-range chips have something to range over; feeds in practice carry one to
 * three days, which is what "All" then means.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Panels whose headlines are read with upstream's tech keyword set. */
const TECH_PANELS = new Set(["tech", "ai"]);

/** Tier 1 (wires, official) is trusted about twice as far as tier 4. */
const TIER_WEIGHT: Record<number, number> = { 1: 1, 2: 0.85, 3: 0.7, 4: 0.55 };

function itemId(link: string, title: string): string {
  return createHash("sha1").update(link || title).digest("hex").slice(0, 16);
}

/** Half-life decay: a 6-hour-old headline is worth half a fresh one. */
function recencyFactor(publishedMs: number, now: number): number {
  const ageHours = Math.max(0, (now - publishedMs) / 3_600_000);
  return Math.pow(0.5, ageHours / 6);
}

function scoreItem(item: {
  level: ThreatLevel;
  tier: number;
  publishedMs: number;
  corroboration: number;
  now: number;
}): number {
  const base = LEVEL_WEIGHT[item.level];
  const tier = TIER_WEIGHT[item.tier] ?? 0.55;
  // Corroboration is sub-linear: the ninth source carrying a story says much
  // less than the second one did.
  const corroboration = 1 + Math.log2(item.corroboration);
  return base * tier * corroboration * recencyFactor(item.publishedMs, item.now);
}

interface Staged {
  raw: RawItem;
  source: string;
  panel: string;
  tier: number;
  publishedMs: number;
}

function stage(results: FeedResult[], panelOf: Map<string, string>, now: number): Staged[] {
  const staged: Staged[] = [];
  const seenLinks = new Set<string>();

  for (const result of results) {
    const panel = panelOf.get(result.feed.name) ?? "politics";
    const tier = getSourceTier(result.feed.name);

    for (const raw of result.items) {
      const publishedMs = raw.published.getTime();
      if (now - publishedMs > WINDOW_MS) continue;

      // Exact reposts of the same URL are noise, not corroboration.
      const linkKey = raw.link || `${result.feed.name}:${raw.title}`;
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);

      staged.push({ raw, source: result.feed.name, panel, tier, publishedMs });
    }
  }

  return staged;
}

/**
 * Collapse same-story groups to one row each, keeping the most authoritative
 * telling (lowest tier, then earliest — the source that broke it).
 */
function collapse(staged: Staged[], now: number): NewsItem[] {
  const clusters = clusterTexts(staged.map((entry) => entry.raw.title));
  const items: NewsItem[] = [];

  for (const cluster of clusters) {
    const members = cluster.map((index) => staged[index]!);
    members.sort((a, b) => a.tier - b.tier || a.publishedMs - b.publishedMs);

    const lead = members[0]!;
    const others = [...new Set(members.slice(1).map((member) => member.source))];
    const threat = classifyByKeyword(
      lead.raw.title,
      TECH_PANELS.has(lead.panel) ? "tech" : "full",
    );
    const hubs = inferGeoHubsFromTitle(lead.raw.title)
      .slice(0, 3)
      .map((match) => match.hubId);

    items.push({
      id: itemId(lead.raw.link, lead.raw.title),
      title: lead.raw.title,
      link: lead.raw.link,
      source: lead.source,
      panel: lead.panel,
      published: new Date(lead.publishedMs).toISOString(),
      publishedMissing: lead.raw.publishedMissing,
      summary: lead.raw.summary,
      threat,
      tier: lead.tier,
      hubs,
      corroboration: members.length,
      alsoReportedBy: others,
      score: scoreItem({
        level: threat.level,
        tier: lead.tier,
        publishedMs: lead.publishedMs,
        corroboration: members.length,
        now,
      }),
    });
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}

/**
 * A 0–100 read on how hot the window looks. Severity-weighted, corroboration-
 * aware and recency-decayed, then compressed — the curve is deliberately flat
 * at the top so an ordinary busy day sits near 40 and only a genuinely bad one
 * approaches 90. It is a heuristic for orientation, not a forecast.
 */
function escalationIndex(items: NewsItem[], now: number): number {
  let mass = 0;
  for (const item of items) {
    if (item.threat.level === "info" || item.threat.level === "low") continue;
    const corroboration = 1 + Math.log2(item.corroboration);
    mass +=
      LEVEL_WEIGHT[item.threat.level] *
      corroboration *
      recencyFactor(new Date(item.published).getTime(), now);
  }
  // Saturating curve: 60 units of weighted mass ≈ 50, 250 ≈ 80.
  return Math.round(100 * (1 - Math.exp(-mass / 90)));
}

export interface SnapshotOptions {
  /** Restrict to these panels; empty means the whole catalog. */
  panels?: string[];
  /** Feeds fetched per panel, in catalog order. Bounds refresh cost. */
  perPanelLimit?: number;
  /** Items returned after ranking. */
  limit?: number;
}

export async function buildSnapshot(
  options: SnapshotOptions = {},
): Promise<MonitorSnapshot> {
  const panelIds = options.panels?.length
    ? options.panels.filter((panel) => panel in FEED_PANELS)
    : Object.keys(FEED_PANELS);
  const perPanel = options.perPanelLimit ?? 6;

  const feeds: Feed[] = [];
  const panelOf = new Map<string, string>();
  for (const panelId of panelIds) {
    for (const feed of FEED_PANELS[panelId]!.feeds.slice(0, perPanel)) {
      if (panelOf.has(feed.name)) continue;
      panelOf.set(feed.name, panelId);
      feeds.push(feed);
    }
  }

  const results = await loadFeeds(feeds);
  const now = Date.now();
  const items = collapse(stage(results, panelOf, now), now);

  const levels: Record<ThreatLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const categories: Record<string, number> = {};
  const panels: Record<string, number> = {};
  for (const item of items) {
    levels[item.threat.level] += 1;
    categories[item.threat.category] = (categories[item.threat.category] ?? 0) + 1;
    panels[item.panel] = (panels[item.panel] ?? 0) + 1;
  }

  const health: FeedHealth[] = results.map((result) => ({
    name: result.feed.name,
    panel: panelOf.get(result.feed.name) ?? "politics",
    ok: !result.error && result.items.length > 0,
    items: result.items.length,
    error: result.error,
    fetchedAt: result.fetchedAt ? new Date(result.fetchedAt).toISOString() : undefined,
    cached: result.cached,
  }));
  const ok = health.filter((entry) => entry.ok).length;

  return {
    items: items.slice(0, options.limit ?? 400),
    hubs: hubActivityFrom(items).slice(0, 80),
    levels,
    categories,
    panels,
    escalation: escalationIndex(items, now),
    sources: { total: health.length, ok, failed: health.length - ok },
    health,
    generatedAt: new Date(now).toISOString(),
  };
}
