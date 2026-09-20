"use client";

// Breadboard's full-page video player.
//
// A dashboard address that answers with video bytes — an artifact preview, a
// garden media asset, a chat attachment — used to open in whatever the frame
// fell back to: Chromium's bare media viewer on a black page, with none of the
// app's chrome and no way back. This is the reader those addresses land in
// instead, the way `/pdf` is for PDFs: same controls wherever the video came
// from, and the file's own route still decides who may read it.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";

interface Props {
  /** Visible name of the video. */
  title: string;
  /** Same-origin address serving the video bytes. */
  sourceUrl: string;
  /** Small label above the title, e.g. "Video artifact". */
  kicker?: string;
  /** Where the back control goes; the browser's own history when absent. */
  backHref?: string;
  showNavbarFlowers?: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const paddedSecs = String(secs).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSecs}`
    : `${minutes}:${paddedSecs}`;
}

export default function VideoPlayerClient({
  title,
  sourceUrl,
  kicker = "Video",
  backHref,
  showNavbarFlowers = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setFailed(true));
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + delta),
      video.duration,
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void shell.requestFullscreen().catch(() => {});
  }, []);

  // The player owns the keyboard while it is the page: the frame has nothing
  // else to type into, and a video nobody can pause with the space bar is the
  // kind of thing that sends people back to the system player.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekBy(-5);
          break;
        case "ArrowRight":
          event.preventDefault();
          seekBy(5);
          break;
        case "j":
          event.preventDefault();
          seekBy(-10);
          break;
        case "l":
          event.preventDefault();
          seekBy(10);
          break;
        case "m": {
          event.preventDefault();
          const video = videoRef.current;
          if (video) {
            video.muted = !video.muted;
            setMuted(video.muted);
          }
          break;
        }
        case "f":
          event.preventDefault();
          toggleFullscreen();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [seekBy, toggleFullscreen, togglePlay]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className="flex h-screen flex-col overflow-hidden bg-[var(--paper-sunken,#101713)] text-[var(--ink-on-dark,#e8efe9)]"
    >
      <header className="relative flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        {showNavbarFlowers ? <NavbarFlowerWind /> : null}
        {backHref ? (
          <Link
            href={backHref}
            className="rounded-lg px-2 py-1 text-sm text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
          >
            ← Back
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-lg px-2 py-1 text-sm text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
          >
            ← Back
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-white/45">{kicker}</p>
          <h1 className="truncate text-sm font-medium text-white/90" title={title}>
            {title}
          </h1>
        </div>
        <a
          href={sourceUrl}
          download
          className="rounded-lg px-2 py-1 text-sm text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
        >
          Download
        </a>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/60 p-4">
        {failed ? (
          <p className="max-w-md text-center text-sm text-white/70">
            This video could not be played here.{" "}
            <a className="underline" href={sourceUrl} download>
              Download it
            </a>{" "}
            to open it in another player.
          </p>
        ) : (
          <ReclaimingVideo
            elementRef={videoRef}
            src={sourceUrl}
            preload="metadata"
            playsInline
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              setMuted(video.muted);
            }}
            className="max-h-full max-w-full cursor-pointer rounded-xl bg-black shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
          >
            Your browser cannot play this video.
          </ReclaimingVideo>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-lg px-2 py-1 text-sm text-white/80 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="w-16 shrink-0 text-right font-mono text-xs text-white/60">
          {formatTime(currentTime)}
        </span>
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Seek</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/15"
          >
            <span
              className="block h-full rounded-full bg-[var(--botanical,#6f9f79)]"
              style={{ width: `${progress}%` }}
            />
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={currentTime}
            onChange={(event) => {
              const video = videoRef.current;
              const next = Number(event.target.value);
              if (video && Number.isFinite(next)) video.currentTime = next;
              setCurrentTime(next);
            }}
            className="relative w-full cursor-pointer appearance-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)] [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
        </label>
        <span className="w-16 shrink-0 font-mono text-xs text-white/60">
          {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          className="rounded-lg px-2 py-1 text-sm text-white/80 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-lg px-2 py-1 text-sm text-white/80 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
        >
          Fullscreen
        </button>
      </div>
    </div>
  );
}
