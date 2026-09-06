"use client";

import { requestForegroundMicrophone, stopForegroundStream } from '@/lib/speech/clap/audio-focus';

import { useEffect, useRef, useState } from "react";
import BreadboardLoader from "@/app/components/breadboard-loader";
import MicrophonePermissionHelp from "@/app/components/microphone-permission-help";
import { describeMicrophoneBlock, type MicrophoneFix } from "@/lib/speech/microphone-access";
import type {
  MusicRecognitionResult,
  RecognizedSong,
} from "@/lib/music-recognition/types.ts";

export const MUSIC_CAPTURE_DURATION_MS = 12_000;

type RecognitionState =
  | "idle"
  | "requesting"
  | "recording"
  | "recognizing"
  | "matched"
  | "no-match"
  | "error";

interface MusicRecognitionButtonProps {
  disabled?: boolean;
  runtimeSessionId?: string | number | null;
  onBusyChange?: (busy: boolean) => void;
}

function bestMusicRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(
    (candidate) => MediaRecorder.isTypeSupported(candidate),
  );
}

function musicFilename(mimeType: string): string {
  const base = mimeType.toLowerCase();
  const extension = base.includes("ogg") ? "ogg" : base.includes("mp4") ? "m4a" : "webm";
  return `music-sample.${extension}`;
}

function responseMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  return responseMessage(object.error) || responseMessage(object.message);
}

export async function identifyRecordedMusic(
  audio: File,
  options: { signal?: AbortSignal; runtimeSessionId?: string | number | null } = {},
): Promise<MusicRecognitionResult> {
  const form = new FormData();
  form.set("audio", audio);
  if (options.runtimeSessionId !== null && options.runtimeSessionId !== undefined) {
    form.set("sessionId", String(options.runtimeSessionId));
  }
  const response = await fetch("/api/music-recognition/recognize", {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseMessage(payload) || "Music recognition failed.");
  }
  if (!payload || typeof payload !== "object" || !("match" in payload)) {
    throw new Error("Music recognition returned an invalid response.");
  }
  return payload as MusicRecognitionResult;
}

function ServiceLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[10px] font-medium text-[var(--botanical)] transition hover:bg-[var(--paper-strong)]"
    >
      {children}
    </a>
  );
}

