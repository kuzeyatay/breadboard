"use client";

// The video studio.
//
// Global on purpose: it opens for *any* video artifact, whoever made it. A
// short cut by the Shorts agent, a film rendered by ViMax, a clip someone
// attached to a chat last month — all of them are a video with a file, and that
// is the whole requirement. What the studio adds is the thing a video artifact
// otherwise lacks: a way to say what should be different about it, and get the
// same artifact back, changed.
//
// The unit of work is a *prompt against a version*, not a filter on a preview.
// Each pass replays the whole edit program against the retained original, so
// asking for six things one at a time costs one generation of encoding rather
// than six, and every step back is a version that still exists.
//
// This deliberately does not create videos. Generating one is a different job
// with different agents behind it (ViMax, MoneyPrinter, HyperFrames); here the
// video already exists and the only question is what changes about it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { artifactUrl } from "./artifact-viewer";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface StudioVersion {
  version: number;
  createdAt: string;
  byteSize: number | null;
  prompt: string | null;
  summary: string | null;
  current: boolean;
}

interface StudioProgram {
  ranges: Array<{ start: number; end: number; reason: string }>;
  grade: string | null;
  aspect: string;
  subtitles: "none" | "burn";
  transform: {
    speed: number;
    mute: boolean;
    volumeDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    reverse: boolean;
  };
  history: Array<{ version: number; prompt: string; summary: string; at: string }>;
}

