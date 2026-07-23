"use client";

// Client-side hook that drives an OpenHarness-backed agent session for any of
// the three surfaces (terminal, garden chat, Quartz AI). It owns the runtime
// session lifecycle, streaming, tool activity, permission prompts, abort, and
// reconnect state — so surface components stay thin and none of this logic
// lands in dashboard-client.tsx.
//
// The browser only ever talks to Breadboard's /api/openharness/* routes. It
// references conversations by an opaque Breadboard id; the OpenHarness
// session id, workspace, and agent are all server-derived.

import { useCallback, useEffect, useRef, useState } from "react";
import { isYoloModeEnabled, useYoloMode } from "@/app/components/use-yolo-mode";
import type { AssistantReasoningEffort } from "@/lib/assistant-reasoning";
import type { ChatAttachment } from "@/lib/chat-attachments";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import {
  activityLabelForTool,
  evidenceKindForTool,
  type EvidenceKind,
  type VerificationSummary,
} from "@/lib/openharness/evidence";
import type { PermissionRisk } from "@/lib/openharness/events";
import { selectRestorableAgentSession } from "@/lib/openharness/session-selection";
import { submitPermissionDecision } from "./permission-client";

export type AgentSurface = "dashboard_terminal" | "garden_chat" | "quartz_ai";

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  summary?: string;
  status: "running" | "completed" | "failed";
}

export interface PermissionPrompt {
  requestId: string;
  permission: string;
  description: string;
  risk: PermissionRisk;
  affectedPaths: string[];
  command?: string;
  sourcePath?: string;
  destinationPath?: string;
  allowSession: boolean;
  /** A Breadboard capability preflight pauses before any OpenHarness run. */
  preflight?: {
    kind: "filesystem" | "confirmation" | "connection";
    path?: string;
    operations: string[];
  };
}

export interface ActivityItem {
  id: string;
  kind: EvidenceKind | "reasoning" | "permission" | "answer";
  label: string;
  detail?: string;
  status:
    | "running"
    | "permission_required"
    | "completed"
    | "failed"
    | "cancelled"
    | "denied";
  startedAt: string;
  completedAt?: string;
  toolCallId?: string;
  parentId?: string;
}

export interface AgentMessage {
  id?: string;
  clientMessageId?: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sources?: string[];
  tools?: ToolActivity[];
  proposal?: unknown;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
  interrupted?: boolean;
  courseCorrection?: boolean;
  clientRequestId?: string;
  branchGroupId?: string;
}

export interface SkillContinuation {
  parentTaskId: string;
  skillId: string;
  capability: string;
  approvedPermissions: string[];
}

export interface AgentSendOptions {
  model?: string;
  reasoningEffort?: AssistantReasoningEffort;
  continuation?: SkillContinuation;
  attachments?: ChatAttachment[];
  confirmedPermissionIds?: string[];
  historyOverride?: AgentMessage[];
  branchGroupId?: string;
}

interface BlockedTurn {
  text: string;
  options?: AgentSendOptions;
  userMessageId: string;
  assistantMessageId: string;
}

function normalizeRestoredMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message): message is AgentMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string"
      );
    })
    .map((message) => {
      const usage = normalizeChatTokenUsage(message.usage);
      const normalized = { ...message };
      if (usage) normalized.usage = usage;
      else delete normalized.usage;
      if (
        typeof message.responseDurationMs === "number" &&
        Number.isFinite(message.responseDurationMs) &&
        message.responseDurationMs >= 0
      ) {
        normalized.responseDurationMs = Math.trunc(message.responseDurationMs);
      } else {
        delete normalized.responseDurationMs;
      }
      if (
        typeof message.branchGroupId !== "string" ||
        !message.branchGroupId.trim()
      ) {
        delete normalized.branchGroupId;
      }
      return normalized;
    });
}

export type ConnectionState =
  "idle" | "connecting" | "streaming" | "waiting" | "error";

export type AgentRunState =
  | "idle"
  | "submitting"
  | "connecting"
  | "running"
  | "waiting_for_permission"
  | "steering"
  | "stopping"
  | "completed"
  | "cancelled"
  | "error";

export function isActiveAgentRunState(state: AgentRunState): boolean {
  return (
    state === "submitting" ||
    state === "connecting" ||
    state === "running" ||
    state === "waiting_for_permission" ||
    state === "steering" ||
    state === "stopping"
  );
}

