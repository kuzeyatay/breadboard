"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isYoloModeEnabled, useYoloMode } from "@/app/components/use-yolo-mode";
import {
  activityLabelForTool,
  evidenceKindForTool,
} from "@/lib/hermes/evidence";
import type {
  ActivityItem,
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";
import { submitPermissionDecision } from "./permission-client";

type LegacyRuntimeEvent = Record<string, unknown> & { type?: string };

export function useLegacyAgentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [pendingPermission, setPendingPermission] =
    useState<PermissionPrompt | null>(null);
  const runtimeSessionId = useRef<number | null>(null);
  const runtimeRunId = useRef<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const [yoloMode] = useYoloMode();

  const start = useCallback(() => {
    const controller = new AbortController();
    requestController.current = controller;
    runtimeSessionId.current = null;
    runtimeRunId.current = null;
    setPendingPermission(null);
    setConnection("connecting");
    setActivities([
      {
        id: "reasoning",
        kind: "reasoning",
        label: "Thinking",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ]);
    return controller.signal;
  }, []);

  const handleEvent = useCallback((
    event: LegacyRuntimeEvent,
    ownerSignal?: AbortSignal,
  ) => {
    if (
      ownerSignal &&
      requestController.current?.signal !== ownerSignal
    ) {
      return;
    }
    if (event.type === "runtime") {
      const id = Number(event.sessionId);
      if (Number.isInteger(id) && id > 0) runtimeSessionId.current = id;
      runtimeRunId.current =
        typeof event.runId === "string" && event.runId.trim()
          ? event.runId.trim()
          : null;
      setConnection("streaming");
      return;
    }
    if (event.type === "tool") {
      const toolName =
        typeof event.toolName === "string" ? event.toolName : "tool";
      const id =
        typeof event.toolCallId === "string"
          ? event.toolCallId
          : `${toolName}-${Date.now()}`;
      const status =
        event.status === "failed"
          ? "failed"
          : event.status === "completed"
            ? "completed"
            : "running";
      setActivities((current) => {
        const existing = current.find((item) => item.id === `tool-${id}`);
        const item: ActivityItem = {
          id: `tool-${id}`,
          kind: evidenceKindForTool(toolName),
          label: activityLabelForTool(toolName),
          detail: typeof event.summary === "string" ? event.summary : toolName,
          status,
          startedAt: existing?.startedAt ?? new Date().toISOString(),
          ...(status === "running"
            ? {}
            : { completedAt: new Date().toISOString() }),
          toolCallId: id,
        };
        return existing
          ? current.map((candidate) =>
              candidate.id === item.id ? item : candidate,
            )
          : [...current, item];
      });
      return;
    }
    if (event.type?.startsWith("artifact.")) {
      const artifactId =
        typeof event.artifactId === "string" ? event.artifactId : null;
      if (!artifactId) return;
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : {};
      setActivities((current) => {
        const id = `artifact-${artifactId}`;
        const existing = current.find((item) => item.id === id);
        const title =
          typeof metadata.title === "string" && metadata.title.trim()
            ? metadata.title.trim()
            : existing?.detail || "artifact";
        const failed =
          event.type === "artifact.failed" || event.status === "failed";
        const completed =
          event.type === "artifact.completed" || event.status === "ready";
        const item: ActivityItem = {
          id,
          kind: "artifact",
          label: failed ? `Could not build ${title}` : `Building ${title}…`,
          detail: title,
          status: failed ? "failed" : completed ? "completed" : "running",
          startedAt: existing?.startedAt ?? new Date().toISOString(),
          ...(failed || completed
            ? { completedAt: new Date().toISOString() }
            : {}),
        };
        return existing
          ? current.map((candidate) => (candidate.id === id ? item : candidate))
          : [...current, item];
      });
      return;
    }
    if (event.type === "permission") {
      const requestId =
        typeof event.requestId === "string" ? event.requestId : "";
      if (!requestId) return;
      const prompt: PermissionPrompt = {
        requestId,
        permission:
          typeof event.permission === "string" ? event.permission : "unknown",
        description:
          typeof event.description === "string"
            ? event.description
            : "The agent requested permission.",
        risk:
          event.risk === "overwrite" ||
          event.risk === "delete" ||
          event.risk === "sensitive" ||
          event.risk === "execute" ||
          event.risk === "write" ||
          event.risk === "move" ||
          event.risk === "network" ||
          event.risk === "install"
            ? event.risk
            : "network",
        affectedPaths: Array.isArray(event.affectedPaths)
          ? event.affectedPaths.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        command: typeof event.command === "string" ? event.command : undefined,
        sourcePath:
          typeof event.sourcePath === "string" ? event.sourcePath : undefined,
        destinationPath:
          typeof event.destinationPath === "string"
            ? event.destinationPath
            : undefined,
        allowSession: event.allowSession === true,
      };
      if (isYoloModeEnabled()) {
        const sessionId = runtimeSessionId.current;
        setPendingPermission(null);
        if (!sessionId) {
          setConnection("error");
          return;
        }
        setConnection("streaming");
        void submitPermissionDecision(requestId, sessionId, "once").catch(
          () => setConnection("error"),
        );
        return;
      }
      setPendingPermission(prompt);
      setConnection("waiting");
      setActivities((current) => [
        ...current,
        {
          id: `permission-${requestId}`,
          kind: "permission",
          label: prompt.description,
          detail: prompt.affectedPaths.join(", ") || prompt.command,
          status: "permission_required",
          startedAt: new Date().toISOString(),
        },
      ]);
    }
  }, []);

  const finish = useCallback((
    failed = false,
    ownerSignal?: AbortSignal,
  ) => {
    if (
      ownerSignal &&
      requestController.current?.signal !== ownerSignal
    ) {
      return;
    }
    requestController.current = null;
    runtimeRunId.current = null;
    setPendingPermission(null);
    setConnection(failed ? "error" : "idle");
    setActivities((current) =>
      current.map((item) =>
        item.status === "running"
          ? {
              ...item,
              status: failed ? "failed" : "completed",
              completedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }, []);

  const abort = useCallback(() => {
    requestController.current?.abort();
    const id = runtimeSessionId.current;
    if (id)
      void fetch(`/api/hermes/sessions/${id}/abort`, {
        method: "POST",
      }).catch(() => undefined);
    setPendingPermission(null);
    runtimeRunId.current = null;
    setConnection("idle");
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

  const steer = useCallback(async (text: string): Promise<boolean> => {
    const sessionId = runtimeSessionId.current;
    const runId = runtimeRunId.current;
    const trimmed = text.trim();
    if (!sessionId || !runId || !trimmed) return false;

    const response = await fetch(`/api/hermes/sessions/${sessionId}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        text: trimmed,
        clientRequestId: crypto.randomUUID(),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      accepted?: boolean;
      code?: string;
      error?: string | { message?: string };
    };
    if (response.status === 409 && body.code === "run_not_active") return false;
    if (!response.ok || body.accepted !== true) {
      const message =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? "Could not steer the active response.";
      throw new Error(message);
    }
    return true;
  }, []);

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const sessionId = runtimeSessionId.current;
      if (!prompt || !sessionId) return;
      try {
        await submitPermissionDecision(
          prompt.requestId,
          sessionId,
          decision,
        );
      } catch {
        setConnection("error");
        setActivities((current) =>
          current.map((item) =>
            item.id === `permission-${prompt.requestId}`
              ? {
                  ...item,
                  detail: "Permission response failed.",
                }
              : item,
          ),
        );
        return;
      }
      setPendingPermission(null);
      setConnection("streaming");
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
      void respondToPermission("once");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingPermission, respondToPermission, yoloMode]);

  return {
    activities,
    connection,
    pendingPermission,
    start,
    handleEvent,
    finish,
    abort,
    steer,
    respondToPermission,
  };
}
