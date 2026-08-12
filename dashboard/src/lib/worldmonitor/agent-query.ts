// The world monitor, addressed by an agent instead of by the console.
//
// `/worldmonitor` renders a snapshot; the model needs to *ask questions of*
// one. The difference is mostly shaping: a snapshot carries up to 400 headlines
// with full summaries, which is a page on screen and a wasted context window in
// a chat. Everything here narrows first and returns compact records, and every
// filter is applied to the same ranked pipeline the console draws, so an answer
// the agent gives and a screen the user is looking at cannot disagree.
//
// Feeds are cached per source for ten minutes in ./rss.ts, so a catalog call, a
// snapshot and three searches in one turn cost one fetch, not five.

import { buildSnapshot } from "./aggregate.ts";
import { getClimateIndicators } from "./climate.ts";
import { FEED_PANELS, panelLabel } from "./feeds.ts";
import { GEO_HUBS } from "./geo-hubs.ts";
import { getHazards } from "./hazards.ts";
import { THREAT_LABELS } from "./threat.ts";
import type {
  ClimateIndicator,
  HazardEvent,
  HubActivity,
  HubWeather,
  MonitorSnapshot,
  NewsItem,
  ThreatLevel,
} from "./types.ts";
import { fetchHubWeather, hubsByIds, MAX_WEATHER_HUBS } from "./weather.ts";

export const THREAT_LEVELS: readonly ThreatLevel[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

/** Upstream's category vocabulary, restated so a caller can be told the set. */
export const EVENT_CATEGORIES: readonly string[] = [
  "conflict",
  "protest",
  "disaster",
  "diplomatic",
  "economic",
  "terrorism",
  "cyber",
  "health",
  "environmental",
  "military",
  "crime",
  "infrastructure",
  "tech",
  "general",
];

/** Headlines kept per answer. Small on purpose — this lands in a context window. */
const DEFAULT_ITEM_LIMIT = 12;
const MAX_ITEM_LIMIT = 50;
const SUMMARY_CHARS = 220;

export class WorldMonitorQueryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorldMonitorQueryError";
    this.status = status;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.trunc(parsed), min, max);
}

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Panels named by a caller, rejected loudly rather than silently ignored: a
 * typo that quietly widens the query to the whole world is the kind of thing
 * that ends up in an answer as a fact.
 */
function resolvePanels(value: unknown): string[] {
  const requested = stringList(value);
  if (requested.length === 0) return [];
  const unknown = requested.filter((panel) => !(panel in FEED_PANELS));
  if (unknown.length > 0) {
    throw new WorldMonitorQueryError(
      `Unknown panel(s): ${unknown.join(", ")}. Call worldmonitor_catalog for the list.`,
    );
  }
  return requested;
}

function resolveLevels(value: unknown): ThreatLevel[] {
  const requested = stringList(value);
  const unknown = requested.filter(
    (level) => !(THREAT_LEVELS as readonly string[]).includes(level),
  );
  if (unknown.length > 0) {
    throw new WorldMonitorQueryError(
      `Unknown level(s): ${unknown.join(", ")}. Levels are ${THREAT_LEVELS.join(", ")}.`,
    );
  }
  return requested as ThreatLevel[];
}

// ── shaping ─────────────────────────────────────────────────────────────────

export interface AgentNewsItem {
  id: string;
  title: string;
  source: string;
  /** 1 = wire services and official bodies, 4 = least authoritative. */
  tier: number;
  panel: string;
  published: string;
  /** True when the feed carried no date and arrival time was stamped instead. */
  publishedApprox?: true;
  level: ThreatLevel;
  category: string;
  /** `keyword` = the deterministic cascade, `llm` = a model re-read it. */
  classifiedBy: "keyword" | "llm";
  /** How many independent sources in this window carry the same story. */
  corroboration: number;
  alsoReportedBy?: string[];
  hubs?: string[];
  link: string;
  summary?: string;
}

