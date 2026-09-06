"use client";
import { holdForegroundAudio } from '@/lib/speech/clap/audio-focus';
import { spotifyHistoryTracks } from '@/lib/spotify/history';

import {
  BatteryCharging,
  ChevronLeft,
  ChevronUp,
  Check,
  CloudSun,
  FolderPlus,
  Globe2,
  Heart,
  Laptop,
  ListPlus,
  ListMusic,
  LoaderCircle,
  MapPinOff,
  Music2,
  Navigation,
  Pause,
  Pencil,
  Play,
  Search as SearchIcon,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatGreeting } from "@/lib/hermes/chat-greeting";
import { useGreetingTypewriter } from "@/app/components/use-greeting-typewriter";
import { WeatherIcon, weatherKind } from "@/app/components/weather-icon";
import { browserShortcutsControl } from "@/lib/desktop-browser-tabs";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { finiteEstimate, type DockBattery, type DockNetwork, type DockWeather } from "./browser-dock-data";
import { BatteryDetails, DockPopover, NetworkDetails, useWorldCities, WorldClocks, WorldWeather, type DockPanel } from "./browser-dock-popovers";
import {
  CURRENT_LOCATION_CHANGE_EVENT,
  getStoredCurrentLocationPreference,
} from "@/lib/current-location.ts";
import {
  SKETCH_MARGIN,
  sketchRectOutlines,
  type SketchBox,
} from "@/lib/hermes/sketch-outline";
import {
  DEFAULT_PLAYER_PALETTE,
  paletteFromCover,
} from "@/lib/spotify/player-palette";

export interface BrowserLink {
  label: string;
  glyph: string;
  color: string;
  url: string;
  iconUrl: string;
}

