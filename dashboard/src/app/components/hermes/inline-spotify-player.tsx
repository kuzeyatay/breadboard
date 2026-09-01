"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Heart,
  Music2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import BreadboardLoader from "@/app/components/breadboard-loader";

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  imageUrl: string | null;
  durationMs: number;
}

interface PlaybackIntent {
  revision: string;
  track: SpotifyTrack;
  queueUris: string[];
  requestedAt: string;
}

interface PlaybackResponse {
  configured: boolean;
  connected: boolean;
  status: "connected" | "needs_reauth" | "not_connected";
  intent: PlaybackIntent | null;
  playback: ManagedPlaybackState | null;
  phone: {
    name: string;
    type: string;
    isActive: boolean;
  } | null;
  library: SpotifyLibraryState | null;
}

interface ManagedPlaybackState {
  track: SpotifyTrack;
  isPlaying: boolean;
  positionMs: number;
  shuffle: boolean;
  deviceId: string | null;
}

interface PlaybackActionResponse {
  ok?: boolean;
  revision?: string;
  playback?: ManagedPlaybackState | null;
  library?: SpotifyLibraryState | null;
}

interface SpotifyLibraryState {
  trackId: string;
  saved: boolean;
}

const POLL_INTERVAL_MS = 1_800;
const MAX_INTENT_POLLS = 6;

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface PlayerPalette {
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  hover: string;
  active: string;
  buttonBackground: string;
  buttonForeground: string;
  overlay: string;
  errorSurface: string;
}

const LIGHT_INK: RgbColor = { red: 248, green: 250, blue: 248 };
const DARK_INK: RgbColor = { red: 15, green: 25, blue: 21 };
const DEFAULT_PLAYER_PALETTE = playerPalette({ red: 37, green: 61, blue: 55 });

function mixColor(first: RgbColor, second: RgbColor, amount: number): RgbColor {
  const mix = (left: number, right: number) =>
    Math.round(left + (right - left) * amount);
  return {
    red: mix(first.red, second.red),
    green: mix(first.green, second.green),
    blue: mix(first.blue, second.blue),
  };
}

function rgb(color: RgbColor): string {
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function rgba(color: RgbColor, alpha: number): string {
  return `rgb(${color.red} ${color.green} ${color.blue} / ${alpha})`;
}

function relativeLuminance(color: RgbColor): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.red) +
    0.7152 * channel(color.green) +
    0.0722 * channel(color.blue)
  );
}

