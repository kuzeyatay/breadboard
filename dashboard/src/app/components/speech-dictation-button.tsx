"use client";

import { useEffect, useRef, useState } from "react";
import BreadboardLoader from "@/app/components/breadboard-loader";
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
import { VOICE_DOUBLE_TAP_MS } from "@/lib/speech/voice-conversation";

type DictationState = "idle" | "requesting" | "recording" | "transcribing" | "reading-file";

interface SpeechDictationButtonProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Full-screen voice mode: the third entry in the microphone's menu, and what
   * a double-tap goes straight to. Passed only by hosts that can hold a spoken
   * conversation; without it the menu offers dictation and file transcription
   * alone, and there is no double-tap window to wait out.
   */
  onOpenVoiceMode?: () => void;
}

type PcmCapture = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  sampleRate: number;
  totalSamples: number;
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
    const response = await fetch("/api/speech/transcribe", {
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
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition ${
        accent ? "hover:bg-[var(--selection-yellow)]" : "hover:bg-[var(--paper-strong)]"
      }`}
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
  textareaRef,
  onOpenVoiceMode,
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
  const partialPromiseRef = useRef<Promise<void> | null>(null);
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);
  const tapTimerRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  function releaseMicrophone() {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (partialTimerRef.current !== null) window.clearInterval(partialTimerRef.current);
    partialTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;

    const capture = pcmCaptureRef.current;
    pcmCaptureRef.current = null;
    if (capture) {
      capture.processor.onaudioprocess = null;
      capture.source.disconnect();
      capture.processor.disconnect();
      capture.sink.disconnect();
      void capture.context.close();
    }
  }

  function stopPartialRecognition(): Promise<void> | null {
    if (partialTimerRef.current !== null) window.clearInterval(partialTimerRef.current);
    partialTimerRef.current = null;
    const pending = partialPromiseRef.current;
    partialAbortRef.current?.abort();
    partialAbortRef.current = null;
    return pending;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      stopPartialRecognition();
      finalAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMicrophone();
    };
  }, []);

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
      };
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        capture.chunks.push(copy);
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
      if (!transcript) throw new Error("Voicebox did not hear any words.");
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
        setError(caught instanceof Error ? caught.message : "Dictation failed.");
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

      const mimeType = bestRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
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
      recorder.start();
      setState("recording");
      partialTimerRef.current = window.setInterval(
        () => recognizePartial(session),
        PARTIAL_TRANSCRIPT_INTERVAL_MS,
      );
      timeoutRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 5 * 60_000);
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
      const response = await fetch("/api/speech/transcribe-upload", {
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
      if (!transcript) throw new Error("Voicebox did not hear any words in that recording.");
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
        setError(caught instanceof Error ? caught.message : "That recording could not be transcribed.");
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
    if (state === "recording") {
      recorderRef.current?.stop();
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
  const label =
    state === "recording"
      ? "Stop dictation — words appear as you speak"
      : state === "transcribing"
        ? "Finishing dictation"
        : state === "reading-file"
          ? "Transcribing a recording"
          : state === "requesting"
            ? "Opening microphone"
            : onOpenVoiceMode
              ? "Voice options — double-tap to talk to the assistant"
              : "Voice options";

  return (
    <div ref={shellRef} className="relative shrink-0 self-end">
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
        aria-pressed={state === "recording"}
        className={`neu-button-icon relative flex items-center justify-center rounded-full transition disabled:opacity-45 ${
          compact ? "h-9 w-9" : "h-11 w-11"
        } ${
          state === "recording"
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
        {state === "recording" ? (
          <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-[#c96d6d]" aria-hidden />
        ) : null}
      </button>
      {menuOpen && !busy ? (
        <div
          role="menu"
          aria-label="Voice options"
          className="bb-microphone-menu absolute bottom-full right-0 z-[120] mb-2 w-[16.5rem] max-w-[85vw] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 shadow-[0_12px_34px_rgba(45,48,40,0.2)]"
        >
          <MicrophoneMenuItem
            title="Dictate live"
            hint="Words appear as you speak."
            onClick={dictateFromMenu}
            icon={
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 10.5v.75a6.25 6.25 0 0 0 12.5 0v-.75M12 17.5V21" />
              </>
            }
          />
          <span className="mx-2 block h-px bg-[var(--line)]" aria-hidden />
          <MicrophoneMenuItem
            title="Transcribe a recording"
            hint="An audio or video file, read by the same model."
            onClick={chooseRecording}
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
          className="neu-popover absolute bottom-full right-0 z-50 mb-2 flex w-[17.5rem] max-w-[85vw] items-center gap-2.5 rounded-2xl border p-3.5 text-xs leading-5 text-[var(--ink)] shadow-xl"
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
      {error || blocked ? (
        <div
          role="alert"
          className="neu-popover absolute bottom-full right-0 z-50 mb-2 w-[17.5rem] max-w-[85vw] rounded-2xl border p-3.5 text-xs leading-5 text-[var(--ink)] shadow-xl"
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