function shapeItem(item: NewsItem, options: { summaries: boolean }): AgentNewsItem {
  const shaped: AgentNewsItem = {
    id: item.id,
    title: item.title,
    source: item.source,
    tier: item.tier,
    panel: item.panel,
    published: item.published,
    level: item.threat.level,
    category: item.threat.category,
    classifiedBy: item.threat.source,
    corroboration: item.corroboration,
    link: item.link,
  };
  if (item.publishedMissing) shaped.publishedApprox = true;
  if (item.alsoReportedBy.length > 0) shaped.alsoReportedBy = item.alsoReportedBy.slice(0, 6);
  if (item.hubs.length > 0) shaped.hubs = item.hubs.slice(0, 4);
  if (options.summaries && item.summary) shaped.summary = truncate(item.summary, SUMMARY_CHARS);
  return shaped;
}

function shapeHub(hub: HubActivity) {
  return {
    id: hub.id,
    name: hub.name,
    country: hub.country,
    region: hub.region,
    headlines: hub.count,
    topLevel: hub.level,
    topHeadline: hub.topHeadline,
  };
}

/**
 * Sources that failed, named. A monitor that lost a third of its feeds and one
 * that genuinely has nothing to report look identical in the counts, so the
 * gaps travel with every answer rather than being available on request.
 */
function shapeSourceHealth(snapshot: MonitorSnapshot) {
  const failed = snapshot.health.filter((entry) => !entry.ok);
  return {
    total: snapshot.sources.total,
    ok: snapshot.sources.ok,
    failed: snapshot.sources.failed,
    failedSources: failed
      .slice(0, 12)
      .map((entry) => ({ name: entry.name, panel: entry.panel, error: entry.error ?? "no items" })),
  };
}

// ── catalog ─────────────────────────────────────────────────────────────────

/**
 * The vocabulary every other tool's filters are written in. No network: it is
 * the shipped catalog, so it is the cheap call to make before guessing at a
 * panel id or a hub name.
 */
export function monitorCatalog(options: { region?: unknown } = {}) {
  const region = typeof options.region === "string" ? options.region.trim().toLowerCase() : "";
  const hubs = region
    ? GEO_HUBS.filter(
        (hub) =>
          hub.region.toLowerCase().includes(region) ||
          hub.country.toLowerCase().includes(region),
      )
    : GEO_HUBS;

  const byRegion = new Map<string, { id: string; name: string; country: string; tier: string }[]>();
  for (const hub of hubs) {
    const bucket = byRegion.get(hub.region) ?? [];
    bucket.push({ id: hub.id, name: hub.name, country: hub.country, tier: hub.tier });
    byRegion.set(hub.region, bucket);
  }

  return {
    panels: Object.keys(FEED_PANELS).map((id) => ({
      id,
      label: panelLabel(id),
      feeds: FEED_PANELS[id]!.feeds.length,
    })),
    levels: THREAT_LEVELS.map((level) => ({ id: level, label: THREAT_LABELS[level] })),
    categories: [...EVENT_CATEGORIES],
    hubs: [...byRegion.entries()].map(([name, entries]) => ({ region: name, hubs: entries })),
    hubCount: hubs.length,
    matchedRegion: region || undefined,
  };
}

// ── snapshot ────────────────────────────────────────────────────────────────

export interface SnapshotQuery {
  panels?: unknown;
  depth?: unknown;
  limit?: unknown;
  includeItems?: unknown;
  includeSummaries?: unknown;
}

/**
 * The live picture: how hot the window looks, what it is made of, where it is
 * concentrated, and the top headlines behind that.
 */
export async function monitorSnapshot(query: SnapshotQuery = {}) {
  const panels = resolvePanels(query.panels);
  const snapshot = await buildSnapshot({
    panels,
    perPanelLimit: numberOption(query.depth, 6, 1, 14),
  });

  const limit = numberOption(query.limit, DEFAULT_ITEM_LIMIT, 1, MAX_ITEM_LIMIT);
  const includeItems = query.includeItems !== false;
  const summaries = query.includeSummaries !== false;

  return {
    generatedAt: snapshot.generatedAt,
    scope: panels.length > 0 ? panels : "all panels",
    /** 0–100 composite of threat weight, corroboration and recency. */
    escalation: snapshot.escalation,
    headlines: snapshot.items.length,
    levels: snapshot.levels,
    categories: snapshot.categories,
    panels: snapshot.panels,
    hotspots: snapshot.hubs.slice(0, 10).map(shapeHub),
    topItems: includeItems
      ? snapshot.items.slice(0, limit).map((item) => shapeItem(item, { summaries }))
      : undefined,
    sources: shapeSourceHealth(snapshot),
  };
}