function contrastRatio(first: RgbColor, second: RgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function playerPalette(coverColor: RgbColor): PlayerPalette {
  // Keep enough of the artwork's hue to read as an extension of the cover,
  // then choose whichever ink has the stronger WCAG contrast against it.
  const surface = mixColor(
    coverColor,
    DARK_INK,
    relativeLuminance(coverColor) > 0.46 ? 0.2 : 0.1,
  );
  const foreground =
    contrastRatio(surface, LIGHT_INK) >= contrastRatio(surface, DARK_INK)
      ? LIGHT_INK
      : DARK_INK;
  const foregroundIsLight = foreground === LIGHT_INK;
  return {
    surface: rgb(surface),
    foreground: rgb(foreground),
    muted: rgba(foreground, 0.68),
    border: rgba(foreground, 0.17),
    hover: rgba(foreground, 0.12),
    active: rgba(foreground, 0.18),
    buttonBackground: rgb(foreground),
    buttonForeground: rgb(surface),
    overlay: `linear-gradient(105deg, ${rgba(surface, 0.72)} 0%, ${rgba(
      surface,
      0.84,
    )} 54%, ${rgba(surface, 0.94)} 100%)`,
    errorSurface: foregroundIsLight
      ? "rgb(7 12 10 / 0.52)"
      : "rgb(255 255 255 / 0.38)",
  };
}

function paletteFromCover(url: string): Promise<PlayerPalette> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable.");
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const buckets = new Map<
          string,
          {
            red: number;
            green: number;
            blue: number;
            weight: number;
            score: number;
          }
        >();
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] / 255;
          if (alpha < 0.1) continue;
          const maximum = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
          const minimum = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
          const saturation = maximum ? (maximum - minimum) / maximum : 0;
          const lightness = (maximum + minimum) / (2 * 255);
          // Album covers often have a large white paper field. Quantizing the
          // pixels and favoring chroma preserves the actual signature color
          // instead of averaging complementary colors into generic gray.
          if ((lightness > 0.93 && saturation < 0.14) || lightness < 0.05) {
            continue;
          }
          const pixelWeight = alpha * (0.2 + saturation * 2);
          const key = `${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${
            pixels[index + 2] >> 4
          }`;
          const bucket = buckets.get(key) ?? {
            red: 0,
            green: 0,
            blue: 0,
            weight: 0,
            score: 0,
          };
          bucket.red += pixels[index] * pixelWeight;
          bucket.green += pixels[index + 1] * pixelWeight;
          bucket.blue += pixels[index + 2] * pixelWeight;
          bucket.weight += pixelWeight;
          bucket.score += pixelWeight;
          buckets.set(key, bucket);
        }
        const dominant = [...buckets.values()].sort(
          (first, second) => second.score - first.score,
        )[0];
        if (!dominant?.weight) throw new Error("The cover has no visible pixels.");
        resolve(
          playerPalette({
            red: Math.round(dominant.red / dominant.weight),
            green: Math.round(dominant.green / dominant.weight),
            blue: Math.round(dominant.blue / dominant.weight),
          }),
        );
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("The cover could not be sampled."));
    image.src = url;
  });
}

function belongsToRequest(intent: PlaybackIntent | null, requestedAt?: string): boolean {
  if (!intent || !requestedAt) return Boolean(intent);
  const intentTime = Date.parse(intent.requestedAt);
  const requestTime = Date.parse(requestedAt);
  return !Number.isFinite(intentTime) || !Number.isFinite(requestTime)
    ? true
    : intentTime >= requestTime;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function responseMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  return typeof record.error === "string" ? record.error : fallback;
}

function SpotifyPlayerLoading() {
  return (
    <section
      aria-label="Loading Spotify phone remote"
      aria-busy="true"
      className="mb-4 flex min-h-[178px] w-full items-center justify-center rounded-[20px] border shadow-[0_16px_40px_rgba(20,20,20,0.10)]"
      style={{
        backgroundColor: DEFAULT_PLAYER_PALETTE.surface,
        borderColor: DEFAULT_PLAYER_PALETTE.border,
        color: DEFAULT_PLAYER_PALETTE.foreground,
      }}
    >
      <div
        role="status"
        className="grid size-10 animate-pulse place-items-center rounded-full"
        style={{ backgroundColor: DEFAULT_PLAYER_PALETTE.buttonBackground }}
      >
        <span className="sr-only">Loading Spotify phone remote</span>
      </div>
    </section>
  );
}

