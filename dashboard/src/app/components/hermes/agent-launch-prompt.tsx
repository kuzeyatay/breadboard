"use client";

// The confirmation a super-agent turn's chosen runtime agent waits behind.
//
// Deliberately the same shape and the same words-per-decision as the permission
// prompt it sits beside: a runtime agent renders video, changes a repository, or
// publishes a post, so choosing one is an action, not a suggestion. The brief is
// shown in full because it is the entire instruction the agent will act on and
// the last point at which anyone can read it.

import type { AgentLaunchRequestPayload } from "./use-agent-launch-queue";

interface Props {
  request: AgentLaunchRequestPayload;
  /** How many further launches are queued behind this one. */
  waiting?: number;
  onConfirm: () => void;
  onDismiss: () => void;
}

export default function AgentLaunchPrompt({
  request,
  waiting = 0,
  onConfirm,
  onDismiss,
}: Props) {
  return (
    <div className="neu-surface-subtle mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--ink-heading)]">
          Start {request.agentName}?
        </p>
        <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
          {request.reason
            ? request.reason
            : `The assistant chose ${request.agentName} for this work.`}
          {request.awaitResult
            ? " Its result comes back to the chat when it finishes."
            : ""}
        </p>
        <p className="mt-2 rounded-lg bg-black/[0.035] px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap text-[var(--ink)]">
          {request.brief}
        </p>
        {waiting > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
            {waiting} more {waiting === 1 ? "launch" : "launches"} queued behind
            this one.
          </p>
        ) : null}
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="neu-button-accent rounded-full bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white transition hover:bg-[var(--botanical-hover)]"
        >
          Start {request.agentName}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="neu-button rounded-full bg-[var(--paper-raised)] px-4 py-2 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--paper-bg)]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
