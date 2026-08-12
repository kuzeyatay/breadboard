// The measured half of the climate panel.
//
// Everything else on this monitor is somebody reporting something. These four
// series are instruments: NOAA's global greenhouse-gas archives, NASA GISS's
// surface temperature record, and NSIDC's daily sea-ice extent. They are public
// text files with no key and no quota, which is why they are read directly
// rather than through a data vendor.
//
// Each series is parsed by a pure function below — the parsers are the part
// worth testing, because a column moving in an upstream file is exactly the
// kind of breakage that would otherwise show up as a plausible wrong number.
// A source that fails takes itself out of the panel and leaves a note; it never
// takes the panel down with it.

import { getHazards } from "./hazards.ts";
import { buildMeasuredContext } from "./prompts.ts";
import type { ClimateIndicator } from "./types.ts";

const CO2_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_trend_gl.txt";
const CH4_URL = "https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt";
const GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";
const SEA_ICE_NORTH_URL =
  "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv";
const SEA_ICE_NORTH_CLIMATOLOGY_URL =
  "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_climatology_1981-2010_v4.0.csv";

/** These archives update daily at best, so re-reading them faster is pure waste. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; breadboard-worldmonitor/1.0; +https://github.com/koala73/worldmonitor)";

export interface SeriesPoint {
  /** UTC midnight of the observation. */
  date: Date;
  value: number;
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function isDataLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#");
}

/**
 * NOAA GML daily trend files: `year month day smoothed trend`, whitespace
 * separated, `#` comments. The trend column is the seasonally adjusted one, so
 * it is the column that means "where the atmosphere actually is" — the smoothed
 * column swings several ppm a year with the northern growing season.
 */
export function parseNoaaDailyTrend(text: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const line of text.split("\n")) {
    if (!isDataLine(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [year, month, day] = parts.map(Number);
    const trend = Number(parts[4]);
    if (!Number.isFinite(year) || !Number.isFinite(trend) || trend <= 0) continue;
    points.push({ date: new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1)), value: trend });
  }
  return points;
}

/**
 * NOAA GML monthly files: `year month decimal average average_unc trend
 * trend_unc`. Missing uncertainties come through as -9.99 and are ignored;
 * a missing *value* would be negative too, which the guard below drops.
 */
export function parseNoaaMonthlyTrend(text: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const line of text.split("\n")) {
    if (!isDataLine(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const trend = Number(parts[5]);
    if (!Number.isFinite(year) || !Number.isFinite(trend) || trend <= 0) continue;
    points.push({ date: new Date(Date.UTC(year, month - 1, 15)), value: trend });
  }
  return points;
}

/**
 * GISTEMP's `GLB.Ts+dSST.csv`: two header lines, then one row per year with
 * twelve monthly anomalies against the 1951–1980 mean. Months that have not
 * been published yet are `***`, which is why the latest row is read backwards
 * rather than assumed complete.
 */
export function parseGistempMonthly(text: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(",");
    const year = Number(parts[0]);
    if (!Number.isInteger(year) || year < 1800) continue;
    for (let month = 1; month <= 12; month += 1) {
      const raw = parts[month]?.trim();
      if (!raw || raw.includes("*")) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      points.push({ date: new Date(Date.UTC(year, month - 1, 15)), value });
    }
  }
  return points;
}

/**
 * NSIDC daily extent: `Year, Month, Day, Extent, Missing, Source Data`. The
 * source-data column is a quoted list that contains commas of its own, so only
 * the first four fields may be read by splitting.
 */
export function parseSeaIceDaily(text: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(",");
    if (parts.length < 4) continue;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const extent = Number(parts[3]);
    if (!Number.isInteger(year) || year < 1900) continue;
    if (!Number.isFinite(extent) || extent <= 0) continue;
    points.push({ date: new Date(Date.UTC(year, month - 1, day)), value: extent });
  }
  return points;
}

/**
 * NSIDC's 1981–2010 climatology, keyed by day of year: `DOY, Average Extent,
 * …`. It is what turns "6.4 million km²" into "1.9 million below normal for
 * the date", which is the only form in which a sea-ice number means anything.
 */