// ── search ──────────────────────────────────────────────────────────────────

export interface SearchQuery extends SnapshotQuery {
  query?: unknown;
  levels?: unknown;
  categories?: unknown;
  hubs?: unknown;
  region?: unknown;
  source?: unknown;
  maxTier?: unknown;
  minCorroboration?: unknown;
  sinceHours?: unknown;
}

/** Every term must appear somewhere in the record — predictable beats clever. */
function matchesText(item: NewsItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${item.title} ${item.summary} ${item.source}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Ask the current window a question. Ranking is the monitor's own — threat ×
 * recency × source authority × corroboration — so "the most important thing
 * about X" is the first hit rather than something the caller has to re-derive.
 */
export async function monitorSearch(query: SearchQuery = {}) {
  const panels = resolvePanels(query.panels);
  const levels = new Set(resolveLevels(query.levels));
  const categories = new Set(stringList(query.categories));
  const hubIds = new Set(stringList(query.hubs));
  const region = typeof query.region === "string" ? query.region.trim().toLowerCase() : "";
  const source = typeof query.source === "string" ? query.source.trim().toLowerCase() : "";
  const maxTier = numberOption(query.maxTier, 4, 1, 4);
  const minCorroboration = numberOption(query.minCorroboration, 1, 1, 20);
  const sinceHours = numberOption(query.sinceHours, 0, 0, 24 * 14);
  const terms = typeof query.query === "string"
    ? query.query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean)
    : [];

  // A region filter is expressed in hub ids, because that is what a headline
  // actually carries — the geo pass pinned it to hubs, not to a country string.
  const regionHubIds = region
    ? new Set(
        GEO_HUBS.filter(
          (hub) =>
            hub.region.toLowerCase().includes(region) ||
            hub.country.toLowerCase().includes(region) ||
            hub.name.toLowerCase().includes(region),
        ).map((hub) => hub.id),
      )
    : null;
  if (regionHubIds && regionHubIds.size === 0) {
    throw new WorldMonitorQueryError(
      `No hub matches "${query.region}". Call worldmonitor_catalog for the places the monitor knows.`,
    );
  }

  const snapshot = await buildSnapshot({
    panels,
    perPanelLimit: numberOption(query.depth, 6, 1, 14),
  });

  const cutoff = sinceHours > 0 ? Date.now() - sinceHours * 3_600_000 : 0;
  const matches = snapshot.items.filter((item) => {
    if (levels.size > 0 && !levels.has(item.threat.level)) return false;
    if (categories.size > 0 && !categories.has(item.threat.category)) return false;
    if (hubIds.size > 0 && !item.hubs.some((hub) => hubIds.has(hub))) return false;
    if (regionHubIds && !item.hubs.some((hub) => regionHubIds.has(hub))) return false;
    if (source && !item.source.toLowerCase().includes(source)) return false;
    if (item.tier > maxTier) return false;
    if (item.corroboration < minCorroboration) return false;
    if (cutoff > 0 && new Date(item.published).getTime() < cutoff) return false;
    return matchesText(item, terms);
  });

  const limit = numberOption(query.limit, 20, 1, MAX_ITEM_LIMIT);
  const summaries = query.includeSummaries !== false;
  const levelCounts: Record<string, number> = {};
  for (const item of matches) {
    levelCounts[item.threat.level] = (levelCounts[item.threat.level] ?? 0) + 1;
  }

  return {
    generatedAt: snapshot.generatedAt,
    matched: matches.length,
    returned: Math.min(matches.length, limit),
    /** Of the whole current window, so "3 of 380" reads honestly. */
    searched: snapshot.items.length,
    levels: levelCounts,
    items: matches.slice(0, limit).map((item) => shapeItem(item, { summaries })),
    sources: shapeSourceHealth(snapshot),
  };
}

// ── climate, hazards and local conditions ───────────────────────────────────

export interface ClimateQuery {
  hubs?: unknown;
  include?: unknown;
  hazardKinds?: unknown;
  minHazardLevel?: unknown;
  limit?: unknown;
}

