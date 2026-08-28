"use client";

import { externalRunStartedAtMs } from "./external-run-clock";

// In-chat run card for a Socials Manager run — the whole agent surface.
//
// There is no standalone page on purpose: the composer only creates this
// run when the user types /agents:socials-manager, so the scheduling UI exists for that
// turn and nowhere else. Like the other inline cards, the host creates the run
// before this mounts and this component only observes
// /api/socials-manager/runs/<id>/events, then edits the posts it produced.
//
// Styling uses the shared neumorphic material (bb-agent-run-* and neu-*) rather
// than anything Postiz-branded, so the card is indistinguishable from the rest
// of the chat.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import {
  useInlineArtifactScope,
  useInlineArtifactViewer,
  useRegisterInlineArtifact,
} from "./inline-artifact-cards";
import SocialsManagerPostStudio, {
  formatPostSlot,
  type SocialsManagerStudioPatch,
} from "./socials-manager-post-studio";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { SocialsManagerProvider } from "@/lib/socials-manager/providers";
import type { PresentedSocialsManagerPost } from "@/lib/socials-manager/types";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface RunPost {
  id: number;
  providerId: string;
  providerName: string;
  content: string;
  status: string;
  scheduledAt: string | null;
  calendarEventId: number | null;
  artifactId: string | null;
  /** The artwork attached to this post, and where to preview it. */
  imageArtifactId: string | null;
  imagePreviewUrl: string | null;
  /** Set once the real Postiz stack owns this post. */
  remoteId: string | null;
  characterCount: number;
  characterLimit: number | null;
}