export function parseSeaIceClimatology(text: string): Map<number, number> {
  const byDoy = new Map<number, number>();
  for (const line of text.split("\n")) {
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const doy = Number(parts[0]?.trim());
    const average = Number(parts[1]?.trim());
    if (!Number.isInteger(doy) || doy < 1 || doy > 366) continue;
    if (!Number.isFinite(average) || average <= 0) continue;
    byDoy.set(doy, average);
  }
  return byDoy;
}

/** Day of year in UTC, 1–366 — the key NSIDC's climatology is indexed by. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

/** The value closest to `target`, within `toleranceDays`, or null. */
export function valueNear(
  points: SeriesPoint[],
  target: Date,
  toleranceDays: number,
): SeriesPoint | null {
  let best: SeriesPoint | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const gap = Math.abs(point.date.getTime() - target.getTime());
    if (gap < bestGap) {
      best = point;
      bestGap = gap;
    }
  }
  if (!best || bestGap > toleranceDays * 86_400_000) return null;
  return best;
}

function trendOf(change: number | undefined, epsilon: number): "up" | "down" | "flat" {
  if (change === undefined || Math.abs(change) < epsilon) return "flat";
  return change > 0 ? "up" : "down";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ── Assembly ────────────────────────────────────────────────────────────────

async function readText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/csv,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Greenhouse gas: latest global trend value, and the same file a year back. */
function co2Indicator(text: string): ClimateIndicator | null {
  const points = parseNoaaDailyTrend(text);
  const latest = points[points.length - 1];
  if (!latest) return null;

  const yearAgo = valueNear(points, new Date(latest.date.getTime() - 365 * 86_400_000), 15);
  const change = yearAgo ? latest.value - yearAgo.value : undefined;

  return {
    id: "co2",
    label: "CO₂ (global)",
    value: round(latest.value, 2),
    unit: "ppm",
    asOf: isoDate(latest.date),
    change: change === undefined ? undefined : round(change, 2),
    changeLabel: "vs. a year ago",
    detail: "Seasonally adjusted global mean. Pre-industrial was about 280 ppm.",
    source: "NOAA GML",
    sourceUrl: "https://gml.noaa.gov/ccgg/trends/global.html",
    trend: trendOf(change, 0.05),
    concern: "up",
  };
}

function ch4Indicator(text: string): ClimateIndicator | null {
  const points = parseNoaaMonthlyTrend(text);
  const latest = points[points.length - 1];
  if (!latest) return null;

  const yearAgo = valueNear(points, new Date(latest.date.getTime() - 365 * 86_400_000), 25);
  const change = yearAgo ? latest.value - yearAgo.value : undefined;

  return {
    id: "ch4",
    label: "Methane (global)",
    value: round(latest.value, 1),
    unit: "ppb",
    asOf: isoDate(latest.date),
    change: change === undefined ? undefined : round(change, 1),
    changeLabel: "vs. a year ago",
    detail: "Roughly 80× the warming effect of CO₂ over twenty years.",
    source: "NOAA GML",
    sourceUrl: "https://gml.noaa.gov/ccgg/trends_ch4/",
    trend: trendOf(change, 0.5),
    concern: "up",
  };
}

/**
 * Surface temperature. The headline number is the twelve-month mean rather than
 * the latest month: a single month swings with weather, and the whole point of
 * the series is the part that is not weather.
 */
function temperatureIndicator(text: string): ClimateIndicator | null {
  const points = parseGistempMonthly(text);
  const latest = points[points.length - 1];
  if (!latest || points.length < 24) return null;

  const window = points.slice(-12);
  const previous = points.slice(-24, -12);
  const mean = window.reduce((sum, point) => sum + point.value, 0) / window.length;
  const priorMean = previous.reduce((sum, point) => sum + point.value, 0) / previous.length;
  const change = mean - priorMean;

  return {
    id: "temp-anomaly",
    label: "Global temperature",
    value: round(mean, 2),
    unit: "°C",
    asOf: isoDate(latest.date),
    change: round(change, 2),
    changeLabel: "vs. the twelve months before",
    detail: `Twelve-month mean anomaly against 1951–1980; latest month ${round(latest.value, 2)} °C.`,
    source: "NASA GISTEMP v4",
    sourceUrl: "https://data.giss.nasa.gov/gistemp/",
    trend: trendOf(change, 0.02),
    concern: "up",
  };
}

/** Arctic sea ice, stated as the departure from the 1981–2010 normal for the date. */
function seaIceIndicator(dailyText: string, climatologyText: string): ClimateIndicator | null {
  const points = parseSeaIceDaily(dailyText);
  const latest = points[points.length - 1];
  if (!latest) return null;

  const climatology = parseSeaIceClimatology(climatologyText);
  const normal = climatology.get(dayOfYear(latest.date));
  const change = normal === undefined ? undefined : latest.value - normal;

  return {
    id: "sea-ice-north",
    label: "Arctic sea ice",
    value: round(latest.value, 2),
    unit: "M km²",
    asOf: isoDate(latest.date),
    change: change === undefined ? undefined : round(change, 2),
    changeLabel: "vs. the 1981–2010 normal for the date",
    detail: "Daily extent from passive microwave imagery.",
    source: "NSIDC Sea Ice Index",
    sourceUrl: "https://nsidc.org/arcticseaicenews/",
    trend: trendOf(change, 0.05),
    // Ice going the other way is the warming signal, so less is the worry here.
    concern: "down",
  };
}

interface CachedIndicators {
  indicators: ClimateIndicator[];
  notes: string[];
  at: number;
}

let cache: CachedIndicators | null = null;
let inFlight: Promise<CachedIndicators> | null = null;

async function settle<T>(
  label: string,
  work: () => Promise<T>,
  notes: string[],
): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    notes.push(`${label}: ${error instanceof Error ? error.message : "unavailable"}`);
    return null;
  }
}