function SongCard({ song }: { song: RecognizedSong }) {
  const year = song.releaseDate?.match(/^\d{4}/u)?.[0];
  return (
    <div className="mt-2 flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
      {song.artwork ? (
        // Provider artwork is projected through an HTTPS-only normalizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={song.artwork}
          alt=""
          className="h-14 w-14 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--paper-strong)] text-[var(--ink-muted)]">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5l10-2v13M9 9l10-2M6.5 21A2.5 2.5 0 1 0 6.5 16a2.5 2.5 0 0 0 0 5Zm10-2A2.5 2.5 0 1 0 16.5 14a2.5 2.5 0 0 0 0 5Z" />
          </svg>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[var(--ink-heading)]">{song.title}</p>
        <p className="truncate text-[11px] text-[var(--ink)]">{song.artist}</p>
        {song.album || year ? (
          <p className="mt-0.5 truncate text-[10px] text-[var(--ink-muted)]">
            {[song.album, year].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ServiceLink href={song.links?.spotify}>Spotify</ServiceLink>
          <ServiceLink href={song.links?.appleMusic}>Apple Music</ServiceLink>
          {!song.links?.spotify && !song.links?.appleMusic ? (
            <ServiceLink href={song.links?.song}>Open song</ServiceLink>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MusicRecognitionButton({
  disabled = false,
  runtimeSessionId,
  onBusyChange,
}: MusicRecognitionButtonProps) {
  const [state, setState] = useState<RecognitionState>("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(12);
  const [result, setResult] = useState<MusicRecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<MicrophoneFix | null>(null);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

  const busy = state === "requesting" || state === "recording" || state === "recognizing";

  function releaseCapture() {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
    stopTimerRef.current = null;
    countdownTimerRef.current = null;
    stopForegroundStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  }

  function cancelRecognition(updateState = true) {
    operationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    const recorder = recorderRef.current;
    // Invalidate the stop callback first, then stop every track immediately.
    if (recorder?.state === "recording") recorder.stop();
    releaseCapture();
    if (updateState && mountedRef.current) {
      setState("idle");
      setResult(null);
      setError(null);
      setBlocked(null);
    }
  }

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
      stopTimerRef.current = null;
      countdownTimerRef.current = null;
      stopForegroundStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  async function identifySong() {
    if (busy || disabled) return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setError(null);
    setBlocked(null);
    setResult(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("Microphone recording is not supported in this browser.");
      return;
    }

    setState("requesting");
    try {
      const stream = await requestForegroundMicrophone({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      if (!mountedRef.current || operation !== operationRef.current) {
        stopForegroundStream(stream);
        return;
      }
      streamRef.current = stream;

      const requestedType = bestMusicRecordingMimeType();
      const recorder = requestedType
        ? new MediaRecorder(stream, { mimeType: requestedType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.addEventListener(
          "error",
          () => reject(new Error("Audio recording failed.")),
          { once: true },
        );
      });

      const startedAt = Date.now();
      recorder.start(250);
      setSecondsRemaining(Math.ceil(MUSIC_CAPTURE_DURATION_MS / 1_000));
      setState("recording");
      countdownTimerRef.current = window.setInterval(() => {
        const remaining = Math.max(0, MUSIC_CAPTURE_DURATION_MS - (Date.now() - startedAt));
        if (mountedRef.current) setSecondsRemaining(Math.ceil(remaining / 1_000));
      }, 200);
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MUSIC_CAPTURE_DURATION_MS);

      await stopped;
      const actualType = recorder.mimeType || requestedType || "audio/webm";
      releaseCapture();
      if (!mountedRef.current || operation !== operationRef.current) return;
      const audio = new File(chunks, musicFilename(actualType), {
        type: actualType,
        lastModified: Date.now(),
      });
      if (!audio.size) throw new Error("No audio was captured. Try another sample.");

      setState("recognizing");
      const controller = new AbortController();
      requestAbortRef.current = controller;
      const next = await identifyRecordedMusic(audio, {
        signal: controller.signal,
        runtimeSessionId,
      });
      requestAbortRef.current = null;
      if (!mountedRef.current || operation !== operationRef.current) return;
      setResult(next);
      setState(next.match ? "matched" : "no-match");
    } catch (caught) {
      releaseCapture();
      if (!mountedRef.current || operation !== operationRef.current) return;
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        setBlocked(await describeMicrophoneBlock(caught));
        setState("error");
        return;
      }
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setState("idle");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Music recognition failed.");
      setState("error");
    } finally {
      if (operation === operationRef.current) requestAbortRef.current = null;
    }
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        disabled={disabled || busy}
        onClick={() => void identifySong()}
        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5l10-2v13M9 9l10-2M6.5 21A2.5 2.5 0 1 0 6.5 16a2.5 2.5 0 0 0 0 5Zm10-2A2.5 2.5 0 1 0 16.5 14a2.5 2.5 0 0 0 0 5Z" />
        </svg>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-heading)]">Identify song</span>
          <span className="block text-[11px] leading-4 text-[var(--ink-muted)]">Listen for 12 seconds, then identify it.</span>
        </span>
      </button>

      {busy ? (
        <div role="status" aria-live="polite" className="mx-1 mb-1 mt-0.5 flex items-center gap-2 rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-[11px] text-[var(--ink)]">
          {state === "recording" ? (
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#b85353]" aria-hidden />
          ) : (
            <BreadboardLoader className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            {state === "requesting"
              ? "Opening microphone…"
              : state === "recording"
                ? `Listening… ${secondsRemaining} ${secondsRemaining === 1 ? "second" : "seconds"} remaining`
                : "Recognizing…"}
          </span>
          <button
            type="button"
            className="rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--ink-muted)] hover:bg-[var(--paper-surface)]"
            onClick={() => cancelRecognition()}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {state === "matched" && result?.match ? (
        <div role="status" aria-live="polite" className="mx-1 mb-1">
          <p className="px-2 pt-1 text-[11px] font-medium text-[var(--botanical)]">Identified</p>
          <SongCard song={result.match} />
        </div>
      ) : null}
      {state === "no-match" ? (
        <div role="status" className="mx-1 mb-1 rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-[11px] text-[var(--ink)]">
          No match found. Try another clean 10–15 second sample.
        </div>
      ) : null}
      {state === "error" ? (
        <div role="alert" className="mx-1 mb-1 rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-[11px] text-[var(--ink)]">
          {blocked ? (
            <MicrophonePermissionHelp
              fix={blocked}
              onRetry={() => void identifySong()}
              retryLabel="Try music recognition again"
            />
          ) : (
            <p>{error ?? "Recognition unavailable."}</p>
          )}
        </div>
      ) : null}
    </>
  );
}
