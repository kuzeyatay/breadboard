"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { releaseMediaElement } from "@/app/components/reclaiming-media";
import styles from "./breadboard-audio-player.module.css";

interface BreadboardAudioPlayerProps {
  src: string;
  label: string;
  className?: string;
}

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.75 5.25h3.5v13.5h-3.5zM13.75 5.25h3.5v13.5h-3.5z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.25 5.6v12.8a.75.75 0 0 0 1.14.64l9.75-6.4a.75.75 0 0 0 0-1.28l-9.75-6.4a.75.75 0 0 0-1.14.64Z" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.75 7.5 9H4.75v6H7.5L11 18.25z" />
      {muted ? (
        <path strokeLinecap="round" d="m15.5 9.5 4 5m0-5-4 5" />
      ) : (
        <path strokeLinecap="round" d="M15.25 9a4.25 4.25 0 0 1 0 6M17.75 6.75a7.4 7.4 0 0 1 0 10.5" />
      )}
    </svg>
  );
}

/** Breadboard's custom audio transport. Playback is deliberately paused initially. */
export default function BreadboardAudioPlayer({
  src,
  label,
  className = "",
}: BreadboardAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const setAudioRef = useCallback((audio: HTMLAudioElement | null) => {
    const previous = audioRef.current;
    if (previous && previous !== audio) releaseMediaElement(previous);
    audioRef.current = audio;
  }, []);

  const resetPlaybackState = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  useEffect(
    () => () => {
      if (audioRef.current) releaseMediaElement(audioRef.current);
    },
    [],
  );

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const updateDuration = () => {
    const nextDuration = audioRef.current?.duration ?? 0;
    setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
  };

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMuted = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <div
      className={`${styles.transport} flex min-w-0 items-center gap-2 rounded-lg border border-[var(--line)] px-2 py-2 ${className}`}
      data-breadboard-audio-player
    >
      <button
        type="button"
        onClick={togglePlayback}
        className={`neu-button-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-[border-color,background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] ${
          isPlaying
            ? "border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_10%,var(--paper-raised))] text-[var(--botanical)]"
            : "border-gray-700 text-[var(--botanical)] hover:border-[var(--botanical)]"
        }`}
        aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
        aria-pressed={isPlaying}
        title={isPlaying ? "Pause audio" : "Play audio"}
      >
        <PlayIcon playing={isPlaying} />
      </button>

      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
        {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
      </span>
      <div className={`${styles.scrubberWrap} min-w-0 flex-1`}>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          disabled={duration <= 0}
          className={styles.scrubber}
          style={{ "--bb-media-progress": `${progress}%` } as CSSProperties}
          aria-label={`Seek ${label}`}
        />
      </div>
      <button
        type="button"
        onClick={toggleMuted}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:scale-[0.96]"
        aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
        title={muted ? "Unmute" : "Mute"}
      >
        <VolumeIcon muted={muted} />
      </button>

      <audio
        ref={setAudioRef}
        preload="metadata"
        src={src}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onEmptied={resetPlaybackState}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
      >
        Your browser cannot play this audio file.
      </audio>
    </div>
  );
}
