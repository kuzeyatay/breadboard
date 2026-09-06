"use client";

import { requestForegroundMicrophone, stopForegroundStream } from '@/lib/speech/clap/audio-focus';

import { useCallback, useEffect, useRef, useState } from "react";
import { ReclaimingAudio } from "@/app/components/reclaiming-media";
import MicrophonePermissionHelp from "./microphone-permission-help";
import {
  MAX_SAMPLE_SECONDS,
  MIN_SAMPLE_SECONDS,
  sampleLengthAdvice,
  type CalibrationPassage,
} from "@/lib/speech/calibration";
import { decodedRecordingAsWav } from "@/lib/speech/live-dictation";
import { describeMicrophoneBlock, type MicrophoneFix } from "@/lib/speech/microphone-access";

type RecorderState = "idle" | "requesting" | "recording" | "preparing" | "recorded";

interface VoiceSampleRecorderProps {
  passage: CalibrationPassage;
  /** Called with the finished take, or with null when it is discarded. */
  onRecorded: (file: File | null, seconds: number) => void;
  disabled?: boolean;
}

/** Speech peaks around 0.1–0.3 RMS, so scale that range across the meter. */
const LEVEL_GAIN = 5;
/** Under this peak the microphone was muted, or it is not the one speaking. */
const SILENT_PEAK = 0.012;

const recorderButton =
  "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-45";
const recordButton =
  "neu-button-accent rounded-xl border border-[var(--botanical)] bg-[var(--botanical)] px-3 py-2 text-sm font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:opacity-45";

function bestRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Records the voice sample in place, from a script.
 *
 * The reference text is the reason this exists: the file-upload path asks the
 * user to type out what they said, and a transcript that drifts from the audio
 * quietly degrades every sentence the clone ever speaks. Reading a passage we
 * already hold means the pairing is exact by construction.
 */
