// The shapes the world monitor moves around, shared by the server aggregation
// and the client shell. Levels and categories are upstream worldmonitor's
// vocabulary (github.com/koala73/worldmonitor, AGPL-3.0) so the ported keyword
// tables and prompts keep meaning the same thing on both sides.

export type ThreatLevel = "critical" | "high" | "medium" | "low" | "info";

export type EventCategory =
  | "conflict"
  | "protest"
  | "disaster"
  | "diplomatic"
  | "economic"
  | "terrorism"
  | "cyber"
  | "health"
  | "environmental"
  | "military"
  | "crime"
  | "infrastructure"
  | "tech"
  | "general";

export interface ThreatClassification {
  level: ThreatLevel;
  category: EventCategory;
  confidence: number;
  /** `keyword` = the deterministic cascade, `llm` = ChatMock re-read it. */
  source: "keyword" | "llm";
}

/** A headline after fetch, parse, classification and geo inference. */
export interface NewsItem {
  /** Stable across refreshes: a hash of the link (or of the title, feedless). */
  id: string;
  title: string;
  link: string;
  /** Feed name as it appears in the catalog — the key into the tier table. */
  source: string;
  /** Catalog panel the feed belongs to (`politics`, `middleeast`, …). */
  panel: string;
  /** ISO timestamp. */
  published: string;
  /** Whether the feed actually carried a date, or we stamped arrival time. */
  publishedMissing: boolean;
  summary: string;
  threat: ThreatClassification;
  /** Source tier 1–4; 1 = wire services and official bodies. */
  tier: number;
  /** Geo hub ids this headline was pinned to, most confident first. */
  hubs: string[];
  /** How many sources in this window carry the same story (1 = only this one). */
  corroboration: number;
  /** The other sources carrying it, for the corroboration tooltip. */
  alsoReportedBy: string[];
  /** Ranking score: threat × recency × source authority × corroboration. */
  score: number;
}

/** A hub with headlines attached — one dot on the map. */
export interface HubActivity {
  id: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  type: "capital" | "conflict" | "strategic" | "organization";
  count: number;
  /** Highest level seen at this hub in the current window. */
  level: ThreatLevel;
  /** Sum of level weights — what sizes the dot. */
  weight: number;
  topHeadline: string;
}

export interface FeedHealth {
  name: string;
  panel: string;
  ok: boolean;
  items: number;
  /** Present when the last attempt failed. */
  error?: string;
  /** ISO timestamp of the newest successful fetch. */
  fetchedAt?: string;
  /** True when the items came from cache rather than a fresh fetch. */
  cached: boolean;
}

export interface MonitorSnapshot {
  items: NewsItem[];
  hubs: HubActivity[];
  levels: Record<ThreatLevel, number>;
  categories: Record<string, number>;
  panels: Record<string, number>;
  /** 0–100 composite of how hot the current window looks. */
  escalation: number;
  sources: { total: number; ok: number; failed: number };
  health: FeedHealth[];
  generatedAt: string;
}

// ── Climate, weather and local time ─────────────────────────────────────────
//
// The headline wire says what is being reported; these three say what is
// measured. They come from open observational archives rather than from feeds,
// so they carry their own provenance — every number on the climate panel can
// name the archive it came from and the day it was observed.

/** One measured global series, read down to its latest observation. */
export interface ClimateIndicator {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** ISO date of the observation itself, not of the fetch. */
  asOf: string;
  /** Signed change against `changeLabel`'s comparison, in the same unit. */
  change?: number;
  changeLabel?: string;
  /** One line a reader can take away without knowing the series. */
  detail?: string;
  source: string;
  sourceUrl: string;
  /** Which way the series is currently moving. */
  trend: "up" | "down" | "flat";
  /** Which direction is the worrying one, so the panel can colour honestly. */
  concern: "up" | "down";
}

export type WeatherStressKind = "heat" | "cold" | "wind" | "rain" | "none";

/** Current conditions and the wall clock at one hub. */
export interface HubWeather {
  hubId: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  temperatureC: number;
  apparentC: number;
  humidity: number;
  precipitationMm: number;
  windKph: number;
  /** WMO weather interpretation code, decoded into `conditions`. */
  code: number;
  conditions: string;
  isDay: boolean;
  maxC: number;
  minC: number;
  /** IANA zone Open-Meteo resolved for the coordinates. */
  timezone: string;
  utcOffsetMinutes: number;
  /** Local wall clock at fetch time, "HH:MM" — the client re-derives it as it ticks. */
  localTime: string;
  localHour: number;
  stress: {
    kind: WeatherStressKind;
    level: ThreatLevel;
    /** Why it was flagged, in the units that flagged it. */
    note: string;
  };
}

export type HazardKind =
  | "cyclone"
  | "flood"
  | "drought"
  | "wildfire"
  | "earthquake"
  | "volcano"
  | "other";

/** A live natural-hazard alert with a place and a severity. */
export interface HazardEvent {
  id: string;
  kind: HazardKind;
  title: string;
  country: string;
  lat: number;
  lon: number;
  /** GDACS alert colour, folded onto the monitor's own level vocabulary. */
  level: ThreatLevel;
  alert: "red" | "orange" | "green";
  severity?: string;
  population?: string;
  link: string;
  /** When the event began. A drought's is months before anyone is looking. */
  from: string;
  /** When GDACS last revised it — what "recent" has to mean for a live alert. */
  updated: string;
  /** True for the weather- and climate-driven kinds (cyclone, flood, drought, fire). */
  climateDriven: boolean;
}

export interface ClimateSnapshot {
  indicators: ClimateIndicator[];
  weather: HubWeather[];
  hazards: HazardEvent[];
  /** Sources that did not answer this time, named rather than silently dropped. */
  notes: string[];
  generatedAt: string;
}
