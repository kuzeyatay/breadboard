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

import { useCallback, useRef, useState } from "react";

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
  risk?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sources?: string[];
  tools?: ToolActivity[];
  proposal?: unknown;
}

export type ConnectionState = "idle" | "connecting" | "streaming" | "waiting" | "error";

interface CreateOptions {
  gardenSlug?: string;
  pageSlug?: string;
  title?: string;
}

export interface UseAgentSessionResult {
  sessionId: number | null;
  messages: AgentMessage[];
  connection: ConnectionState;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activeTools: ToolActivity[];
  setMessages: (messages: AgentMessage[]) => void;
  setSessionId: (id: number | null) => void;
  send: (text: string, options?: { model?: { providerID: string; modelID: string } }) => Promise<void>;
  respondToPermission: (decision: "once" | "always" | "reject") => Promise<void>;
  abort: () => Promise<void>;
  reset: () => void;
}

async function ensureSession(
  surface: AgentSurface,
  options: CreateOptions | undefined,
  currentId: number | null,
): Promise<number> {
  if (currentId) return currentId;
  const response = await fetch("/api/openharness/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surface, ...options }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "Could not start an agent session.");
  }
  const data = await response.json();
  return data.session.id as number;
}

export function useAgentSession(surface: AgentSurface, createOptions?: CreateOptions): UseAgentSessionResult {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionPrompt | null>(null);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<number | null>(null);

  const streamEvents = useCallback(
    async (activeSessionId: number, assistant: AgentMessage, commit: (message: AgentMessage) => void) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(`/api/openharness/sessions/${activeSessionId}/events`, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error("Could not open the agent event stream.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const tools = new Map<string, ToolActivity>();

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
              assistant = { ...assistant, content: assistant.content + String(payload.text ?? "") };
              commit(assistant);
              break;
            case "reasoning.status":
              assistant = { ...assistant, reasoning: (assistant.reasoning ?? "") + String(payload.detail ?? "") };
              commit(assistant);
              break;
            case "tool.started":
              tools.set(String(payload.toolCallId), {
                toolCallId: String(payload.toolCallId),
                toolName: String(payload.toolName),
                summary: payload.summary as string | undefined,
                status: "running",
              });
              setActiveTools(Array.from(tools.values()));
              flushAssistant();
              break;
            case "tool.completed": {
              const id = String(payload.toolCallId);
              const existing = tools.get(id);
              tools.set(id, {
                toolCallId: id,
                toolName: String(payload.toolName),
                summary: (payload.summary as string | undefined) ?? existing?.summary,
                status: payload.success ? "completed" : "failed",
              });
              setActiveTools(Array.from(tools.values()));
              flushAssistant();
              break;
            }
            case "permission.requested":
              setPendingPermission({
                requestId: String(payload.requestId),
                permission: String(payload.permission),
                description: String(payload.description),
                risk: payload.risk as string | undefined,
              });
              setConnection("waiting");
              break;
            case "session.status":
              if (payload.status === "waiting") setConnection("waiting");
              else if (payload.status === "busy") setConnection("streaming");
              break;
            case "error":
              setError(String(payload.message ?? "The agent reported an error."));
              break;
            case "done":
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
    async (text: string, options?: { model?: { providerID: string; modelID: string } }) => {
      const trimmed = text.trim();
      if (!trimmed || connection === "streaming" || connection === "connecting") return;
      setError(null);
      setConnection("connecting");
      setActiveTools([]);

      const userMessage: AgentMessage = { role: "user", content: trimmed };
      const assistant: AgentMessage = { role: "assistant", content: "", sources: [], tools: [] };
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
        const activeSessionId = await ensureSession(surface, createOptions, sessionRef.current);
        sessionRef.current = activeSessionId;
        setSessionId(activeSessionId);
        setConnection("streaming");

        // Open the event stream, then dispatch the message so no early deltas are
        // missed. The stream stays open until the turn goes idle.
        const streamPromise = streamEvents(activeSessionId, assistant, commit);
        const sendResponse = await fetch(`/api/openharness/sessions/${activeSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, model: options?.model }),
        });
        if (!sendResponse.ok) {
          const body = await sendResponse.json().catch(() => ({}));
          throw new Error(typeof body.error === "string" ? body.error : "The agent could not accept the message.");
        }
        await streamPromise;
        setConnection("idle");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setConnection("idle");
          return;
        }
        setError(err instanceof Error ? err.message : "The agent is unavailable.");
        setConnection("error");
      } finally {
        abortRef.current = null;
      }
    },
    [connection, messages, surface, createOptions, streamEvents],
  );

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const activeSessionId = sessionRef.current;
      if (!prompt || !activeSessionId) return;
      setPendingPermission(null);
      setConnection("streaming");
      await fetch(`/api/openharness/permissions/${encodeURIComponent(prompt.requestId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId, decision }),
      }).catch(() => undefined);
    },
    [pendingPermission],
  );

  const abort = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    abortRef.current?.abort();
    if (activeSessionId) {
      await fetch(`/api/openharness/sessions/${activeSessionId}/abort`, { method: "POST" }).catch(
        () => undefined,
      );
    }
    setConnection("idle");
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    setMessages([]);
    setConnection("idle");
    setError(null);
    setPendingPermission(null);
    setActiveTools([]);
  }, []);

  const setSessionIdExternal = useCallback((id: number | null) => {
    sessionRef.current = id;
    setSessionId(id);
  }, []);

  return {
    sessionId,
    messages,
    connection,
    error,
    pendingPermission,
    activeTools,
    setMessages,
    setSessionId: setSessionIdExternal,
    send,
    respondToPermission,
    abort,
    reset,
  };
}
