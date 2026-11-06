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
import {
  ArrowLeft, Download, Maximize, Minimize, Pause, Play,
  RotateCcw, RotateCw, Square, Volume2, VolumeX, X,
} from "lucide-react";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "./use-desktop-tabs";
import styles from "./video-player-client.module.css";

interface Props {
  /** Visible name of the video. */
  title: string;
  /** Same-origin address serving the video bytes. */
  sourceUrl: string;
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
  backHref,
  showNavbarFlowers = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const tabs = useDesktopTabs();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch((error: unknown) => {
      // A quick Stop/Pause can interrupt a pending play without breaking media.
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
    });
    else video.pause();
  }, []);

  const stop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = 1;
      video.muted = false;
    } else video.muted = true;
  }, []);

  const goBack = useCallback(() => {
    videoRef.current?.pause();
    if (backHref) window.location.assign(backHref);
    else if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  }, [backHref]);

  const exitPlayer = useCallback(async () => {
    videoRef.current?.pause();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    // Address this player explicitly so a delayed command cannot close another tab.
    if (
      tabs?.enabled && tabs.selfId != null &&
      await sendDesktopTabsCommand({ type: "close", id: tabs.selfId })
    ) return;
    goBack();
  }, [goBack, tabs]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + delta),
      video.duration,
    );
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
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
      // Let focused controls handle Space and arrow keys themselves.
      if (target?.closest("input, textarea, select")) return;
      if (event.key === " " && target?.closest("button, a, [role='button']")) return;
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
        case "m":
          event.preventDefault();
          toggleMute();
          break;
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
  }, [seekBy, toggleFullscreen, toggleMute, togglePlay]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={styles.player}
      role="region"
      aria-label="Video player"
    >
      <header className={styles.header}>
        {showNavbarFlowers ? <NavbarFlowerWind /> : null}
        <button type="button" onClick={goBack} className={styles.button} aria-label="Back">
          <ArrowLeft aria-hidden="true" size={18} /><span className={styles.optionalLabel}>Back</span>
        </button>
        <div className={styles.heading}>
          <h1 className={styles.title} title={title}>
            {title}
          </h1>
        </div>
        <a
          href={sourceUrl}
          download
          className={styles.button}
          aria-label="Download video"
        >
          <Download aria-hidden="true" size={18} /><span className={styles.optionalLabel}>Download</span>
        </a>
        <button type="button" onClick={() => void exitPlayer()} className={styles.button} aria-label="Exit player" title="Exit player">
          <X aria-hidden="true" size={18} /> Exit
        </button>
      </header>

      <div className={styles.stage}>
        {failed ? (
          <p className={styles.error} role="alert">
            This video could not be played here.{" "}
            <a className="underline" href={sourceUrl} download>
              Download it
            </a>{" "}
            to open it in another player.
            <button type="button" className={styles.button} onClick={() => {
              setFailed(false);
              setPlaying(false);
              setCurrentTime(0);
              setDuration(0);
            }}>Retry</button>
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
            onEnded={() => setPlaying(false)}
            onVolumeChange={(event) => {
              setMuted(event.currentTarget.muted);
              setVolume(event.currentTarget.volume);
            }}
            onError={() => setFailed(true)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              setMuted(video.muted);
              setVolume(video.volume);
            }}
            className={styles.video}
          >
            Your browser cannot play this video.
          </ReclaimingVideo>
        )}
      </div>

      <div className={styles.controls} role="group" aria-label="Playback controls">
        <div className={styles.timeline}>
          <span className={styles.time}>{formatTime(currentTime)}</span>
          <input
            type="range"
            aria-label="Seek"
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            min={0}
            max={duration || 0}
            step="any"
            value={currentTime}
            disabled={failed || duration <= 0}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (videoRef.current && Number.isFinite(next)) {
                videoRef.current.currentTime = next;
                setCurrentTime(next);
              }
            }}
            className={styles.seek}
            style={{ background: `linear-gradient(to right, #a7d7b3 ${progress}%, #526159 ${progress}%)` }}
          />
          <span className={styles.time}>{formatTime(duration)}</span>
        </div>
        <div className={styles.transport}>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            disabled={failed}
            title={playing ? "Pause (Space / K)" : "Play (Space / K)"}
            className={`${styles.button} ${styles.primary}`}
          >
            {playing ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={stop} disabled={failed} className={styles.button} title="Stop and return to the beginning">
            <Square aria-hidden="true" size={16} /> Stop
          </button>
          <button type="button" onClick={() => seekBy(-10)} disabled={failed || duration <= 0} className={styles.button} aria-label="Rewind 10 seconds" title="Rewind 10 seconds (J)">
            <RotateCcw aria-hidden="true" size={18} /> 10s
          </button>
          <button type="button" onClick={() => seekBy(10)} disabled={failed || duration <= 0} className={styles.button} aria-label="Forward 10 seconds" title="Forward 10 seconds (L)">
            <RotateCw aria-hidden="true" size={18} /> 10s
          </button>
          <div className={styles.volume}>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              title={muted || volume === 0 ? "Unmute (M)" : "Mute (M)"}
              className={styles.button}
              disabled={failed}
            >
              {muted || volume === 0 ? <VolumeX aria-hidden="true" size={18} /> : <Volume2 aria-hidden="true" size={18} />}
            </button>
            <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} disabled={failed} className={styles.volumeSlider} onChange={(event) => {
              const video = videoRef.current;
              if (!video) return;
              video.volume = Number(event.target.value);
              video.muted = false;
            }} />
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`${styles.button} ${styles.fullscreen}`}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={fullscreen ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)"}
          >
            {fullscreen ? <Minimize aria-hidden="true" size={18} /> : <Maximize aria-hidden="true" size={18} />}
            <span className={styles.optionalLabel}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
