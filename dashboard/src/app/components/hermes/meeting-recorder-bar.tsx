"use client";

// The record control, shown above the composer while Meeting Notes is selected.
//
// It is deliberately one button with one number next to it. A meeting is
// recorded by somebody who is also in the meeting, so anything that needs
// reading or deciding mid-call is the wrong control — press it at the start,
// press it again at the end, and the run begins on its own.
//
// The one thing it does insist on saying is whether the other side of the call
// was captured. A recording of only your own microphone still produces notes,
// and they will be confidently wrong about who said what, so the difference is
// stated while there is still time to restart rather than discovered afterwards.

import { useMeetingRecorder, type MeetingRecording } from "@/lib/meeting-notes/use-meeting-recorder";

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export default function MeetingRecorderBar({
  onRecorded,
  disabled = false,
}: {
  onRecorded: (recording: MeetingRecording) => void;
  disabled?: boolean;
}) {
  const recorder = useMeetingRecorder({ onRecorded });
  const recording = recorder.phase === "recording";
  const busy = recorder.phase === "starting" || recorder.phase === "uploading";

  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 pt-0.5">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          if (recording) recorder.stop();
          else void recorder.start();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-strong)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
        title={
          recording
            ? "Stop recording and write the notes"
            : "Record this meeting — your microphone, plus the call's audio if you share it"
        }
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            recording ? "animate-pulse bg-[var(--danger)]" : "bg-[var(--botanical)]"
          }`}
        />
        {recording
          ? `Stop · ${formatClock(recorder.seconds)}`
          : recorder.phase === "starting"
            ? "Starting…"
            : recorder.phase === "uploading"
              ? "Saving the recording…"
              : "Record meeting"}
      </button>

      {recording ? (
        <>
          <span className="min-w-0 truncate text-[10px] text-[var(--ink-muted)]">
            {recorder.systemAudio
              ? "Microphone and call audio"
              : "Microphone only — the other side of the call is not being recorded"}
          </span>
          <button
            type="button"
            onClick={() => recorder.cancel()}
            className="shrink-0 text-[10px] text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
          >
            Discard
          </button>
        </>
      ) : null}

      {recorder.error ? (
        <span className="min-w-0 truncate text-[10px] text-[var(--danger)]">{recorder.error}</span>
      ) : null}
    </div>
  );
}
