"use client";

// Client-side hook that drives an OpenHarness-backed agent session for any of
// the three surfaces (terminal, garden chat, Quartz AI). It owns the runtime
// session lifecycle, streaming, tool activity, permission prompts, abort, and
// reconnect state — so surface components stay thin and none of this logic
// lands in dashboard-client.tsx.
//
// The browser only ever talks to Breadboard's /api/openharness/* routes. It
// references sessions by their Breadboard runtime-session id; the OpenHarness
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
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sources?: string[];
  tools?: ToolActivity[];
  proposal?: unknown;
  usage?: ChatTokenUsage;
  verification?: VerificationSummary;
}

export interface SkillContinuation {
  parentTaskId: string;
  skillId: string;
  capability: string;
  approvedPermissions: string[];
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
      if (usage) return { ...message, usage };
      const messageWithoutUsage = { ...message };
      delete messageWithoutUsage.usage;
      return messageWithoutUsage;
    });
}

export type ConnectionState =
  "idle" | "connecting" | "streaming" | "waiting" | "error";

interface CreateOptions {
  gardenSlug?: string;
  pageSlug?: string;
  title?: string;
}

export interface UseAgentSessionResult {
  sessionId: number | null;
  activeDirectory: string | null;
  filesystemMode: "restricted" | "full";
  messages: AgentMessage[];
  connection: ConnectionState;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activeTools: ToolActivity[];
  activities: ActivityItem[];
  setMessages: (messages: AgentMessage[]) => void;
  setSessionId: (id: number | null) => void;
  send: (
    text: string,
    options?: {
      model?: string;
      reasoningEffort?: AssistantReasoningEffort;
      continuation?: SkillContinuation;
      attachments?: ChatAttachment[];
    },
  ) => Promise<void>;
  respondToPermission: (
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  abort: () => Promise<void>;
  reset: () => void;
}

async function ensureSession(
  surface: AgentSurface,
  options: CreateOptions | undefined,
  currentId: number | null,
  current: {
    activeDirectory: string | null;
    filesystemMode: "restricted" | "full";
  },
): Promise<{
  id: number;
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
    id: data.session.id as number,
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
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null);
  const [filesystemMode, setFilesystemMode] = useState<"restricted" | "full">(
    "restricted",
  );
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionPrompt | null>(null);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<number | null>(null);
  const [yoloMode] = useYoloMode();

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
        const restored = sessions.find(
          (candidate: { gardenId?: unknown; pageSlug?: unknown }) =>
            (!createOptions?.gardenSlug ||
              candidate.gardenId === createOptions.gardenSlug) &&
            (!createOptions?.pageSlug ||
              candidate.pageSlug === createOptions.pageSlug),
        );
        if (!restored || !Number.isInteger(restored.id)) return;
        sessionRef.current = restored.id;
        setSessionId(restored.id);
        setActiveDirectory(
          typeof restored.activeDirectory === "string"
            ? restored.activeDirectory
            : null,
        );
        setFilesystemMode(
          restored.filesystemMode === "full" ? "full" : "restricted",
        );
        setMessages(normalizeRestoredMessages(restored.messages));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [surface, createOptions?.gardenSlug, createOptions?.pageSlug]);

  const streamEvents = useCallback(
    async (
      activeSessionId: number,
      assistant: AgentMessage,
      commit: (message: AgentMessage) => void,
      onConnected: () => void,
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(
        `/api/openharness/sessions/${activeSessionId}/events`,
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
      const tools = new Map<string, ToolActivity>();
      const upsertActivity = (item: ActivityItem) => {
        setActivities((current) => {
          const index = current.findIndex(
            (candidate) => candidate.id === item.id,
          );
          if (index < 0) return [...current, item];
          const next = [...current];
          next[index] = { ...next[index], ...item };
          return next;
        });
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
                setConnection("streaming");
                try {
                  await submitPermissionDecision(
                    prompt.requestId,
                    activeSessionId,
                    "always",
                  );
                } catch (permissionError) {
                  setConnection("error");
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
              setConnection("waiting");
              break;
            }
            case "session.status":
              if (payload.status === "waiting") setConnection("waiting");
              else if (payload.status === "busy") setConnection("streaming");
              break;
            case "error":
              setError(
                String(payload.message ?? "The agent reported an error."),
              );
              break;
            case "verification.updated":
              assistant = {
                ...assistant,
                verification: payload as unknown as VerificationSummary,
              };
              commit(assistant);
              break;
            case "cancelled":
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
              return;
            case "done":
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
              return;
            default:
              break;
          }
        }
      }
    },
    [],
  );

  const send = useCallback(
    async (
      text: string,
      options?: {
        model?: string;
        reasoningEffort?: AssistantReasoningEffort;
        continuation?: SkillContinuation;
        attachments?: ChatAttachment[];
      },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || connection === "streaming" || connection === "connecting")
        return;
      setError(null);
      setConnection("connecting");
      setActiveTools([]);
      setActivities([
        {
          id: "reasoning",
          kind: "reasoning",
          label: "Thinking",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ]);

      const userMessage: AgentMessage = { role: "user", content: trimmed };
      const assistant: AgentMessage = {
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
      };
      const baseline = [...messages, userMessage, assistant];
      setMessages(baseline);

      const commit = (message: AgentMessage) => {
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { ...message };
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
        sessionRef.current = activeSessionId;
        setSessionId(activeSessionId);
        setActiveDirectory(ensured.activeDirectory);
        setFilesystemMode(ensured.filesystemMode);
        setConnection("streaming");

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
        );
        await Promise.race([
          connected,
          streamPromise.then(() => {
            throw new Error(
              "The agent event stream closed before it became ready.",
            );
          }),
        ]);
        const sendResponse = await fetch(
          `/api/openharness/sessions/${activeSessionId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: trimmed,
              model: options?.model,
              reasoningEffort: options?.reasoningEffort,
              continuation: options?.continuation,
              attachments: options?.attachments,
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
        await streamPromise;
        setConnection("idle");
      } catch (err) {
        abortRef.current?.abort();
        if ((err as Error).name === "AbortError") {
          setConnection("idle");
          return;
        }
        setError(
          err instanceof Error ? err.message : "The agent is unavailable.",
        );
        setConnection("error");
      } finally {
        abortRef.current = null;
      }
    },
    [
      activeDirectory,
      connection,
      createOptions,
      filesystemMode,
      messages,
      streamEvents,
      surface,
    ],
  );

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const activeSessionId = sessionRef.current;
      if (!prompt || !activeSessionId) return;
      setPendingPermission(null);
      setConnection("streaming");
      try {
        await submitPermissionDecision(
          prompt.requestId,
          activeSessionId,
          decision,
        );
      } catch (permissionError) {
        setPendingPermission(prompt);
        setConnection("error");
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
    [pendingPermission],
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
    abortRef.current?.abort();
    if (activeSessionId) {
      await fetch(`/api/openharness/sessions/${activeSessionId}/abort`, {
        method: "POST",
      }).catch(() => undefined);
    }
    setConnection("idle");
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
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    setActiveDirectory(null);
    setMessages([]);
    setConnection("idle");
    setError(null);
    setPendingPermission(null);
    setActiveTools([]);
    setActivities([]);
  }, []);

  const setSessionIdExternal = useCallback((id: number | null) => {
    sessionRef.current = id;
    setSessionId(id);
  }, []);

  return {
    sessionId,
    activeDirectory,
    filesystemMode,
    messages,
    connection,
    error,
    pendingPermission,
    activeTools,
    activities,
    setMessages,
    setSessionId: setSessionIdExternal,
    send,
    respondToPermission,
    abort,
    reset,
  };
}