function connectionForRunState(state: AgentRunState): ConnectionState {
  if (state === "submitting" || state === "connecting") return "connecting";
  if (state === "waiting_for_permission") return "waiting";
  if (state === "running" || state === "steering" || state === "stopping") {
    return "streaming";
  }
  if (state === "error") return "error";
  return "idle";
}

function isExpectedCancellationError(message: string): boolean {
  return /\b(?:abort(?:ed)?|cancel(?:led|ed)?|cancelled_by_user)\b/i.test(
    message,
  );
}

interface CreateOptions {
  gardenSlug?: string;
  pageSlug?: string;
  title?: string;
}

export interface UseAgentSessionResult {
  sessionId: string | null;
  activeDirectory: string | null;
  filesystemMode: "restricted" | "full";
  messages: AgentMessage[];
  connection: ConnectionState;
  runState: AgentRunState;
  activeRunId: string | null;
  activeInstruction: string | null;
  steerError: string | null;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activeTools: ToolActivity[];
  activities: ActivityItem[];
  setMessages: (messages: AgentMessage[]) => void;
  setSessionId: (id: string | null) => void;
  send: (
    text: string,
    options?: AgentSendOptions,
  ) => Promise<void>;
  steer: (text: string) => Promise<boolean>;
  respondToPermission: (
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  abort: () => Promise<void>;
  reset: () => void;
}

async function ensureSession(
  surface: AgentSurface,
  options: CreateOptions | undefined,
  currentId: string | null,
  current: {
    activeDirectory: string | null;
    filesystemMode: "restricted" | "full";
  },
): Promise<{
  id: string;
  activeDirectory: string | null;
  filesystemMode: "restricted" | "full";
}> {
  if (currentId) return { id: currentId, ...current };
  const response = await fetch("/api/openharness/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surface, ...options }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "Could not start an agent session.",
    );
  }
  const data = await response.json();
  return {
    id: data.session.id as string,
    activeDirectory:
      typeof data.session.activeDirectory === "string"
        ? data.session.activeDirectory
        : null,
    filesystemMode:
      data.session.filesystemMode === "full" ? "full" : "restricted",
  };
}

