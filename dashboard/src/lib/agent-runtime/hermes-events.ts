import type {
  NormalizedAgentEvent,
  PermissionRisk,
} from "../openharness/events.ts";

export interface RawHermesEvent {
  type: string;
  session_id?: string;
  payload?: unknown;
}

export interface HermesEventNormalizationState {
  assistantText: string;
}

export function createHermesEventNormalizationState(): HermesEventNormalizationState {
  return { assistantText: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function now(): string {
  return new Date().toISOString();
}

function safeSingleLine(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  return text && text.length <= 2_000 && !/[\r\n]/.test(text)
    ? text
    : undefined;
}

function approvalRisk(command: string, description: string): PermissionRisk {
  const text = `${command} ${description}`.toLowerCase();
  if (/credential|secret|token|ssh|browser profile/.test(text)) {
    return "sensitive";
  }
  if (/\b(delete|remove|rm|rmdir|clean)\b/.test(text)) return "delete";
  if (/\b(overwrite|replace)\b/.test(text)) return "overwrite";
  if (/\b(move|rename|mv)\b/.test(text)) return "move";
  if (/\b(install|dependency|package)\b/.test(text)) return "install";
  if (/\b(curl|wget|fetch|http|network)\b/.test(text)) return "network";
  return "execute";
}

function toolSucceeded(payload: Record<string, unknown>): boolean {
  if (typeof payload.success === "boolean") return payload.success;
  if (typeof payload.is_error === "boolean") return !payload.is_error;
  if (asString(payload.error)?.trim()) return false;
  if (isRecord(payload.result)) {
    if (typeof payload.result.success === "boolean") {
      return payload.result.success;
    }
    if (asString(payload.result.error)?.trim()) return false;
  }
  return true;
}

function terminalStatus(
  value: unknown,
): "idle" | "aborted" | "failed" {
  switch (asString(value)?.toLowerCase()) {
    case "interrupted":
    case "aborted":
    case "cancelled":
      return "aborted";
    case "error":
    case "failed":
    case "partial":
      return "failed";
    default:
      return "idle";
  }
}

/**
 * Translate one Hermes JSON-RPC gateway event into Breadboard's existing
 * normalized event contract. One Hermes terminal frame becomes both an
 * assistant completion and a terminal session status, so callers receive an
 * array rather than a single nullable event.
 */
export function normalizeHermesEvent(
  raw: RawHermesEvent,
  liveSessionId: string,
  publicSessionId: string,
  state: HermesEventNormalizationState,
): NormalizedAgentEvent[] {
  if (raw.session_id && raw.session_id !== liveSessionId) return [];
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const timestamp = now();

  switch (raw.type) {
    case "message.start":
      state.assistantText = "";
      return [{
        type: "session.status",
        sessionId: publicSessionId,
        timestamp,
        payload: { status: "busy" },
      }];

    case "message.delta": {
      const text = asString(payload.text) ?? "";
      if (!text) return [];
      state.assistantText += text;
      return [{
        type: "assistant.delta",
        sessionId: publicSessionId,
        timestamp,
        payload: { text },
      }];
    }

    case "thinking.delta":
    case "reasoning.delta":
    case "reasoning.available": {
      const detail = asString(payload.text)?.trim();
      if (!detail) return [];
      return [{
        type: "reasoning.status",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          label: "Thinking",
          detail,
          detailMode:
            raw.type === "reasoning.available" ? "replace" : "append",
        },
      }];
    }

    case "status.update": {
      const detail = asString(payload.text)?.trim();
      if (!detail) return [];
      return [{
        type: "reasoning.status",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          label: detail,
          detailMode: "replace",
        },
      }];
    }

    case "tool.start": {
      const toolName = asString(payload.name) ?? "tool";
      return [{
        type: "tool.started",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          toolCallId:
            asString(payload.tool_id) ??
            `${toolName}:${timestamp}`,
          toolName,
          summary:
            safeSingleLine(payload.context) ??
            safeSingleLine(payload.args_text),
          location: safeSingleLine(payload.context),
        },
      }];
    }

    case "tool.complete": {
      const toolName = asString(payload.name) ?? "tool";
      return [{
        type: "tool.completed",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          toolCallId:
            asString(payload.tool_id) ??
            `${toolName}:${timestamp}`,
          toolName,
          success: toolSucceeded(payload),
          summary:
            safeSingleLine(payload.summary) ??
            safeSingleLine(payload.error),
        },
      }];
    }

    case "approval.request": {
      const command = asString(payload.command)?.trim() ?? "";
      const description =
        asString(payload.description)?.trim() ||
        "Permission is required to continue.";
      const choices = Array.isArray(payload.choices)
        ? payload.choices.filter((value): value is string =>
            typeof value === "string"
          )
        : [];
      const risk = approvalRisk(command, description);
      return [{
        type: "permission.requested",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          requestId:
            asString(payload.request_id) ??
            asString(payload.id) ??
            `${publicSessionId}:approval`,
          permission: "execute",
          description,
          risk,
          affectedPaths: [],
          ...(command ? { command } : {}),
          allowSession:
            choices.length === 0 ||
            choices.includes("session") ||
            choices.includes("always"),
        },
      }];
    }

    case "message.complete": {
      const fullText = asString(payload.text) ?? "";
      const events: NormalizedAgentEvent[] = [];
      if (fullText && fullText !== state.assistantText) {
        const residual = fullText.startsWith(state.assistantText)
          ? fullText.slice(state.assistantText.length)
          : state.assistantText
            ? ""
            : fullText;
        if (residual) {
          state.assistantText += residual;
          events.push({
            type: "assistant.delta",
            sessionId: publicSessionId,
            timestamp,
            payload: { text: residual },
          });
        }
      }
      events.push({
        type: "assistant.completed",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          usage: payload.usage,
          ...(asString(payload.reasoning)
            ? { reasoning: payload.reasoning }
            : {}),
        },
      });
      events.push({
        type: "session.status",
        sessionId: publicSessionId,
        timestamp,
        payload: { status: terminalStatus(payload.status) },
      });
      return events;
    }

    case "error": {
      const message =
        asString(payload.message)?.trim() ||
        "The Hermes agent runtime reported an error.";
      return [
        {
          type: "error",
          sessionId: publicSessionId,
          timestamp,
          payload: {
            code: asString(payload.code) ?? "hermes_error",
            message,
            recoverable: true,
          },
        },
        {
          type: "session.status",
          sessionId: publicSessionId,
          timestamp,
          payload: { status: "failed" },
        },
      ];
    }

    default:
      return [];
  }
}
