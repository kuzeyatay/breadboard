"use client";

// The chat side of `agent_launch`: launches a super-agent turn asked for,
// performed by the surface that owns launching.
//
// The surface still owns the concrete launcher, but a model-selected launch is
// delegation metadata rather than user input. The queue therefore hands the
// structured request directly to the surface; it must never replay the slash
// command through the composer or persist it in the person's name.
//
// Two rules shape the timing. A launch never interrupts the turn that asked for
// it: the request arrives mid-stream and waits until the surface is idle, or the
// submit would be refused and silently lost. Action-capable agents then wait for
// confirmation (unless YOLO mode is on); read-only internal delegations can
// start immediately after the turn and attach their card to that assistant.
//
// The parsing and the continuation wording live in lib/hermes/agent-launch.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { isYoloModeEnabled, useYoloMode } from "@/app/components/use-yolo-mode";
import {
  parseAgentLaunchRequest,
  type AgentLaunchRequestPayload,
} from "@/lib/hermes/agent-launch.ts";

export {
  MAX_AGENT_LAUNCH_HOPS,
  agentLaunchContinuationMessage,
  parseAgentLaunchRequest,
  type AgentLaunchRequestPayload,
} from "@/lib/hermes/agent-launch.ts";

export interface AgentLaunchQueueOptions {
  /** Dispatch the structured delegation without manufacturing user input. */
  submit: (request: AgentLaunchRequestPayload) => void;
  /** Conversation currently rendering the queue; cards stay with their origin. */
  scopeKey?: string | number | null;
  /** False while a turn is streaming or another agent is starting. */
  ready: boolean;
  /** Called with the request the moment its submit is dispatched. */
  onLaunched?: (request: AgentLaunchRequestPayload) => void;
  /** Called when the user refuses one, so the chat can say so. */
  onDismissed?: (request: AgentLaunchRequestPayload) => void;
}

export interface AgentLaunchQueue {
  /** A launch is waiting for the current assistant turn to hand it the UI. */
  queued: boolean;
  /** The request awaiting the user, or null when there is nothing to confirm. */
  pending: AgentLaunchRequestPayload | null;
  /** How many more are queued behind it. */
  waiting: number;
  /** Feed every stream event here; true means it was a launch request. */
  handleEvent: (value: unknown) => boolean;
  confirm: () => void;
  dismiss: () => void;
  /** Drop everything — a new user message supersedes an unanswered launch. */
  reset: () => void;
}

export function useAgentLaunchQueue(
  options: AgentLaunchQueueOptions,
): AgentLaunchQueue {
  const { submit, scopeKey = null, ready, onLaunched, onDismissed } = options;
  const [queue, setQueue] = useState<
    Array<{ request: AgentLaunchRequestPayload; scopeKey: string | number | null }>
  >([]);
  const [yoloMode] = useYoloMode();
  // Requests already acted on. A stream that replays on reconnect re-delivers
  // them, and starting a second video because the socket blinked is the one
  // failure this feature must not have.
  const seenRef = useRef<Set<string>>(new Set());
  // The callers' handlers are re-created every render and read live state when
  // they run, so they are reached through refs rather than captured — otherwise
  // a launch dispatched from a timer would submit against a stale transcript.
  const submitRef = useRef(submit);
  const launchedRef = useRef(onLaunched);
  const dismissedRef = useRef(onDismissed);
  useEffect(() => {
    submitRef.current = submit;
    launchedRef.current = onLaunched;
    dismissedRef.current = onDismissed;
  });

  const handleEvent = useCallback((value: unknown): boolean => {
    const request = parseAgentLaunchRequest(value);
    if (!request) return false;
    if (seenRef.current.has(request.requestId)) return true;
    seenRef.current.add(request.requestId);
    setQueue((current) => [...current, { request, scopeKey }]);
    return true;
  }, [scopeKey]);

  const launch = useCallback((request: AgentLaunchRequestPayload) => {
    setQueue((current) =>
      current.filter((item) => item.request.requestId !== request.requestId),
    );
    launchedRef.current?.(request);
    submitRef.current(request);
  }, []);

  const activeQueue = queue.filter((item) => item.scopeKey === scopeKey);
  const head = activeQueue[0]?.request ?? null;

  // Approval-free delegations and YOLO-approved actions both dispatch here. The
  // timeout defers past this render so submit never runs during commit. YOLO is
  // re-read inside it so a switch flipped off in between cannot start an action.
  useEffect(() => {
    if (!head || !ready || (head.requiresApproval && !yoloMode)) return;
    const timer = window.setTimeout(() => {
      if (!head.requiresApproval || isYoloModeEnabled()) launch(head);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [head, launch, ready, yoloMode]);

  const confirm = useCallback(() => {
    if (head) launch(head);
  }, [head, launch]);

  const dismiss = useCallback(() => {
    if (!head) return;
    setQueue((current) =>
      current.filter((item) => item.request.requestId !== head.requestId),
    );
    dismissedRef.current?.(head);
  }, [head]);

  const reset = useCallback(() => setQueue([]), []);

  return {
    queued: Boolean(head),
    // Held back until the surface is idle so the chip cannot be tapped into a
    // submit that would be refused.
    pending:
      yoloMode || !ready || !head?.requiresApproval ? null : head,
    waiting: head ? activeQueue.length - 1 : 0,
    handleEvent,
    confirm,
    dismiss,
    reset,
  };
}