export function useAgentSession(
  surface: AgentSurface,
  createOptions?: CreateOptions,
): UseAgentSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null);
  const [filesystemMode, setFilesystemMode] = useState<"restricted" | "full">(
    "restricted",
  );
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [runState, setRunState] = useState<AgentRunState>("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeInstruction, setActiveInstruction] = useState<string | null>(null);
  const [steerError, setSteerError] = useState<string | null>(null);
  const [runToResume, setRunToResume] = useState<{
    sessionId: string;
    runId: string;
    instruction: string;
    startedAt?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionPrompt | null>(null);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const runStateRef = useRef<AgentRunState>("idle");
  const activeRunIdRef = useRef<string | null>(null);
  const activeStreamRef = useRef<Promise<"completed" | "cancelled" | "failed"> | null>(null);
  const steeringRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const resumedRunIdRef = useRef<string | null>(null);
  const blockedTurnRef = useRef<BlockedTurn | null>(null);
  const latestSendOptionsRef = useRef<{
    model?: string;
    reasoningEffort?: AssistantReasoningEffort;
  }>({});
  const [yoloMode] = useYoloMode();

  const transition = useCallback((next: AgentRunState) => {
    runStateRef.current = next;
    setRunState(next);
    setConnection(connectionForRunState(next));
  }, []);

  // Breadboard owns the durable transcript. Restore the newest matching
  // runtime session after a refresh; OpenHarness ids remain server-side.
  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/openharness/sessions?surface=${encodeURIComponent(surface)}`,
    )
      .then((response) => (response.ok ? response.json() : { sessions: [] }))
      .then((data) => {
        if (cancelled || sessionRef.current) return;
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const preferredId = window.localStorage.getItem("breadboard-active-conversation");
        const restored = selectRestorableAgentSession(
          sessions,
          preferredId,
          createOptions,
        );
        if (!restored) return;
        sessionRef.current = restored.id;
        setSessionId(restored.id);
        window.localStorage.setItem("breadboard-active-conversation", restored.id);
        setActiveDirectory(
          typeof restored.activeDirectory === "string"
            ? restored.activeDirectory
            : null,
        );
        setFilesystemMode(
          restored.filesystemMode === "full" ? "full" : "restricted",
        );
        setMessages(normalizeRestoredMessages(restored.messages));
        const restoredRun =
          restored.activeRun && typeof restored.activeRun === "object"
            ? (restored.activeRun as Record<string, unknown>)
            : null;
        if (
          restoredRun &&
          typeof restoredRun.id === "string" &&
          typeof restoredRun.instruction === "string"
        ) {
          activeRunIdRef.current = restoredRun.id;
          setActiveRunId(restoredRun.id);
          setActiveInstruction(restoredRun.instruction);
          transition("connecting");
          setRunToResume({
            sessionId: restored.id,
            runId: restoredRun.id,
            instruction: restoredRun.instruction,
            startedAt:
              typeof restoredRun.startedAt === "string"
                ? restoredRun.startedAt
                : undefined,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [surface, createOptions?.gardenSlug, createOptions?.pageSlug, transition]);

  const streamEvents = useCallback(
    async (
      activeSessionId: string,
      assistant: AgentMessage,
      commit: (message: AgentMessage) => void,
      onConnected: () => void,
      responseStartedAtMs: number,
    ): Promise<"completed" | "cancelled" | "failed"> => {
      const controller = new AbortController();
      abortRef.current = controller;
      const streamContext = new URLSearchParams({ surface });
      if (createOptions?.gardenSlug) streamContext.set("gardenSlug", createOptions.gardenSlug);
      if (createOptions?.pageSlug) streamContext.set("pageSlug", createOptions.pageSlug);
      const response = await fetch(
        `/api/openharness/sessions/${activeSessionId}/events?${streamContext.toString()}`,
        {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error("Could not open the agent event stream.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = false;
      const tools = new Map<string, ToolActivity>();
      const upsertActivity = (item: ActivityItem) => {
        setActivities((current) => {
          const index = current.findIndex(
            (candidate) => candidate.id === item.id,
          );
          if (index < 0) return [...current, item];
          const next = [...current];
          next[index] = {
            ...next[index],
            ...item,
            // Repeated reasoning/tool events update status and detail without
            // restarting the full response timer.
            startedAt: next[index].startedAt,
          };
          return next;
        });
      };

      const commitResponseDuration = (completedAtMs = Date.now()) => {
        assistant = {
          ...assistant,
          responseDurationMs: Math.max(0, completedAtMs - responseStartedAtMs),
        };
        commit(assistant);
      };

      const flushAssistant = () => {
        assistant = { ...assistant, tools: Array.from(tools.values()) };
        commit(assistant);
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          if (frame.split("\n").some((line) => line.trim() === ": connected")) {
            onConnected();
            continue;
          }
          const dataLine = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!dataLine) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(dataLine);
          } catch {
            continue;
          }
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          if (typeof event.type === "string" && event.type.startsWith("artifact.")) {
            window.dispatchEvent(new CustomEvent("breadboard:artifact-event", {
              detail: { type: event.type, ...payload },
            }));
            continue;
          }
          switch (event.type) {
            case "assistant.delta":
              assistant = {
                ...assistant,
                content: assistant.content + String(payload.text ?? ""),
              };
              upsertActivity({
                id: "writing-answer",
                kind: "answer",
                label: "Writing answer",
                status: "running",
                startedAt: new Date().toISOString(),
              });
              commit(assistant);
              break;
            case "reasoning.status":
              if (typeof payload.detail === "string" && payload.detail) {
                assistant = {
                  ...assistant,
                  reasoning: `${assistant.reasoning ?? ""}${payload.detail}`,
                };
                commit(assistant);
              }
              upsertActivity({
                id: "reasoning",
                kind: "reasoning",
                label: String(payload.label ?? "Thinking"),
                status: "running",
                startedAt: new Date().toISOString(),
              });
              break;
            case "assistant.completed": {
              const usage = normalizeChatTokenUsage(payload.usage);
              if (usage) {
                assistant = { ...assistant, usage };
                commit(assistant);
              }
              break;
            }
            case "tool.started":
              tools.set(String(payload.toolCallId), {
                toolCallId: String(payload.toolCallId),
                toolName: String(payload.toolName),
                summary: payload.summary as string | undefined,
                status: "running",
              });
              setActiveTools(Array.from(tools.values()));
              upsertActivity({
                id: `tool-${String(payload.toolCallId)}`,
                kind: evidenceKindForTool(String(payload.toolName)),
                label: activityLabelForTool(String(payload.toolName)),
                detail: payload.summary as string | undefined,
                status: "running",
                startedAt: new Date().toISOString(),
                toolCallId: String(payload.toolCallId),
              });
              flushAssistant();
              break;
            case "tool.completed": {
              const id = String(payload.toolCallId);
              const existing = tools.get(id);
              tools.set(id, {
                toolCallId: id,
                toolName: String(payload.toolName),
                summary:
                  (payload.summary as string | undefined) ?? existing?.summary,
                status: payload.success ? "completed" : "failed",
              });
              setActiveTools(Array.from(tools.values()));
              upsertActivity({
                id: `tool-${id}`,
                kind: evidenceKindForTool(String(payload.toolName)),
                label: activityLabelForTool(String(payload.toolName)),
                detail:
                  (payload.summary as string | undefined) ?? existing?.summary,
                status: payload.success ? "completed" : "failed",
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                toolCallId: id,
              });
              flushAssistant();
              break;
            }
            case "permission.requested": {
              const prompt: PermissionPrompt = {
                requestId: String(payload.requestId),
                permission: String(payload.permission),
                description: String(payload.description),
                risk: payload.risk as PermissionRisk,
                affectedPaths: Array.isArray(payload.affectedPaths)
                  ? payload.affectedPaths.filter(
                      (value): value is string => typeof value === "string",
                    )
                  : [],
                command: payload.command as string | undefined,
                sourcePath: payload.sourcePath as string | undefined,
                destinationPath: payload.destinationPath as string | undefined,
                allowSession: payload.allowSession === true,
              };
              if (isYoloModeEnabled()) {
                setPendingPermission(null);
                if (runStateRef.current !== "stopping") transition("running");
                try {
                  await submitPermissionDecision(
                    prompt.requestId,
                    activeSessionId,
                    "always",
                  );
                } catch (permissionError) {
                  transition("error");
                  setError(
                    permissionError instanceof Error
                      ? permissionError.message
                      : "Automatic permission approval failed.",
                  );
                }
                break;
              }
              setPendingPermission(prompt);
              upsertActivity({
                id: `permission-${prompt.requestId}`,
                kind: "permission",
                label: "Permission required",
                detail: prompt.description,
                status: "permission_required",
                startedAt: new Date().toISOString(),
              });
              if (runStateRef.current !== "stopping") {
                transition("waiting_for_permission");
              }
              break;
            }
            case "session.status":
              if (runStateRef.current !== "stopping") {
                if (payload.status === "waiting") {
                  transition("waiting_for_permission");
                } else if (
                  payload.status === "busy" &&
                  runStateRef.current !== "steering"
                ) {
                  transition("running");
                }
              }
              break;
            case "error":
              {
                const message = String(
                  payload.message ?? "The agent reported an error.",
                );
                if (
                  stopRequestedRef.current &&
                  isExpectedCancellationError(message)
                ) {
                  setError(null);
                  break;
                }
                failed = true;
                setError(message);
              }
              break;
            case "verification.updated":
              assistant = {
                ...assistant,
                verification: payload as unknown as VerificationSummary,
              };
              commit(assistant);
              break;
            case "cancelled":
              failed = false;
              setError(null);
              commitResponseDuration();
              setActivities((current) =>
                current.map((item) =>
                  item.status === "running" ||
                  item.status === "permission_required"
                    ? {
                        ...item,
                        status: "cancelled",
                        completedAt: new Date().toISOString(),
                      }
                    : item,
                ),
              );
              assistant = { ...assistant, interrupted: true };
              commit(assistant);
              return "cancelled";
            case "done":
              commitResponseDuration();
              setActivities((current) =>
                current.map((item) =>
                  item.status === "running"
                    ? {
                        ...item,
                        status: "completed",
                        completedAt: new Date().toISOString(),
                      }
                    : item,
                ),
              );
              return failed ? "failed" : "completed";
            default:
              break;
          }
        }
      }
      commitResponseDuration();
      return failed ? "failed" : "completed";
    },
    [createOptions?.gardenSlug, createOptions?.pageSlug, surface, transition],
  );

  const adoptDispatchedRun = useCallback(
    async (
      activeSessionId: string,
      runId: string,
      instruction: string,
      startedAt?: string,
    ) => {
      await activeStreamRef.current?.catch(() => undefined);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      const assistant: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
      };
      setMessages((current) => [...current, assistant]);
      const commit = (message: AgentMessage) => {
        setMessages((current) => {
          const next = [...current];
          const index = next.findIndex(
            (candidate) => candidate.id === assistant.id,
          );
          if (index >= 0) next[index] = { ...message };
          return next;
        });
      };

      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      setActiveInstruction(instruction);
      setError(null);
      setActiveTools([]);
      const parsedStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
      const responseStartedAtMs = Number.isFinite(parsedStartedAt)
        ? parsedStartedAt
        : Date.now();
      setActivities([
        {
          id: "reasoning",
          kind: "reasoning",
          label: "Thinking",
          status: "running",
          startedAt: new Date(responseStartedAtMs).toISOString(),
        },
      ]);
      transition("connecting");

      let adoptedStream: Promise<"completed" | "cancelled" | "failed"> | null = null;
      try {
        let markConnected!: () => void;
        const connected = new Promise<void>((resolve) => {
          markConnected = resolve;
        });
        const streamPromise = streamEvents(
          activeSessionId,
          assistant,
          commit,
          markConnected,
          responseStartedAtMs,
        );
        adoptedStream = streamPromise;
        activeStreamRef.current = streamPromise;
        await Promise.race([
          connected,
          streamPromise.then(() => {
            throw new Error(
              "The follow-up event stream closed before it became ready.",
            );
          }),
        ]);
        if (activeRunIdRef.current === runId) transition("running");
        const outcome = await streamPromise;
        if (activeRunIdRef.current !== runId) return;
        activeRunIdRef.current = null;
        setActiveRunId(null);
        if (outcome === "cancelled") {
          setError(null);
          transition("cancelled");
        }
        else if (outcome === "failed") transition("error");
        else transition("completed");
      } catch (streamError) {
        if ((streamError as Error).name !== "AbortError") {
          setError(
            streamError instanceof Error
              ? streamError.message
              : "The follow-up event stream failed.",
          );
          transition("error");
        }
      } finally {
        if (activeStreamRef.current === adoptedStream) {
          activeStreamRef.current = null;
          abortRef.current = null;
        }
      }
    },
    [streamEvents, transition],
  );

  useEffect(() => {
    if (!runToResume || resumedRunIdRef.current === runToResume.runId) return;
    resumedRunIdRef.current = runToResume.runId;
    void adoptDispatchedRun(
      runToResume.sessionId,
      runToResume.runId,
      runToResume.instruction,
      runToResume.startedAt,
    );
  }, [adoptDispatchedRun, runToResume]);

  const send = useCallback(
    async (text: string, options?: AgentSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || isActiveAgentRunState(runStateRef.current)) return;
      const resumedBlockedTurn =
        blockedTurnRef.current?.text === trimmed ? blockedTurnRef.current : null;
      const transcript = resumedBlockedTurn
        ? messages.filter(
            (message) =>
              message.id !== resumedBlockedTurn.userMessageId &&
              message.id !== resumedBlockedTurn.assistantMessageId,
          )
        : options?.historyOverride ?? messages;
      if (resumedBlockedTurn) blockedTurnRef.current = null;
      latestSendOptionsRef.current = {
        model: options?.model,
        reasoningEffort: options?.reasoningEffort,
      };
      stopRequestedRef.current = false;
      setError(null);
      setSteerError(null);
      setActiveInstruction(trimmed);
      setActiveRunId(null);
      activeRunIdRef.current = null;
      transition("submitting");
      setActiveTools([]);
      const responseStartedAtMs = Date.now();
      setActivities([
        {
          id: "reasoning",
          kind: "reasoning",
          label: "Thinking",
          status: "running",
          startedAt: new Date(responseStartedAtMs).toISOString(),
        },
      ]);

      const userMessage: AgentMessage = {
        id: resumedBlockedTurn?.userMessageId ?? crypto.randomUUID(),
        role: "user",
        content: trimmed,
        ...(options?.branchGroupId
          ? { branchGroupId: options.branchGroupId }
          : {}),
      };
      userMessage.clientMessageId = userMessage.id;
      const assistant: AgentMessage = {
        id: resumedBlockedTurn?.assistantMessageId ?? crypto.randomUUID(),
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
        ...(options?.branchGroupId
          ? { branchGroupId: options.branchGroupId }
          : {}),
      };
      assistant.clientMessageId = userMessage.id;
      const baseline = [...transcript, userMessage, assistant];
      setMessages(baseline);

      const commit = (message: AgentMessage) => {
        setMessages((current) => {
          const next = [...current];
          const assistantIndex = next.findIndex(
            (candidate) => candidate.id === assistant.id,
          );
          if (assistantIndex >= 0) next[assistantIndex] = { ...message };
          return next;
        });
      };

      try {
        const ensured = await ensureSession(
          surface,
          createOptions,
          sessionRef.current,
          { activeDirectory, filesystemMode },
        );
        const activeSessionId = ensured.id;
        if (stopRequestedRef.current) {
          transition("cancelled");
          return;
        }
        sessionRef.current = activeSessionId;
        setSessionId(activeSessionId);
        window.localStorage.setItem("breadboard-active-conversation", activeSessionId);
        setActiveDirectory(ensured.activeDirectory);
        setFilesystemMode(ensured.filesystemMode);
        transition("connecting");

        // Open the event stream, then dispatch the message so no early deltas are
        // missed. The stream stays open until the turn goes idle.
        let markConnected!: () => void;
        const connected = new Promise<void>((resolve) => {
          markConnected = resolve;
        });
        const streamPromise = streamEvents(
          activeSessionId,
          assistant,
          commit,
          markConnected,
          responseStartedAtMs,
        );
        activeStreamRef.current = streamPromise;
        await Promise.race([
          connected,
          streamPromise.then(() => {
            throw new Error(
              "The agent event stream closed before it became ready.",
            );
          }),
        ]);
        if (stopRequestedRef.current) {
          abortRef.current?.abort();
          transition("cancelled");
          return;
        }
        const sendResponse = await fetch(
          `/api/openharness/sessions/${activeSessionId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientMessageId: userMessage.id,
              text: trimmed,
              surface,
              surfaceContext: {
                activeGardenSlug: createOptions?.gardenSlug,
                activePageSlug: createOptions?.pageSlug,
              },
              model: options?.model,
              reasoningEffort: options?.reasoningEffort,
              continuation: options?.continuation,
              attachments: options?.attachments,
              confirmedPermissionIds: options?.confirmedPermissionIds,
              retry: Boolean(resumedBlockedTurn),
              branchGroupId: options?.branchGroupId,
            }),
          },
        );
        if (!sendResponse.ok) {
          const body = await sendResponse.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The agent could not accept the message.",
          );
        }
        const responseBody = await sendResponse.json().catch(() => ({}));
        if (
          responseBody.blocked === true &&
          Array.isArray(responseBody.pendingPermissions)
        ) {
          const pending = responseBody.pendingPermissions.find(
            (value: unknown) => value && typeof value === "object",
          ) as Record<string, unknown> | undefined;
          if (!pending) {
            throw new Error("The agent paused without a permission request.");
          }
          const operations = Array.isArray(pending.operations)
            ? pending.operations.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          const path = typeof pending.path === "string" ? pending.path : undefined;
          const kind =
            pending.kind === "filesystem" ||
            pending.kind === "connection" ||
            pending.kind === "confirmation"
              ? pending.kind
              : "confirmation";
          const prompt: PermissionPrompt = {
            requestId: String(pending.id ?? "preflight-permission"),
            permission: String(pending.capability ?? "capability"),
            description: String(
              pending.message ?? "This task needs additional permission.",
            ),
            risk: operations.includes("delete")
              ? "delete"
              : operations.includes("move")
                ? "move"
                : operations.some((operation) =>
                      ["create", "modify", "write"].includes(operation),
                    )
                  ? "write"
                  : "read",
            affectedPaths: path ? [path] : [],
            allowSession: kind === "filesystem",
            preflight: { kind, path, operations },
          };
          blockedTurnRef.current = {
            text: trimmed,
            options,
            userMessageId: userMessage.id!,
            assistantMessageId: assistant.id!,
          };
          setPendingPermission(prompt);
          setActivities([
            {
              id: `permission-${prompt.requestId}`,
              kind: "permission",
              label: "Permission required",
              detail: prompt.description,
              status: "permission_required",
              startedAt: new Date().toISOString(),
            },
          ]);
          transition("waiting_for_permission");
          abortRef.current?.abort();
          await streamPromise.catch((streamError) => {
            if ((streamError as Error).name !== "AbortError") throw streamError;
          });
          return;
        }
        if (typeof responseBody.runId !== "string" || !responseBody.runId) {
          throw new Error("The agent did not return an active run id.");
        }
        activeRunIdRef.current = responseBody.runId;
        setActiveRunId(responseBody.runId);
        if (stopRequestedRef.current) {
          transition("stopping");
          await fetch(
            `/api/openharness/sessions/${activeSessionId}/abort`,
            { method: "POST" },
          ).catch(() => undefined);
        } else if (runStateRef.current !== "stopping") {
          transition("running");
        }
        const outcome = await streamPromise;
        activeRunIdRef.current = null;
        setActiveRunId(null);
        if (outcome === "cancelled") {
          setError(null);
          transition("cancelled");
        }
        else if (outcome === "failed") transition("error");
        else transition("completed");
      } catch (err) {
        abortRef.current?.abort();
        if ((err as Error).name === "AbortError") {
          if (runStateRef.current !== "cancelled") transition("idle");
          return;
        }
        setError(
          err instanceof Error ? err.message : "The agent is unavailable.",
        );
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("error");
      } finally {
        abortRef.current = null;
        activeStreamRef.current = null;
      }
    },
    [
      activeDirectory,
      createOptions,
      filesystemMode,
      messages,
      streamEvents,
      surface,
      transition,
    ],
  );

  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      const activeSessionId = sessionRef.current;
      const runId = activeRunIdRef.current;
      if (!trimmed || !activeSessionId || !runId || steeringRef.current) {
        return false;
      }

      steeringRef.current = true;
      const clientRequestId = crypto.randomUUID();
      setSteerError(null);
      transition("steering");
      try {
        const response = await fetch(
          `/api/openharness/sessions/${activeSessionId}/steer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId,
              text: trimmed,
              clientRequestId,
            }),
          },
        );
        const body = await response.json().catch(() => ({}));

        // This is the only automatic fallback: the server authoritatively says
        // the run ended before it could accept steering. Reuse the same
        // Breadboard session and let normal send create the next run.
        if (response.status === 409 && body.code === "run_not_active") {
          await activeStreamRef.current?.catch(() => undefined);
          await Promise.resolve();
          activeRunIdRef.current = null;
          setActiveRunId(null);
          if (isActiveAgentRunState(runStateRef.current)) {
            transition("completed");
          }
          void send(trimmed, latestSendOptionsRef.current);
          return true;
        }
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The course correction could not be applied.",
          );
        }

        setMessages((current) => {
          if (
            current.some(
              (message) => message.clientRequestId === clientRequestId,
            )
          ) {
            return current;
          }
          return [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "user",
              content: trimmed,
              courseCorrection: true,
              clientRequestId,
            },
          ];
        });
        setActiveInstruction(trimmed);
        if (body.mode === "follow_up" && typeof body.runId === "string") {
          void adoptDispatchedRun(activeSessionId, body.runId, trimmed);
          return true;
        }
        if (
          activeRunIdRef.current === runId &&
          runStateRef.current !== "stopping"
        ) {
          transition(
            pendingPermission ? "waiting_for_permission" : "running",
          );
        }
        return true;
      } catch (steeringError) {
        setSteerError(
          steeringError instanceof Error
            ? steeringError.message
            : "The course correction could not be applied.",
        );
        if (
          activeRunIdRef.current === runId &&
          runStateRef.current !== "stopping"
        ) {
          transition(
            pendingPermission ? "waiting_for_permission" : "running",
          );
        }
        return false;
      } finally {
        steeringRef.current = false;
      }
    },
    [adoptDispatchedRun, pendingPermission, send, transition],
  );

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const activeSessionId = sessionRef.current;
      if (!prompt || !activeSessionId) return;

      if (prompt.preflight) {
        const blocked = blockedTurnRef.current;
        if (!blocked) return;
        if (decision === "reject") {
          blockedTurnRef.current = null;
          setPendingPermission(null);
          setMessages((current) =>
            current.map((message) =>
              message.id === blocked.assistantMessageId
                ? {
                    ...message,
                    content:
                      "I didn’t access that resource because permission wasn’t granted.",
                  }
                : message,
            ),
          );
          setActivities((current) =>
            current.map((item) =>
              item.id === `permission-${prompt.requestId}`
                ? { ...item, status: "denied", completedAt: new Date().toISOString() }
                : item,
            ),
          );
          transition("completed");
          return;
        }

        let oneTimeGrantId: string | null = null;
        try {
          if (prompt.preflight.kind === "filesystem") {
            if (!prompt.preflight.path) {
              throw new Error("The permission request did not identify a folder.");
            }
            const permissions = Object.fromEntries(
              prompt.preflight.operations.map((operation) => [operation, true]),
            );
            const response = await fetch("/api/openharness/filesystem-grants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: prompt.preflight.path,
                permissions,
                scope: decision === "always" ? "remembered" : "one_time",
              }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(
                typeof body.message === "string"
                  ? body.message
                  : "The folder permission could not be saved.",
              );
            }
            if (
              decision === "once" &&
              body.grant &&
              typeof body.grant.id === "string"
            ) {
              oneTimeGrantId = body.grant.id;
            }
          }

          setPendingPermission(null);
          setActivities((current) =>
            current.map((item) =>
              item.id === `permission-${prompt.requestId}`
                ? { ...item, status: "completed", completedAt: new Date().toISOString() }
                : item,
            ),
          );
          transition("idle");
          await send(blocked.text, {
            ...blocked.options,
            confirmedPermissionIds:
              prompt.preflight.kind === "confirmation"
                ? [prompt.requestId]
                : blocked.options?.confirmedPermissionIds,
          });
        } catch (permissionError) {
          setPendingPermission(prompt);
          transition("error");
          setError(
            permissionError instanceof Error
              ? permissionError.message
              : "The permission decision failed.",
          );
        } finally {
          if (oneTimeGrantId) {
            await fetch(
              `/api/openharness/filesystem-grants?id=${encodeURIComponent(oneTimeGrantId)}`,
              { method: "DELETE" },
            ).catch(() => undefined);
          }
        }
        return;
      }

      setPendingPermission(null);
      transition("running");
      try {
        await submitPermissionDecision(
          prompt.requestId,
          activeSessionId,
          decision,
        );
      } catch (permissionError) {
        setPendingPermission(prompt);
        transition("error");
        setError(
          permissionError instanceof Error
            ? permissionError.message
            : "The permission decision failed.",
        );
        return;
      }
      setActivities((current) =>
        current.map((item) =>
          item.id === `permission-${prompt.requestId}`
            ? {
                ...item,
                status: decision === "reject" ? "denied" : "completed",
                completedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    },
    [pendingPermission, send, transition],
  );

  useEffect(() => {
    if (!yoloMode || !pendingPermission) return;
    const timer = window.setTimeout(() => {
      void respondToPermission("always");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingPermission, respondToPermission, yoloMode]);

  const abort = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    if (!isActiveAgentRunState(runStateRef.current)) return;
    setError(null);
    stopRequestedRef.current = true;
    transition("stopping");
    if (!activeSessionId || !activeRunIdRef.current) {
      abortRef.current?.abort();
      transition("cancelled");
      setPendingPermission(null);
      setActivities((current) =>
        current.map((item) =>
          item.status === "running" || item.status === "permission_required"
            ? {
                ...item,
                status: "cancelled",
                completedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      return;
    }
    try {
      const response = await fetch(
        `/api/openharness/sessions/${activeSessionId}/abort`,
        { method: "POST" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The active run could not be stopped.",
        );
      }

      if (body.alreadyFinished && body.status === "completed") {
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("completed");
        return;
      }

      if (activeStreamRef.current) {
        await Promise.race([
          activeStreamRef.current.catch(() => "failed" as const),
          new Promise<"timeout">((resolve) => {
            window.setTimeout(() => resolve("timeout"), 2_000);
          }),
        ]);
      }
      if (runStateRef.current === "stopping") {
        abortRef.current?.abort();
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("cancelled");
      }
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "The active run could not be stopped.",
      );
      transition(pendingPermission ? "waiting_for_permission" : "running");
      return;
    }
    setPendingPermission(null);
    setMessages((current) => {
      const next = [...current];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index].role === "assistant") {
          next[index] = { ...next[index], interrupted: true };
          break;
        }
      }
      return next;
    });
    setActivities((current) =>
      current.map((item) =>
        item.status === "running" || item.status === "permission_required"
          ? {
              ...item,
              status: "cancelled",
              completedAt: new Date().toISOString(),
            }
          : item,
        ),
    );
  }, [pendingPermission, transition]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    window.localStorage.removeItem("breadboard-active-conversation");
    setActiveDirectory(null);
    setMessages([]);
    transition("idle");
    activeRunIdRef.current = null;
    stopRequestedRef.current = false;
    resumedRunIdRef.current = null;
    setActiveRunId(null);
    setActiveInstruction(null);
    setSteerError(null);
    setError(null);
    setPendingPermission(null);
    setActiveTools([]);
    setActivities([]);
  }, [transition]);

  const setSessionIdExternal = useCallback((id: string | null) => {
    sessionRef.current = id;
    setSessionId(id);
    if (id) window.localStorage.setItem("breadboard-active-conversation", id);
  }, []);

  return {
    sessionId,
    activeDirectory,
    filesystemMode,
    messages,
    connection,
    runState,
    activeRunId,
    activeInstruction,
    steerError,
    error,
    pendingPermission,
    activeTools,
    activities,
    setMessages,
    setSessionId: setSessionIdExternal,
    send,
    steer,
    respondToPermission,
    abort,
    reset,
  };
}
