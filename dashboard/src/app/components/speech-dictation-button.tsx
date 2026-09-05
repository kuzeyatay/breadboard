"use client";

import { speechRequest } from "@/lib/speech/request-client";
import { connectSubscriptionVoice, subscriptionSelected, type SubscriptionVoice } from "@/lib/speech/subscription-live";
import { useCallback, useEffect, useRef, useState } from "react";
import BreadboardLoader from "@/app/components/breadboard-loader";
import MusicRecognitionButton from "@/app/components/music-recognition-button";
import MicrophonePermissionHelp from "./microphone-permission-help";
import { describeMicrophoneBlock, type MicrophoneFix } from "@/lib/speech/microphone-access";
import {
  appendRecognizedSegment,
  decodedRecordingAsWav,
  encodePcm16Wav,
  replaceDictationPreview,
} from "@/lib/speech/live-dictation";
import {
  MAX_RECORDING_BYTES,
  RECORDING_ACCEPT_ATTR,
  RECORDING_FILENAME_HEADER,
  describeRecordingProgress,
  formatRecordingSize,
  isTranscribableRecording,
  readRecordingEvents,
  type RecordingTranscriptionEvent,
} from "@/lib/speech/recording-upload";
import { prepareLocalSpeech, speechErrorMessage } from "@/lib/speech/prepare-client";
import { VOICE_DOUBLE_TAP_MS } from "@/lib/speech/voice-conversation";

type DictationState =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "transcribing"
  | "reading-file";

interface SpeechDictationButtonProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Open upward in chat docks and downward when the composer sits at a panel's top. */
  placement?: "above" | "below";
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Full-screen voice mode: an entry in the microphone's menu, and what
   * a double-tap goes straight to. Passed only by hosts that can hold a spoken
   * conversation; without it the menu offers dictation and file transcription
   * alone, and there is no double-tap window to wait out.
   */
  onOpenVoiceMode?: () => void;
  /** Existing runtime session, used only to retain a direct recognition result in chat. */
  runtimeSessionId?: string | number | null;
}

type PcmCapture = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  sampleRate: number;
  totalSamples: number;
  paused: boolean;
};

const PARTIAL_TRANSCRIPT_INTERVAL_MS = 2_750;
const MIN_PARTIAL_SECONDS = 1.25;
const MODEL_DOWNLOAD_RETRY_MS = 2_000;
const MODEL_DOWNLOAD_WAIT_MS = 10 * 60_000;

function bestRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
}

function nestedMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return nestedMessage(record.message) || nestedMessage(record.detail) || nestedMessage(record.error);
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return nestedMessage(body) || `Dictation failed (${response.status}).`;
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function requestTranscript(
  blob: Blob,
  filename: string,
  signal: AbortSignal,
  waitForModel: boolean,
): Promise<string | null> {
  const deadline = Date.now() + MODEL_DOWNLOAD_WAIT_MS;
  while (true) {
    const form = new FormData();
    form.set("file", blob, filename);
    const response = await speechRequest("/api/speech/transcribe", {
      method: "POST",
      body: form,
      signal,
    });
    if (response.status === 202) {
      if (!waitForModel) return null;
      if (Date.now() >= deadline) throw new Error(await responseError(response));
      await waitForRetry(MODEL_DOWNLOAD_RETRY_MS, signal);
      continue;
    }
    if (!response.ok) throw new Error(await responseError(response));
    const result = (await response.json()) as { text?: string };
    return result.text?.trim() || "";
  }
}

/**
 * Fold a batch of progress events into an outcome. Kept out of the component so
 * the transcript and the failure are assigned in the same scope that reads
 * them, rather than through a closure that hides them from the type checker.
 */
function recordingOutcome(
  events: RecordingTranscriptionEvent[],
  onProgress: (label: string) => void,
): { transcript?: string; failure?: string } {
  const outcome: { transcript?: string; failure?: string } = {};
  for (const event of events) {
    if (event.stage === "done") outcome.transcript = event.text;
    else if (event.stage === "error") outcome.failure = event.error;
    else onProgress(describeRecordingProgress(event));
  }
  return outcome;
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/**
 * One row of the microphone menu, wearing the same clothes as the menu that
 * appears over highlighted chat text: paper-raised card, hairline border,
 * rounded rows that light up on hover.
 */
function MicrophoneMenuItem({
  title,
  hint,
  icon,
  onClick,
  accent = false,
  disabled = false,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition ${
        accent ? "hover:bg-[var(--selection-yellow)]" : "hover:bg-[var(--paper-strong)]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-muted)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        {icon}
      </svg>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--ink-heading)]">{title}</span>
        <span className="block text-[11px] leading-4 text-[var(--ink-muted)]">{hint}</span>
      </span>
    </button>
  );
}

