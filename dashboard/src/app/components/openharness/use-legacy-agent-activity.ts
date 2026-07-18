"use client";

import { useCallback, useRef, useState } from "react";
import {
  activityLabelForTool,
  evidenceKindForTool,
} from "@/lib/openharness/evidence";
import type {
  ActivityItem,
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";

type LegacyRuntimeEvent = Record<string, unknown> & { type?: string };

export function useLegacyAgentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [pendingPermission, setPendingPermission] =
    useState<PermissionPrompt | null>(null);
  const runtimeSessionId = useRef<number | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    const controller = new AbortController();
    requestController.current = controller;
    runtimeSessionId.current = null;
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

  const handleEvent = useCallback((event: LegacyRuntimeEvent) => {
    if (event.type === "runtime") {
      const id = Number(event.sessionId);
      if (Number.isInteger(id) && id > 0) runtimeSessionId.current = id;
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

  const finish = useCallback((failed = false) => {
    requestController.current = null;
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
      void fetch(`/api/openharness/sessions/${id}/abort`, {
        method: "POST",
      }).catch(() => undefined);
    setPendingPermission(null);
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

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const sessionId = runtimeSessionId.current;
      if (!prompt || !sessionId) return;
      let response: Response;
      try {
        response = await fetch(
          `/api/openharness/permissions/${encodeURIComponent(prompt.requestId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, decision }),
          },
        );
      } catch {
        setConnection("error");
        return;
      }
      if (!response.ok) {
        setConnection("error");
        setActivities((current) =>
          current.map((item) =>
            item.id === `permission-${prompt.requestId}`
              ? {
                  ...item,
                  detail: `Permission response failed (${response.status}).`,
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

  return {
    activities,
    connection,
    pendingPermission,
    start,
    handleEvent,
    finish,
    abort,
    respondToPermission,
  };
}
