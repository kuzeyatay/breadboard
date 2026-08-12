// Live natural-hazard alerts, from GDACS.
//
// GDACS is the EU Joint Research Centre / UN alerting service: every tropical
// cyclone, flood, drought, wildfire, earthquake and eruption it tracks, with an
// assessed alert colour and the population inside the footprint. That last part
// is why it is here rather than a raw event catalog — "green earthquake, 880
// thousand people at MMI IV" is an assessment, and the monitor's own levels are
// assessments too, so the two vocabularies line up.
//
// Its RSS is namespaced (`gdacs:`, `geo:`), which the general feed reader in
// `rss.ts` deliberately ignores — it only wants title, link and date. So this
// module reads the same XML with its own small parser and keeps the fields that
// make an alert placeable and rankable.

import type { HazardEvent, HazardKind, ThreatLevel } from "./types.ts";

const GDACS_RSS_URL = "https://www.gdacs.org/xml/rss.xml";
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
/**
 * How stale an alert may be before it leaves the list — measured from when
 * GDACS last revised it, not from when the event began. A drought that started
 * in March and was re-assessed this morning is the most current thing on the
 * feed; ageing it by its start date would drop every drought on the map.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; breadboard-worldmonitor/1.0; +https://github.com/koala73/worldmonitor)";

/** GDACS event types, folded onto the kinds this panel draws. */
const KINDS: Record<string, HazardKind> = {
  TC: "cyclone",
  FL: "flood",
  DR: "drought",
  WF: "wildfire",
  EQ: "earthquake",
  VO: "volcano",
  TS: "other",
};

/** The kinds that are weather or climate driven rather than geological. */
const CLIMATE_DRIVEN = new Set<HazardKind>(["cyclone", "flood", "drought", "wildfire"]);

/**
 * Alert colour → monitor level. Green stays `low`: GDACS raises a green alert
 * for every tracked event, so treating them as medium would put a few hundred
 * routine tremors on the map at the same weight as a reported strike.
 */
const ALERT_LEVELS: Record<string, { level: ThreatLevel; alert: "red" | "orange" | "green" }> = {
  red: { level: "critical", alert: "red" },
  orange: { level: "high", alert: "orange" },
  green: { level: "low", alert: "green" },
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[body.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decode(match[1] ?? "") : "";
}

function attribute(block: string, tag: string, name: string): string {
  const match = block.match(new RegExp(`<${tag}\\s[^>]*${name}="([^"]*)"`, "i"));
  return match ? decode(match[1] ?? "") : "";
}

/**
 * Parse the GDACS feed. Exported and pure so the field mapping can be tested
 * against a captured item rather than against whatever is happening on Earth
 * the day the suite runs.
 */
export function parseGdacsRss(xml: string, now = Date.now()): HazardEvent[] {
  const events: HazardEvent[] = [];
  const seen = new Set<string>();

  for (const chunk of xml.split(/<item[\s>]/i).slice(1)) {
    const block = chunk.split(/<\/item>/i)[0] ?? "";

    const eventType = tagText(block, "gdacs:eventtype").toUpperCase();
    const kind = KINDS[eventType] ?? "other";

    const alertKey = tagText(block, "gdacs:alertlevel").toLowerCase();
    const alert = ALERT_LEVELS[alertKey];
    if (!alert) continue;

    const lat = Number(tagText(block, "geo:lat"));
    const lon = Number(tagText(block, "geo:long"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const title = tagText(block, "title");
    if (!title) continue;

    const id = tagText(block, "guid") || `${eventType}${tagText(block, "gdacs:eventid")}`;
    if (!id || seen.has(id)) continue;

    const parseDate = (raw: string, fallback: number): number => {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const updated = parseDate(
      tagText(block, "gdacs:datemodified") || tagText(block, "pubDate"),
      now,
    );
    if (now - updated > MAX_AGE_MS) continue;

    const from = parseDate(tagText(block, "gdacs:fromdate"), updated);

    seen.add(id);
    events.push({
      id,
      kind,
      title,
      country: tagText(block, "gdacs:country"),
      lat,
      lon,
      level: alert.level,
      alert: alert.alert,
      severity: tagText(block, "gdacs:severity") || attribute(block, "gdacs:severity", "value") || undefined,
      population: tagText(block, "gdacs:population") || undefined,
      link: tagText(block, "link"),
      from: new Date(from).toISOString(),
      updated: new Date(updated).toISOString(),
      climateDriven: CLIMATE_DRIVEN.has(kind),
    });
  }

  // Loudest first, then most recently revised — the order the panel reads in.
  const rank: Record<string, number> = { red: 3, orange: 2, green: 1 };
  events.sort(
    (a, b) =>
      (rank[b.alert] ?? 0) - (rank[a.alert] ?? 0) ||
      Date.parse(b.updated) - Date.parse(a.updated),
  );
  return events;
}

interface Cached {
  events: HazardEvent[];
  at: number;
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function load(): Promise<Cached> {
  const response = await fetch(GDACS_RSS_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,application/xml,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GDACS HTTP ${response.status}`);
  return { events: parseGdacsRss(await response.text()), at: Date.now() };
}

/**
 * The current alert list, cached for fifteen minutes. On a failed refresh the
 * last good list is served with a note: an alert from twenty minutes ago is
 * still worth showing, an empty hazard panel implies an empty world.
 */
export async function getHazards(): Promise<{ hazards: HazardEvent[]; note?: string }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { hazards: cache.events };

  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }

  try {
    cache = await inFlight;
    return { hazards: cache.events };
  } catch (error) {
    const note = `GDACS: ${error instanceof Error ? error.message : "unavailable"}`;
    return { hazards: cache?.events ?? [], note };
  }
}

/** Test seam: drop the cached alerts. */
export function resetHazardCache(): void {
  cache = null;
  inFlight = null;
}
