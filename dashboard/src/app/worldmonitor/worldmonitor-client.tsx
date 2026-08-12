"use client";

// The world monitor shell.
//
// The arrangement is upstream worldmonitor's, panel for panel: command bar,
// GLOBAL SITUATION strip, a full-width map with layers pinned top-left and the
// legend along its bottom, then three columns — live stream, hotspot grid, and
// the AI column. What changes is the surface: upstream is a black tactical
// console with neon threat colours, and this is the same instrument rebuilt on
// Breadboard's paper, neumorphic depth and botanical palette.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { hubActivityFrom } from "@/lib/worldmonitor/hub-activity.ts";
import type {
  ClimateSnapshot,
  HubWeather,
  MonitorSnapshot,
  NewsItem,
  ThreatLevel,
} from "@/lib/worldmonitor/types.ts";
import { localClock, MAX_WEATHER_HUBS } from "@/lib/worldmonitor/weather.ts";
import ClimatePanel from "./climate-panel";
import { LiveNewsView, WebcamsView } from "./live-video";
import WorldMap, { levelName, type MapLayer, type MapMode } from "./world-map";

const LEVEL_ORDER: ThreatLevel[] = ["critical", "high", "medium", "low", "info"];

/** Auto-refresh cadence. Feeds are cached server-side for ten minutes, so a
 *  faster tick would mostly re-render the same items. */
const REFRESH_MS = 5 * 60 * 1000;

const RANGES = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "6h", label: "6h", hours: 6 },
  { id: "24h", label: "24h", hours: 24 },
  { id: "48h", label: "48h", hours: 48 },
  { id: "all", label: "All", hours: 24 * 7 },
];

/**
 * The layer list. Upstream's layers are data sources it fetches separately
 * (military bases, undersea cables, spaceports); Breadboard's are the strata it
 * actually has — where a hub is, and what kind of event put it on the map — so
 * every switch changes the picture instead of promising a feed that is not there.
 */
const HUB_TYPE_LAYERS = [
  { id: "type:capital", label: "Capitals", types: ["capital"] },
  { id: "type:conflict", label: "Conflict zones", types: ["conflict"] },
  { id: "type:strategic", label: "Strategic sites", types: ["strategic"] },
  { id: "type:organization", label: "Organisations", types: ["organization"] },
];

const CATEGORY_LAYERS = [
  { id: "cat:war", label: "Military & conflict", categories: ["military", "conflict", "terrorism"] },
  { id: "cat:unrest", label: "Unrest & crime", categories: ["protest", "crime"] },
  { id: "cat:disaster", label: "Disaster & health", categories: ["disaster", "health"] },
  // Split out of the disaster layer: climate reporting and an earthquake are
  // both "disaster" to the classifier but not to a reader deciding what to look at.
  { id: "cat:climate", label: "Climate & environment", categories: ["environmental"] },
  { id: "cat:cyber", label: "Cyber", categories: ["cyber"] },
  { id: "cat:economic", label: "Economic", categories: ["economic"] },
  { id: "cat:diplomatic", label: "Diplomatic", categories: ["diplomatic"] },
  { id: "cat:infra", label: "Infrastructure", categories: ["infrastructure"] },
  { id: "cat:general", label: "General & tech", categories: ["general", "tech"] },
];

/**
 * Hazard layers. These are not headlines: they are the GDACS alert list, drawn
 * as its own stratum so the map can show what the ground is doing even when
 * nobody has filed a story about it yet.
 *
 * Wildfires get their own switch because of the shape of the data rather than
 * for tidiness — in fire season they are four out of five alerts on the feed,
 * and a hundred of them over one continent will hide everything else there.
 */
const HAZARD_LAYERS = [
  { id: "haz:weather", label: "Storms, floods & drought", kinds: ["cyclone", "flood", "drought"] },
  { id: "haz:fire", label: "Wildfire alerts", kinds: ["wildfire"] },
  { id: "haz:geo", label: "Quakes & eruptions", kinds: ["earthquake", "volcano", "other"] },
];

/** Geological alerts are not what this panel is about; they are a switch away. */
const DEFAULT_DISABLED_LAYERS = ["haz:geo"];

/** How often the measured panel is re-read. Its sources move slower than the wire. */
const CLIMATE_REFRESH_MS = 15 * 60 * 1000;

const REGIONS = ["All", "Middle East", "Europe", "Asia", "North America", "Africa", "South America"];

interface Props {
  panels: Array<{ id: string; label: string; sources: number }>;
}

function relativeTime(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function utcStamp(now: number): string {
  return new Date(now)
    .toUTCString()
    .replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) ([\d:]+) GMT$/, "$1, $2 $3 $4 $5 UTC")
    .toUpperCase();
}

