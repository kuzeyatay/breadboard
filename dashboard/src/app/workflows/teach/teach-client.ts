"use client";

import { requestForegroundMicrophone, stopForegroundStream } from '@/lib/speech/clap/audio-focus';

// The browser half of a teaching session.
//
// Two things happen here that cannot happen on the server: the microphone, which
// must be requested from the person sitting in front of the machine, and the
// clock the narration is timestamped against.
//
// The clock is simple because Breadboard is local: the dashboard and the capture
// backend are the same machine, so `Date.now()` in this tab and the epoch the
// recorder reported are the same clock. The offset the narration is stored with
// is therefore a real measurement, not an estimate across a network.

import type { DemonstratedProcedure, TeachSessionSummary } from "@/lib/teach/types";

export const NARRATION_OFFSET_HEADER = "x-narration-offset-ms";

/** How the floating controller and the tab holding the microphone talk. */
export const TEACH_CHANNEL = "breadboard-teach-session";

export type TeachControlAction = "pause" | "resume" | "finish" | "cancel";

export interface TeachChannelMessage {
  sessionId: string;
  /** A control asking the tab that owns the microphone to do something. */
  request?: TeachControlAction;
  /** The owning tab saying it is alive and what state it is in. */
  state?: TeachSessionSummary["state"];
  elapsedMs?: number;
  level?: number;
}

export interface TeachAvailabilityView {
  available: boolean;
  reason?: string;
  platform: string;
  capture: { available: boolean; reason?: string };
  computer: { available: boolean; reason?: string };
  speech: { ready: boolean; installable: boolean; model: string; reason?: string };
}

export interface TeachSessionView {
  session: TeachSessionSummary;
  draft: DemonstratedProcedure | null;
  processing: { stage: string; detail?: string } | null;
  diff: {
    summary: string;
    addedSteps: string[];
    removedSteps: string[];
    changedSteps: string[];
    addedInputs: string[];
    removedInputs: string[];
    addedConstraints: string[];
  } | null;
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallbackMessage);
  return payload;
}

export async function loadTeachAvailability(signal?: AbortSignal): Promise<TeachAvailabilityView> {
  const response = await fetch("/api/workflows/teach", { cache: "no-store", signal });
  return readJson<TeachAvailabilityView>(response, "Teaching could not be checked on this machine.");
}

export async function startTeachSession(input: {
  name?: string;
  objective?: string;
  reteachWorkflowId?: string | null;
}): Promise<{ session: TeachSessionSummary; startedAtEpochMs: number }> {
  const response = await fetch("/api/workflows/teach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response, "The teaching session could not be started.");
}

export async function loadTeachSession(sessionId: string, signal?: AbortSignal): Promise<TeachSessionView> {
  const response = await fetch(`/api/workflows/teach/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
    signal,
  });
  return readJson<TeachSessionView>(response, "That teaching session could not be read.");
}

export async function controlTeachSession(
  sessionId: string,
  action: TeachControlAction,
): Promise<TeachSessionSummary> {
  const response = await fetch(`/api/workflows/teach/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const payload = await readJson<{ session: TeachSessionSummary }>(
    response,
    "That teaching session could not be changed.",
  );
  return payload.session;
}

export async function saveTeachSession(input: {
  sessionId: string;
  procedure: DemonstratedProcedure;
  answers: Record<string, string>;
  retainRecording: boolean;
}): Promise<{ workflowId: string; version: number }> {
  const response = await fetch(`/api/workflows/teach/${encodeURIComponent(input.sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "save",
      procedure: input.procedure,
      answers: input.answers,
      retainRecording: input.retainRecording,
    }),
  });
  return readJson(response, "The workflow could not be saved.");
}

/* ------------------------------------------------------------------ *
 * Microphone
 * ------------------------------------------------------------------ */

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

/**
 * The microphones the user can pick from.
 *
 * Labels are only populated once permission has been granted, which is why this
 * is called after the stream is opened rather than before: a picker full of
 * "Microphone 1", "Microphone 2" is worse than no picker.
 */
export async function listMicrophones(): Promise<MicrophoneDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}

export interface NarrationRecorder {
  stop(): Promise<Blob>;
  /** 0..1, for the level meter. */
  level(): number;
  /** When recording began, on the same clock as the session's epoch. */
  startedAtEpochMs: number;
  pause(): void;
  resume(): void;
  discard(): void;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Start recording narration.
 *
 * Chunks are collected as they arrive rather than at the end, so a long
 * demonstration is a list of small buffers instead of one growing one, and
 * `stop` hands back a blob the caller streams straight to the server.
 */
export async function startNarrationRecorder(deviceId?: string): Promise<NarrationRecorder> {
  const stream = await requestForegroundMicrophone({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);

  recorder.start(2_000);
  const startedAtEpochMs = Date.now();

  const release = (): void => {
    stopForegroundStream(stream);
    void context.close().catch(() => undefined);
  };

  return {
    startedAtEpochMs,
    level(): number {
      if (context.state === "closed") return 0;
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      return Math.min(1, peak / 96);
    },
    pause(): void {
      if (recorder.state === "recording") recorder.pause();
    },
    resume(): void {
      if (recorder.state === "paused") recorder.resume();
    },
    async stop(): Promise<Blob> {
      if (recorder.state === "inactive") {
        release();
        return new Blob(chunks, { type: mimeType ?? "audio/webm" });
      }
      const finished = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      await finished;
      release();
      return new Blob(chunks, { type: mimeType ?? "audio/webm" });
    },
    discard(): void {
      if (recorder.state !== "inactive") recorder.stop();
      chunks.length = 0;
      release();
    },
  };
}

/**
 * Send the narration up.
 *
 * Called before `finish`, because finishing is what starts the analysis and the
 * analysis is what reads this file.
 */
export async function uploadNarration(
  sessionId: string,
  audio: Blob,
  audioStartOffsetMs: number,
): Promise<void> {
  if (audio.size === 0) return;
  const response = await fetch(`/api/workflows/teach/${encodeURIComponent(sessionId)}/narration`, {
    method: "POST",
    headers: {
      "content-type": audio.type || "audio/webm",
      [NARRATION_OFFSET_HEADER]: String(Math.round(audioStartOffsetMs)),
    },
    body: audio,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "The narration could not be saved.");
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The Electron shell, when the page is running inside it. */
export function desktopShell():
  | { openTeachController(sessionId: string): Promise<boolean>; closeTeachController(): Promise<boolean> }
  | null {
  if (typeof window === "undefined") return null;
  const shell = (window as unknown as { breadboardDesktop?: Record<string, unknown> }).breadboardDesktop;
  if (!shell || typeof shell.openTeachController !== "function") return null;
  return shell as unknown as {
    openTeachController(sessionId: string): Promise<boolean>;
    closeTeachController(): Promise<boolean>;
  };
}
