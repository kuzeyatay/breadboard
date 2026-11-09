"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import { assistantThinkingUpdates, isAssistantTextPreview } from "@/lib/assistant-thinking";
import { normalizeMathDelimiters } from "@/lib/chat-markdown-math";
import {
  assistantLiveActivityReady,
  assistantResponseElapsedMs,
} from "@/lib/assistant-activity-timing";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { parseChatTimestamp } from "@/lib/chat-time-separators";
import type {
  ActivityItem,
  ClarificationPrompt,
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";

const remarkPlugins = [remarkMath];
const rehypePlugins = [rehypeKatex];

interface Props {
  activities: ActivityItem[];
  /** Assistant-authored, user-visible updates emitted before the final answer. */
  progressNotes?: string[];
  /** Provider thinking text, shown alongside response-owned progress updates. */
  reasoning?: string;
  /** Used to suppress answer previews persisted as reasoning by older runtimes. */
  answerContent?: string;
  connection: ConnectionState;
  pendingPermission: PermissionPrompt | null;
  /** A question the model is blocked on; answered by a choice or typed text. */
  pendingClarification?: ClarificationPrompt | null;
  onClarificationAnswer?: (answer: string) => void;
  usage?: ChatTokenUsage;
  /** Local preparation precedes the model call and is shown immediately. */
  preparationLabel?: string;
  responseDurationMs?: number;
  /** Durable beginning of the response this row belongs to. */
  responseStartedAt?: string;
  /** Durable completion wins over a stale chat connection. */
  responseCompletedAt?: string;
  /** Start of an ongoing phase that runs outside the main chat connection. */
  activePhaseStartedAt?: string;
  /**
   * Time this row inherits from a phase that is no longer on screen. A delegated
   * worker's turn is hidden behind the hand-back that reports it, so without
   * this the answer's clock described only its last few seconds.
   */
  carriedDurationMs?: number;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  /** Overrides Thinking for terminal states such as an interrupted turn. */
  stateLabel?: string;
  restoredActivityLabel?: string;
  /** Replaces the default Thought label after a successful special outcome. */
  completedLabel?: string;
  stateFailed?: boolean;
  stateAction?: ReactNode;
}

export default function ActivityPanel({
  activities,
  progressNotes,
  reasoning,
  answerContent = "",
  connection,
  pendingPermission,
  pendingClarification = null,
  onClarificationAnswer,
  usage,
  preparationLabel,
  responseDurationMs,
  responseStartedAt,
  responseCompletedAt,
  activePhaseStartedAt,
  carriedDurationMs,
  onPermissionDecision,
  stateLabel,
  restoredActivityLabel,
  completedLabel,
  stateFailed = false,
  stateAction,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [progressOpen, setProgressOpen] = useState(false);
  const progressId = useId();
  const [activeFallbackStartedAtMs] = useState(() => Date.now());
  const active =
    connection === "connecting" ||
    connection === "streaming" ||
    connection === "waiting";
  const artifactState = activities.findLast(
    (item) =>
      item.kind === "artifact" &&
      (item.status === "running" || item.status === "failed"),
  );
  // A failed artifact can be repaired while the response continues. Only an
  // explicit response failure may stop a live chat. Natural rewriting belongs
  // to the finished answer's action row and never extends its thinking time.
  const responseComplete = parseChatTimestamp(responseCompletedAt) !== null;
  const responseActive = ((active && !responseComplete) || artifactState?.status === "running") && !stateFailed;
  const effectiveFailed = stateFailed || (!responseActive && artifactState?.status === "failed");
  const liveActivity = activities.findLast((item) => item.status === "running");
  const completedActivityLabel = activities.findLast(
    (item) => item.status === "completed" && item.completedLabel,
  )?.completedLabel;
  const elapsedMs = useMemo(
    () =>
      assistantResponseElapsedMs({
        activities,
        active: responseActive,
        now,
        reportedDurationMs: responseDurationMs ?? usage?.responseDurationMs,
        responseStartedAt,
        responseCompletedAt,
        activePhaseStartedAt,
        activeFallbackStartedAtMs,
        carriedDurationMs,
      }),
    [
      activities,
      now,
      responseActive,
      responseDurationMs,
      responseStartedAt,
      responseCompletedAt,
      activeFallbackStartedAtMs,
      activePhaseStartedAt,
      carriedDurationMs,
      usage?.responseDurationMs,
    ],
  );
  const showLiveActivity =
    responseActive && assistantLiveActivityReady(elapsedMs);
  const liveLabel =
    (pendingPermission
      ? "Waiting for permission"
      : pendingClarification
        ? "Waiting for your answer"
        : stateLabel ?? (artifactState?.status === "running" ? artifactState.label : undefined) ??
          liveActivity?.label ?? restoredActivityLabel ?? "Thinking");
  // Tool, orchestration, answer-writing and artifact labels wait five seconds.
  // Compaction can begin before the first model call, so show it immediately.
  // A settled default returns to Thinking so AssistantResponseMeta renders the
  // permanent, past-tense Thought label.
  const effectiveLabel = responseActive
    ? preparationLabel ?? (pendingPermission || pendingClarification || liveLabel === "Compacting conversation" || showLiveActivity
      ? liveLabel
      : "Thinking")
    : stateLabel ??
      (artifactState?.status === "failed" ? artifactState.label : undefined) ??
      completedLabel ??
      completedActivityLabel ??
      "Thinking";
  const visibleProgressNotes = useMemo(
    () =>
      (progressNotes ?? []).reduce<string[]>((notes, note) => {
        const trimmed = note.trim();
        if (trimmed && notes.at(-1) !== trimmed && !isAssistantTextPreview(trimmed, answerContent)) {
          notes.push(trimmed);
        }
        return notes;
      }, []),
    [progressNotes, answerContent],
  );
  const thinkingUpdates = useMemo(
    () => [
      ...visibleProgressNotes,
      ...assistantThinkingUpdates(reasoning, answerContent, visibleProgressNotes),
    ],
    [reasoning, answerContent, visibleProgressNotes],
  );
  const hasProgressNotes = thinkingUpdates.length > 0;
  const canDisclose = hasProgressNotes;
  const showMeta = responseActive || hasProgressNotes || answerContent.trim() || effectiveFailed || stateAction ||
    effectiveLabel !== "Thinking" || (elapsedMs !== null && elapsedMs > 0) ||
    Boolean(usage?.totalTokens && usage.scope !== "session");

  useEffect(() => {
    const transitionTick = window.setTimeout(() => setNow(Date.now()), 0);
    if (!responseActive) return () => window.clearTimeout(transitionTick);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(transitionTick);
      window.clearInterval(timer);
    };
  }, [responseActive]);

  return (
    <section className="text-[var(--ink)]">
      {showMeta ? <AssistantResponseMeta
        active={responseActive}
        shimmer={responseActive}
        failed={effectiveFailed}
        label={effectiveLabel}
        usage={usage}
        showTokenUsage={!preparationLabel}
        responseDurationMs={elapsedMs !== null && (responseActive || elapsedMs > 0) ? elapsedMs : undefined}
        action={stateAction}
        disclosureExpanded={canDisclose ? progressOpen : undefined}
        disclosureControls={canDisclose ? progressId : undefined}
        onDisclosureToggle={canDisclose ? () => setProgressOpen((open) => !open) : undefined}
      /> : null}

      {canDisclose && progressOpen ? (
        <div
          id={progressId}
          className="relative ml-1 mt-1 pb-1"
          data-response-progress
        >
          {thinkingUpdates.length > 1 ? (
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-[3px] top-3 w-px bg-[var(--line)]"
            />
          ) : null}
          <ol className="space-y-3" aria-label="Thinking updates">
            {thinkingUpdates.map((note, index) => {
              const latest = index === thinkingUpdates.length - 1;
              return (
                <li
                  key={index}
                  className="relative grid min-w-0 grid-cols-[8px_minmax(0,1fr)] gap-3"
                >
                  <span
                    aria-hidden="true"
                    className={`relative z-10 mt-2 h-2 w-2 rounded-full bg-[var(--botanical)] ${
                      responseActive && latest ? "motion-safe:animate-pulse" : ""
                    }`}
                  />
                  <div className="min-w-0 break-words text-sm font-normal leading-6 text-[var(--ink-muted)] [&_p]:whitespace-pre-wrap [&_pre]:whitespace-pre-wrap [&_code]:[overflow-wrap:anywhere] [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:underline [&>*+*]:mt-2">
                    <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
                      {normalizeMathDelimiters(note)}
                    </ReactMarkdown>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {pendingPermission ? (
        <div className="neu-surface-subtle mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              Permission required
            </p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              {pendingPermission.description}
            </p>
            {pendingPermission.command ? (
              <code className="mt-2 block overflow-x-auto rounded-lg bg-black/[0.035] px-2.5 py-1.5 text-[10px] text-[var(--ink)]">
                {pendingPermission.command}
              </code>
            ) : null}
            {pendingPermission.affectedPaths.length ? (
              <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                {pendingPermission.affectedPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPermissionDecision("once")}
              className="neu-button-accent rounded-full bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white transition hover:bg-[var(--botanical-hover)]"
            >
              Allow once
            </button>
            {pendingPermission.allowSession ? (
              <button
                type="button"
                onClick={() => onPermissionDecision("always")}
                className="neu-button rounded-full bg-[var(--paper-raised)] px-4 py-2 text-xs font-medium text-[var(--botanical)] transition hover:bg-[var(--paper-bg)]"
              >
                Allow similar for session
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onPermissionDecision("reject")}
              className="neu-button-destructive rounded-full bg-red-500/[0.07] px-3.5 py-2 text-xs font-medium text-[#a45f56] transition hover:bg-red-500/[0.12]"
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}

      {pendingClarification && onClarificationAnswer ? (
        <ClarificationCard
          key={pendingClarification.requestId}
          prompt={pendingClarification}
          onAnswer={onClarificationAnswer}
        />
      ) : null}
    </section>
  );
}

/**
 * The model's mid-turn question. Choices are one click; anything else is
 * typed here or in the composer, which routes a send to the same answer while
 * the question is open.
 */
function ClarificationCard({
  prompt,
  onAnswer,
}: {
  prompt: ClarificationPrompt;
  onAnswer: (answer: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const submitDraft = () => {
    if (!trimmed) return;
    onAnswer(trimmed);
    setDraft("");
  };
  return (
    <div data-notification-message={JSON.stringify([`question:${prompt.requestId}`])}
      className="neu-surface-subtle mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3.5">
      <p className="text-sm font-medium text-[var(--ink-heading)]">
        The agent has a question
      </p>
      <p className="mt-0.5 text-sm leading-6 text-[var(--ink)]">
        {prompt.question}
      </p>
      {prompt.choices.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {prompt.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => onAnswer(choice)}
              className="neu-button rounded-full bg-[var(--paper-raised)] px-4 py-2 text-xs font-medium text-[var(--botanical)] transition hover:bg-[var(--paper-bg)]"
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            prompt.choices.length ? "Or type a different answer" : "Type your answer"
          }
          aria-label="Answer the agent's question"
          className="min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--paper-raised)] px-3.5 py-2 text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)]"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="neu-button-accent rounded-full bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Answer
        </button>
      </form>
    </div>
  );
}