async function loadIndicators(): Promise<CachedIndicators> {
  const notes: string[] = [];

  const [co2, ch4, temperature, seaIce] = await Promise.all([
    settle("NOAA CO₂", async () => co2Indicator(await readText(CO2_URL)), notes),
    settle("NOAA methane", async () => ch4Indicator(await readText(CH4_URL)), notes),
    settle("NASA GISTEMP", async () => temperatureIndicator(await readText(GISTEMP_URL)), notes),
    settle(
      "NSIDC sea ice",
      async () => {
        const [daily, climatology] = await Promise.all([
          readText(SEA_ICE_NORTH_URL),
          readText(SEA_ICE_NORTH_CLIMATOLOGY_URL),
        ]);
        return seaIceIndicator(daily, climatology);
      },
      notes,
    ),
  ]);

  const indicators = [co2, ch4, temperature, seaIce].filter(
    (indicator): indicator is ClimateIndicator => indicator !== null,
  );

  return { indicators, notes, at: Date.now() };
}

/**
 * The indicator row, cached for six hours and shared between concurrent
 * callers. When every archive fails the last good copy is served rather than an
 * empty panel — a stale CO₂ reading is still true, it is just not from today.
 */
export async function getClimateIndicators(): Promise<{
  indicators: ClimateIndicator[];
  notes: string[];
}> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { indicators: cache.indicators, notes: cache.notes };
  }

  if (!inFlight) {
    inFlight = loadIndicators().finally(() => {
      inFlight = null;
    });
  }

  const loaded = await inFlight;

  // A refresh that came back with nothing keeps the previous readings — but it
  // does NOT keep the previous notes, or a panel whose sources are all down
  // would look like a panel that is simply up to date.
  if (loaded.indicators.length === 0 && cache) {
    return { indicators: cache.indicators, notes: loaded.notes };
  }

  cache = loaded;
  return { indicators: loaded.indicators, notes: loaded.notes };
}

/** Test seam: drop the cached indicators. */
export function resetClimateCache(): void {
  cache = null;
  inFlight = null;
}

/**
 * The measured picture as prompt text, for the brief and the analyst.
 *
 * Both callers are already doing a full feed refresh, and both of these are
 * cached, so this costs nothing in the usual case. It never throws: a brief
 * that cannot be written because a sea-ice file was slow would be a bad trade.
 */
export async function measuredContext(): Promise<string> {
  try {
    const [{ indicators }, { hazards }] = await Promise.all([
      getClimateIndicators(),
      getHazards(),
    ]);
    return buildMeasuredContext(indicators, hazards);
  } catch {
    return "";
  }
}
