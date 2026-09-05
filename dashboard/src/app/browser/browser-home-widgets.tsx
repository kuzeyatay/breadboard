"use client";

import {
  ChevronLeft,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Search as SearchIcon,
  SkipBack,
  SkipForward,
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
import { browserShortcutsControl } from "@/lib/desktop-browser-tabs";
import { useBrowserSavedItems } from "./use-browser-saved-items";
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
  const displayedRef = useRef("");
  const initializedRef = useRef(false);
  const [displayed, setDisplayed] = useState("");
  const [animating, setAnimating] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!initializedRef.current || reducedMotion) {
        initializedRef.current = true;
        displayedRef.current = target;
        setDisplayed(target);
        setAnimating(false);
        return;
      }
      if (displayedRef.current === target) return;

      let current = displayedRef.current;
      setAnimating(true);
      const commit = (value: string) => {
        current = value;
        displayedRef.current = value;
        setDisplayed(value);
      };
      const write = (index: number) => {
        if (cancelled) return;
        commit(target.slice(0, index));
        if (index < target.length) timer = window.setTimeout(() => write(index + 1), 46);
        else setAnimating(false);
      };
      const erase = () => {
        if (cancelled) return;
        if (current.length > 0) {
          commit(current.slice(0, -1));
          timer = window.setTimeout(erase, 32);
        } else {
          timer = window.setTimeout(() => write(1), 260);
        }
      };
      erase();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reducedMotion, target]);

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

interface DockWeather {
  temperatureC: number;
  apparentC: number;
  code: number;
  condition: string;
  isDay: boolean;
  timezone: string;
}

function weatherGlyph(weather: DockWeather | null): string {
  if (!weather) return "–";
  if (weather.code === 0) return weather.isDay ? "☀" : "☾";
  if (weather.code <= 3 || weather.code === 45 || weather.code === 48) return "☁";
  if (weather.code >= 71 && weather.code <= 86) return "❄";
  if (weather.code >= 95) return "⚡";
  return "☂";
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
}

function useBatteryStatus(): { percent: number; charging: boolean } | null {
  const [battery, setBattery] = useState<{ percent: number; charging: boolean } | null>(null);
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
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      manager?.removeEventListener("levelchange", update);
      manager?.removeEventListener("chargingchange", update);
    };
  }, []);
  return battery;
}

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

function useNetworkStatus() {
  const [network, setNetwork] = useState({ online: true, detail: "Connection active" });
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
const SPOTIFY_HISTORY_LIMIT = 12;

function isSpotifyDockTrack(value: unknown): value is SpotifyDockTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === "string" &&
    /^[A-Za-z0-9]{10,64}$/.test(track.id) &&
    track.uri === `spotify:track:${track.id}` &&
    typeof track.name === "string" &&
    Boolean(track.name.trim()) &&
    typeof track.artist === "string" &&
    Boolean(track.artist.trim()) &&
    typeof track.album === "string" &&
    (track.imageUrl === null || typeof track.imageUrl === "string") &&
    typeof track.durationMs === "number" &&
    Number.isFinite(track.durationMs) &&
    track.durationMs > 0
  );
}

function readSpotifyHistory(): SpotifyDockTrack[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SPOTIFY_HISTORY_KEY) ?? "[]");
    return (Array.isArray(stored) ? stored : [])
      .filter(isSpotifyDockTrack)
      .slice(0, SPOTIFY_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

interface SpotifyDockPlaylist {
  id: string;
  uri: string;
  name: string;
  description: string;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
}

interface SpotifyDockState {
  connected: boolean;
  status: "connected" | "needs_reauth" | "not_connected";
  playlistAccess: boolean;
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
  };
}