export default function InlineSpotifyPlayer({
  conversationPublicId,
  requestedAt,
  turnPending = false,
}: {
  conversationPublicId: string;
  requestedAt?: string;
  turnPending?: boolean;
}) {
  const playingRevisionRef = useRef<string | null>(null);
  const [connection, setConnection] = useState<PlaybackResponse | null>(null);
  const [managedPlaying, setManagedPlaying] = useState(false);
  const [managedShuffle, setManagedShuffle] = useState(false);
  const [managedQueueLoaded, setManagedQueueLoaded] = useState(false);
  const [managedTrack, setManagedTrack] = useState<SpotifyTrack | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayPosition, setDisplayPosition] = useState(0);
  const [palette, setPalette] = useState(DEFAULT_PLAYER_PALETTE);
  const [paletteSource, setPaletteSource] = useState<string | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);

  const intent = belongsToRequest(connection?.intent ?? null, requestedAt)
    ? connection?.intent ?? null
    : null;
  const intentRevision = intent?.revision;

  useEffect(() => {
    playingRevisionRef.current = null;
    setManagedPlaying(false);
    setManagedQueueLoaded(false);
    setManagedTrack(null);
    setDisplayPosition(0);
    setSaved(false);
  }, [intentRevision]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;
    setIntentLoading(true);
    const load = async () => {
      let foundIntent = false;
      try {
        const url = new URL(
          "/api/hermes/connections/spotify/playback",
          window.location.origin,
        );
        url.searchParams.set("conversation", conversationPublicId);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as PlaybackResponse;
        if (!cancelled) {
          setConnection(payload);
          foundIntent = belongsToRequest(payload.intent, requestedAt);
          if (foundIntent) setIntentLoading(false);
        }
      } catch {
        // The assistant response remains available if this optional player fails.
      } finally {
        attempts += 1;
        // Wait for each request to settle before scheduling another one. A cold
        // Next.js compile used to let setInterval accumulate dozens of pending
        // playback reads, which made the local dashboard even slower precisely
        // while a chat turn was trying to start. Once the tool intent exists,
        // there is nothing left to poll for.
        if (
          !cancelled &&
          !foundIntent &&
          (turnPending || attempts < MAX_INTENT_POLLS)
        ) {
          timer = window.setTimeout(() => void load(), POLL_INTERVAL_MS);
        } else if (!cancelled) {
          setIntentLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [conversationPublicId, requestedAt, turnPending]);

  useEffect(() => {
    if (!connection?.connected || !intentRevision) return;
    if (!connection.phone) {
      setDeviceReady(false);
      setError(
        "Spotify is not currently available on your phone. Open Spotify on the phone and try again.",
      );
      return;
    }
    setDeviceReady(true);
    setError(null);
  }, [connection?.connected, connection?.phone, intentRevision]);

  useEffect(() => {
    if (!managedPlaying) return;
    const timer = window.setInterval(() => {
      setDisplayPosition((position) =>
        Math.min(
          managedTrack?.durationMs ?? intent?.track.durationMs ?? position,
          position + 500,
        ),
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [intent?.track.durationMs, managedPlaying, managedTrack?.durationMs]);

  const postAction = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      const response = await fetch("/api/hermes/connections/spotify/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation: conversationPublicId,
          action,
          ...extra,
        }),
      });
      const payload = (await response.json()) as PlaybackActionResponse &
        Record<string, unknown>;
      if (!response.ok) throw new Error(responseMessage(payload, "Spotify could not play that."));
      return payload;
    },
    [conversationPublicId],
  );

  const runControl = useCallback(async (control: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await control();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Spotify playback failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const applyManagedPlayback = useCallback((playback: ManagedPlaybackState | null | undefined) => {
    if (!playback) return;
    setManagedTrack(playback.track);
    setManagedPlaying(playback.isPlaying);
    setManagedShuffle(playback.shuffle);
    setDisplayPosition(playback.positionMs);
  }, []);

  useEffect(() => {
    const playback = connection?.playback;
    if (
      !intentRevision ||
      !playback ||
      !intent?.queueUris.includes(playback.track.uri)
    ) {
      return;
    }
    playingRevisionRef.current = intentRevision;
    setManagedQueueLoaded(true);
    applyManagedPlayback(playback);
  }, [
    applyManagedPlayback,
    connection?.playback,
    intent?.queueUris,
    intentRevision,
  ]);

  const togglePlayback = () =>
    void runControl(async () => {
      if (managedPlaying && playingRevisionRef.current === intentRevision) {
        await postAction("pause");
        setManagedPlaying(false);
        return;
      }
      if (playingRevisionRef.current === intentRevision) {
        await postAction("resume");
        setManagedPlaying(true);
        return;
      }
      await postAction("play");
      playingRevisionRef.current = intentRevision ?? null;
      setManagedQueueLoaded(true);
      setManagedTrack(intent?.track ?? null);
      setDisplayPosition(0);
      setManagedPlaying(true);
    });

  const visibleTrack = useMemo<SpotifyTrack | null>(
    () => managedTrack ?? intent?.track ?? null,
    [intent?.track, managedTrack],
  );

  useEffect(() => {
    const library = connection?.library;
    if (!visibleTrack || !library || library.trackId !== visibleTrack.id) {
      setSaved(false);
      return;
    }
    setSaved(library.saved);
  }, [connection?.library, visibleTrack]);

  useEffect(() => {
    let cancelled = false;
    const imageUrl = visibleTrack?.imageUrl;
    if (!imageUrl) {
      setPalette(DEFAULT_PLAYER_PALETTE);
      setPaletteSource(null);
      return () => {
        cancelled = true;
      };
    }
    void paletteFromCover(imageUrl)
      .then((nextPalette) => {
        if (!cancelled) {
          setPalette(nextPalette);
          setPaletteSource(imageUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPalette(DEFAULT_PLAYER_PALETTE);
          setPaletteSource(imageUrl);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visibleTrack?.imageUrl]);

  const duration = visibleTrack?.durationMs ?? 0;
  const isPlaying = managedPlaying;
  const connectionRequired = connection !== null && !connection.connected;
  const paletteReady = Boolean(
    visibleTrack && paletteSource === (visibleTrack.imageUrl ?? null),
  );

  // Like the inline map, the player appears only when the tool has produced
  // real provider data. A completed turn with no intent must not leave behind
  // an indefinite, context-free loading card.
  if (!intent || !visibleTrack) {
    return intentLoading ? <SpotifyPlayerLoading /> : null;
  }
  if (!paletteReady) return <SpotifyPlayerLoading />;

  return (
    <section
      aria-label="Spotify phone remote"
      className="relative isolate mb-4 w-full overflow-hidden rounded-[20px] border shadow-[0_16px_40px_rgba(20,20,20,0.18)]"
      style={
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          color: palette.foreground,
          "--spotify-control-fg": palette.foreground,
          "--spotify-control-muted": palette.muted,
          "--spotify-control-hover": palette.hover,
          "--spotify-control-active": palette.active,
          "--spotify-button-bg": palette.buttonBackground,
          "--spotify-button-ink": palette.buttonForeground,
        } as React.CSSProperties
      }
    >
      {visibleTrack.imageUrl ? (
        <div
          aria-hidden
          className="absolute -inset-8 -z-20 scale-110 bg-cover bg-center opacity-90 blur-[32px] saturate-[1.15]"
          style={{ backgroundImage: `url(${visibleTrack.imageUrl})` }}
        />
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: palette.overlay }}
      />
      <div className="relative flex min-h-[116px] items-center gap-4 p-4 sm:p-5">
        <div
          aria-hidden
          className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-[10px] border shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
          style={
            visibleTrack.imageUrl
              ? {
                  backgroundImage: `url(${visibleTrack.imageUrl})`,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                  borderColor: palette.border,
                }
              : {
                  backgroundColor: palette.hover,
                  borderColor: palette.border,
                }
          }
        >
          {!visibleTrack.imageUrl ? <Music2 className="size-7 opacity-70" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          {connectionRequired ? (
            <>
              <p className="text-base font-semibold tracking-[-0.01em]">
                Reconnect Spotify
              </p>
              <p className="mt-1 text-sm" style={{ color: palette.muted }}>
                Settings → Connections → Spotify
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-xl font-semibold leading-tight tracking-[-0.025em] drop-shadow-sm">
                {visibleTrack.name}
              </p>
              <p
                className="mt-1.5 truncate text-sm drop-shadow-sm"
                style={{ color: palette.muted }}
              >
                {visibleTrack.artist}
              </p>
            </>
          )}
          {duration > 0 ? (
            <div
              className="mt-3 flex items-center gap-2.5 text-[10px] tabular-nums"
              style={{ color: palette.muted }}
            >
              <span>{formatTime(displayPosition)}</span>
              <input
                aria-label="Track position"
                className="h-1 min-w-0 flex-1"
                style={{ accentColor: palette.foreground }}
                type="range"
                min={0}
                max={duration}
                step={1_000}
                value={Math.min(displayPosition, duration)}
                onChange={(event) => setDisplayPosition(Number(event.target.value))}
                onPointerUp={(event) => {
                  const value = Number((event.currentTarget as HTMLInputElement).value);
                  void runControl(async () => {
                    const result = await postAction("seek", { positionMs: value });
                    applyManagedPlayback(result.playback);
                  });
                }}
              />
              <span>{formatTime(duration)}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div
        className="relative grid grid-cols-5 items-center border-t px-4 py-2.5 backdrop-blur-xl"
        style={{
          backgroundColor: palette.surface,
          borderColor: palette.border,
        }}
      >
        <PlayerButton
          label={managedShuffle ? "Disable shuffle" : "Enable shuffle"}
          disabled={!deviceReady || busy || !intent}
          active={managedShuffle}
          onClick={() =>
            void runControl(async () => {
              const enabled = !managedShuffle;
              await postAction("shuffle", { enabled });
              setManagedShuffle(enabled);
            })
          }
        >
          <Shuffle className="size-[17px]" />
        </PlayerButton>
        <PlayerButton
          label="Previous track"
          disabled={
            !deviceReady ||
            busy ||
            !managedQueueLoaded
          }
          onClick={() =>
            void runControl(async () => {
              if (!visibleTrack) return;
              const result = await postAction("previous", {
                currentTrackId: visibleTrack.id,
              });
              playingRevisionRef.current = intentRevision ?? null;
              applyManagedPlayback(result.playback);
              setSaved(result.library?.saved ?? false);
            })
          }
        >
          <SkipBack className="size-[18px] fill-current" />
        </PlayerButton>
        <PlayerButton
          label={isPlaying ? "Pause" : "Play"}
          disabled={!deviceReady || busy || !intent}
          prominent
          onClick={togglePlayback}
        >
          {busy ? (
            <BreadboardLoader className="size-5" />
          ) : isPlaying ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 fill-current" />
          )}
        </PlayerButton>
        <PlayerButton
          label="Next track"
          disabled={
            !deviceReady ||
            busy ||
            !managedQueueLoaded
          }
          onClick={() =>
            void runControl(async () => {
              if (!visibleTrack) return;
              const result = await postAction("next", {
                currentTrackId: visibleTrack.id,
              });
              playingRevisionRef.current = intentRevision ?? null;
              applyManagedPlayback(result.playback);
              setSaved(result.library?.saved ?? false);
            })
          }
        >
          <SkipForward className="size-[18px] fill-current" />
        </PlayerButton>
        <PlayerButton
          label={saved ? "Remove from liked songs" : "Save to liked songs"}
          disabled={busy || !visibleTrack}
          active={saved}
          onClick={() =>
            void runControl(async () => {
              if (!visibleTrack) return;
              const result = await postAction(saved ? "unsave" : "save", {
                trackId: visibleTrack.id,
              });
              setSaved(result.library?.saved ?? !saved);
            })
          }
        >
          <Heart className={`size-[18px] ${saved ? "fill-current" : ""}`} />
        </PlayerButton>
      </div>
      {error ? (
        <p
          className="relative border-t px-4 py-2.5 text-xs backdrop-blur-xl"
          style={{
            backgroundColor: palette.errorSurface,
            borderColor: palette.border,
            color: palette.foreground,
          }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PlayerButton({
  label,
  disabled,
  active = false,
  prominent = false,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  active?: boolean;
  prominent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        backgroundColor: prominent
          ? "var(--spotify-button-bg)"
          : active
            ? "var(--spotify-control-active)"
            : undefined,
        color: prominent
          ? "var(--spotify-button-ink)"
          : "var(--spotify-control-fg)",
      }}
      className={`mx-auto grid place-items-center rounded-full transition-[transform,color,background-color,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
        prominent
          ? "size-10 shadow-[0_4px_14px_rgba(0,0,0,0.2)] hover:opacity-90"
          : "size-9 hover:bg-[var(--spotify-control-hover)]"
      }`}
    >
      {children}
    </button>
  );
}