/**
 * Upstream's header carries a DEFCON dial. The same idea, honestly named: the
 * escalation index folded into five postures, so the number has a word.
 */
function posture(escalation: number): { level: number; label: string } {
  if (escalation >= 80) return { level: 1, label: "Severe" };
  if (escalation >= 62) return { level: 2, label: "High" };
  if (escalation >= 44) return { level: 3, label: "Elevated" };
  if (escalation >= 25) return { level: 4, label: "Guarded" };
  return { level: 5, label: "Baseline" };
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path
        strokeLinecap="round"
        d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5Z"
      />
    </svg>
  );
}

/**
 * Bar controls. These were typographic glyphs — ⟳, ❙❙, ⛶ — which is a font
 * lottery: each one lands at a different size and baseline depending on which
 * fallback font has it, and ⛶ is missing outright on some Windows installs. Drawn
 * once, they line up with each other and with the icons the video tiles use.
 */
function BarIcon({ children, filled }: { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const RefreshIcon = () => (
  <BarIcon>
    <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
    <path d="M23 4v6h-6" />
  </BarIcon>
);

const PauseIcon = () => (
  <BarIcon filled>
    <rect x="7" y="5" width="3.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1.2" />
  </BarIcon>
);

const PlayIcon = () => (
  <BarIcon filled>
    <path d="M8.5 5.4v13.2L19 12z" />
  </BarIcon>
);

const FullscreenIcon = () => (
  <BarIcon>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </BarIcon>
);

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

interface AnalystTurn {
  role: "user" | "assistant";
  content: string;
}

export default function WorldMonitorClient({ panels }: Props) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<string[]>([]);
  const [range, setRange] = useState("24h");
  const [levelFilter, setLevelFilter] = useState<ThreatLevel | null>(null);
  const [selectedHub, setSelectedHub] = useState<string | null>(null);
  const [sourceTab, setSourceTab] = useState<string>("All");
  const [regionTab, setRegionTab] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("2d");
  const [streamView, setStreamView] = useState<"headlines" | "tv">("headlines");
  const [centreTab, setCentreTab] = useState<"hotspots" | "webcams" | "climate">("webcams");
  const [now, setNow] = useState(() => Date.now());

  const [climate, setClimate] = useState<ClimateSnapshot | null>(null);
  const [climateLoading, setClimateLoading] = useState(true);
  const [climateError, setClimateError] = useState<string | null>(null);

  // The model the composer is pointing at right now. The hook reads the same
  // localStorage key the chat pickers write and follows their change event, so
  // switching model in a chat switches what writes the brief here too.
  const { model: assistantModel, reasoningEffort } = useAssistantIntelligence();

  // Read through a ref inside the loaders: picking a different model must not
  // change their identity, or the effect that watches them would refetch every
  // feed and throw away the brief the moment the picker moved.
  const intelligence = useRef({ model: assistantModel, effort: reasoningEffort });
  intelligence.current = { model: assistantModel, effort: reasoningEffort };

  const [disabledLayers, setDisabledLayers] = useState<Set<string>>(
    () => new Set(DEFAULT_DISABLED_LAYERS),
  );

  const [brief, setBrief] = useState<{ text: string; model: string; at: string } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefRequested = useRef(false);

  const [refining, setRefining] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const [turns, setTurns] = useState<AnalystTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const situationRef = useRef<HTMLElement | null>(null);

  const scopeKey = scope.join(",");

  const loadSnapshot = useCallback(
    async (options: { refine?: boolean; quiet?: boolean } = {}) => {
      if (options.quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (scopeKey) params.set("panels", scopeKey);
        // A narrowed scope can afford to read deeper into each panel's sources.
        params.set("depth", scope.length > 0 && scope.length <= 3 ? "12" : "6");
        if (options.refine) {
          params.set("refine", "1");
          params.set("model", intelligence.current.model);
          params.set("reasoningEffort", intelligence.current.effort);
        }

        const response = await fetch(`/api/worldmonitor/snapshot?${params}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Could not load the feed");
        }
        setSnapshot(data as MonitorSnapshot);
        setNow(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the feed");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [scope.length, scopeKey],
  );

  const loadBrief = useCallback(async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const response = await fetch("/api/worldmonitor/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panels: scope,
          model: intelligence.current.model,
          reasoningEffort: intelligence.current.effort,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.brief !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Could not write the brief");
      }
      setBrief({
        text: data.brief,
        model: data.model ?? "",
        at: data.generatedAt ?? new Date().toISOString(),
      });
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Could not write the brief");
    } finally {
      setBriefLoading(false);
    }
  }, [scope]);

  // Scope changes reload the window and invalidate the brief written for the
  // old one — a Middle East read sitting above a global stream would lie.
  useEffect(() => {
    briefRequested.current = false;
    setBrief(null);
    setSelectedHub(null);
    setSourceTab("All");
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot || snapshot.items.length === 0 || briefRequested.current) return;
    briefRequested.current = true;
    void loadBrief();
  }, [snapshot, loadBrief]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void loadSnapshot({ quiet: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, paused]);

  // "3m ago" has to keep counting between refreshes.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const layers: MapLayer[] = useMemo(
    () =>
      [...HUB_TYPE_LAYERS, ...CATEGORY_LAYERS, ...HAZARD_LAYERS].map((layer) => ({
        id: layer.id,
        label: layer.label,
        enabled: !disabledLayers.has(layer.id),
      })),
    [disabledLayers],
  );

  const enabledTypes = useMemo(() => {
    const types = new Set<string>();
    for (const layer of HUB_TYPE_LAYERS) {
      if (!disabledLayers.has(layer.id)) for (const type of layer.types) types.add(type);
    }
    return types;
  }, [disabledLayers]);

  const enabledCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const layer of CATEGORY_LAYERS) {
      if (!disabledLayers.has(layer.id)) for (const category of layer.categories) categories.add(category);
    }
    return categories;
  }, [disabledLayers]);

  const rangeHours = RANGES.find((option) => option.id === range)?.hours ?? 24;

  /** Everything in the window that the range and the layer switches admit. */
  const inWindow = useMemo(() => {
    if (!snapshot) return [];
    const cutoff = now - rangeHours * 3_600_000;
    return snapshot.items.filter((item) => {
      if (new Date(item.published).getTime() < cutoff) return false;
      if (!enabledCategories.has(item.threat.category)) return false;
      return true;
    });
  }, [snapshot, now, rangeHours, enabledCategories]);

  const hubs = useMemo(
    () => hubActivityFrom(inWindow).filter((hub) => enabledTypes.has(hub.type)),
    [inWindow, enabledTypes],
  );

  // A hub can leave the picture when a layer or the range changes. Deriving the
  // effective selection rather than clearing it in an effect means the filter
  // simply stops applying — and comes back if the layer is switched on again.
  const activeHub = useMemo(
    () => (selectedHub && hubs.some((hub) => hub.id === selectedHub) ? selectedHub : null),
    [selectedHub, hubs],
  );

  /**
   * The hubs the measured panel reads: the loudest ones currently on the map,
   * plus whatever is selected, capped at what one Open-Meteo request carries.
   * Sorted by id rather than by weight so the request key changes when the set
   * of places changes and not when their ranking shuffles — otherwise every
   * five-minute refresh would look like a new set and refetch the weather.
   */
  const weatherKey = useMemo(() => {
    const ranked = [...hubs].sort((a, b) => b.weight - a.weight);
    const ids = ranked.slice(0, MAX_WEATHER_HUBS).map((hub) => hub.id);
    if (activeHub && !ids.includes(activeHub)) {
      // The place being looked at always gets a clock, even if it is quiet
      // enough to have fallen off the end of the ranking.
      ids.pop();
      ids.unshift(activeHub);
    }
    return [...new Set(ids)].sort().join(",");
  }, [hubs, activeHub]);

  const loadClimate = useCallback(async () => {
    setClimateLoading(true);
    setClimateError(null);
    try {
      const params = new URLSearchParams();
      if (weatherKey) params.set("hubs", weatherKey);
      const response = await fetch(`/api/worldmonitor/climate?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Could not read the instruments",
        );
      }
      setClimate(data as ClimateSnapshot);
    } catch (err) {
      setClimateError(err instanceof Error ? err.message : "Could not read the instruments");
    } finally {
      setClimateLoading(false);
    }
  }, [weatherKey]);

  // The hub set settles as the first snapshot lands and the layers are touched;
  // waiting a beat means one request for the set the user ends up with rather
  // than one per intermediate state.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadClimate(), 1200);
    return () => window.clearTimeout(timer);
  }, [loadClimate]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void loadClimate(), CLIMATE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadClimate, paused]);

  const enabledHazardKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const layer of HAZARD_LAYERS) {
      if (!disabledLayers.has(layer.id)) for (const kind of layer.kinds) kinds.add(kind);
    }
    return kinds;
  }, [disabledLayers]);

  const hazards = useMemo(
    () => (climate?.hazards ?? []).filter((hazard) => enabledHazardKinds.has(hazard.kind)),
    [climate, enabledHazardKinds],
  );

  /** Conditions keyed by hub, so a tile can carry its own weather. */
  const weatherByHub = useMemo(() => {
    const map = new Map<string, HubWeather>();
    for (const entry of climate?.weather ?? []) map.set(entry.hubId, entry);
    return map;
  }, [climate]);

  const selectedWeather = activeHub ? (weatherByHub.get(activeHub) ?? null) : null;

  const sourceTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of inWindow) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 9)
      .map(([name]) => name);
  }, [inWindow]);

  const streamItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inWindow.filter((item) => {
      if (levelFilter && item.threat.level !== levelFilter) return false;
      if (activeHub && !item.hubs.includes(activeHub)) return false;
      if (sourceTab !== "All" && item.source !== sourceTab) return false;
      if (needle && !item.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [inWindow, levelFilter, activeHub, sourceTab, search]);

  const gridHubs = useMemo(
    () => (regionTab === "All" ? hubs : hubs.filter((hub) => hub.region === regionTab)),
    [hubs, regionTab],
  );

  const selectedHubName = useMemo(
    () => hubs.find((hub) => hub.id === activeHub)?.name ?? null,
    [hubs, activeHub],
  );

  const windowLevels = useMemo(() => {
    const levels: Record<ThreatLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const item of inWindow) levels[item.threat.level] += 1;
    return levels;
  }, [inWindow]);

  const escalation = snapshot?.escalation ?? 0;
  const stance = posture(escalation);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || asking) return;

    setQuestion("");
    setAsking(true);
    const history = turns.slice(-6);
    setTurns((current) => [
      ...current,
      { role: "user", content: asked },
      { role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/worldmonitor/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: asked,
          history,
          panels: scope,
          model: intelligence.current.model,
          reasoningEffort: intelligence.current.effort,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "The analyst did not answer");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content: answer };
          return next;
        });
        answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "The analyst did not answer";
      setTurns((current) => {
        const next = [...current];
        next[next.length - 1] = { role: "assistant", content: `_${message}_` };
        return next;
      });
    } finally {
      setAsking(false);
    }
  }

  function toggleLayer(layerId: string) {
    setDisabledLayers((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  function toggleFullscreen() {
    const element = situationRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.();
  }

  return (
    <main className="bb-wm-shell flex min-h-0 flex-col">
      {/* ── Command bar ── */}
      <header className="bb-wm-command bb-neu-toolbar flex shrink-0 items-center gap-2.5 border-b px-3 py-1.5">
        {/* A wordmark, not a way out: this opens in its own tab, and a monitor
            whose title bar navigates away is a monitor you lose by accident. */}
        <span className="bb-wm-brand flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-[0.1em] uppercase">
          <GlobeIcon className="h-3.5 w-3.5" />
          World
        </span>

        <span className="text-[0.72rem] font-semibold tracking-[0.14em] bb-wm-heading uppercase">
          Monitor
        </span>
        <span className="hidden text-[0.62rem] bb-wm-ink-faint sm:inline">
          {snapshot?.sources.total ?? 0} sources
        </span>

        <span className="bb-wm-live flex items-center gap-1.5 text-[0.62rem] tracking-wide uppercase">
          <span className={`bb-wm-live-dot ${paused ? "is-paused" : ""}`} aria-hidden="true" />
          {paused ? "Paused" : "Live"}
        </span>

        <select
          value={scope.length === 1 ? scope[0] : scope.length === 0 ? "" : "custom"}
          onChange={(event) => {
            const value = event.target.value;
            setScope(value === "" || value === "custom" ? [] : [value]);
          }}
          className="neu-control rounded-lg border px-2 py-1 text-[0.68rem] bb-wm-ink"
          aria-label="Coverage scope"
        >
          <option value="">Global</option>
          {panels.map((panel) => (
            <option key={panel.id} value={panel.id}>
              {panel.label}
            </option>
          ))}
        </select>

        <span
          className={`bb-wm-posture bb-wm-posture-${stance.level} flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.62rem] tracking-wide uppercase`}
          title="Escalation index: severity-weighted, corroboration-aware, recency-decayed"
        >
          Posture {stance.level} · {stance.label}
          {/* Readout and dial. The number alone is a fact you have to think
              about; the trough beside it is the one you take in at a glance,
              which is the whole job of a bar at the top of a monitor. */}
          <span className="font-mono tabular-nums">{escalation}%</span>
          <span className="bb-wm-gauge" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, escalation))}%` }} data-hot={escalation >= 62} />
          </span>
        </span>

        <div className="flex items-center gap-1">
          {LEVEL_ORDER.map((level) => {
            const count = windowLevels[level];
            const isActive = levelFilter === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => setLevelFilter(isActive ? null : level)}
                aria-pressed={isActive}
                className={`bb-wm-level-chip neu-button rounded-lg border px-1.5 py-1 text-[0.62rem] ${isActive ? "is-selected" : ""}`}
                title={`${levelName(level)} — ${count} ${count === 1 ? "story" : "stories"}`}
              >
                <span className={`bb-wm-dot bb-wm-level-${level}`} aria-hidden="true" />
                <span className="font-mono tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto flex items-center gap-1.5">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search headlines"
            className="neu-control w-36 rounded-lg border px-2 py-1 text-[0.68rem] bb-wm-ink"
            aria-label="Search headlines"
          />
          <button
            type="button"
            onClick={() => setSourcesOpen((open) => !open)}
            className="neu-button rounded-lg border px-2 py-1 text-[0.68rem] bb-wm-ink-muted"
            aria-expanded={sourcesOpen}
            title="Source health"
          >
            {snapshot ? `${snapshot.sources.ok}/${snapshot.sources.total}` : "—"}
          </button>
          <button
            type="button"
            onClick={async () => {
              setRefining(true);
              await loadSnapshot({ refine: true, quiet: true });
              setRefining(false);
            }}
            disabled={refining || loading}
            className="neu-button flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.68rem] bb-wm-ink-muted disabled:opacity-50"
            title="Re-read the headlines the keyword classifier was unsure about, through ChatMock"
          >
            {refining && <Spinner className="h-3 w-3" />}
            Re-read
          </button>
          <button
            type="button"
            onClick={() => void loadSnapshot({ quiet: true })}
            disabled={loading || refreshing}
            className="neu-button-icon flex items-center rounded-lg border px-2 py-1 text-[0.68rem] bb-wm-ink-muted disabled:opacity-50"
            title="Refresh now"
            aria-label="Refresh now"
          >
            {loading || refreshing ? <Spinner className="h-3 w-3" /> : <RefreshIcon />}
          </button>

          {sourcesOpen && snapshot && (
            <div className="bb-wm-popover neu-dialog absolute top-full right-0 z-20 mt-1.5 max-h-[22rem] w-72 overflow-y-auto rounded-xl border p-3">
              <p className="mb-2 text-[0.62rem] tracking-wide bb-wm-ink-muted uppercase">
                Sources · {snapshot.sources.ok} answering, {snapshot.sources.failed} not
              </p>
              <ul className="space-y-1 text-[0.68rem]">
                {snapshot.health.map((entry) => (
                  <li key={entry.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`bb-wm-dot ${entry.ok ? "bb-wm-level-low" : "bb-wm-level-critical"}`}
                        aria-hidden="true"
                      />
                      <span className="truncate bb-wm-ink-muted">{entry.name}</span>
                    </span>
                    <span className="shrink-0 font-mono bb-wm-ink-faint tabular-nums">
                      {entry.ok ? entry.items : (entry.error ?? "empty")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </header>

      {/* ── Situation strip ── */}
      <section ref={situationRef} className="bb-wm-situation flex min-h-0 flex-[1.15] flex-col">
        <div className="bb-wm-strip flex shrink-0 items-center gap-3 border-b px-3 py-1.5">
          <h1 className="text-[0.68rem] font-semibold tracking-[0.12em] bb-wm-heading uppercase">
            {scope.length === 0
              ? "Global situation"
              : `${panels.find((panel) => panel.id === scope[0])?.label ?? "Scoped"} situation`}
          </h1>
          {/* Local time where the story is. A monitor that pins a headline to
              Manila and leaves you working out whether anyone there is awake is
              doing half the job. */}
          {selectedWeather && (
            <span
              className="bb-wm-local-clock ml-auto flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[0.62rem]"
              title={`${selectedWeather.timezone} · ${selectedWeather.conditions} · feels like ${selectedWeather.apparentC} °C`}
            >
              <span className="tracking-wide uppercase">{selectedWeather.name}</span>
              <span className="font-mono tabular-nums">
                {localClock(selectedWeather.utcOffsetMinutes, now).time}
              </span>
              <span className="bb-wm-ink-muted">
                {Math.round(selectedWeather.temperatureC)}° {selectedWeather.conditions}
              </span>
            </span>
          )}
          <span
            className={`font-mono text-[0.66rem] bb-wm-ink-muted tabular-nums ${selectedWeather ? "" : "ml-auto"}`}
          >
            {utcStamp(now)}
          </span>
          <div className="bb-wm-segmented neu-segmented flex items-center gap-0.5 rounded-lg p-0.5">
            {(["2d", "3d"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMapMode(option)}
                aria-pressed={mapMode === option}
                className={`rounded-md px-2 py-0.5 text-[0.62rem] tracking-wide uppercase ${mapMode === option ? "is-selected" : ""}`}
                title={option === "3d" ? "Globe — drag to spin" : "Flat map — drag to pan when zoomed"}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((current) => !current)}
            className="neu-button-icon flex items-center rounded-lg border px-2 py-1 bb-wm-ink-muted"
            title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
            aria-label={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
            aria-pressed={paused}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="neu-button-icon flex items-center rounded-lg border px-2 py-1 bb-wm-ink-muted"
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <FullscreenIcon />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-2.5">
          <WorldMap
            hubs={hubs}
            selectedHub={activeHub}
            onSelectHub={setSelectedHub}
            layers={layers}
            onToggleLayer={toggleLayer}
            ranges={RANGES.map((option) => ({ id: option.id, label: option.label }))}
            range={range}
            onRange={setRange}
            mode={mapMode}
            hazards={hazards}
          />
        </div>
      </section>

      {/* ── Bottom row ── */}
      <div className="bb-wm-row-bottom grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.95fr)] gap-2.5 border-t p-2.5">
        {/* Live news: the headline stream and the broadcasters themselves */}
        <section className="bb-wm-panel neu-surface-raised flex min-h-0 flex-col rounded-xl border">
          <header className="bb-wm-panel-head flex items-center gap-2 border-b px-2.5 py-1.5">
            <h2 className="text-[0.66rem] font-semibold tracking-[0.1em] bb-wm-heading uppercase">
              Live news
            </h2>
            <div className="bb-wm-segmented neu-segmented flex items-center gap-0.5 rounded-lg p-0.5">
              {(
                [
                  ["headlines", "Wire"],
                  ["tv", "TV"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStreamView(value)}
                  aria-pressed={streamView === value}
                  className={`rounded-md px-1.5 py-0.5 text-[0.58rem] tracking-wide uppercase ${streamView === value ? "is-selected" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {streamView === "headlines" && (
              <span className="font-mono text-[0.62rem] bb-wm-ink-faint tabular-nums">
                {streamItems.length}
              </span>
            )}
            {streamView === "headlines" && (activeHub || levelFilter || search) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedHub(null);
                  setLevelFilter(null);
                  setSearch("");
                }}
                className="ml-auto text-[0.62rem] bb-wm-ink-muted bb-wm-hover-ink"
              >
                Clear{selectedHubName ? ` · ${selectedHubName}` : ""}
              </button>
            )}
          </header>

          {streamView === "tv" ? (
            <LiveNewsView />
          ) : (
            <>
          <div className="bb-wm-tabs flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1">
            {["All", ...sourceTabs].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSourceTab(tab)}
                aria-pressed={sourceTab === tab}
                title={tab}
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] tracking-wide whitespace-nowrap uppercase ${sourceTab === tab ? "is-selected" : ""}`}
              >
                {/* A rail of full mastheads ("South China Morning Post") pushes
                    the useful tabs off-screen; the title attribute keeps the
                    full name a hover away. */}
                {tab.length > 15 ? `${tab.slice(0, 14)}…` : tab}
              </button>
            ))}
          </div>

          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
            {error && (
              <li className="bb-wm-alert neu-surface rounded-lg border px-2.5 py-2 text-[0.7rem]">
                {error}
              </li>
            )}
            {loading && !snapshot && (
              <li className="flex items-center gap-2 px-2.5 py-6 text-xs bb-wm-ink-muted">
                <Spinner className="h-4 w-4" />
                Reading the wire…
              </li>
            )}
            {streamItems.map((item) => (
              <HeadlineRow key={item.id} item={item} now={now} />
            ))}
            {!loading && streamItems.length === 0 && !error && (
              <li className="px-2.5 py-6 text-center text-xs bb-wm-ink-muted">
                Nothing in this slice of the window.
              </li>
            )}
              </ul>
            </>
          )}
        </section>

        {/* Live webcams, with the hotspot roll-up behind the second tab */}
        <section className="bb-wm-panel neu-surface-raised flex min-h-0 flex-col rounded-xl border">
          <header className="bb-wm-panel-head flex items-center gap-2 border-b px-2.5 py-1.5">
            <h2 className="text-[0.66rem] font-semibold tracking-[0.1em] bb-wm-heading uppercase">
              {centreTab === "webcams"
                ? "Live webcams"
                : centreTab === "climate"
                  ? "Climate & weather"
                  : "Hotspots"}
            </h2>
            <div className="bb-wm-segmented neu-segmented flex items-center gap-0.5 rounded-lg p-0.5">
              {(
                [
                  ["webcams", "Cams"],
                  ["hotspots", "Hotspots"],
                  ["climate", "Climate"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCentreTab(value)}
                  aria-pressed={centreTab === value}
                  className={`rounded-md px-1.5 py-0.5 text-[0.58rem] tracking-wide uppercase ${centreTab === value ? "is-selected" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {centreTab === "hotspots" && (
              <span className="font-mono text-[0.62rem] bb-wm-ink-faint tabular-nums">
                {gridHubs.length}
              </span>
            )}
            {centreTab === "climate" && (
              <button
                type="button"
                onClick={() => void loadClimate()}
                disabled={climateLoading}
                className="ml-auto neu-button rounded-md border px-1.5 py-0.5 text-[0.6rem] bb-wm-ink-muted disabled:opacity-50"
                title={
                  climate
                    ? `Read ${relativeTime(climate.generatedAt, now)}`
                    : "Read the archives now"
                }
              >
                {climateLoading ? "Reading" : "Re-read"}
              </button>
            )}
          </header>

          {centreTab === "climate" ? (
            <ClimatePanel
              snapshot={climate}
              loading={climateLoading}
              error={climateError}
              hazards={hazards}
              selectedHub={activeHub}
              onSelectHub={setSelectedHub}
            />
          ) : centreTab === "webcams" ? (
            <WebcamsView />
          ) : (
            <>
              <div className="bb-wm-tabs flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1">
                {REGIONS.map((region) => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setRegionTab(region)}
                    aria-pressed={regionTab === region}
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] tracking-wide whitespace-nowrap uppercase ${regionTab === region ? "is-selected" : ""}`}
                  >
                    {region}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-1.5">
                  {gridHubs.map((hub) => (
                    <HubTile
                      key={hub.id}
                      hub={hub}
                      weather={weatherByHub.get(hub.id) ?? null}
                      now={now}
                      selected={activeHub === hub.id}
                      onSelect={() => setSelectedHub(activeHub === hub.id ? null : hub.id)}
                    />
                  ))}
                </div>
                {gridHubs.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs bb-wm-ink-muted">
                    No pinned activity in this region for the current layers.
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {/* AI column */}
        <section className="flex min-h-0 flex-col gap-2.5">
          <div className="bb-wm-panel neu-surface-raised flex max-h-[55%] min-h-0 flex-col rounded-xl border">
            <header className="bb-wm-panel-head flex items-center gap-2 border-b px-2.5 py-1.5">
              <h2 className="text-[0.66rem] font-semibold tracking-[0.1em] bb-wm-heading uppercase">
                AI insights
              </h2>
              {/* The model is the chat picker's business, not a badge here —
                  the tooltip still says which one wrote this. */}
              <span
                className="bb-wm-badge-live text-[0.58rem] tracking-wide uppercase"
                title={`${assistantModel} · ${reasoningEffort} — follows the model picked in chat`}
              >
                {briefLoading ? "Writing" : "Live"}
              </span>
              <button
                type="button"
                onClick={() => void loadBrief()}
                disabled={briefLoading || !snapshot?.items.length}
                className="ml-auto neu-button rounded-md border px-1.5 py-0.5 text-[0.6rem] bb-wm-ink-muted disabled:opacity-50"
              >
                Rewrite
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
              <p className="mb-1.5 text-[0.6rem] tracking-[0.1em] bb-wm-ink-muted uppercase">
                World brief
              </p>
              {briefLoading && !brief && (
                <p className="flex items-center gap-2 py-2 text-[0.7rem] bb-wm-ink-muted">
                  <Spinner className="h-3.5 w-3.5" />
                  Reading {snapshot?.items.length ?? 0} stories…
                </p>
              )}
              {briefError && <p className="bb-wm-alert text-[0.7rem]">{briefError}</p>}
              {brief && (
                <>
                  <div className="bb-wm-prose text-[0.76rem] bb-wm-ink">
                    {brief.text.split(/\n{2,}/).map((paragraph, index) => (
                      <p key={index}>{renderBold(paragraph)}</p>
                    ))}
                  </div>
                  <p className="mt-2 text-[0.6rem] bb-wm-ink-faint">
                    {brief.model || "chatmock"} · {relativeTime(brief.at, now)}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="bb-wm-panel neu-surface-raised flex min-h-0 flex-1 flex-col rounded-xl border">
            <header className="bb-wm-panel-head flex items-center gap-2 border-b px-2.5 py-1.5">
              <h2 className="text-[0.66rem] font-semibold tracking-[0.1em] bb-wm-heading uppercase">
                AI analyst
              </h2>
              <span className="ml-auto font-mono text-[0.6rem] bb-wm-ink-faint tabular-nums">
                {inWindow.length} in context
              </span>
            </header>

            <div ref={answerRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2">
              {turns.length === 0 && (
                <p className="text-[0.7rem] leading-relaxed bb-wm-ink-muted">
                  Ask about the current window. The answer is grounded in the
                  headlines on this page, and says so when they do not cover the
                  question.
                </p>
              )}
              {turns.map((turn, index) => (
                <div key={index} className={turn.role === "user" ? "text-right" : ""}>
                  <div
                    className={
                      turn.role === "user"
                        ? "neu-chat-message-user bb-wm-ink inline-block rounded-lg px-2 py-1 text-[0.72rem]"
                        : "bb-wm-prose text-[0.72rem] bb-wm-ink"
                    }
                  >
                    {turn.role === "assistant"
                      ? turn.content
                          .split(/\n{2,}/)
                          .map((paragraph, i) => <p key={i}>{renderBold(paragraph)}</p>)
                      : turn.content}
                  </div>
                </div>
              ))}
              {asking && turns[turns.length - 1]?.content === "" && (
                <Spinner className="h-3.5 w-3.5 bb-wm-ink-muted" />
              )}
            </div>

            <form onSubmit={ask} className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2.5">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What is converging right now?"
                className="neu-control bb-wm-ink min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-[0.72rem]"
              />
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="neu-button-primary rounded-lg px-2.5 py-1.5 text-[0.72rem] font-medium disabled:opacity-50"
              >
                Ask
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function HubTile({
  hub,
  weather,
  now,
  selected,
  onSelect,
}: {
  hub: { id: string; name: string; country: string; count: number; level: ThreatLevel; topHeadline: string };
  /** Present once the climate panel has read this hub; the tile works without it. */
  weather: HubWeather | null;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`bb-wm-tile bb-wm-level-${hub.level} ${selected ? "is-selected" : ""} rounded-lg border p-1.5 text-left`}
      title={
        weather
          ? `${hub.topHeadline}\n${weather.timezone} · ${weather.conditions}, feels like ${weather.apparentC} °C`
          : hub.topHeadline
      }
    >
      <span className="flex items-center gap-1.5">
        <span className={`bb-wm-dot bb-wm-level-${hub.level}`} aria-hidden="true" />
        <span className="bb-wm-ink truncate text-[0.68rem] font-medium">{hub.name}</span>
        <span className="ml-auto font-mono text-[0.62rem] bb-wm-ink-faint tabular-nums">
          {hub.count}
        </span>
      </span>
      <span className="mt-1 line-clamp-2 block text-[0.62rem] leading-snug bb-wm-ink-muted">
        {hub.topHeadline}
      </span>
      {weather && (
        <span className="mt-1 flex items-center gap-1.5 text-[0.58rem] bb-wm-ink-faint">
          <span className="font-mono tabular-nums">
            {localClock(weather.utcOffsetMinutes, now).time}
          </span>
          <span className="font-mono tabular-nums">{Math.round(weather.temperatureC)}°</span>
          <span className="truncate">{weather.conditions}</span>
          {weather.stress.kind !== "none" && (
            <span
              className={`bb-wm-dot bb-wm-level-${weather.stress.level}`}
              aria-label={weather.stress.note}
            />
          )}
        </span>
      )}
    </button>
  );
}

/** The prompts ask for **bold** headers; render them rather than printing the
 *  asterisks. */
function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="bb-wm-heading">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function HeadlineRow({ item, now }: { item: NewsItem; now: number }) {
  return (
    <li className={`bb-wm-row neu-surface rounded-lg border bb-wm-level-${item.threat.level}`}>
      <a
        href={item.link || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2 px-2.5 py-1.5"
      >
        <span className={`bb-wm-dot mt-1 bb-wm-level-${item.threat.level}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="bb-wm-ink block text-[0.78rem] leading-snug">{item.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.62rem] bb-wm-ink-muted">
            <span className={`bb-wm-tier bb-wm-tier-${item.tier}`} title={`Source tier ${item.tier}`}>
              {item.source}
            </span>
            <span>{item.threat.category}</span>
            <span
              title={
                item.publishedMissing
                  ? "The feed carried no date; this is when we first saw it"
                  : undefined
              }
            >
              {item.publishedMissing ? "seen " : ""}
              {relativeTime(item.published, now)}
            </span>
            {item.corroboration > 1 && (
              <span
                className="bb-wm-corroboration"
                title={`Also reported by ${item.alsoReportedBy.join(", ")}`}
              >
                +{item.corroboration - 1}
              </span>
            )}
            {item.threat.source === "llm" && (
              <span className="bb-wm-refined" title="Re-classified by ChatMock">
                re-read
              </span>
            )}
          </span>
        </span>
      </a>
    </li>
  );
}