export function websiteIconUrl(url: string): string {
  const hostname = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

function websiteIconSources(src?: string, pageUrl?: string): string[] {
  const sources: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !sources.includes(value)) sources.push(value);
  };
  add(src);
  if (!pageUrl) return sources;
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "http:" && page.protocol !== "https:") return sources;
    add(websiteIconUrl(page.toString()));
    add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(page.hostname)}.ico`);
    add(new URL("/favicon.ico", page.origin).toString());
  } catch {
    // A bad page URL cannot invalidate a favicon the shell already supplied.
  }
  return sources;
}

function ResilientSiteImage({ sources }: { sources: readonly string[] }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source) return null;
  return (
    // Site icons are deliberately loaded from the website or a favicon service.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt=""
      onError={() => setSourceIndex((index) => index + 1)}
    />
  );
}

export const QUICK_LINKS: readonly BrowserLink[] = [
  { label: "Mail", glyph: "M", color: "#c85d4b", url: "https://mail.google.com", iconUrl: websiteIconUrl("https://mail.google.com") },
  { label: "YouTube", glyph: "▶", color: "#e85a4f", url: "https://www.youtube.com", iconUrl: websiteIconUrl("https://www.youtube.com") },
  { label: "GitHub", glyph: "GH", color: "#242926", url: "https://github.com", iconUrl: websiteIconUrl("https://github.com") },
  { label: "ChatGPT", glyph: "✦", color: "#397a63", url: "https://chatgpt.com", iconUrl: websiteIconUrl("https://chatgpt.com") },
  { label: "Drive", glyph: "△", color: "#d39b3e", url: "https://drive.google.com", iconUrl: websiteIconUrl("https://drive.google.com") },
  { label: "Notion", glyph: "N", color: "#323735", url: "https://www.notion.so", iconUrl: websiteIconUrl("https://www.notion.so") },
] as const;

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" {...STROKE} />
      <path d="m12.2 12.2 4 4" {...STROKE} />
    </svg>
  );
}

export function GoogleGlyph() {
  return <span className="browser-google-glyph" aria-hidden="true">G</span>;
}

export function BrowserSiteIcon({
  src,
  fallback,
  className,
  pageUrl,
}: {
  src?: string;
  fallback: ReactNode;
  className?: string;
  pageUrl?: string;
}) {
  const sources = websiteIconSources(src, pageUrl);
  return (
    <span className={`browser-site-icon ${className ?? ""}`} aria-hidden="true">
      <span className="browser-site-icon-fallback">{fallback}</span>
      <ResilientSiteImage key={sources.join("\n")} sources={sources} />
    </span>
  );
}

export function BrowserSketchOutline({
  targetRef,
  index,
  disconnected = false,
}: {
  targetRef: RefObject<HTMLElement | null>;
  index: number;
  disconnected?: boolean;
}) {
  const [box, setBox] = useState<SketchBox | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const measure = () => {
      const bounds = target.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 12;
      const next = {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        radius,
      };
      setBox((previous) =>
        previous &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.radius === next.radius
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  const outlines = useMemo(
    () => (box ? sketchRectOutlines(box, index + 20) : null),
    [box, index],
  );
  const surface = box
    ? { width: box.width + SKETCH_MARGIN * 2, height: box.height + SKETCH_MARGIN * 2 }
    : null;

  return (
    <svg
      aria-hidden="true"
      className={`browser-sketch-outline ${disconnected ? "is-disconnected" : ""}`}
      viewBox={surface ? `0 0 ${surface.width} ${surface.height}` : undefined}
      style={
        {
          "--browser-sketch-delay": `${index * -2115}ms`,
          width: surface ? `${surface.width}px` : undefined,
          height: surface ? `${surface.height}px` : undefined,
        } as CSSProperties
      }
    >
      {outlines ? (
        <>
          <path d={outlines.settled} pathLength={1} />
          <path d={outlines.pass} pathLength={1} />
        </>
      ) : null}
    </svg>
  );
}

export function AnimatedBrowserGreeting({ greeting }: { greeting: ChatGreeting | null }) {
  const target = greeting
    ? `${greeting.lead}${greeting.name ? `, ${greeting.name}` : ""}\n${greeting.question}`
    : "";
  const { displayed, animating } = useGreetingTypewriter(target);

  const splitAt = displayed.indexOf("\n");
  const lead = splitAt < 0 ? displayed : displayed.slice(0, splitAt);
  const question = splitAt < 0 ? "" : displayed.slice(splitAt + 1);
  return (
    <div className={`browser-greeting ${greeting ? "is-ready" : ""}`} data-animating={animating}>
      <span className="sr-only">{target.replace("\n", ". ")}</span>
      <h1 aria-hidden="true">
        {lead || " "}
        {animating && splitAt < 0 ? <span className="browser-greeting-caret" /> : null}
      </h1>
      <p aria-hidden="true">
        {question || " "}
        {animating && splitAt >= 0 ? <span className="browser-greeting-caret" /> : null}
      </p>
    </div>
  );
}

function safeShortcut(value: unknown): BrowserLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = record.label ?? record.title;
  const label = typeof title === "string" ? title.trim().slice(0, 24) : "";
  const rawUrl = typeof record.url === "string" ? record.url.trim() : "";
  if (!label || rawUrl.length > 2_048) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      label,
      glyph: label.slice(0, 1).toLocaleUpperCase(),
      color: "#5d786c",
      url: url.toString(),
      iconUrl: websiteIconUrl(url.toString()),
    };
  } catch {
    return null;
  }
}

function shortcutsKey(ownerKey: string): string {
  return `breadboard:browser-shortcuts:${ownerKey}`;
}

function normalizeShortcuts(value: unknown): BrowserLink[] {
  const links = (Array.isArray(value) ? value : [])
    .map(safeShortcut)
    .filter((link): link is BrowserLink => Boolean(link));
  return links.filter((link, index) => links.findIndex((other) => other.url === link.url) === index).slice(0, 8);
}

function shortcutsControl(ownerKey: string) {
  const control = browserShortcutsControl(ownerKey);
  if (!control) return null;
  return {
    read: control.read,
    write: (links: BrowserLink[]) => control.write(
      links.map(({ label, url, iconUrl }) => ({ title: label, url, iconUrl })),
    ),
  };
}

export function BrowserQuickLinks({
  navigate,
  ownerKey,
}: {
  navigate: (value: string) => void;
  ownerKey: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const addFrameRef = useRef<HTMLSpanElement | null>(null);
  const shortcutStore = useBrowserSavedItems(ownerKey, shortcutsKey(ownerKey), shortcutsControl, normalizeShortcuts);
  const customLinks = shortcutStore.items;
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [error, setError] = useState("");

  const openEditor = () => {
    setError("");
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => labelRef.current?.focus());
  };
  const closeEditor = () => dialogRef.current?.close();
  const addShortcut = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = safeShortcut({ label: draftLabel, url: draftUrl });
    if (!link) {
      setError("Add a name and a valid http or https address.");
      return;
    }
    if (customLinks.some((entry) => entry.url === link.url)) {
      setError("That shortcut is already here.");
      return;
    }
    if (customLinks.length >= 8) {
      setError("You can save up to 8 shortcuts. Remove one to add another.");
      return;
    }
    if (!(await shortcutStore.save([...customLinks, link]))) return;
    setDraftLabel("");
    setDraftUrl("");
    closeEditor();
  };

  return (
    <>
      <div className="browser-quick-links" aria-label="Quick access websites">
        {QUICK_LINKS.map((link) => (
          <button key={link.label} type="button" className="browser-quick-link" onClick={() => navigate(link.url)}>
            <span className="browser-quick-link-icon" style={{ "--browser-link-color": link.color } as CSSProperties} aria-hidden="true">
              <BrowserSiteIcon src={link.iconUrl} pageUrl={link.url} fallback={link.glyph} />
            </span>
            <span>{link.label}</span>
          </button>
        ))}
        <button type="button" className="browser-quick-link browser-add-shortcut" onClick={openEditor}>
          <span ref={addFrameRef} className="browser-quick-link-icon" aria-hidden="true">
            <span className="browser-add-shortcut-plus">+</span>
            <BrowserSketchOutline targetRef={addFrameRef} index={2} disconnected />
          </span>
          <span>Add shortcut</span>
        </button>
        {customLinks.map((link) => (
          <button key={link.url} type="button" className="browser-quick-link" onClick={() => navigate(link.url)}>
            <span className="browser-quick-link-icon" style={{ "--browser-link-color": link.color } as CSSProperties} aria-hidden="true">
              <BrowserSiteIcon src={link.iconUrl} pageUrl={link.url} fallback={link.glyph} />
            </span>
            <span>{link.label}</span>
          </button>
        ))}
      </div>
      <dialog ref={dialogRef} className="browser-shortcut-dialog" onClose={() => setError("")}>
        <form method="dialog" className="browser-shortcut-dialog-head">
          <strong>Quick access</strong>
          <button type="submit" aria-label="Close shortcut editor">×</button>
        </form>
        <form className="browser-shortcut-form" onSubmit={addShortcut}>
          <label>
            Name
            <input ref={labelRef} value={draftLabel} maxLength={24} onChange={(event) => setDraftLabel(event.target.value)} placeholder="Figma" />
          </label>
          <label>
            Website
            <input value={draftUrl} inputMode="url" onChange={(event) => setDraftUrl(event.target.value)} placeholder="figma.com" />
          </label>
          {error || shortcutStore.error ? <p role="alert">{error || shortcutStore.error}</p> : null}
          {shortcutStore.error && !shortcutStore.ready && <button type="button" onClick={shortcutStore.retry}>Retry loading shortcuts</button>}
          <button type="submit" className="browser-shortcut-save" disabled={!shortcutStore.ready || shortcutStore.saving}>
            {shortcutStore.saving ? "Saving…" : "Add shortcut"}
          </button>
        </form>
        {customLinks.length ? (
          <div className="browser-shortcut-list" aria-label="Custom shortcuts">
            {customLinks.map((link) => (
              <div key={link.url}>
                <span>{link.label}</span>
                <button type="button" disabled={!shortcutStore.ready || shortcutStore.saving} onClick={() => void shortcutStore.save(customLinks.filter((entry) => entry.url !== link.url))} aria-label={`Remove ${link.label}`}>Remove</button>
              </div>
            ))}
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function useDockWeather(): { weather: DockWeather | null; status: "ready" | "off" | "loading" | "unavailable" } {
  const [weather, setWeather] = useState<DockWeather | null>(null);
  const [status, setStatus] = useState<"ready" | "off" | "loading" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const preference = getStoredCurrentLocationPreference(window.localStorage);
      if (!preference.useForAnswers || !preference.snapshot) {
        if (!cancelled) {
          setWeather(null);
          setStatus("off");
        }
        return;
      }
      try {
        const url = new URL("/api/browser/weather", window.location.origin);
        url.searchParams.set("latitude", String(preference.snapshot.latitude));
        url.searchParams.set("longitude", String(preference.snapshot.longitude));
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("weather unavailable");
        const next = (await response.json()) as DockWeather;
        if (!cancelled) {
          setWeather(next);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15 * 60_000);
    window.addEventListener(CURRENT_LOCATION_CHANGE_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(CURRENT_LOCATION_CHANGE_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  return { weather, status };
}

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
  chargingTime?: number;
  dischargingTime?: number;
}

function useBatteryStatus(): DockBattery | null {
  const [battery, setBattery] = useState<DockBattery | null>(null);
  useEffect(() => {
    let manager: BatteryManagerLike | null = null;
    let cancelled = false;
    const navigatorWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    const update = () => {
      if (!manager || cancelled) return;
      setBattery({
        percent: Math.max(0, Math.min(100, Math.round(manager.level * 100))),
        charging: manager.charging,
        chargingTime: finiteEstimate(manager.chargingTime),
        dischargingTime: finiteEstimate(manager.dischargingTime),
      });
    };
    const readBattery = navigatorWithBattery.getBattery;
    if (!readBattery) return;
    void readBattery.call(navigatorWithBattery).then((next) => {
      if (cancelled) return;
      manager = next;
      update();
      manager.addEventListener("levelchange", update);
      manager.addEventListener("chargingchange", update);
      manager.addEventListener("chargingtimechange", update);
      manager.addEventListener("dischargingtimechange", update);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      manager?.removeEventListener("levelchange", update);
      manager?.removeEventListener("chargingchange", update);
      manager?.removeEventListener("chargingtimechange", update);
      manager?.removeEventListener("dischargingtimechange", update);
    };
  }, []);
  return battery;
}

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

function useNetworkStatus() {
  const [network, setNetwork] = useState<DockNetwork>({ online: true, detail: "Connection active", effectiveType: null, downlink: null, rtt: null, saveData: null });
  useEffect(() => {
    const navigatorWithConnection = navigator as Navigator & {
      connection?: NetworkInformationLike;
      mozConnection?: NetworkInformationLike;
      webkitConnection?: NetworkInformationLike;
    };
    const connection = navigatorWithConnection.connection ??
      navigatorWithConnection.mozConnection ??
      navigatorWithConnection.webkitConnection;
    const update = () => {
      const online = navigator.onLine;
      const speed = typeof connection?.downlink === "number"
        ? `${Math.round(connection.downlink * 10) / 10} Mbps`
        : "Connection active";
      const kind = connection?.effectiveType?.toLocaleUpperCase();
      setNetwork({
        online,
        detail: online ? [kind, speed].filter(Boolean).join(" · ") : "Check your connection",
        effectiveType: kind ?? null,
        downlink: finiteEstimate(connection?.downlink),
        rtt: finiteEstimate(connection?.rtt),
        saveData: typeof connection?.saveData === "boolean" ? connection.saveData : null,
      });
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    connection?.addEventListener("change", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      connection?.removeEventListener("change", update);
    };
  }, []);
  return network;
}

interface SpotifyDockTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  imageUrl: string | null;
  durationMs: number;
}

const SPOTIFY_HISTORY_KEY = "breadboard:spotify-listening-history:v1";
const SPOTIFY_SEARCH_HISTORY_KEY = "breadboard:spotify-search-history:v1";
const SPOTIFY_SEARCH_HISTORY_LIMIT = 8;

function readSpotifyHistory(): SpotifyDockTrack[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SPOTIFY_HISTORY_KEY) ?? "[]");
    return spotifyHistoryTracks(stored);
  } catch {
    return [];
  }
}

function readSpotifySearchHistory(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SPOTIFY_SEARCH_HISTORY_KEY) ?? "[]");
    return (Array.isArray(stored) ? stored : [])
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim().replace(/\s+/gu, " ").slice(0, 120))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, SPOTIFY_SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

interface SpotifyDockPlaylist {
  id: string;
  uri: string;
  kind: "playlist" | "liked-songs";
  name: string;
  description: string;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
  canAddTracks: boolean;
  canRemoveTracks: boolean;
  canEditDetails: boolean;
  canDelete: boolean;
}

interface SpotifyDockState {
  connected: boolean;
  status: "connected" | "needs_reauth" | "not_connected";
  playlistAccess: boolean;
  playlistWriteAccess: boolean;
  savedTrack: boolean;
  history: SpotifyDockTrack[];
  engine: {
    ready: boolean;
    deviceId: string | null;
    status: "ready" | "starting" | "unavailable";
    error: string | null;
  };
  playback: null | {
    track: SpotifyDockTrack;
    isPlaying: boolean;
    positionMs: number;
    deviceId: string | null;
    deviceName: string | null;
  };
}

type SpotifyDockAction =
  | "pause"
  | "resume"
  | "previous"
  | "next"
  | "play-track"
  | "play-playlist"
  | "save-track"
  | "remove-saved-track"
  | "add-to-playlist"
  | "remove-from-playlist"
  | "create-playlist"
  | "rename-playlist"
  | "delete-playlist";

function spotifyResponseMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  return typeof record.error === "string" ? record.error : fallback;
}

function useSpotifyDock() {
  const viewIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);
  const [spotify, setSpotify] = useState<SpotifyDockState | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    viewIdRef.current ??= window.crypto.randomUUID?.() ?? `browser-dock-${Date.now()}`;
    const viewId = viewIdRef.current;
    let cancelled = false;
    let running = false;
    let historyMigrated = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        if (!historyMigrated) {
          const tracks = readSpotifyHistory();
          if (!tracks.length) historyMigrated = true;
          else {
            try {
              const response = await fetch("/api/browser/spotify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "import-history", tracks }),
              });
              if (response.ok) {
                historyMigrated = true;
                window.localStorage.removeItem(SPOTIFY_HISTORY_KEY);
              }
            } catch {
              // Keep the original entries and retry migration on the next poll.
            }
          }
        }
        const statusResponse = await fetch("/api/browser/spotify", { cache: "no-store" });
        if (!statusResponse.ok) throw new Error("Spotify status unavailable");
        let next = (await statusResponse.json()) as SpotifyDockState;
        connectedRef.current = next.connected;
        if (next.connected) {
          const leaseResponse = await fetch("/api/hermes/connections/spotify/engine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewId }),
          });
          if (leaseResponse.ok) {
            const engine = (await leaseResponse.json()) as SpotifyDockState["engine"];
            next = { ...next, engine };
          }
        }
        if (!cancelled) {
          setSpotify(next);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Spotify is unavailable.");
      } finally {
        running = false;
        if (!cancelled) setInitializing(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    const refreshPlayback = () => { void load(); };
    window.addEventListener('breadboard:spotify-playback-changed', refreshPlayback);
    window.addEventListener('focus', refreshPlayback);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('breadboard:spotify-playback-changed', refreshPlayback);
      window.removeEventListener('focus', refreshPlayback);
      if (connectedRef.current) {
        void fetch("/api/hermes/connections/spotify/engine", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, []);

  const control = async (
    action: SpotifyDockAction,
    extra?: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/browser/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = (await response.json()) as {
        code?: string;
        error?: string;
        message?: string;
        engine?: SpotifyDockState["engine"];
        playback?: SpotifyDockState["playback"];
        savedTrack?: boolean;
        history?: SpotifyDockTrack[];
      };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Spotify could not do that.");
      setSpotify((current) => current ? {
        ...current,
        engine: payload.engine ?? current.engine,
        playback: payload.playback ?? current.playback,
        savedTrack: payload.savedTrack ?? current.savedTrack,
        history: payload.history ?? current.history,
      } : current);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Spotify could not do that.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { spotify, initializing, busy, error, control };
}

function formatSpotifyTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function SpotifyArtwork({
  imageUrl,
  label,
  className,
}: {
  imageUrl: string | null | undefined;
  label: string;
  className: string;
}) {
  return (
    <span
      className={className}
      role={imageUrl ? "img" : undefined}
      aria-label={imageUrl ? label : undefined}
      style={imageUrl ? { backgroundImage: `url("${imageUrl.replace(/"/gu, "%22")}")` } : undefined}
    >
      {!imageUrl ? <Music2 aria-hidden="true" /> : null}
    </span>
  );
}