export default function VoiceSampleRecorder({ passage, onRecorded, disabled = false }: VoiceSampleRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<{ url: string; seconds: number; silent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<MicrophoneFix | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const frameRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const peakRef = useRef(0);
  const meteringRef = useRef(false);
  const takeUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  /** Everything the browser keeps alive after a take: mic, meter, timers. */
  const releaseMicrophone = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    frameRef.current = null;
    tickRef.current = null;
    stopTimerRef.current = null;
    stopForegroundStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMicrophone();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      takeUrlRef.current = null;
    };
  }, [releaseMicrophone]);

  /**
   * A level meter is not decoration here: a muted or wrong input device
   * records perfect silence, which looks exactly like a successful take until
   * the cloned voice comes back wrong.
   */
  function startMetering(stream: MediaStream) {
    const AudioContextCtor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = context;
    meteringRef.current = true;
    // Started from a click, so this is allowed — but a suspended context reads
    // as pure silence, which would libel a perfectly good take.
    void context.resume().catch(() => {});
    const samples = new Float32Array(analyser.fftSize);
    const measure = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      peakRef.current = Math.max(peakRef.current, rms);
      setLevel(Math.min(1, rms * LEVEL_GAIN));
      frameRef.current = requestAnimationFrame(measure);
    };
    frameRef.current = requestAnimationFrame(measure);
  }

  function discardTake() {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    onRecordedRef.current(null, 0);
  }

  async function startRecording() {
    setError(null);
    setBlocked(null);
    discardTake();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not supported here. Upload an audio file instead.");
      return;
    }
    setState("requesting");
    try {
      // No noise suppression or auto gain: those reshape exactly the timbre
      // the clone is meant to copy. Echo cancellation stays on because a
      // laptop speaker bleeding into the take is worse.
      const stream = await requestForegroundMicrophone({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      if (!mountedRef.current) {
        stopForegroundStream(stream);
        return;
      }
      const mimeType = bestRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      peakRef.current = 0;
      meteringRef.current = false;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        async () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          const recordedMime = recorder.mimeType || mimeType || "audio/webm";
          // MediaRecorder's webm carries no duration header, so the wall clock
          // is the only honest length: an <audio> element reports Infinity.
          const seconds = (Date.now() - startedAtRef.current) / 1_000;
          // Without a meter there is no peak to judge, and claiming silence on
          // a browser that lacks AudioContext would flag every take.
          const silent = meteringRef.current && peakRef.current < SILENT_PEAK;
          releaseMicrophone();
          if (!mountedRef.current) return;
          setState("preparing");
          if (!chunks.length) {
            setState("idle");
            setError("Nothing was captured. Try again once the button turns red.");
            return;
          }
          const blob = new Blob(chunks, { type: recordedMime });
          const wav = await decodedRecordingAsWav(blob, 48_000);
          if (!mountedRef.current) return;
          if (!wav?.size) {
            setState("idle");
            setError("Breadboard could not prepare that recording. Record it again, or upload a WAV file instead.");
            onRecordedRef.current(null, 0);
            return;
          }
          const file = new File([wav], "voice-sample.wav", { type: "audio/wav" });
          const url = URL.createObjectURL(wav);
          takeUrlRef.current = url;
          setTake({ url, seconds, silent });
          setState("recorded");
          onRecordedRef.current(file, seconds);
        },
        { once: true },
      );
      // One complete container is reliably decodable; timed MediaRecorder
      // fragments may not carry their own WebM/MP4 header.
      recorder.start();
      startMetering(stream);
      setState("recording");
      tickRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_SAMPLE_SECONDS * 1_000);
    } catch (caught) {
      releaseMicrophone();
      setState("idle");
      // A refusal is not an error message: it is a setting somewhere the user
      // has to be walked to, so it gets the guidance panel instead.
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        const fix = await describeMicrophoneBlock(caught);
        if (mountedRef.current) setBlocked(fix);
        return;
      }
      setError(caught instanceof Error ? caught.message : "The microphone could not be opened.");
    }
  }

  const busy = state === "requesting" || state === "preparing";
  const recording = state === "recording";
  const advice = recording
    ? sampleLengthAdvice(elapsedMs / 1_000, "recording")
    : take
      ? sampleLengthAdvice(take.seconds, "recorded")
      : null;
  const adviceColor =
    advice?.tone === "short" ? "text-[#b85353]" : advice?.tone === "good" ? "text-[var(--botanical)]" : "text-[var(--ink-muted)]";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Read this aloud</p>
        <p dir={passage.dir} className="mt-1.5 text-sm leading-6 text-[var(--ink)]">
          {passage.text}
        </p>
        <p className="mt-2 text-[11px] leading-5 text-[var(--ink-muted)]">
          {passage.translated
            ? "Read at your normal pace, in a quiet room. Breadboard files these exact words as the transcript, so the clone learns from a perfect match."
            : "There is no passage in that language yet, so this English one stands in. Read it as shown; Breadboard saves the passage with the recording automatically."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={recording ? recorderButton : recordButton}
          onClick={recording ? () => recorderRef.current?.stop() : () => void startRecording()}
          disabled={disabled || busy}
          aria-pressed={recording}
        >
          {state === "requesting" ? "Opening microphone…" : state === "preparing" ? "Preparing audio…" : recording ? "Stop recording" : take ? "Record again" : "Start recording"}
        </button>

        {recording ? (
          <>
            <span className="flex items-center gap-2 text-sm tabular-nums text-[var(--ink)]">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#c96d6d]" aria-hidden />
              {formatClock(elapsedMs)}
            </span>
            <div
              className="neu-progress-track h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-[var(--line)]"
              role="meter"
              aria-label="Microphone level"
              aria-valuenow={Math.round(level * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[var(--botanical)] transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </>
        ) : null}

        {take && !recording ? (
          <ReclaimingAudio src={take.url} controls className="h-9 min-w-0 flex-1" aria-label="Your recorded sample" />
        ) : null}
      </div>

      {advice ? (
        <p role="status" className={`text-[11px] leading-5 ${adviceColor}`}>
          {take && !recording ? `${Math.round(take.seconds * 10) / 10} seconds. ` : ""}
          {advice.message}
        </p>
      ) : (
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          Recording stops when you press stop, or after {MAX_SAMPLE_SECONDS} seconds. Aim for{" "}
          {MIN_SAMPLE_SECONDS}–15 seconds.
        </p>
      )}

      {take?.silent ? (
        <p role="alert" className="rounded-xl border border-[#c78b58] bg-[color-mix(in_srgb,#c78b58_8%,var(--paper-raised))] px-3 py-2 text-[11px] leading-5 text-[var(--ink)]">
          That take is almost silent. Play it back to check — if you hear nothing, your microphone is muted or the
          wrong input device is selected.
        </p>
      ) : null}

      {error || blocked ? (
        <div role="alert" className="neu-surface-subtle rounded-xl border p-3 text-[11px] leading-5 text-[var(--ink)]">
          {blocked ? (
            <MicrophonePermissionHelp
              fix={blocked}
              onRetry={() => void startRecording()}
              retryLabel="Try recording again"
            />
          ) : (
            <p>{error}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