interface StudioState {
  artifactId: string;
  title: string;
  version: number;
  versions: StudioVersion[];
  program: StudioProgram | null;
  history: StudioProgram["history"];
  sourceDurationSeconds: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sourceRetained: boolean;
  transcriptAvailable: boolean;
  editable: boolean;
  reason: string | null;
  speechAware: boolean;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "source.ready",
  "source.probed",
  "stage.updated",
  "plan.ready",
  "render.progress",
  "artifact.stored",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:ring-1 focus:ring-[var(--botanical)]";
const buttonClass =
  "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "neu-button neu-button-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/** Openers people reach for, shown until they have made their own edit. */
const SUGGESTIONS = [
  "Cut the dead air and tighten the pacing",
  "Trim it to the strongest 60 seconds",
  "Make it vertical for Reels",
  "Clean up the colour and normalise the audio",
] as const;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timecode(seconds: number | null): string {
  if (!seconds && seconds !== 0) return "—";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** One line describing what the current program actually does. */
function describeProgram(program: StudioProgram | null): string[] {
  if (!program) return [];
  const parts: string[] = [
    `${program.ranges.length} cut${program.ranges.length === 1 ? "" : "s"}`,
  ];
  if (program.aspect !== "original") parts.push(program.aspect);
  if (program.grade) parts.push(program.grade === "auto" ? "auto grade" : "graded");
  if (program.subtitles === "burn") parts.push("captions burned in");
  if (program.transform.speed !== 1) parts.push(`${program.transform.speed}× speed`);
  if (program.transform.reverse) parts.push("reversed");
  if (program.transform.mute) parts.push("muted");
  else if (program.transform.volumeDb !== 0) parts.push(`${program.transform.volumeDb} dB`);
  if (program.transform.fadeInSeconds) parts.push(`${program.transform.fadeInSeconds}s fade in`);
  if (program.transform.fadeOutSeconds) parts.push(`${program.transform.fadeOutSeconds}s fade out`);
  return parts;
}

export default function ArtifactVideoStudio({
  artifact,
  onClose,
  onUpdated,
}: {
  artifact: PresentedArtifact;
  onClose: () => void;
  /** The artifact changed — the surrounding surface should refresh its copy. */
  onUpdated?: (artifactId: string) => void;
}) {
  const [state, setState] = useState<StudioState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<"final" | "preview">("final");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStage, setRunStage] = useState("");
  const [runDetail, setRunDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);
  // A finished edit bumps the artifact version, and the player has to be told
  // to fetch the new file rather than reuse the one it already decoded.
  const [playbackVersion, setPlaybackVersion] = useState(artifact.version);

  const conversationId = artifact.conversationId;
  const previewUrl = useMemo(
    () => `${artifactUrl({ ...artifact, version: playbackVersion }, "preview")}`,
    [artifact, playbackVersion],
  );
  const downloadUrl = useMemo(
    () => artifactUrl({ ...artifact, version: playbackVersion }, "download"),
    [artifact, playbackVersion],
  );

  const loadState = useCallback(async () => {
    if (!conversationId) return;
    try {
      const response = await fetch(
        `/api/video-use/artifacts/${encodeURIComponent(artifact.id)}?conversationId=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        state?: StudioState;
        error?: string;
      };
      if (!response.ok || !body.state) {
        setError(body.error ?? "This video could not be opened for editing.");
        return;
      }
      setState(body.state);
      setPlaybackVersion(body.state.version);
    } catch {
      setError("This video could not be opened for editing.");
    }
  }, [artifact.id, conversationId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Follow the edit that is running. Opened only while one is, and closed on
  // the first error — EventSource otherwise reconnects forever.
  useEffect(() => {
    if (!runId) return;
    const stream = new EventSource(`/api/video-use/runs/${runId}/events`);
    const handler = (event: MessageEvent) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(event.data) as RunEvent;
      } catch {
        return;
      }
      const payload = parsed.payload;
      switch (parsed.type) {
        case "run.started":
          setRunStage("Reading the video");
          break;
        case "stage.updated":
          setRunStage(asString(payload.label) || asString(payload.stage));
          break;
        case "plan.ready":
          setRunStage("Rendering");
          setRunDetail(asString(payload.summary));
          break;
        case "render.progress":
          setRunStage(asString(payload.stage) || "Rendering");
          setRunDetail(asString(payload.detail));
          break;
        case "run.completed":
          setRunStage("");
          setRunDetail("");
          setBusy(false);
          setRunId(null);
          setPrompt("");
          setPlaybackVersion(asNumber(payload.version) || playbackVersion);
          void loadState();
          onUpdated?.(artifact.id);
          break;
        case "run.failed":
        case "run.aborted":
          setRunStage("");
          setRunDetail("");
          setBusy(false);
          setRunId(null);
          setError(
            asString(payload.error) || asString(payload.summary) || "The edit did not finish.",
          );
          break;
        default:
          break;
      }
    };
    for (const type of STREAMED_EVENT_TYPES) stream.addEventListener(type, handler);
    stream.onerror = () => stream.close();
    return () => {
      for (const type of STREAMED_EVENT_TYPES) stream.removeEventListener(type, handler);
      stream.close();
    };
  }, [artifact.id, loadState, onUpdated, playbackVersion, runId]);

  async function applyEdit() {
    const instruction = prompt.trim();
    if (!instruction) {
      setError("Describe the change you want.");
      return;
    }
    if (!conversationId) {
      setError("This video is not attached to a chat, so it cannot be edited.");
      return;
    }
    setBusy(true);
    setError(null);
    setRunStage("Starting");
    try {
      const response = await fetch("/api/video-use/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          conversationPublicId: conversationId,
          request: { artifactId: artifact.id, prompt: instruction, quality },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        run?: { runId: string };
        error?: string;
      };
      if (!response.ok || !body.run) {
        throw new Error(body.error ?? "The edit could not be started.");
      }
      setRunId(body.run.runId);
    } catch (cause) {
      setBusy(false);
      setRunStage("");
      setError(cause instanceof Error ? cause.message : "The edit could not be started.");
    }
  }

  async function revertTo(version: number) {
    if (!conversationId) return;
    setReverting(version);
    setError(null);
    try {
      const response = await fetch(
        `/api/video-use/artifacts/${encodeURIComponent(artifact.id)}/revert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, version }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        state?: StudioState;
        error?: string;
      };
      if (!response.ok || !body.state) {
        throw new Error(body.error ?? "That version could not be restored.");
      }
      setState(body.state);
      setPlaybackVersion(body.state.version);
      onUpdated?.(artifact.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That version could not be restored.");
    } finally {
      setReverting(null);
    }
  }

  async function stopEdit() {
    if (!runId) return;
    await fetch(`/api/video-use/runs/${runId}/abort`, { method: "POST" }).catch(() => {});
  }

  const programParts = describeProgram(state?.program ?? null);
  const canEdit = Boolean(state?.editable && conversationId);

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Video studio — ${artifact.title}`}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="bb-modal-panel neu-dialog flex h-[92vh] max-h-[92vh] w-full max-w-[min(88rem,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--ink-heading)]">
              {artifact.title}
            </h2>
            <p className="truncate text-xs text-[var(--ink-muted)]">
              Video studio · version {playbackVersion}
              {state?.durationSeconds ? ` · ${timecode(state.durationSeconds)}` : ""}
              {state?.width && state?.height ? ` · ${state.width}×${state.height}` : ""}
            </p>
          </div>
          <a href={downloadUrl} className={buttonClass}>
            Download
          </a>
          <button
            type="button"
            className="neu-button-icon rounded-lg px-2 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
            aria-label="Close the video studio"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-[18rem] flex-1 items-center justify-center overflow-auto bg-[var(--neu-surface-pressed)] p-5 sm:p-7">
            <ReclaimingVideo
              // Keying on the version forces a fresh element after an edit, so
              // the browser fetches the new file instead of replaying the old
              // one it has already buffered.
              key={playbackVersion}
              controls
              preload="metadata"
              src={previewUrl}
              className="max-h-[74vh] w-full rounded-xl border border-[var(--line)] bg-black shadow-lg"
            >
              Your browser cannot play this video.
            </ReclaimingVideo>
          </div>

          <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-[var(--line)] bg-[var(--paper-surface)] p-4 md:w-[26rem] md:border-l md:border-t-0">
            <label className="block text-xs font-medium text-[var(--ink-heading)]">
              What should change?
              <textarea
                className={`${fieldClass} mt-1.5 min-h-28 resize-y`}
                value={prompt}
                maxLength={4000}
                disabled={busy || !canEdit}
                placeholder="Cut the pause before the demo, tighten the ending, and make it vertical…"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    if (!busy && canEdit) void applyEdit();
                  }
                }}
              />
            </label>

            {!prompt && !busy ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)]"
                    onClick={() => setPrompt(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <div className="flex flex-1 rounded-lg bg-[var(--paper-strong)] p-1" role="group" aria-label="Render quality">
                {(["final", "preview"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={quality === value}
                    disabled={busy}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                      quality === value
                        ? "bg-[var(--paper-raised)] text-[var(--ink-heading)] shadow-sm"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
                    }`}
                    onClick={() => setQuality(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {busy ? (
                <button type="button" className={buttonClass} onClick={() => void stopEdit()}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={!prompt.trim() || !canEdit}
                  onClick={() => void applyEdit()}
                >
                  Apply edit
                </button>
              )}
            </div>

            {busy ? (
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-3">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--ink-heading)]">
                  <span className="bb-agent-run-led h-1.5 w-1.5 animate-pulse bg-[var(--botanical-2)]" />
                  {runStage || "Working"}
                </p>
                {runDetail ? (
                  <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{runDetail}</p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--paper-strong)] p-2.5 text-xs text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}

            {state && !state.editable ? (
              <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                {state.reason ?? "Editing is not available on this machine."}
              </p>
            ) : null}

            {state && state.editable && !state.speechAware ? (
              <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                Edits are planned from the silence map. Start Scriberr in Video Use&rsquo;s settings
                to cut on what was said and to burn in captions.
              </p>
            ) : null}

            {programParts.length ? (
              <section className="mt-5">
                <p className="bb-agent-run-label">This edit</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink)]">
                  {programParts.join(" · ")}
                </p>
                {state?.sourceDurationSeconds ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    From {timecode(state.sourceDurationSeconds)} of source
                    {state.sourceRetained ? ", kept untouched" : ""}.
                  </p>
                ) : null}
              </section>
            ) : null}

            {state?.versions.length ? (
              <section className="mt-5 min-h-0">
                <p className="bb-agent-run-label">History</p>
                <ol className="mt-1.5 space-y-1.5">
                  {[...state.versions]
                    .sort((left, right) => right.version - left.version)
                    .map((version) => (
                      <li
                        key={version.version}
                        className={`rounded-lg border p-2.5 ${
                          version.current
                            ? "border-[var(--botanical)] bg-[var(--paper-raised)]"
                            : "border-[var(--line)] bg-[var(--paper-strong)]"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[var(--ink-heading)]">
                            Version {version.version}
                            {version.current ? " · showing" : ""}
                          </span>
                          {!version.current ? (
                            <button
                              type="button"
                              className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink-heading)] hover:underline disabled:opacity-50"
                              disabled={busy || reverting !== null}
                              onClick={() => void revertTo(version.version)}
                            >
                              {reverting === version.version ? "Restoring…" : "Restore"}
                            </button>
                          ) : null}
                        </div>
                        {version.prompt ? (
                          <p className="mt-1 text-[11px] leading-4 text-[var(--ink)]">
                            &ldquo;{version.prompt}&rdquo;
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                            {version.version === 1 ? "The original." : "No note kept."}
                          </p>
                        )}
                        {version.summary ? (
                          <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                            {version.summary}
                          </p>
                        ) : null}
                      </li>
                    ))}
                </ol>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