type SpotifyDockAction =
  | "pause"
  | "resume"
  | "previous"
  | "next"
  | "play-track"
  | "play-playlist";

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
    const load = async () => {
      if (running) return;
      running = true;
      try {
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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
        error?: string;
        message?: string;
        engine?: SpotifyDockState["engine"];
        playback?: SpotifyDockState["playback"];
      };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Spotify could not do that.");
      setSpotify((current) => current ? {
        ...current,
        engine: payload.engine ?? current.engine,
        playback: payload.playback ?? current.playback,
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

function BrowserSpotifyDock({
  spotify,
  initializing,
  busy,
  error,
  control,
  openConnections,
}: {
  spotify: SpotifyDockState | null;
  initializing: boolean;
  busy: boolean;
  error: string;
  control: (action: SpotifyDockAction, extra?: Record<string, unknown>) => Promise<boolean>;
  openConnections: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"search" | "playlists">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyDockTrack[]>([]);
  const [history, setHistory] = useState<SpotifyDockTrack[]>([]);
  const [playlists, setPlaylists] = useState<SpotifyDockPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyDockPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyDockTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [playlistReconnectRequired, setPlaylistReconnectRequired] = useState(false);
  const [sampledPalette, setSampledPalette] = useState({
    source: null as string | null,
    palette: DEFAULT_PLAYER_PALETTE,
  });

  const track = spotify?.playback?.track ?? null;
  const playingHere = Boolean(
    spotify?.playback?.isPlaying &&
    spotify.engine.deviceId &&
    spotify.playback.deviceId === spotify.engine.deviceId,
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHistory(readSpotifyHistory()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const rememberTrack = useCallback((nextTrack: SpotifyDockTrack) => {
    setHistory((current) => {
      if (current[0]?.uri === nextTrack.uri) return current;
      const next = [
        nextTrack,
        ...current.filter((item) => item.uri !== nextTrack.uri),
      ].slice(0, SPOTIFY_HISTORY_LIMIT);
      try {
        window.localStorage.setItem(SPOTIFY_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Listening history is an enhancement; private browsing can disable storage.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!track) return;
    const frame = window.requestAnimationFrame(() => rememberTrack(track));
    return () => window.cancelAnimationFrame(frame);
  }, [rememberTrack, track]);

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

  const palette = track?.imageUrl && sampledPalette.source === track.imageUrl
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
  }, [open]);

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
    const timer = window.setTimeout(() => {
      const url = new URL("/api/browser/spotify", window.location.origin);
      url.searchParams.set("view", "search");
      url.searchParams.set("q", normalized);
      void fetch(url, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as { tracks?: SpotifyDockTrack[] };
          if (!response.ok) throw new Error(spotifyResponseMessage(payload, "Spotify search is unavailable."));
          setSearchResults(payload.tracks ?? []);
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
      controller.abort();
    };
  }, [open, query, view]);

  useEffect(() => {
    if (!open || view !== "playlists" || selectedPlaylist) return;
    if (spotify?.playlistAccess === false) return;
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
  }, [open, selectedPlaylist, spotify?.playlistAccess, view]);

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
        (view === "playlists" && spotify.playlistAccess !== false) ||
          Boolean(query.trim()),
      );
    }
    setOpen(!open);
  };
  const playTrack = async (nextTrack: SpotifyDockTrack, queue: SpotifyDockTrack[]) => {
    const played = await control("play-track", {
      trackUri: nextTrack.uri,
      queueUris: queue.map((item) => item.uri),
    });
    if (played) rememberTrack(nextTrack);
    return played;
  };
  const dockStyle = track?.imageUrl ? {
    backgroundColor: palette.surface,
    color: palette.foreground,
    "--browser-spotify-muted": palette.muted,
    "--browser-spotify-surface": palette.surface,
    "--browser-spotify-border": palette.border,
    "--browser-spotify-hover": palette.hover,
    "--browser-spotify-active": palette.active,
    "--browser-spotify-button": palette.buttonBackground,
    "--browser-spotify-button-ink": palette.buttonForeground,
    "--browser-spotify-overlay": palette.overlay,
  } as CSSProperties : undefined;
  const progress = track?.durationMs
    ? Math.min(100, Math.max(0, ((spotify?.playback?.positionMs ?? 0) / track.durationMs) * 100))
    : 0;
  const playlistPermissionMissing =
    view === "playlists" && spotify?.playlistAccess === false;
  const displayedLibraryError = playlistPermissionMissing
    ? "Reconnect Spotify to show your playlists."
    : libraryError;

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
      {track?.imageUrl ? (
        <span className="browser-spotify-ambient" aria-hidden="true" style={{ backgroundImage: `url("${track.imageUrl.replace(/"/gu, "%22")}")` }} />
      ) : null}
      <span className="browser-spotify-tint" aria-hidden="true" />
      <button
        type="button"
        className="browser-spotify-summary"
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
        </span>
        {spotify?.connected ? <span className="browser-spotify-open-cue" aria-hidden="true">⌃</span> : null}
      </button>
      {initializing ? null : spotify?.connected ? (
        <span className="browser-spotify-controls">
          <button type="button" aria-label="Previous track" disabled={busy || !track || !spotify.engine.ready} onClick={() => void control("previous")}><SkipBack aria-hidden="true" /></button>
          <button type="button" className="browser-spotify-play" aria-label={playingHere ? "Pause Spotify" : "Play Spotify in Breadboard"} disabled={busy || !track || !spotify.engine.ready} onClick={() => void control(playingHere ? "pause" : "resume")}>{playingHere ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" aria-label="Next track" disabled={busy || !track || !spotify.engine.ready} onClick={() => void control("next")}><SkipForward aria-hidden="true" /></button>
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
              <span className="browser-spotify-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
              <span className="browser-spotify-times" aria-hidden="true"><span>{formatSpotifyTime(spotify?.playback?.positionMs ?? 0)}</span><span>{formatSpotifyTime(track?.durationMs ?? 0)}</span></span>
            </div>
            <button type="button" className="browser-spotify-close" onClick={() => setOpen(false)} aria-label="Close Spotify"><X aria-hidden="true" /></button>
          </header>
          <div className="browser-spotify-popover-controls" aria-label="Playback controls">
            <button type="button" aria-label="Previous track" disabled={busy || !track || !spotify.engine.ready} onClick={() => void control("previous")}><SkipBack aria-hidden="true" /></button>
            <button type="button" className="browser-spotify-popover-play" aria-label={playingHere ? "Pause Spotify" : "Play Spotify in Breadboard"} disabled={busy || !track || !spotify.engine.ready} onClick={() => void control(playingHere ? "pause" : "resume")}>{playingHere ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
            <button type="button" aria-label="Next track" disabled={busy || !track || !spotify.engine.ready} onClick={() => void control("next")}><SkipForward aria-hidden="true" /></button>
          </div>
          <div className="browser-spotify-tabs" role="tablist" aria-label="Spotify library views">
            <button type="button" role="tab" aria-selected={view === "search"} onClick={() => { setView("search"); setSelectedPlaylist(null); setLibraryError(""); setLoading(Boolean(query.trim())); }}><SearchIcon aria-hidden="true" />Search</button>
            <button type="button" role="tab" aria-selected={view === "playlists"} onClick={() => { setView("playlists"); setLibraryError(""); setPlaylistReconnectRequired(false); setLoading(spotify.playlistAccess !== false); }}><ListMusic aria-hidden="true" />Playlists</button>
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
                {!query.trim() && !loading && !history.length ? <p className="browser-spotify-empty">What do you want to listen to?</p> : null}
                {query.trim() && !loading && !libraryError && !searchResults.length ? <p className="browser-spotify-empty">No songs found.</p> : null}
                {!query.trim() && history.length ? <p className="browser-spotify-history-label">Recently played</p> : null}
                <div className="browser-spotify-result-list">
                  {(query.trim() ? searchResults : history).map((item) => (
                    <button key={item.uri} type="button" className="browser-spotify-result" disabled={busy || !spotify.engine.ready} onClick={() => void playTrack(item, query.trim() ? searchResults : history)} aria-label={`Play ${item.name} by ${item.artist}`}>
                      <SpotifyArtwork imageUrl={item.imageUrl} label={`${item.album} cover`} className="browser-spotify-result-art" />
                      <span><strong>{item.name}</strong><small>{item.artist} · {item.album}</small></span>
                      <Play aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            ) : selectedPlaylist ? (
              <>
                <div className="browser-spotify-playlist-heading">
                  <button type="button" className="browser-spotify-back" onClick={() => { setSelectedPlaylist(null); setPlaylistTracks([]); setLibraryError(""); setLoading(true); }} aria-label="Back to playlists"><ChevronLeft aria-hidden="true" /></button>
                  <SpotifyArtwork imageUrl={selectedPlaylist.imageUrl} label={`${selectedPlaylist.name} cover`} className="browser-spotify-playlist-art" />
                  <span><strong>{selectedPlaylist.name}</strong><small>{selectedPlaylist.trackCount} songs · {selectedPlaylist.owner}</small></span>
                  <button type="button" className="browser-spotify-playlist-play" disabled={busy || !spotify.engine.ready} onClick={() => void control("play-playlist", { playlistUri: selectedPlaylist.uri })}><Play aria-hidden="true" /><span>Play</span></button>
                </div>
                <div className="browser-spotify-result-list">
                  {playlistTracks.map((item) => (
                    <button key={item.uri} type="button" className="browser-spotify-result" disabled={busy || !spotify.engine.ready} onClick={() => void playTrack(item, playlistTracks)} aria-label={`Play ${item.name} by ${item.artist}`}>
                      <SpotifyArtwork imageUrl={item.imageUrl} label={`${item.album} cover`} className="browser-spotify-result-art" />
                      <span><strong>{item.name}</strong><small>{item.artist} · {item.album}</small></span>
                      <Play aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="browser-spotify-playlist-grid">
                {playlists.map((playlist) => (
                  <button key={playlist.uri} type="button" className="browser-spotify-playlist" onClick={() => { setSelectedPlaylist(playlist); setLibraryError(""); setLoading(true); }}>
                    <SpotifyArtwork imageUrl={playlist.imageUrl} label={`${playlist.name} cover`} className="browser-spotify-playlist-cover" />
                    <span><strong>{playlist.name}</strong><small>{playlist.trackCount} songs · {playlist.owner}</small></span>
                  </button>
                ))}
              </div>
            )}
            {loading ? <p className="browser-spotify-loading" role="status"><span aria-hidden="true" />Loading Spotify…</p> : null}
            {displayedLibraryError ? (
              <div className="browser-spotify-error" role="alert">
                <p>{displayedLibraryError}</p>
                {playlistPermissionMissing || playlistReconnectRequired ? <button type="button" onClick={openConnections}>Reconnect Spotify</button> : null}
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
}: {
  openConnections: () => void;
}) {
  const dockRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div ref={dockRef} className="browser-dock" role="group" aria-label="Quick tools">
      <BrowserSketchOutline targetRef={dockRef} index={1} />
      <div className="browser-dock-time">
        <strong>{time}</strong>
        <span>{day}</span>
      </div>
      <div className="browser-dock-weather" title={weather ? `Feels like ${weather.apparentC}°, ${weather.condition}` : "Enable current location in Settings for local weather"}>
        <span className="browser-weather-icon" aria-hidden="true">{weatherGlyph(weather)}</span>
        <span>
          <strong>{weather ? `${weather.temperatureC}°` : "Weather"}</strong>
          <small>{weather?.condition ?? (weatherStatus === "off" ? "Location is off" : weatherStatus === "loading" ? "Checking…" : "Unavailable")}</small>
        </span>
      </div>
      <div className="browser-dock-network" role="status" data-online={network.online}>
        <span className="browser-network-mark" aria-hidden="true" />
        <span>
          <strong>{network.online ? "Online" : "Offline"}</strong>
          <small>{network.detail}</small>
        </span>
      </div>
      <div className="browser-battery" role="status" aria-label={battery ? `Battery ${battery.percent} percent${battery.charging ? ", charging" : ""}` : "Battery percentage unavailable"} style={{ "--browser-battery": `${(battery?.percent ?? 0) * 3.6}deg` } as CSSProperties}>
        <span>{battery?.percent ?? "–"}</span>
        {battery ? <small>%{battery.charging ? " · ↯" : ""}</small> : null}
      </div>
      <BrowserSpotifyDock
        spotify={spotify}
        initializing={spotifyInitializing}
        busy={spotifyBusy}
        error={spotifyError}
        control={controlSpotify}
        openConnections={openConnections}
      />
    </div>
  );
}
