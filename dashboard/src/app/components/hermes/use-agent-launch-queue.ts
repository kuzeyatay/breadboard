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
// start immediately. Launch setup is dispatched one head at a time, but each
// worker then owns a separate hidden turn and continues running concurrently.
//
// The parsing and the continuation wording live in lib/hermes/agent-launch.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { isYoloModeEnabled, useYoloMode } from "@/app/components/use-yolo-mode";
import {
  parseAgentLaunchRequest,
  type AgentLaunchRequestPayload,
} from "@/lib/hermes/agent-launch.ts";
import type { AgentLaunchScopeKey } from "./agent-launch-scope.ts";

export {
  MAX_AGENT_LAUNCH_HOPS,
  MAX_PARALLEL_AGENT_LAUNCHES,
  agentLaunchContinuationMarker,
  agentLaunchContinuationMessage,
  agentLaunchWorkerClientMessageId,
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
  handleEvent: (value: unknown, originScopeKey?: AgentLaunchScopeKey) => boolean;
  confirm: () => void;
  dismiss: () => void;
  /** Drop all launches, or just those owned by the supplied conversation. */
  reset: (scopeKey?: AgentLaunchScopeKey) => void;
}

interface ScopedAgentLaunchRequest {
  request: AgentLaunchRequestPayload;
  scopeKey: AgentLaunchScopeKey;
}

export function useAgentLaunchQueue(
  options: AgentLaunchQueueOptions,
): AgentLaunchQueue {
  const { submit, scopeKey = null, ready, onLaunched, onDismissed } = options;
  const [queue, setQueue] = useState<ScopedAgentLaunchRequest[]>([]);
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
  const currentScopeRef = useRef(scopeKey);
  currentScopeRef.current = scopeKey;
  useEffect(() => {
    submitRef.current = submit;
    launchedRef.current = onLaunched;
    dismissedRef.current = onDismissed;
  });

  const handleEvent = useCallback((value: unknown, originScopeKey = scopeKey): boolean => {
    const request = parseAgentLaunchRequest(value);
    if (!request) return false;
    // A stream started on the blank composer can outlive chat creation and
    // navigation. Its caller must supply the reserved chat id; the next chat
    // selected is never evidence of ownership. Leave unowned events unseen so
    // a restored transcript can deliver them again with its actual scope.
    if (originScopeKey === null) return true;
    // A request rebuilt from a finished turn's evidence and the live request
    // the stream delivered for the same turn and agent are one hand-off.
    const originKey = request.originClientMessageId
      ? `origin:${request.originClientMessageId}:${request.agentId}:${request.brief.trim()}`
      : null;
    if (seenRef.current.has(request.requestId)) return true;
    if (originKey && seenRef.current.has(originKey)) return true;
    seenRef.current.add(request.requestId);
    if (originKey) seenRef.current.add(originKey);
    setQueue((current) => [...current, { request, scopeKey: originScopeKey }]);
    return true;
  }, [scopeKey]);

  const launch = useCallback((request: AgentLaunchRequestPayload, originScopeKey: AgentLaunchScopeKey) => {
    if (originScopeKey === null || currentScopeRef.current !== originScopeKey) return;
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
      if (!head.requiresApproval || isYoloModeEnabled()) launch(head, scopeKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [head, launch, ready, scopeKey, yoloMode]);

  const confirm = useCallback(() => {
    if (head) launch(head, scopeKey);
  }, [head, launch, scopeKey]);

  const dismiss = useCallback(() => {
    if (!head) return;
    setQueue((current) =>
      current.filter((item) => item.request.requestId !== head.requestId),
    );
    dismissedRef.current?.(head);
  }, [head]);

  const reset = useCallback((scope?: AgentLaunchScopeKey) => {
    setQueue((current) => scope === undefined ? [] : current.filter((item) => item.scopeKey !== scope));
  }, []);

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