/** Plain-language stack states. Anything else is treated as "still starting". */
const STACK_TEXT: Record<string, string> = {
  running: "Postiz is connected",
  starting: "Postiz is starting — drafting locally meanwhile",
  stopped: "Postiz is not running — drafting locally",
  docker_unavailable: "Waiting on Docker — drafting locally",
  not_installed: "Docker is not installed — drafting locally",
  unauthenticated: "Postiz is up but not connected — drafting locally",
  adapter: "Local drafting mode",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

const ERROR_TEXT: Record<string, string> = {
  run_not_found: "This run is no longer available — the dashboard restarted or the run expired.",
  model_not_configured: "No model is configured for drafting.",
  drafting_failed: "The model could not draft these posts.",
  persist_failed: "The draft could not be saved.",
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/**
 * A slot is named the same way here and in the studio — the card and the editor
 * are two views of the same post, so the formatter is shared rather than copied.
 */
const formatSlot = formatPostSlot;

/** A convenient suggestion for the picker; it is not persisted until the user
 * confirms "Add to calendar". */
function suggestedCalendarSlot(now = new Date()): string {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(0);
  next.setHours(next.getHours() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}` +
    `T${pad(next.getHours())}:${pad(next.getMinutes())}`
  );
}

function summarize(posts: RunPost[]): string {
  if (!posts.length) return "No posts were drafted.";
  return posts
    .map(
      (post) =>
        `## ${post.providerName}${post.scheduledAt ? ` — ${formatSlot(post.scheduledAt)}` : ""}\n\n${post.content}`,
    )
    .join("\n\n");
}

function presentStoredPost(
  post: PresentedSocialsManagerPost,
  providers: readonly SocialsManagerProvider[],
): RunPost {
  const provider = providers.find((candidate) => candidate.id === post.providerId);
  return {
    id: post.id,
    providerId: post.providerId,
    providerName: provider?.name ?? post.providerName ?? post.providerId,
    content: post.content,
    status: post.status,
    scheduledAt: post.scheduledAt,
    calendarEventId: post.calendarEventId,
    artifactId: post.artifactId,
    imageArtifactId: post.imageArtifactId ?? null,
    imagePreviewUrl: post.imagePreviewUrl ?? null,
    remoteId: post.remoteId,
    characterCount: post.content.length,
    characterLimit: provider?.maxCharacters ?? null,
  };
}

export default function InlineSocialsManagerRun({
  runId,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  /** Passed by the host for parity with the other run cards. The card does not
   *  render it — it is the user's own message directly above this one. */
  brief?: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const openArtifact = useInlineArtifactViewer();
  const artifactScope = useInlineArtifactScope();
  const registerArtifact = useRegisterInlineArtifact();
  const [status, setStatus] = useState<string>(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "running",
  );
  const [posts, setPosts] = useState<RunPost[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent || null
      : null,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<{ state: string; reason: string | null } | null>(
    null,
  );
  /** The post whose studio is open. Editing copy and artwork happens there. */
  const [studioId, setStudioId] = useState<number | null>(null);
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [draftScheduleAt, setDraftScheduleAt] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [imagingId, setImagingId] = useState<number | null>(null);
  const [hydratedRunId, setHydratedRunId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const postsRef = useRef(posts);
  const failureRef = useRef(failure);
  const usageRef = useRef(usage);
  const onTerminalRef = useRef(onTerminal);
  const reportedTerminalRef = useRef(false);

  const base = `/api/socials-manager/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedTerminalRef.current = false;
  }, [runId]);

  const upsertPost = useCallback((post: RunPost) => {
    setPosts((current) => {
      const next = current.some((candidate) => candidate.id === post.id)
        ? current.map((candidate) => (candidate.id === post.id ? post : candidate))
        : [...current, post];
      postsRef.current = next;
      return next;
    });
  }, []);

  const patchPost = useCallback((id: number, patch: Partial<RunPost>) => {
    setPosts((current) => {
      const next = current.map((candidate) =>
        candidate.id === id ? { ...candidate, ...patch } : candidate,
      );
      postsRef.current = next;
      return next;
    });
  }, []);

  // Run events are intentionally short-lived, but the posts are not. Hydrate
  // every mount from SQLite so refreshes, history switches, and app restarts
  // reconstruct the complete interactive card inside the transcript.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    postsRef.current = [];
    setPosts([]);
    setHydratedRunId(null);
    setStudioId(null);
    setSchedulingId(null);
    setDraftScheduleAt("");

    void fetch(`/api/socials-manager/posts?runId=${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not restore the saved drafts.");
        return response.json() as Promise<{
          posts?: PresentedSocialsManagerPost[];
          networks?: SocialsManagerProvider[];
        }>;
      })
      .then((data: { posts?: PresentedSocialsManagerPost[]; networks?: SocialsManagerProvider[] }) => {
        if (cancelled) return;
        const providers = Array.isArray(data.networks) ? data.networks : [];
        const restored = (Array.isArray(data.posts) ? data.posts : []).map((post) =>
          presentStoredPost(post, providers),
        );
        setPosts((current) => {
          const merged = new Map(current.map((post) => [post.id, post]));
          for (const post of restored) merged.set(post.id, post);
          const next = [...merged.values()].sort((left, right) => left.id - right.id);
          postsRef.current = next;
          return next;
        });
      })
      .catch((cause: unknown) => {
        if (
          !cancelled &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not restore the saved drafts.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHydratedRunId(runId);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;

      if (event.type === "run.started") {
        const networks = Array.isArray(payload.networks) ? payload.networks : [];
        setNote(
          networks.length
            ? `Writing for ${networks
                .map((network) =>
                  network && typeof network === "object" && "name" in network
                    ? String((network as { name: unknown }).name)
                    : "",
                )
                .filter(Boolean)
                .join(", ")}…`
            : "Writing…",
        );
      }
      // Drafting and any artwork each report what they spent as they land, so
      // the count climbs during the run rather than appearing only at the end.
      if (event.type === "run.usage") {
        const next = normalizeChatTokenUsage(payload);
        if (next) {
          usageRef.current = next;
          setUsage(next);
        }
      }
      if (event.type === "stack.status") {
        setStack({
          state: typeof payload.state === "string" ? payload.state : "unknown",
          reason: typeof payload.reason === "string" ? payload.reason : null,
        });
      }
      if (event.type === "post.published_to_stack" && typeof payload.postId === "number") {
        patchPost(payload.postId, {
          remoteId: typeof payload.remoteId === "string" ? payload.remoteId : null,
        });
      }
      if (event.type === "post.drafted" && payload.post) {
        upsertPost(payload.post as unknown as RunPost);
      }
      if (event.type === "post.scheduled" && typeof payload.postId === "number") {
        patchPost(payload.postId, {
          status: "scheduled",
          scheduledAt:
            typeof payload.scheduledAt === "string" ? payload.scheduledAt : null,
          calendarEventId:
            typeof payload.calendarEventId === "number" ? payload.calendarEventId : null,
        });
      }
      if (event.type === "post.artifact_ready" && typeof payload.postId === "number") {
        patchPost(payload.postId, {
          artifactId: typeof payload.artifactId === "string" ? payload.artifactId : null,
        });
      }
      if (event.type === "post.image_started" && typeof payload.postId === "number") {
        setImagingId(payload.postId);
      }
      if (event.type === "post.image_ready" && typeof payload.postId === "number") {
        setImagingId((current) => (current === payload.postId ? null : current));
        patchPost(payload.postId, {
          imageArtifactId:
            typeof payload.imageArtifactId === "string" ? payload.imageArtifactId : null,
          imagePreviewUrl:
            typeof payload.imagePreviewUrl === "string" ? payload.imagePreviewUrl : null,
        });
      }
      if (event.type === "post.image_failed" && typeof payload.postId === "number") {
        setImagingId((current) => (current === payload.postId ? null : current));
        setError("An image could not be drawn for one post. Open Edit to try again.");
      }
      if (event.type === "run.completed") {
        if (Array.isArray(payload.posts)) {
          const finished = payload.posts as unknown as RunPost[];
          postsRef.current = finished;
          setPosts(finished);
        }
        const total = normalizeChatTokenUsage(payload.usage);
        if (total) {
          usageRef.current = total;
          setUsage(total);
        }
      }
      if (event.type === "run.failed") {
        const code = typeof payload.error === "string" ? payload.error : null;
        const message =
          (code && ERROR_TEXT[code]) ?? code ?? "The run failed.";
        failureRef.current = message;
        setFailure(message);
      }

      const outcome = event.type.replace("run.", "");
      if (event.type.startsWith("run.") && TERMINAL_STATUSES.has(outcome)) {
        setStatus(outcome);
        setNote(null);
        if (!reportedTerminalRef.current) {
          reportedTerminalRef.current = true;
          onTerminalRef.current?.({
            outcome: outcome as ExternalAgentTerminalResult["outcome"],
            content:
              outcome === "completed"
                ? summarize(postsRef.current)
                : (failureRef.current ??
                  (outcome === "aborted" ? "Drafting was stopped." : "Drafting failed.")),
            // Tokens spent before a stop or a failure were still spent, so the
            // saved turn carries them whatever the outcome.
            ...(usageRef.current ? { usage: usageRef.current } : {}),
          });
        }
      }
    },
    [patchPost, upsertPost],
  );

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running") {
      // A restored transcript shows its saved copy; the run is long gone.
      return;
    }
    const source = new EventSource(`${base}/events`);
    eventSourceRef.current = source;
    const handle = (event: MessageEvent) => {
      try {
        applyEvent(JSON.parse(event.data) as RunEvent);
      } catch {
        // A malformed frame must not tear the stream down.
      }
    };
    for (const type of [
      "run.started",
      "stack.status",
      "stack.synced",
      "post.published_to_stack",
      "post.stack_skipped",
      "post.drafted",
      "post.scheduled",
      "post.schedule_failed",
      "post.artifact_ready",
      "post.image_started",
      "post.image_ready",
      "post.image_failed",
      "post.failed",
      "drafting.started",
      "drafting.completed",
      "run.usage",
      "run.completed",
      "run.failed",
      "run.aborted",
    ]) {
      source.addEventListener(type, handle as EventListener);
    }
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [base, applyEvent, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;
    const started = externalRunStartedAtMs(runId);
    setElapsedSeconds(Math.max(0, Math.round((Date.now() - started) / 1_000)));
    const timer = setInterval(
      () => setElapsedSeconds(Math.round((Date.now() - started) / 1000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [runId, status]);

  const stop = async () => {
    try {
      const response = await fetch(`${base}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(String(response.status));
      setNote("Stopping…");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  /**
   * The one write path for a post: copy, artwork, and calendar slot all go
   * through it, so whatever comes back from the server is what the card shows.
   */
  const savePost = async (
    post: RunPost,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusyId(post.id);
    setError(null);
    try {
      const response = await fetch(`/api/socials-manager/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await response.json()) as {
        ok: boolean;
        post?: RunPost;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.post) {
        throw new Error(data.error ?? "Could not save the post.");
      }
      patchPost(post.id, {
        content: data.post.content,
        status: data.post.status,
        scheduledAt: data.post.scheduledAt,
        calendarEventId: data.post.calendarEventId,
        imageArtifactId: data.post.imageArtifactId ?? null,
        imagePreviewUrl: data.post.imagePreviewUrl ?? null,
        characterCount: data.post.content.length,
      });
      setSchedulingId(null);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const removePost = async (post: RunPost) => {
    setBusyId(post.id);
    setError(null);
    try {
      const response = await fetch(`/api/socials-manager/posts/${post.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the post.");
      setPosts((current) => {
        const next = current.filter((candidate) => candidate.id !== post.id);
        postsRef.current = next;
        return next;
      });
      if (schedulingId === post.id) setSchedulingId(null);
      if (studioId === post.id) setStudioId(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const terminal = TERMINAL_STATUSES.has(status);
  const studioPost = posts.find((post) => post.id === studioId) ?? null;
  const scheduledCount = posts.filter((post) => post.calendarEventId !== null).length;
  const statusDot = terminal
    ? status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]"
    : "animate-pulse bg-[var(--botanical-2)]";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        usage={usage}
        responseDurationMs={
          !terminal || elapsedSeconds > 0 ? elapsedSeconds * 1_000 : undefined
        }
        agentName="Socials Manager"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The brief is the user's own message directly above this card, so the
            header names the agent and its state and nothing else. */}
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Socials Manager</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {terminal ? status : `drafting · ${formatDuration(elapsedSeconds)}`}
            </span>
            {!terminal && (
              <button type="button" onClick={stop} className="bb-agent-run-action">
                Stop
              </button>
            )}
          </div>
        </div>

        <div className="space-y-[13px] p-[21px]">
          {/* Where the drafts stand and what is drafting them: whether the real
              Postiz stack is behind this run changes what the buttons below do,
              so it is stated rather than left to be inferred. */}
          <div className="flex flex-wrap items-center gap-x-[13px] gap-y-[5px]">
            <p className="bb-agent-run-label">
              {terminal
                ? status === "completed"
                  ? `${posts.length} post${posts.length === 1 ? "" : "s"} · ${
                      scheduledCount
                        ? `${scheduledCount} on your calendar`
                        : "none scheduled yet"
                    }`
                  : status === "aborted"
                    ? "Drafting stopped"
                    : "Drafting failed"
                : (note ?? "Drafting…")}
            </p>
            {stack ? (
              <p className="bb-agent-run-label inline-flex items-center gap-1.5">
                <span
                  className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                    stack.state === "running"
                      ? "bg-[var(--botanical)]"
                      : "bg-[var(--line-strong)]"
                  }`}
                />
                {STACK_TEXT[stack.state] ?? "Postiz is starting — drafting locally meanwhile"}
              </p>
            ) : null}
          </div>

          {failure && <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>}
          {error && <p className="bb-agent-run-text text-[var(--danger)]">{error}</p>}

          {posts.map((post) => {
            const overLimit =
              post.characterLimit !== null && post.characterCount > post.characterLimit;
            const scheduling = schedulingId === post.id;
            return (
              <div key={post.id} className="bb-agent-run-panel space-y-[8px] p-[13px]">
                <div className="flex items-center justify-between gap-[8px]">
                  <span className="bb-agent-run-title">{post.providerName}</span>
                  <span
                    className={`bb-agent-run-label tabular-nums ${
                      overLimit ? "text-[var(--danger)]" : ""
                    }`}
                  >
                    {post.characterCount}
                    {post.characterLimit === null ? "" : ` / ${post.characterLimit}`}
                  </span>
                </div>

                <p className="bb-agent-run-text whitespace-pre-wrap break-words">
                  {post.content}
                </p>

                {post.imagePreviewUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (post.imageArtifactId) void openArtifact?.(post.imageArtifactId);
                    }}
                    disabled={!openArtifact || !post.imageArtifactId}
                    className="block w-full overflow-hidden rounded-[13px] border border-[color-mix(in_srgb,var(--line)_70%,transparent)] bg-[var(--paper-strong)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default"
                    title={`Open the ${post.providerName} image`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped artifact preview, not a next/image source */}
                    <img
                      src={post.imagePreviewUrl}
                      alt={`Artwork attached to the ${post.providerName} post`}
                      className="max-h-64 w-full object-cover"
                    />
                  </button>
                ) : imagingId === post.id ? (
                  <p className="bb-agent-run-inset bb-agent-run-label p-[13px]">
                    Drawing an image for this post…
                  </p>
                ) : null}

                {scheduling ? (
                  <div className="bb-agent-run-inset flex flex-wrap items-center gap-[8px] p-[13px]">
                    <label
                      className="bb-agent-run-label"
                      htmlFor={`socials-manager-slot-${post.id}`}
                    >
                      Calendar time
                    </label>
                    <input
                      id={`socials-manager-slot-${post.id}`}
                      type="datetime-local"
                      value={draftScheduleAt}
                      disabled={busyId === post.id}
                      onChange={(event) => setDraftScheduleAt(event.target.value)}
                      className="min-w-[12rem] rounded-[8px] border border-[color-mix(in_srgb,var(--line)_70%,transparent)] bg-[var(--paper-surface)] px-[8px] py-[3px] text-[13px] leading-[1.618] text-[var(--ink)] outline-none focus-visible:border-[var(--line-strong)]"
                    />
                    <button
                      type="button"
                      disabled={busyId === post.id || !draftScheduleAt}
                      onClick={() =>
                        void savePost(post, { scheduledAt: draftScheduleAt })
                      }
                      className="bb-agent-run-action bb-agent-run-action-primary"
                    >
                      {post.calendarEventId ? "Save time" : "Add to calendar"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === post.id}
                      onClick={() => setSchedulingId(null)}
                      className="bb-agent-run-action"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="bb-agent-run-label"
                      aria-live="polite"
                    >
                      {post.calendarEventId
                        ? `On your calendar · ${formatSlot(post.scheduledAt)}`
                        : "Not on your calendar"}
                      {post.remoteId ? " · saved in Postiz" : ""}
                    </span>

                    <span className="ml-auto flex flex-wrap items-center justify-end gap-[5px]">
                      {post.calendarEventId ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === post.id}
                            onClick={() => {
                              setSchedulingId(post.id);
                              setDraftScheduleAt(
                                post.scheduledAt ?? suggestedCalendarSlot(),
                              );
                            }}
                            className="bb-agent-run-action"
                          >
                            Change time
                          </button>
                          <button
                            type="button"
                            disabled={busyId === post.id}
                            onClick={() => void savePost(post, { scheduledAt: null })}
                            className="bb-agent-run-action bb-agent-run-action-danger"
                          >
                            Remove from calendar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === post.id}
                          onClick={() => {
                            setSchedulingId(post.id);
                            setDraftScheduleAt(suggestedCalendarSlot());
                          }}
                          className="bb-agent-run-action bb-agent-run-action-primary"
                        >
                          Add to calendar
                        </button>
                      )}
                    {/* Copy, artwork, and the draft artifact are one job, so
                        they are one button: the post studio. */}
                    <button
                      type="button"
                      disabled={busyId === post.id || imagingId === post.id}
                      onClick={() => {
                        setSchedulingId(null);
                        setStudioId(post.id);
                      }}
                      className="bb-agent-run-action"
                    >
                      {imagingId === post.id ? "Drawing…" : "Edit"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === post.id}
                      onClick={() => removePost(post)}
                      className="bb-agent-run-action bb-agent-run-action-danger"
                    >
                      Delete
                    </button>
                  </span>
                  </div>
                )}
              </div>
            );
          })}

          {hydratedRunId !== runId && !posts.length ? (
            <p className="bb-agent-run-output bb-agent-run-text p-[13px] text-[var(--ink-muted)]">
              Restoring saved posts…
            </p>
          ) : null}

          {terminal && hydratedRunId === runId && !posts.length && !failure ? (
            <p className="bb-agent-run-output bb-agent-run-text p-[13px] text-[var(--ink-muted)]">
              No posts were drafted.
            </p>
          ) : null}
        </div>
      </div>
      {studioPost ? (
        <SocialsManagerPostStudio
          post={studioPost}
          conversationId={artifactScope?.conversationId ?? null}
          gardenSlug={artifactScope?.gardenSlug ?? null}
          sourceSurface={artifactScope?.sourceSurface ?? null}
          formatSlot={formatSlot}
          onSave={(patch: SocialsManagerStudioPatch) => savePost(studioPost, patch)}
          onClose={() => setStudioId(null)}
          onOpenArtifact={
            openArtifact ? (artifactId) => void openArtifact(artifactId) : null
          }
          onArtifactCreated={(artifact) => registerArtifact?.(artifact)}
        />
      ) : null}
      {terminal ? (
        <AssistantMessageActions content={summarize(posts)} onRetry={onRetry} />
      ) : null}
    </>
  );
}