const HAZARD_RANK: Record<ThreatLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function shapeIndicator(indicator: ClimateIndicator) {
  return {
    id: indicator.id,
    label: indicator.label,
    value: indicator.value,
    unit: indicator.unit,
    asOf: indicator.asOf,
    change: indicator.change,
    changeLabel: indicator.changeLabel,
    trend: indicator.trend,
    /** Which direction is the worrying one for this series. */
    concern: indicator.concern,
    detail: indicator.detail,
    source: indicator.source,
  };
}

function shapeHazard(hazard: HazardEvent) {
  return {
    id: hazard.id,
    kind: hazard.kind,
    title: hazard.title,
    country: hazard.country,
    level: hazard.level,
    alert: hazard.alert,
    severity: hazard.severity,
    population: hazard.population,
    from: hazard.from,
    /** When it was last revised — what "recent" has to mean for a live alert. */
    updated: hazard.updated,
    climateDriven: hazard.climateDriven,
    link: hazard.link,
  };
}

function shapeWeather(reading: HubWeather) {
  return {
    hubId: reading.hubId,
    name: reading.name,
    country: reading.country,
    localTime: reading.localTime,
    timezone: reading.timezone,
    conditions: reading.conditions,
    temperatureC: reading.temperatureC,
    feelsLikeC: reading.apparentC,
    minC: reading.minC,
    maxC: reading.maxC,
    humidity: reading.humidity,
    precipitationMm: reading.precipitationMm,
    windKph: reading.windKph,
    stress: reading.stress.kind === "none" ? undefined : reading.stress,
  };
}

/**
 * The measured layer: global indicators, live hazard alerts, and the current
 * conditions plus wall clock at named hubs.
 *
 * The three sources fail independently and so does this: whatever answered is
 * returned and whatever did not is named in `notes`, because a missing archive
 * reported as "no alerts" would be a lie in the shape of an answer.
 */
export async function monitorClimate(query: ClimateQuery = {}) {
  const include = new Set(stringList(query.include));
  const wants = (part: string) => include.size === 0 || include.has(part);

  const notes: string[] = [];
  const requestedHubs = stringList(query.hubs).slice(0, MAX_WEATHER_HUBS * 2);
  const hubs = wants("weather") ? hubsByIds(requestedHubs) : [];
  if (requestedHubs.length > 0 && hubs.length === 0 && wants("weather")) {
    throw new WorldMonitorQueryError(
      `None of those hub ids exist: ${requestedHubs.join(", ")}. Call worldmonitor_catalog for the list.`,
    );
  }
  // An empty weather list because no place was named reads exactly like an
  // empty one because Open-Meteo was down. Say which.
  if (wants("weather") && requestedHubs.length === 0) {
    notes.push("No hubs named, so no local weather or clock was read.");
  }

  const hazardKinds = new Set(stringList(query.hazardKinds));
  const minLevel = HAZARD_RANK[(stringList(query.minHazardLevel)[0] as ThreatLevel) ?? "info"] ?? 0;
  const limit = numberOption(query.limit, 20, 1, 60);

  const [indicators, hazards, weather] = await Promise.all([
    wants("indicators")
      ? getClimateIndicators()
      : Promise.resolve({ indicators: [] as ClimateIndicator[], notes: [] as string[] }),
    wants("hazards")
      ? getHazards()
      : Promise.resolve({ hazards: [] as HazardEvent[], note: undefined as string | undefined }),
    fetchHubWeather(hubs).catch((error: unknown) => {
      notes.push(`Open-Meteo: ${error instanceof Error ? error.message : "unavailable"}`);
      return [] as HubWeather[];
    }),
  ]);
  if (hazards.note) notes.push(hazards.note);

  const selected = hazards.hazards
    .filter((hazard) => (hazardKinds.size === 0 || hazardKinds.has(hazard.kind)))
    .filter((hazard) => HAZARD_RANK[hazard.level] >= minLevel)
    .sort((a, b) => HAZARD_RANK[b.level] - HAZARD_RANK[a.level] || b.updated.localeCompare(a.updated));

  return {
    generatedAt: new Date().toISOString(),
    indicators: wants("indicators") ? indicators.indicators.map(shapeIndicator) : undefined,
    hazards: wants("hazards")
      ? { total: selected.length, events: selected.slice(0, limit).map(shapeHazard) }
      : undefined,
    weather: wants("weather") ? weather.map(shapeWeather) : undefined,
    notes: [...indicators.notes, ...notes],
  };
}
