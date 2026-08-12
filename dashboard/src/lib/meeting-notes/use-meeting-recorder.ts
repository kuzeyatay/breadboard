"use client";

// Recording the meeting as it happens.
//
// This is the one part of meetily that could not be ported as logic, because
// what it does is not logic: the clone captures the microphone and the system's
// own output through Rust — WASAPI loopback on Windows, ScreenCaptureKit on
// macOS — and mixes them before Whisper ever sees them. A web page cannot reach
// either device that way.
//
// What a browser can do is the same job through two different doors. The
// microphone comes from `getUserMedia`, and the other side of the call — the
// people on Teams, Zoom, Meet — comes from `getDisplayMedia`, which offers the
// audio of a shared tab or screen. Web Audio mixes the two into one track and
// MediaRecorder writes it, so the file that reaches the upload route is a single
// recording of the whole meeting rather than half of one.
//
// Two things about that are worth stating plainly rather than discovering:
// sharing system audio is a choice the browser asks the person to make, and on
// some platforms it is not offered at all. So a capture that ends up
// microphone-only is a normal outcome, not a failure — it is reported, and the
// recording still happens.

import { useCallback, useEffect, useRef, useState } from "react";

import { MEETING_FILENAME_HEADER } from "./identity.ts";

export type RecorderPhase = "idle" | "starting" | "recording" | "uploading" | "error";

export interface MeetingRecording {
  uploadId: string;
  filename: string;
  byteSize: number;
  /** False when the other side of the call was not captured. */
  systemAudio: boolean;
  seconds: number;
}

export interface MeetingRecorderState {
  phase: RecorderPhase;
  /** Seconds recorded so far. */
  seconds: number;
  /** True once system audio is confirmed to be in the mix. */
  systemAudio: boolean;
  error: string;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/** Every track from every stream, stopped — the only way the OS indicator clears. */
function stopStreams(streams: MediaStream[]): void {
  for (const stream of streams) {
    for (const track of stream.getTracks()) track.stop();
  }
}

export function useMeetingRecorder(options: {
  onRecorded: (recording: MeetingRecording) => void;
}): MeetingRecorderState {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [systemAudio, setSystemAudio] = useState(false);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef(0);
  const systemAudioRef = useRef(false);
  const cancelledRef = useRef(false);
  const onRecordedRef = useRef(options.onRecorded);

  useEffect(() => {
    onRecordedRef.current = options.onRecorded;
  }, [options.onRecorded]);

  const teardown = useCallback(() => {
    recorderRef.current = null;
    stopStreams(streamsRef.current);
    streamsRef.current = [];
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  // A page that unmounts mid-recording must not leave the microphone live.
  useEffect(() => () => teardown(), [teardown]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(
      () => setSeconds((Date.now() - startedAtRef.current) / 1_000),
      500,
    );
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = useCallback(async () => {
    if (phase === "recording" || phase === "starting") return;
    setError("");
    setSeconds(0);
    setSystemAudio(false);
    systemAudioRef.current = false;
    cancelledRef.current = false;
    setPhase("starting");

    const streams: MediaStream[] = [];
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot record audio.");
      }
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streams.push(mic);

      // The other half of the meeting. Chrome and Edge only offer the audio
      // checkbox when video is requested too, so video is asked for and then
      // dropped — nothing is recorded from the screen.
      let display: MediaStream | null = null;
      try {
        display = await navigator.mediaDevices.getDisplayMedia?.({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        }) ?? null;
      } catch {
        // Declining the picker is a decision, not an error: the meeting is
        // still recorded from the microphone.
        display = null;
      }
      if (display) {
        streams.push(display);
        for (const track of display.getVideoTracks()) track.stop();
        systemAudioRef.current = display.getAudioTracks().length > 0;
        setSystemAudio(systemAudioRef.current);
      }

      const context = new AudioContext();
      contextRef.current = context;
      const destination = context.createMediaStreamDestination();
      context.createMediaStreamSource(mic).connect(destination);
      if (display && display.getAudioTracks().length) {
        context.createMediaStreamSource(display).connect(destination);
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        destination.stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const captured = chunksRef.current;
        const withSystemAudio = systemAudioRef.current;
        const elapsed = (Date.now() - startedAtRef.current) / 1_000;
        chunksRef.current = [];
        teardown();
        if (cancelledRef.current) {
          setPhase("idle");
          setSeconds(0);
          return;
        }
        const blob = new Blob(captured, { type: mimeType || "audio/webm" });
        if (!blob.size) {
          setPhase("error");
          setError("Nothing was recorded.");
          return;
        }
        setPhase("uploading");
        const filename = `meeting-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        void fetch("/api/meeting-notes/uploads", {
          method: "POST",
          headers: { [MEETING_FILENAME_HEADER]: filename, "content-type": "application/octet-stream" },
          body: blob,
        })
          .then(async (response) => {
            const data = (await response.json().catch(() => ({}))) as {
              uploadId?: string;
              filename?: string;
              byteSize?: number;
              message?: string;
              error?: string;
            };
            if (!response.ok || !data.uploadId) {
              throw new Error(
                data.message ?? data.error ?? "The recording could not be saved.",
              );
            }
            setPhase("idle");
            setSeconds(0);
            onRecordedRef.current({
              uploadId: data.uploadId,
              filename: data.filename ?? filename,
              byteSize: data.byteSize ?? blob.size,
              systemAudio: withSystemAudio,
              seconds: elapsed,
            });
          })
          .catch((cause: unknown) => {
            setPhase("error");
            setError(
              cause instanceof Error ? cause.message : "The recording could not be saved.",
            );
          });
      };

      streamsRef.current = streams;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      // A timeslice keeps the recorder flushing rather than holding a
      // two-hour meeting in one buffer.
      recorder.start(5_000);
      setPhase("recording");
    } catch (cause) {
      stopStreams(streams);
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
      setPhase("error");
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "Breadboard was not allowed to use the microphone."
          : cause instanceof Error
            ? cause.message
            : "The recording could not start.",
      );
    }
  }, [phase, teardown]);

  const stop = useCallback(() => {
    cancelledRef.current = false;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    teardown();
    setPhase("idle");
    setSeconds(0);
  }, [teardown]);

  return { phase, seconds, systemAudio, error, start, stop, cancel };
}