export default function SpeechDictationButton({
  value,
  onChange,
  disabled = false,
  compact = false,
  placement = "above",
  textareaRef,
  onOpenVoiceMode,
  runtimeSessionId,
}: SpeechDictationButtonProps) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<MicrophoneFix | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmCaptureRef = useRef<PcmCapture | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const valueRef = useRef(value);
  const liveTranscriptRef = useRef("");
  const previewRef = useRef("");
  const partialCursorRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const partialTimerRef = useRef<number | null>(null);
  const partialAbortRef = useRef<AbortController | null>(null);
  const finalAbortRef = useRef<AbortController | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const partialPromiseRef = useRef<Promise<void> | null>(null);
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);
  const tapTimerRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const levelBarsRef = useRef<Array<HTMLSpanElement | null>>([]);

  const paintDictationLevel = useCallback((rms: number) => {
    const level = Math.min(1, Math.max(0, rms * 9));
    const shape = [0.56, 0.82, 1, 0.76, 0.52];
    levelBarsRef.current.forEach((bar, index) => {
      if (!bar) return;
      const scale = Math.min(1, 0.24 + level * (shape[index] ?? 0.6));
      bar.style.transform = `scaleY(${scale.toFixed(3)})`;
      bar.style.opacity = `${(0.62 + level * 0.38).toFixed(3)}`;
    });
  }, []);

  const subscriptionRef = useRef<SubscriptionVoice | null>(null);
  const releaseMicrophone = useCallback(() => {
    void subscriptionRef.current?.close();
    subscriptionRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (partialTimerRef.current !== null) window.clearInterval(partialTimerRef.current);
    partialTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    paintDictationLevel(0);

    const capture = pcmCaptureRef.current;
    pcmCaptureRef.current = null;
    if (capture) {
      capture.processor.onaudioprocess = null;
      capture.source.disconnect();
      capture.processor.disconnect();
      capture.sink.disconnect();
      void capture.context.close();
    }
  }, [paintDictationLevel]);

  const stopPartialRecognition = useCallback((): Promise<void> | null => {
    if (partialTimerRef.current !== null) window.clearInterval(partialTimerRef.current);
    partialTimerRef.current = null;
    const pending = partialPromiseRef.current;
    partialAbortRef.current?.abort();
    partialAbortRef.current = null;
    return pending;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      stopPartialRecognition();
      prepareAbortRef.current?.abort();
      finalAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      releaseMicrophone();
    };
  }, [releaseMicrophone, stopPartialRecognition]);

  // The menu is dismissed the way the text-selection menu is: a pointer landing
  // anywhere else, or Escape. The shell wraps the button too, so tapping the
  // microphone again falls through to its own toggle instead of double-closing.
  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  function showPreview(nextPreview: string) {
    const nextValue = replaceDictationPreview(valueRef.current, previewRef.current, nextPreview);
    previewRef.current = nextPreview;
    valueRef.current = nextValue;
    onChange(nextValue);
  }

  async function beginPcmCapture(stream: MediaStream): Promise<PcmCapture | null> {
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) return null;
    let context: AudioContext | null = null;
    try {
      context = new AudioContextClass();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      const capture: PcmCapture = {
        context,
        source,
        processor,
        sink,
        chunks: [],
        sampleRate: context.sampleRate,
        totalSamples: 0,
        paused: false,
      };
      processor.onaudioprocess = (event) => {
        if (capture.paused) return;
        const input = event.inputBuffer.getChannelData(0);
        let energy = 0;
        for (const sample of input) energy += sample * sample;
        paintDictationLevel(Math.sqrt(energy / input.length));
        const copy = new Float32Array(input.length);
        copy.set(input);
        if (!subscriptionRef.current) capture.chunks.push(copy);
        capture.totalSamples += copy.length;
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      pcmCaptureRef.current = capture;
      return capture;
    } catch {
      if (context) void context.close();
      return null;
    }
  }

  function recognizePartial(session: number) {
    if (subscriptionRef.current) return;
    if (partialPromiseRef.current) return;
    const capture = pcmCaptureRef.current;
    const startSample = partialCursorRef.current;
    const endSample = capture?.totalSamples ?? 0;
    if (
      !capture ||
      recorderRef.current?.state !== "recording" ||
      endSample - startSample < capture.sampleRate * MIN_PARTIAL_SECONDS
    ) {
      return;
    }

    const wav = encodePcm16Wav(capture.chunks, capture.sampleRate, {
      startSample,
      endSample,
    });
    const controller = new AbortController();
    partialAbortRef.current = controller;
    const pending = (async () => {
      try {
        const segment = await requestTranscript(
          wav,
          "dictation-partial.wav",
          controller.signal,
          false,
        );
        if (
          segment === null ||
          session !== sessionRef.current ||
          recorderRef.current?.state !== "recording"
        ) {
          return;
        }
        partialCursorRef.current = endSample;
        if (!segment) return;
        liveTranscriptRef.current = appendRecognizedSegment(liveTranscriptRef.current, segment);
        showPreview(liveTranscriptRef.current);
      } catch (caught) {
        // Rolling recognition is best-effort. The final pass reports a useful
        // error and keeps any words already placed in the composer.
        if (!(caught instanceof DOMException && caught.name === "AbortError")) return;
      } finally {
        if (partialAbortRef.current === controller) partialAbortRef.current = null;
        partialPromiseRef.current = null;
      }
    })();
    partialPromiseRef.current = pending;
  }

  async function transcribeRecording(
    pcmWav: Blob | null,
    chunks: Blob[],
    mimeType: string,
    pendingPartial: Promise<void> | null,
  ) {
    try {
      await pendingPartial?.catch(() => undefined);
      let recording = pcmWav;
      if (!recording && chunks.length) {
        recording = await decodedRecordingAsWav(new Blob(chunks, { type: mimeType || "audio/webm" }));
      }
      if (!recording?.size) {
        throw new Error("No audio was captured. Try again and speak after the button turns red.");
      }

      const controller = new AbortController();
      finalAbortRef.current = controller;
      const transcript = await requestTranscript(
        recording,
        "dictation.wav",
        controller.signal,
        true,
      );
      if (!transcript) throw new Error("No words were recognized.");
      if (!mountedRef.current) return;

      const nextValue = replaceDictationPreview(valueRef.current, previewRef.current, transcript);
      previewRef.current = "";
      valueRef.current = nextValue;
      onChange(nextValue);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (caught) {
      if (
        mountedRef.current &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setError(speechErrorMessage(caught, "Dictation failed."));
      }
    } finally {
      finalAbortRef.current = null;
      if (mountedRef.current) setState("idle");
    }
  }

  async function startRecording() {
    setError(null);
    setBlocked(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is not supported in this browser.");
      return;
    }
    setState("requesting");
    try {
      const prepareController = new AbortController();
      prepareAbortRef.current = prepareController;
      try {
        await prepareLocalSpeech(prepareController.signal);
      } finally {
        if (prepareAbortRef.current === prepareController) prepareAbortRef.current = null;
      }
      if (!mountedRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const session = sessionRef.current + 1;
      sessionRef.current = session;
      liveTranscriptRef.current = "";
      previewRef.current = "";
      partialCursorRef.current = 0;
      await beginPcmCapture(stream);

      const cloudController = new AbortController();
      prepareAbortRef.current = cloudController;
      if (await subscriptionSelected(cloudController.signal)) {
        const voice = await connectSubscriptionVoice({ microphone: stream, signal: cloudController.signal,
          onTranscript: (text) => { if (mountedRef.current && session === sessionRef.current) showPreview(text); },
        });
        if (!mountedRef.current) { await voice.close(); return; }
        subscriptionRef.current = voice;
      }
      if (prepareAbortRef.current === cloudController) prepareAbortRef.current = null;

      const mimeType = bestRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0 && !subscriptionRef.current) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
          const voice = subscriptionRef.current;
          if (voice) {
            subscriptionRef.current = null;
            sessionRef.current += 1;
            stopPartialRecognition();
            const controller = new AbortController();
            finalAbortRef.current = controller;
            controller.signal.addEventListener("abort", () => { void voice.close(); }, { once: true });
            const final = voice.finishTranscript();
            releaseMicrophone();
            setState("transcribing");
            void final.then((text) => {
              if (!mountedRef.current) return;
              showPreview(text);
              previewRef.current = "";
            }, (error) => { if (mountedRef.current) setError(error instanceof Error ? error.message : "Dictation failed."); })
              .finally(() => { void voice.close(); if (finalAbortRef.current === controller) finalAbortRef.current = null; if (mountedRef.current) setState("idle"); });
            return;
          }
          sessionRef.current += 1;
          const pendingPartial = stopPartialRecognition();
          const capture = pcmCaptureRef.current;
          const pcmWav = capture?.totalSamples
            ? encodePcm16Wav(capture.chunks, capture.sampleRate)
            : null;
          const chunks = chunksRef.current;
          chunksRef.current = [];
          const recordedMime = recorder.mimeType || mimeType || "audio/webm";
          releaseMicrophone();
          if (mountedRef.current) {
            setState("transcribing");
            void transcribeRecording(pcmWav, chunks, recordedMime, pendingPartial);
          }
        },
        { once: true },
      );
      // A single complete fallback container is decodable. Passing a timeslice
      // can produce WebM fragments without their header in Chromium/WebKit.
      if (subscriptionRef.current) recorder.start(1000);
      else recorder.start();
      setState("recording");
      requestAnimationFrame(() => pauseButtonRef.current?.focus());
      partialTimerRef.current = window.setInterval(
        () => recognizePartial(session),
        PARTIAL_TRANSCRIPT_INTERVAL_MS,
      );
      if (!subscriptionRef.current) timeoutRef.current = window.setTimeout(() => {
        if (recorder.state === "recording" || recorder.state === "paused") recorder.stop();
      }, 5 * 60_000);
    } catch (caught) {
      releaseMicrophone();
      setState("idle");
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      // A refusal is not an error message: it is a setting somewhere the user
      // has to be walked to, so it gets the guidance panel instead.
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        const fix = await describeMicrophoneBlock(caught);
        if (mountedRef.current) setBlocked(fix);
        return;
      }
      setError(speechErrorMessage(caught, "The microphone could not be opened."));
    }
  }

  function toggleRecordingPause() {
    const recorder = recorderRef.current;
    const capture = pcmCaptureRef.current;
    if (!recorder) return;

    if (state === "recording" && recorder.state === "recording") {
      subscriptionRef.current?.setListening(false);
      recorder.pause();
      if (capture) capture.paused = true;
      stopPartialRecognition();
      paintDictationLevel(0);
      setState("paused");
      return;
    }

    if (state === "paused" && recorder.state === "paused") {
      subscriptionRef.current?.setListening(true);
      recorder.resume();
      if (capture) capture.paused = false;
      const session = sessionRef.current;
      partialTimerRef.current = window.setInterval(
        () => recognizePartial(session),
        PARTIAL_TRANSCRIPT_INTERVAL_MS,
      );
      setState("recording");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && (recorder.state === "recording" || recorder.state === "paused")) {
      recorder.stop();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  /**
   * Transcribe a recording the user already has. The file is streamed to the
   * route as the raw body — a lecture video should never be turned into a
   * string in this tab — and the reply is a progress stream, so a long file
   * says which part it is on rather than spinning silently.
   */
  async function transcribeChosenFile(file: File) {
    setError(null);
    setBlocked(null);
    if (!isTranscribableRecording(file.name)) {
      setError(`Breadboard cannot read "${file.name}" as a recording. Pick an audio or video file.`);
      return;
    }
    if (file.size > MAX_RECORDING_BYTES) {
      setError(
        `That recording is ${formatRecordingSize(file.size)}. Recordings may be at most ${formatRecordingSize(MAX_RECORDING_BYTES)}.`,
      );
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setState("reading-file");
    setUploadStatus(`Sending ${file.name}…`);

    let transcript: string | null = null;
    let failure: string | null = null;
    const showStatus = (label: string) => {
      if (mountedRef.current) setUploadStatus(label);
    };

    try {
      const response = await speechRequest("/api/speech/transcribe-upload", {
        method: "POST",
        body: file,
        headers: {
          [RECORDING_FILENAME_HEADER]: encodeURIComponent(file.name),
          "content-type": file.type || "application/octet-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(await responseError(response));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        // A stream cut short of its final newline still has an outcome in it.
        if (done && buffer.trim() && !buffer.endsWith("\n")) buffer += "\n";
        const parsed = readRecordingEvents(buffer);
        buffer = parsed.rest;
        const outcome = recordingOutcome(parsed.events, showStatus);
        if (outcome.transcript !== undefined) transcript = outcome.transcript;
        if (outcome.failure !== undefined) failure = outcome.failure;
        if (done) break;
      }

      if (failure) throw new Error(failure);
      if (!transcript) throw new Error("No words were recognized in that recording.");
      if (!mountedRef.current) return;

      const nextValue = replaceDictationPreview(valueRef.current, "", transcript);
      valueRef.current = nextValue;
      onChange(nextValue);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (caught) {
      if (
        mountedRef.current &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setError(speechErrorMessage(caught, "That recording could not be transcribed."));
      }
    } finally {
      uploadAbortRef.current = null;
      if (mountedRef.current) {
        setState("idle");
        setUploadStatus(null);
      }
    }
  }

  function chooseRecording() {
    setMenuOpen(false);
    setError(null);
    setBlocked(null);
    fileInputRef.current?.click();
  }

  function dictateFromMenu() {
    setMenuOpen(false);
    void startRecording();
  }

  function openVoiceModeFromMenu() {
    setMenuOpen(false);
    setError(null);
    setBlocked(null);
    onOpenVoiceMode?.();
  }

  /**
   * One tap opens the microphone's options, two still go straight to voice
   * mode. The menu appears on the first tap so nothing feels delayed — a second
   * tap inside the window takes it back down on the way to the voice screen.
   * Stopping a running recording is never a double-tap gesture, so that tap
   * acts immediately and never opens a menu.
   */
  function handleTap() {
    if (musicBusy) {
      // Closing the menu unmounts the recognition controller, whose cleanup
      // aborts the request and stops every microphone track immediately.
      setMenuOpen(false);
      return;
    }
    if (state === "recording" || state === "paused") {
      stopRecording();
      return;
    }
    // The menu and the error panel share a corner, so opening one puts the
    // other away. Nothing is lost: every option that failed is still in reach.
    const toggleMenu = () => {
      setError(null);
      setBlocked(null);
      setMenuOpen((open) => !open);
    };
    if (!onOpenVoiceMode || state !== "idle") {
      if (state === "idle") toggleMenu();
      return;
    }
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      setMenuOpen(false);
      setError(null);
      setBlocked(null);
      onOpenVoiceMode();
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
    }, VOICE_DOUBLE_TAP_MS);
    toggleMenu();
  }

  const busy = state === "requesting" || state === "transcribing" || state === "reading-file";
  const dictationActive = state === "recording" || state === "paused";
  const popupPosition = placement === "below" ? "top-full mt-2" : "bottom-full mb-2";
  const label =
    musicBusy
      ? "Cancel song identification"
      : dictationActive
      ? "Stop dictation — words appear as you speak"
      : state === "transcribing"
        ? "Finishing dictation"
        : state === "reading-file"
          ? "Transcribing a recording"
          : state === "requesting"
            ? "Starting speech"
            : onOpenVoiceMode
              ? "Voice options — double-tap to talk to the assistant"
              : "Voice options";

  return (
    <div
      ref={shellRef}
      className={`relative shrink-0 self-end ${compact ? "h-9 w-9" : "h-11 w-11"}`}
      data-dictation-active={dictationActive}
      data-dictation-paused={state === "paused"}
      data-dictation-compact={compact}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={RECORDING_ACCEPT_ATTR}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = "";
          if (file) void transcribeChosenFile(file);
        }}
      />
      <button
        type="button"
        onClick={handleTap}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled || busy}
        aria-label={label}
        title={label}
        aria-pressed={dictationActive || musicBusy}
        aria-hidden={dictationActive}
        tabIndex={dictationActive ? -1 : undefined}
        className={`dictation-trigger-button neu-button-icon relative flex h-full w-full items-center justify-center rounded-full disabled:opacity-45 ${
          dictationActive || musicBusy
            ? "bg-[#c96d6d]/15 text-[#b85353] ring-1 ring-[#c96d6d]/50"
            : "text-[var(--ink)] hover:bg-[var(--paper-strong)]"
        }`}
      >
        {busy ? (
          <BreadboardLoader className="h-[18px] w-[18px]" />
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 10.5v.75a6.25 6.25 0 0 0 12.5 0v-.75M12 17.5V21m-3 0h6" />
          </svg>
        )}
        {dictationActive || musicBusy ? (
          <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-[#c96d6d]" aria-hidden />
        ) : null}
      </button>
      <div
        className="dictation-live-control"
        role="group"
        aria-label={state === "paused" ? "Dictation paused" : "Live dictation controls"}
        aria-hidden={!dictationActive}
      >
        <button
          ref={pauseButtonRef}
          type="button"
          className="dictation-live-action dictation-live-pause"
          onClick={toggleRecordingPause}
          disabled={!dictationActive}
          aria-label={state === "paused" ? "Resume dictation" : "Pause dictation"}
          title={state === "paused" ? "Resume dictation" : "Pause dictation"}
        >
          {state === "paused" ? (
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="m7.2 5.4 6.2 4.1a.6.6 0 0 1 0 1l-6.2 4.1a.6.6 0 0 1-.92-.5V5.9a.6.6 0 0 1 .92-.5Z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M6.5 5.5h2v9h-2zm5 0h2v9h-2z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span
          className="dictation-levels"
          role="img"
          aria-label={state === "paused" ? "Microphone paused" : "Live microphone level"}
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              ref={(node) => {
                levelBarsRef.current[index] = node;
              }}
              className="dictation-level-bar"
              aria-hidden
            />
          ))}
        </span>
        <button
          type="button"
          className="dictation-live-action dictation-live-stop"
          onClick={stopRecording}
          disabled={!dictationActive}
          aria-label="Stop dictation"
          title="Stop dictation"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="m6.25 6.25 7.5 7.5m0-7.5-7.5 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          </svg>
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "paused" ? "Dictation paused" : state === "recording" ? "Dictation listening" : ""}
      </span>
      {menuOpen && !busy ? (
        <div
          role="menu"
          aria-label="Voice options"
          className={`bb-microphone-menu absolute right-0 z-[120] w-[16.5rem] max-w-[85vw] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 shadow-[0_12px_34px_rgba(45,48,40,0.2)] ${popupPosition}`}
        >
          <MicrophoneMenuItem
            title="Dictate live"
            hint="Words appear as you speak."
            onClick={dictateFromMenu}
            disabled={musicBusy}
            icon={
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 10.5v.75a6.25 6.25 0 0 0 12.5 0v-.75M12 17.5V21" />
              </>
            }
          />
          <span className="mx-2 block h-px bg-[var(--line)]" aria-hidden />
          <MusicRecognitionButton
            disabled={disabled || state !== "idle"}
            runtimeSessionId={runtimeSessionId}
            onBusyChange={setMusicBusy}
          />
          <span className="mx-2 block h-px bg-[var(--line)]" aria-hidden />
          <MicrophoneMenuItem
            title="Transcribe a recording"
            hint="An audio or video file, read by the same model."
            onClick={chooseRecording}
            disabled={musicBusy}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"
              />
            }
          />
          {onOpenVoiceMode ? (
            <>
              <span className="mx-2 block h-px bg-[var(--line)]" aria-hidden />
              <MicrophoneMenuItem
                title="Talk to the assistant"
                hint="Full-screen voice mode. Double-tap the microphone for this."
                accent
                onClick={openVoiceModeFromMenu}
                disabled={musicBusy}
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20 12a7 7 0 0 1-7 7H8l-4 2 1-3.5A7 7 0 0 1 11 5h2a7 7 0 0 1 7 7Z"
                  />
                }
              />
            </>
          ) : null}
        </div>
      ) : null}
      {state === "reading-file" ? (
        <div
          role="status"
          className={`neu-popover absolute right-0 z-50 flex w-[17.5rem] max-w-[85vw] items-center gap-2.5 rounded-2xl border p-3.5 text-xs leading-5 text-[var(--ink)] shadow-xl ${popupPosition}`}
        >
          <BreadboardLoader className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{uploadStatus ?? "Transcribing…"}</span>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
            onClick={() => uploadAbortRef.current?.abort()}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {state === "requesting" ? (
        <div
          role="status"
          className={`neu-popover absolute right-0 z-50 flex w-[17.5rem] max-w-[85vw] items-center gap-2.5 rounded-2xl border p-3.5 text-xs leading-5 text-[var(--ink)] shadow-xl ${popupPosition}`}
        >
          <BreadboardLoader className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Preparing speech… Dictation will begin when it is ready.</span>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
            onClick={() => prepareAbortRef.current?.abort()}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error || blocked ? (
        <div
          role="alert"
          className={`neu-popover absolute right-0 z-50 w-[17.5rem] max-w-[85vw] rounded-2xl border p-3.5 text-xs leading-5 text-[var(--ink)] shadow-xl ${popupPosition}`}
        >
          <button
            type="button"
            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[13px] leading-none text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
            onClick={() => {
              setError(null);
              setBlocked(null);
            }}
            aria-label="Dismiss dictation error"
          >
            ×
          </button>
          {blocked ? (
            <MicrophonePermissionHelp
              fix={blocked}
              onRetry={() => void startRecording()}
              retryLabel="Try dictation again"
            />
          ) : (
            <p className="pr-4">{error}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