function SpotifyPlaylistArtwork({
  playlist,
  className,
}: {
  playlist: SpotifyDockPlaylist;
  className: string;
}) {
  if (playlist.kind === "liked-songs") {
    return (
      <span className={`${className} browser-spotify-liked-art`} role="img" aria-label="Liked Songs cover">
        <Heart aria-hidden="true" />
      </span>
    );
  }
  return <SpotifyArtwork imageUrl={playlist.imageUrl} label={`${playlist.name} cover`} className={className} />;
}

function BrowserSpotifyDock({
  spotify,
  initializing,
  busy,
  error,
  control,
  openConnections,
  open,
  setOpen,
}: {
  spotify: SpotifyDockState | null;
  initializing: boolean;
  busy: boolean;
  error: string;
  control: (action: SpotifyDockAction, extra?: Record<string, unknown>) => Promise<boolean>;
  openConnections: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<"search" | "playlists">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyDockTrack[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const history = spotify?.history ?? [];
  const [playlists, setPlaylists] = useState<SpotifyDockPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyDockPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyDockTrack[]>([]);
  const [trackToAdd, setTrackToAdd] = useState<SpotifyDockTrack | null>(null);
  const [playlistForm, setPlaylistForm] = useState<"create" | "rename" | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [libraryNotice, setLibraryNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [playlistReconnectRequired, setPlaylistReconnectRequired] = useState(false);
  const [sampledPalette, setSampledPalette] = useState({
    source: null as string | null,
    palette: DEFAULT_PLAYER_PALETTE,
  });

  const track = spotify?.playback?.track ?? null;
  const isPlaying = spotify?.playback?.isPlaying === true;
  useEffect(() => { if (isPlaying) return holdForegroundAudio(); }, [isPlaying]);
  const playbackDeviceName = spotify?.playback?.deviceName?.trim() || (
    spotify?.engine.deviceId && spotify.playback?.deviceId === spotify.engine.deviceId
      ? "Breadboard"
      : "another device"
  );
  const playbackDeviceLabel = isPlaying ? `Playing on ${playbackDeviceName}` : null;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRecentSearches(readSpotifySearchHistory());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const rememberSearch = useCallback((value: string) => {
    const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 120);
    if (!normalized) return;
    setRecentSearches((current) => {
      const next = [
        normalized,
        ...current.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
      ].slice(0, SPOTIFY_SEARCH_HISTORY_LIMIT);
      try {
        window.localStorage.setItem(SPOTIFY_SEARCH_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Search history is an enhancement; private browsing can disable storage.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!track?.imageUrl) return;
    void paletteFromCover(track.imageUrl)
      .then((nextPalette) => {
        if (!cancelled) setSampledPalette({ source: track.imageUrl, palette: nextPalette });
      })
      .catch(() => {
        if (!cancelled) setSampledPalette({ source: track.imageUrl, palette: DEFAULT_PLAYER_PALETTE });
      });
    return () => {
      cancelled = true;
    };
  }, [track?.imageUrl]);

  // Keep the current colors while the next cover is sampled. Resetting to the
  // default palette here caused a green flash between every pair of tracks.
  const palette = track?.imageUrl
    ? sampledPalette.palette
    : DEFAULT_PLAYER_PALETTE;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || view !== "search") return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, view]);

  useEffect(() => {
    if (!open || view !== "search") return;
    const normalized = query.trim();
    if (!normalized) return;
    const controller = new AbortController();
    let rememberTimer: number | null = null;
    const timer = window.setTimeout(() => {
      const url = new URL("/api/browser/spotify", window.location.origin);
      url.searchParams.set("view", "search");
      url.searchParams.set("q", normalized);
      void fetch(url, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as { tracks?: SpotifyDockTrack[] };
          if (!response.ok) throw new Error(spotifyResponseMessage(payload, "Spotify search is unavailable."));
          const tracks = payload.tracks ?? [];
          setSearchResults(tracks);
          if (tracks.length) {
            rememberTimer = window.setTimeout(() => rememberSearch(normalized), 800);
          }
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setLibraryError(reason instanceof Error ? reason.message : "Spotify search is unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 240);
    return () => {
      window.clearTimeout(timer);
      if (rememberTimer !== null) window.clearTimeout(rememberTimer);
      controller.abort();
    };
  }, [open, query, rememberSearch, view]);

  useEffect(() => {
    if (!open || view !== "playlists" || selectedPlaylist) return;
    const controller = new AbortController();
    const url = new URL("/api/browser/spotify", window.location.origin);
    url.searchParams.set("view", "playlists");
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          code?: string;
          error?: string;
          message?: string;
          playlists?: SpotifyDockPlaylist[];
        };
        if (payload.code === "spotify_playlist_permission_required") {
          setPlaylistReconnectRequired(true);
        }
        if (!response.ok) throw new Error(spotifyResponseMessage(payload, "Your playlists are unavailable."));
        setPlaylistReconnectRequired(false);
        setPlaylists(payload.playlists ?? []);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLibraryError(reason instanceof Error ? reason.message : "Your playlists are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [libraryRevision, open, selectedPlaylist, view]);

  useEffect(() => {
    const selectedPlaylistId = selectedPlaylist?.id ?? "";
    if (!open || view !== "playlists" || !selectedPlaylistId) return;
    const controller = new AbortController();
    const url = new URL("/api/browser/spotify", window.location.origin);
    url.searchParams.set("view", "playlist");
    url.searchParams.set("id", selectedPlaylistId);
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          playlist?: SpotifyDockPlaylist;
          tracks?: SpotifyDockTrack[];
        };
        if (!response.ok) throw new Error(spotifyResponseMessage(payload, "That playlist is unavailable."));
        if (payload.playlist) setSelectedPlaylist(payload.playlist);
        setPlaylistTracks(payload.tracks ?? []);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLibraryError(reason instanceof Error ? reason.message : "That playlist is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, selectedPlaylist?.id, view]);

  const openPlayer = () => {
    if (!spotify?.connected) {
      openConnections();
      return;
    }
    if (!open) {
      setLibraryError("");
      setLoading(
        view === "playlists" ||
          Boolean(query.trim()),
      );
    }
    setOpen(!open);
  };
  const playTrack = async (
    nextTrack: SpotifyDockTrack,
    queue: SpotifyDockTrack[],
    autoplay = false,
  ) => {
    return control("play-track", {
      trackUri: nextTrack.uri,
      ...(autoplay
        ? { autoplay: true }
        : { queueUris: queue.map((item) => item.uri) }),
    });
  };
  const beginAddToPlaylist = (nextTrack: SpotifyDockTrack) => {
    setTrackToAdd(nextTrack);
    setPlaylistForm(null);
    setSelectedPlaylist(null);
    setView("playlists");
    setLibraryError("");
    setLibraryNotice("");
    setLoading(!playlists.length);
  };
  const addTrackToPlaylist = async (playlist: SpotifyDockPlaylist) => {
    if (!trackToAdd || !playlist.canAddTracks) return;
    setLibraryError("");
    setLibraryNotice("");
    const added = await control("add-to-playlist", {
      playlistId: playlist.id,
      trackUri: trackToAdd.uri,
    });
    if (!added) return;
    setPlaylists((current) => current.map((item) => item.id === playlist.id
      ? { ...item, trackCount: item.trackCount + 1 }
      : item));
    setLibraryNotice(`Added “${trackToAdd.name}” to ${playlist.name}.`);
    setTrackToAdd(null);
  };
  const removeTrackFromPlaylist = async (nextTrack: SpotifyDockTrack) => {
    if (!selectedPlaylist?.canRemoveTracks) return;
    setLibraryError("");
    setLibraryNotice("");
    const removed = await control("remove-from-playlist", {
      playlistId: selectedPlaylist.id,
      trackUri: nextTrack.uri,
    });
    if (!removed) return;
    setPlaylistTracks((current) => current.filter((item) => item.uri !== nextTrack.uri));
    setSelectedPlaylist((current) => current ? {
      ...current,
      trackCount: Math.max(0, current.trackCount - 1),
    } : current);
    setPlaylists((current) => current.map((item) => item.id === selectedPlaylist.id
      ? { ...item, trackCount: Math.max(0, item.trackCount - 1) }
      : item));
    setLibraryNotice(`Removed “${nextTrack.name}”.`);
  };
  const submitPlaylistForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = playlistName.trim().replace(/\s+/gu, " ");
    if (!normalizedName) return;
    setLibraryError("");
    setLibraryNotice("");
    if (playlistForm === "create") {
      const created = await control("create-playlist", {
        name: normalizedName,
        ...(trackToAdd ? { trackUri: trackToAdd.uri } : {}),
      });
      if (!created) return;
      setPlaylistForm(null);
      setPlaylistName("");
      setTrackToAdd(null);
      setLibraryNotice(trackToAdd
        ? `Created ${normalizedName} and added “${trackToAdd.name}”.`
        : `Created ${normalizedName}.`);
      setLibraryRevision((current) => current + 1);
      return;
    }
    if (playlistForm === "rename" && selectedPlaylist) {
      const renamed = await control("rename-playlist", {
        playlistId: selectedPlaylist.id,
        name: normalizedName,
      });
      if (!renamed) return;
      setSelectedPlaylist((current) => current ? { ...current, name: normalizedName } : current);
      setPlaylists((current) => current.map((item) => item.id === selectedPlaylist.id
        ? { ...item, name: normalizedName }
        : item));
      setPlaylistForm(null);
      setPlaylistName("");
      setLibraryNotice(`Renamed playlist to ${normalizedName}.`);
    }
  };
  const deleteSelectedPlaylist = async () => {
    if (!selectedPlaylist?.canDelete) return;
    const confirmed = window.confirm(
      `Delete “${selectedPlaylist.name}” from your Spotify library? Spotify keeps it available to existing followers.`,
    );
    if (!confirmed) return;
    setLibraryError("");
    setLibraryNotice("");
    const deleted = await control("delete-playlist", { playlistId: selectedPlaylist.id });
    if (!deleted) return;
    const deletedName = selectedPlaylist.name;
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistForm(null);
    setPlaylists((current) => current.filter((item) => item.id !== selectedPlaylist.id));
    setLibraryNotice(`Deleted ${deletedName} from your library.`);
    setLibraryRevision((current) => current + 1);
  };
  const dockStyle = track?.imageUrl ? {
    backgroundColor: palette.surface,
    color: palette.foreground,
    "--browser-spotify-muted": palette.muted,
    "--browser-spotify-playing": palette.playingForeground,
    "--browser-spotify-surface": palette.surface,
    "--browser-spotify-border": palette.border,
    "--browser-spotify-hover": palette.hover,
    "--browser-spotify-active": palette.active,
    "--browser-spotify-button": palette.buttonBackground,
    "--browser-spotify-button-ink": palette.buttonForeground,
    "--browser-spotify-overlay-start": palette.overlayStart,
    "--browser-spotify-overlay-middle": palette.overlayMiddle,
    "--browser-spotify-overlay-end": palette.overlayEnd,
  } as CSSProperties : undefined;
  const progress = track?.durationMs
    ? Math.min(100, Math.max(0, ((spotify?.playback?.positionMs ?? 0) / track.durationMs) * 100))
    : 0;
  const playlistPermissionMissing = view === "playlists" && spotify?.playlistAccess === false;
  const displayedLibraryError = libraryError || (open ? error : "");

  return (
    <section
      ref={rootRef}
      className="browser-spotify-dock"
      aria-label="Spotify in Breadboard"
      data-connected={spotify?.connected === true}
      data-loading={initializing}
      data-open={open}
      style={dockStyle}
    >
      <span className="browser-spotify-background" aria-hidden="true">
        {track?.imageUrl ? (
          <span className="browser-spotify-ambient" style={{ backgroundImage: `url("${track.imageUrl.replace(/"/gu, "%22")}")` }} />
        ) : null}
        <span className="browser-spotify-tint" />
      </span>
      <button
        type="button"
        className="browser-spotify-summary"
        data-dock-popup-trigger
        onClick={openPlayer}
        disabled={initializing}
        aria-busy={initializing || undefined}
        aria-expanded={spotify?.connected ? open : undefined}
        aria-controls={spotify?.connected ? "browser-spotify-player" : undefined}
        aria-label={initializing ? "Loading Spotify connection" : spotify?.connected ? "Open Spotify player" : spotify ? "Connect Spotify" : "Spotify unavailable"}
      >
        {initializing ? (
          <span className="browser-spotify-cover browser-spotify-cover-loading" aria-hidden="true"><LoaderCircle /></span>
        ) : (
          <SpotifyArtwork imageUrl={track?.imageUrl} label={track?.album ?? "Spotify album art"} className="browser-spotify-cover" />
        )}
        <span className="browser-spotify-copy">
          <strong>{initializing ? "Loading Spotify…" : track?.name ?? (spotify?.connected ? "Spotify is ready" : spotify ? "Connect Spotify" : "Spotify unavailable")}</strong>
          <small>{initializing ? "Checking your connection" : error || track?.artist || (spotify?.connected ? (spotify.engine.ready ? "Search music or browse playlists" : "Starting player…") : spotify ? "Settings → Connections" : "Trying again shortly")}</small>
          {playbackDeviceLabel ? <span className="browser-spotify-device" title={playbackDeviceLabel}>{playbackDeviceLabel}</span> : null}
        </span>
        {spotify?.connected ? <span className="browser-spotify-open-cue" aria-hidden="true"><ChevronUp /></span> : null}
      </button>
      {initializing ? null : spotify?.connected ? (
        <span className="browser-spotify-controls">
          <button type="button" aria-label="Previous track" disabled={busy || !track} onClick={() => void control("previous")}><SkipBack aria-hidden="true" /></button>
          <button type="button" className="browser-spotify-play" aria-label={isPlaying ? "Pause Spotify" : "Play Spotify in Breadboard"} disabled={busy || !track || (!isPlaying && !spotify.engine.ready)} onClick={() => void control(isPlaying ? "pause" : "resume")}>{isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" aria-label="Next track" disabled={busy || !track} onClick={() => void control("next")}><SkipForward aria-hidden="true" /></button>
        </span>
      ) : spotify ? (
        <button type="button" className="browser-spotify-connect" onClick={openConnections}>Connect</button>
      ) : null}

      {spotify?.connected ? (
        <section
          id="browser-spotify-player"
          className="browser-spotify-popover"
          role="dialog"
          aria-label="Spotify player and library"
          aria-hidden={!open}
          data-open={open}
          inert={!open ? true : undefined}
        >
          {track?.imageUrl ? (
            <span className="browser-spotify-popover-ambient" aria-hidden="true" style={{ backgroundImage: `url("${track.imageUrl.replace(/"/gu, "%22")}")` }} />
          ) : null}
          <span className="browser-spotify-popover-tint" aria-hidden="true" />
          <header className="browser-spotify-now-playing">
            <SpotifyArtwork imageUrl={track?.imageUrl} label={track?.album ?? "Spotify album art"} className="browser-spotify-now-art" />
            <div className="browser-spotify-now-copy">
              <strong>{track?.name ?? "Choose something to play"}</strong>
              <small>{track ? `${track.artist} · ${track.album}` : "Search for a song or open one of your playlists."}</small>
              {playbackDeviceLabel ? <span className="browser-spotify-device" title={playbackDeviceLabel}>{playbackDeviceLabel}</span> : null}
              <span className="browser-spotify-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
              <span className="browser-spotify-times" aria-hidden="true"><span>{formatSpotifyTime(spotify?.playback?.positionMs ?? 0)}</span><span>{formatSpotifyTime(track?.durationMs ?? 0)}</span></span>
            </div>
            <button type="button" className="browser-spotify-close" onClick={() => setOpen(false)} aria-label="Close Spotify"><X aria-hidden="true" /></button>
          </header>
          <div className="browser-spotify-popover-controls" aria-label="Playback controls">
            <button
              type="button"
              className="browser-spotify-library-control"
              data-active={spotify.savedTrack}
              aria-label={spotify.savedTrack ? "Remove from Liked Songs" : "Add to Liked Songs"}
              aria-pressed={spotify.savedTrack}
              disabled={busy || !track}
              onClick={() => track && void control(spotify.savedTrack ? "remove-saved-track" : "save-track", { trackUri: track.uri })}
            ><Heart aria-hidden="true" /></button>
            <button type="button" aria-label="Previous track" disabled={busy || !track} onClick={() => void control("previous")}><SkipBack aria-hidden="true" /></button>
            <button type="button" className="browser-spotify-popover-play" aria-label={isPlaying ? "Pause Spotify" : "Play Spotify in Breadboard"} disabled={busy || !track || (!isPlaying && !spotify.engine.ready)} onClick={() => void control(isPlaying ? "pause" : "resume")}>{isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
            <button type="button" aria-label="Next track" disabled={busy || !track} onClick={() => void control("next")}><SkipForward aria-hidden="true" /></button>
            <button
              type="button"
              className="browser-spotify-library-control"
              aria-label="Add to playlist"
              disabled={busy || !track}
              onClick={() => track && beginAddToPlaylist(track)}
            ><ListPlus aria-hidden="true" /></button>
          </div>
          <div className="browser-spotify-tabs" role="tablist" aria-label="Spotify library views">
            <button type="button" role="tab" aria-selected={view === "search"} onClick={() => { setView("search"); setSelectedPlaylist(null); setTrackToAdd(null); setPlaylistForm(null); setLibraryError(""); setLoading(Boolean(query.trim())); }}><SearchIcon aria-hidden="true" />Search</button>
            <button type="button" role="tab" aria-selected={view === "playlists"} onClick={() => { setView("playlists"); setLibraryError(""); setPlaylistReconnectRequired(false); setLoading(true); }}><ListMusic aria-hidden="true" />Playlists</button>
          </div>
          <div className="browser-spotify-library" role="tabpanel">
            {view === "search" ? (
              <>
                <label className="browser-spotify-search">
                  <SearchIcon aria-hidden="true" />
                  <span className="sr-only">Search Spotify</span>
                  <input ref={searchRef} value={query} onChange={(event) => { const nextQuery = event.currentTarget.value; setQuery(nextQuery); setLibraryError(""); setLoading(Boolean(nextQuery.trim())); if (!nextQuery.trim()) setSearchResults([]); }} placeholder="Songs, artists, albums" autoComplete="off" />
                  {query ? <button type="button" onClick={() => { setQuery(""); setSearchResults([]); setLibraryError(""); setLoading(false); }} aria-label="Clear search"><X aria-hidden="true" /></button> : null}
                </label>
                {!query.trim() && !loading && !recentSearches.length && !history.length ? <p className="browser-spotify-empty">What do you want to listen to?</p> : null}
                {query.trim() && !loading && !libraryError && !searchResults.length ? <p className="browser-spotify-empty">No songs found.</p> : null}
                {!query.trim() && recentSearches.length ? (
                  <>
                    <p className="browser-spotify-history-label">Recent searches</p>
                    <div className="browser-spotify-recent-searches">
                      {recentSearches.map((item) => (
                        <button key={item} type="button" onClick={() => { setQuery(item); setLibraryError(""); setLoading(true); }}>
                          <SearchIcon aria-hidden="true" />
                          <span>{item}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {!query.trim() && history.length ? <p className="browser-spotify-history-label">Recently played</p> : null}
                <div className="browser-spotify-result-list">
                  {(query.trim() ? searchResults : history).map((item) => (
                    <div key={item.uri} className="browser-spotify-managed-track">
                      <button type="button" className="browser-spotify-result" disabled={busy || !spotify.engine.ready} onClick={() => { if (query.trim()) rememberSearch(query); void playTrack(item, [], true); }} aria-label={`Play ${item.name} by ${item.artist}`}>
                        <SpotifyArtwork imageUrl={item.imageUrl} label={`${item.album} cover`} className="browser-spotify-result-art" />
                        <span><strong>{item.name}</strong><small>{item.artist} · {item.album}</small></span>
                        <Play aria-hidden="true" />
                      </button>
                      <button type="button" className="browser-spotify-track-action" disabled={busy} onClick={() => beginAddToPlaylist(item)} aria-label={`Add ${item.name} to a playlist`}><ListPlus aria-hidden="true" /></button>
                    </div>
                  ))}
                </div>
              </>
            ) : selectedPlaylist ? (
              <>
                <div className="browser-spotify-playlist-heading">
                  <button type="button" className="browser-spotify-back" onClick={() => { setSelectedPlaylist(null); setPlaylistTracks([]); setLibraryError(""); setLoading(true); }} aria-label="Back to playlists"><ChevronLeft aria-hidden="true" /></button>
                  <SpotifyPlaylistArtwork playlist={selectedPlaylist} className="browser-spotify-playlist-art" />
                  <span><strong>{selectedPlaylist.name}</strong><small>{selectedPlaylist.trackCount} songs · {selectedPlaylist.owner}</small></span>
                  <span className="browser-spotify-playlist-actions">
                    <button type="button" className="browser-spotify-playlist-play" disabled={busy || !spotify.engine.ready || (selectedPlaylist.kind === "liked-songs" && !playlistTracks.length)} onClick={() => { if (selectedPlaylist.kind === "liked-songs") { const firstTrack = playlistTracks[0]; if (firstTrack) void playTrack(firstTrack, playlistTracks); } else { void control("play-playlist", { playlistUri: selectedPlaylist.uri }); } }}><Play aria-hidden="true" /><span>Play</span></button>
                    {selectedPlaylist.canEditDetails ? <button type="button" className="browser-spotify-playlist-icon-action" disabled={busy} onClick={() => { setPlaylistForm("rename"); setPlaylistName(selectedPlaylist.name); setLibraryNotice(""); }} aria-label={`Rename ${selectedPlaylist.name}`}><Pencil aria-hidden="true" /></button> : null}
                    {selectedPlaylist.canDelete ? <button type="button" className="browser-spotify-playlist-icon-action browser-spotify-destructive" disabled={busy} onClick={() => void deleteSelectedPlaylist()} aria-label={`Delete ${selectedPlaylist.name}`}><Trash2 aria-hidden="true" /></button> : null}
                  </span>
                </div>
                {playlistForm === "rename" ? (
                  <form className="browser-spotify-playlist-form" onSubmit={submitPlaylistForm}>
                    <label><span className="sr-only">Playlist name</span><input value={playlistName} onChange={(event) => setPlaylistName(event.currentTarget.value)} maxLength={100} autoFocus /></label>
                    <button type="submit" disabled={busy || !playlistName.trim()} aria-label="Save playlist name"><Check aria-hidden="true" /><span>Save</span></button>
                    <button type="button" disabled={busy} onClick={() => { setPlaylistForm(null); setPlaylistName(""); }} aria-label="Cancel rename"><X aria-hidden="true" /></button>
                  </form>
                ) : null}
                <div className="browser-spotify-result-list">
                  {playlistTracks.map((item, index) => (
                    <div key={`${item.uri}-${index}`} className="browser-spotify-managed-track">
                      <button type="button" className="browser-spotify-result" disabled={busy || !spotify.engine.ready} onClick={() => void playTrack(item, playlistTracks)} aria-label={`Play ${item.name} by ${item.artist}`}>
                        <SpotifyArtwork imageUrl={item.imageUrl} label={`${item.album} cover`} className="browser-spotify-result-art" />
                        <span><strong>{item.name}</strong><small>{item.artist} · {item.album}</small></span>
                        <Play aria-hidden="true" />
                      </button>
                      {selectedPlaylist.canRemoveTracks ? <button type="button" className="browser-spotify-track-action browser-spotify-destructive" disabled={busy} onClick={() => void removeTrackFromPlaylist(item)} aria-label={`Remove ${item.name} from ${selectedPlaylist.name}`}><Trash2 aria-hidden="true" /></button> : null}
                    </div>
                  ))}
                </div>
                {!loading && !playlistTracks.length ? <p className="browser-spotify-empty">This playlist is empty.</p> : null}
              </>
            ) : (
              <>
                <div className="browser-spotify-playlist-toolbar">
                  <span>{trackToAdd ? <>Add <strong>“{trackToAdd.name}”</strong> to</> : "Your playlists"}</span>
                  <span>
                    {trackToAdd ? <button type="button" disabled={busy} onClick={() => setTrackToAdd(null)}><X aria-hidden="true" /><span>Cancel</span></button> : null}
                    <button type="button" disabled={busy} onClick={() => { setPlaylistForm("create"); setPlaylistName(""); setLibraryNotice(""); }}><FolderPlus aria-hidden="true" /><span>New playlist</span></button>
                  </span>
                </div>
                {playlistForm === "create" ? (
                  <form className="browser-spotify-playlist-form" onSubmit={submitPlaylistForm}>
                    <label><span className="sr-only">New playlist name</span><input value={playlistName} onChange={(event) => setPlaylistName(event.currentTarget.value)} maxLength={100} placeholder="Playlist name" autoFocus /></label>
                    <button type="submit" disabled={busy || !playlistName.trim()}><Check aria-hidden="true" /><span>Create</span></button>
                    <button type="button" disabled={busy} onClick={() => { setPlaylistForm(null); setPlaylistName(""); }} aria-label="Cancel new playlist"><X aria-hidden="true" /></button>
                  </form>
                ) : null}
                <div className="browser-spotify-playlist-grid">
                  {playlists.map((playlist) => (
                    <button key={playlist.uri} type="button" className="browser-spotify-playlist" disabled={busy || Boolean(trackToAdd && !playlist.canAddTracks)} onClick={() => { if (trackToAdd) { void addTrackToPlaylist(playlist); } else { setSelectedPlaylist(playlist); setLibraryError(""); setLibraryNotice(""); setLoading(true); } }}>
                      <SpotifyPlaylistArtwork playlist={playlist} className="browser-spotify-playlist-cover" />
                      <span><strong>{playlist.name}</strong><small>{playlist.trackCount} songs · {playlist.owner}</small></span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {libraryNotice ? <p className="browser-spotify-notice" role="status">{libraryNotice}</p> : null}
            {loading ? <p className="browser-spotify-loading" role="status"><span aria-hidden="true" />Loading Spotify…</p> : null}
            {displayedLibraryError ? (
              <div className="browser-spotify-error" role="alert">
                <p>{displayedLibraryError}</p>
                {playlistPermissionMissing || playlistReconnectRequired || /Reconnect Spotify/u.test(displayedLibraryError) ? <button type="button" onClick={openConnections}>Reconnect Spotify</button> : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function BrowserDock({
  openConnections,
  openPanel,
  setPanelOpen,
}: {
  openConnections: () => void;
  openPanel: DockPanel | null;
  setPanelOpen: (panel: DockPanel, open: boolean) => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const { cities, save: saveCities } = useWorldCities();
  const setSpotifyOpen = useCallback((open: boolean) => setPanelOpen("spotify", open), [setPanelOpen]);
  const [now, setNow] = useState<Date | null>(null);
  const battery = useBatteryStatus();
  const network = useNetworkStatus();
  const { weather, status: weatherStatus } = useDockWeather();
  const { spotify, initializing: spotifyInitializing, busy: spotifyBusy, error: spotifyError, control: controlSpotify } = useSpotifyDock();

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "--:--";
  const day = now?.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) ?? "Today";
  const currentWeather = weatherStatus === "ready" ? weather : null;
  const weatherMessage = weatherStatus === "off" ? "Location is off" : weatherStatus === "loading" ? "Checking…" : "Unavailable";

  return (
    <div ref={dockRef} className="browser-dock" role="group" aria-label="Quick tools">
      <BrowserSketchOutline targetRef={dockRef} index={8} />
      <DockPopover
        panel="time"
        open={openPanel === "time"}
        onOpenChange={(open) => setPanelOpen("time", open)}
        trigger={
          <button type="button" className="browser-dock-time" aria-label="Open world clocks">
            <span>{day}</span>
            <strong>{time}</strong>
          </button>
        }
      >
        <WorldClocks now={now} cities={cities} save={saveCities} />
      </DockPopover>
      <DockPopover
        panel="weather"
        open={openPanel === "weather"}
        onOpenChange={(open) => setPanelOpen("weather", open)}
        trigger={
          <button
            type="button"
            className="browser-dock-weather"
            data-weather-kind={currentWeather ? weatherKind(currentWeather.code) : undefined}
            data-daylight={currentWeather ? (currentWeather.isDay ? "day" : "night") : undefined}
            data-weather-status={weatherStatus}
            aria-label={currentWeather ? `Open world weather. Local weather: ${currentWeather.condition}, ${currentWeather.temperatureC}°C, feels like ${currentWeather.apparentC}°C` : `Open world weather. Local weather: ${weatherMessage}`}
            title={currentWeather ? `Feels like ${currentWeather.apparentC}°C, ${currentWeather.condition}` : weatherStatus === "off" ? "Enable current location in Settings for local weather" : weatherMessage}
          >
            <span className="browser-weather-heading" aria-hidden="true">Local weather <Navigation /></span>
            <span className="browser-weather-icon" aria-hidden="true">
              {currentWeather ? <WeatherIcon kind={weatherKind(currentWeather.code)} isDay={currentWeather.isDay} /> : weatherStatus === "off" ? <MapPinOff /> : <CloudSun />}
            </span>
            <strong className="browser-weather-temperature" aria-hidden="true">{currentWeather ? `${currentWeather.temperatureC}°` : "–°"}</strong>
            <span className="browser-weather-detail" aria-hidden="true">
              <span>{currentWeather?.condition ?? weatherMessage}</span>
              {currentWeather ? <span>Feels like {currentWeather.apparentC}°</span> : <span>{weatherStatus === "off" ? "Enable in Settings" : "Local forecast"}</span>}
            </span>
          </button>
        }
      >
        <WorldWeather cities={cities} save={saveCities} localWeather={currentWeather} />
      </DockPopover>
      <DockPopover
        panel="network"
        open={openPanel === "network"}
        onOpenChange={(open) => setPanelOpen("network", open)}
        trigger={
          <button type="button" className="browser-dock-network" data-online={network.online} aria-label={`Open connection details. ${network.online ? "Online" : "Offline"}`}>
            <span className="browser-network-mark" aria-hidden="true"><Globe2 /></span>
            <span>
              <strong>{network.online ? "Online" : "Offline"}</strong>
              <small>{network.detail}</small>
            </span>
          </button>
        }
      >
        <NetworkDetails network={network} />
      </DockPopover>
      <DockPopover
        panel="battery"
        open={openPanel === "battery"}
        onOpenChange={(open) => setPanelOpen("battery", open)}
        trigger={
          <button type="button" className="browser-battery" data-low={Boolean(battery && battery.percent <= 20 && !battery.charging)} aria-label={battery ? `Open battery details. Battery ${battery.percent} percent${battery.charging ? ", charging" : ""}` : "Open battery details. Battery percentage unavailable"} title={battery?.charging ? "Charging" : battery ? "On battery" : "Battery percentage unavailable"} style={{ "--browser-battery": `${(battery?.percent ?? 0) * 3.6}deg` } as CSSProperties}>
            {battery?.charging ? <BatteryCharging aria-hidden="true" /> : <Laptop aria-hidden="true" />}
            <span className="browser-battery-reading" aria-hidden="true">{battery?.percent ?? "–"}{battery ? <small>%</small> : null}</span>
          </button>
        }
      >
        <BatteryDetails battery={battery} />
      </DockPopover>
      <BrowserSpotifyDock
        spotify={spotify}
        initializing={spotifyInitializing}
        busy={spotifyBusy}
        error={spotifyError}
        control={controlSpotify}
        openConnections={openConnections}
        open={openPanel === "spotify"}
        setOpen={setSpotifyOpen}
      />
    </div>
  );
}
