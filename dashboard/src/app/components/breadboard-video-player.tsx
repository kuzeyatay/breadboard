"use client";

// Breadboard's one video player. Uploaded attachments, generated video
// artifacts, upload previews and the full-page /video route all render this,
// so playback looks and behaves the same wherever a video came from: a dark
// rounded stage, a floating control pill that hides while watching, and a
// fullscreen that takes the whole screen.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SyntheticEvent,
} from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";
import styles from "./breadboard-video-player.module.css";

export interface BreadboardVideoPlayerProps {
  src: string;
  /** Spoken name of the video for assistive tech. */
  title?: string;
  autoPlay?: boolean;
  className?: string;
  /** Fired once the first frame's metadata is in; preview surfaces use it. */
  onReady?: () => void;
  onError?: () => void;
  /** Shared with callers that need the element (the full-page route's exit). */
  elementRef?: MutableRefObject<HTMLVideoElement | null>;
  /** Bind shortcuts to the window: for pages where the player is the page. */
  ownsKeyboard?: boolean;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const IDLE_HIDE_MS = 2_500;

export default function BreadboardVideoPlayer({
  src,
  title,
  autoPlay = false,
  className,
  onReady,
  onError,
  elementRef,
  ownsKeyboard = false,
}: BreadboardVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [idle, setIdle] = useState(false);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_HIDE_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, []);

  // Controls only hide while something is actually playing.
  const onPlaying = useCallback(() => { setPlaying(true); wake(); }, [wake]);
  const onStopped = useCallback(() => {
    setPlaying(false);
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch((error: unknown) => {
        // A quick pause can interrupt a pending play without breaking media.
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    } else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = 1;
      video.muted = false;
    } else video.muted = true;
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void shell.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const handleKey = useCallback((event: KeyboardEvent | ReactKeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
    if (event.key === " " && target?.closest("button, a, [role='button']")) return;
    const actions: Record<string, () => void> = {
      " ": togglePlay, k: togglePlay,
      ArrowLeft: () => seekBy(-5), ArrowRight: () => seekBy(5),
      j: () => seekBy(-10), l: () => seekBy(10),
      m: toggleMute, f: toggleFullscreen,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    wake();
  }, [seekBy, toggleFullscreen, toggleMute, togglePlay, wake]);

  useEffect(() => {
    if (!ownsKeyboard) return;
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey, ownsKeyboard]);

  const syncVolume = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setMuted(video.muted || video.volume === 0);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hideControls = idle && playing;

  if (failed) {
    return (
      <div className={`${styles.player} ${className ?? ""}`} role="alert">
        <p className={styles.error}>
          This video could not be played here.{" "}
          <a href={src} download>Download it</a> to open it in another player.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={`${styles.player} ${hideControls ? styles.idle : ""} ${className ?? ""}`}
      role="region"
      aria-label={title ? `Video player: ${title}` : "Video player"}
      tabIndex={ownsKeyboard ? -1 : 0}
      onKeyDown={ownsKeyboard ? undefined : handleKey}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
    >
      <ReclaimingVideo
        elementRef={videoRef}
        src={src}
        autoPlay={autoPlay}
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={onPlaying}
        onPause={onStopped}
        onEnded={onStopped}
        onVolumeChange={syncVolume}
        onError={() => { setFailed(true); onError?.(); }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (elementRef) elementRef.current = video;
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          setMuted(video.muted);
          onReady?.();
        }}
        className={styles.video}
      >
        Your browser cannot play this video.
      </ReclaimingVideo>

      {/* Decorative: the video itself is click-to-play, the pill is the control. */}
      {!playing ? (
        <span className={styles.bigPlay} aria-hidden="true">
          <Play size={28} fill="currentColor" />
        </span>
      ) : null}

      <div className={styles.controls} role="group" aria-label="Playback controls">
        <button
          type="button"
          onClick={togglePlay}
          className={styles.iconButton}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing
            ? <Pause aria-hidden="true" size={16} fill="currentColor" />
            : <Play aria-hidden="true" size={16} fill="currentColor" />}
        </button>
        <span className={styles.time}>{formatPlaybackTime(currentTime)}</span>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`}
          min={0}
          max={duration || 0}
          step="any"
          value={currentTime}
          disabled={duration <= 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (videoRef.current && Number.isFinite(next)) {
              videoRef.current.currentTime = next;
              setCurrentTime(next);
            }
          }}
          className={styles.seek}
          style={{ "--bb-video-progress": `${progress}%` } as CSSProperties}
        />
        <span className={styles.time}>-{formatPlaybackTime(Math.max(0, duration - currentTime))}</span>
        <button
          type="button"
          onClick={toggleMute}
          className={styles.iconButton}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute (M)" : "Mute (M)"}
        >
          {muted ? <VolumeX aria-hidden="true" size={16} /> : <Volume2 aria-hidden="true" size={16} />}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className={styles.iconButton}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          title={fullscreen ? "Exit fullscreen (F / Esc)" : "Fullscreen (F)"}
        >
          {fullscreen ? <Minimize aria-hidden="true" size={16} /> : <Maximize aria-hidden="true" size={16} />}
        </button>
      </div>
    </div>
  );
}
