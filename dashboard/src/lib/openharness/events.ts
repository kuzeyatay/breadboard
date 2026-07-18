// Normalized agent-event contract shared between the Breadboard backend and all
// three interactive UIs, plus the translation from OpenHarness's raw event
// stream into that contract.
//
// OpenHarness (an OpenCode fork) emits a single instance-wide SSE stream of
// events shaped `{ id, type, properties }`. The gateway subscribes with a
// `directory` filter (so it only sees one workspace's events) and then this
// module further narrows to a single session and reshapes each raw event into a
// `NormalizedAgentEvent`. UIs never see raw OpenHarness JSON.

export type NormalizedAgentEvent =
  | {
      type: "assistant.delta";
      sessionId: string;
      messageId?: string;
      timestamp: string;
      payload: { text: string };
    }
  | {
      type: "assistant.completed";
      sessionId: string;
      messageId?: string;
      timestamp: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "reasoning.status";
      sessionId: string;
      timestamp: string;
      payload: { label: string; detail?: string };
    }
  | {
      type: "tool.started";
      sessionId: string;
      timestamp: string;
      payload: {
        toolCallId: string;
        toolName: string;
        summary?: string;
        arguments?: unknown;
      };
    }
  | {
      type: "tool.completed";
      sessionId: string;
      timestamp: string;
      payload: {
        toolCallId: string;
        toolName: string;
        success: boolean;
        summary?: string;
        result?: unknown;
      };
    }
  | {
      type: "permission.requested";
      sessionId: string;
      timestamp: string;
      payload: {
        requestId: string;
        permission: string;
        description: string;
        risk?: string;
        details?: unknown;
      };
    }
  | {
      type: "session.status";
      sessionId: string;
      timestamp: string;
      payload: {
        status: "idle" | "busy" | "waiting" | "aborted" | "failed";
      };
    }
  | {
      type: "error";
      sessionId: string;
      timestamp: string;
      payload: {
        code: string;
        message: string;
        recoverable: boolean;
      };
    };

export type NormalizedAgentEventType = NormalizedAgentEvent["type"];

export interface RawOpenHarnessEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Best-effort extraction of the session id from a raw event's properties.
 * OpenHarness events carry either `sessionID` (most session events) or nest it
 * inside `info`/`part`/`item`. Returning undefined means "not attributable to a
 * session" and such events are dropped by the session filter.
 */
export function extractSessionId(raw: RawOpenHarnessEvent): string | undefined {
  const props = raw.properties;
  if (!isRecord(props)) return undefined;
  const direct = asString(props.sessionID) ?? asString(props.sessionId);
  if (direct) return direct;
  for (const key of ["info", "part", "item", "message", "permission"]) {
    const nested = props[key];
    if (isRecord(nested)) {
      const id = asString(nested.sessionID) ?? asString(nested.sessionId);
      if (id) return id;
    }
  }
  return undefined;
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Translate one raw OpenHarness event into zero or one normalized events for
 * the given session. Events for other sessions, and event types we do not
 * surface, return null. This is a pure function so it can be unit-tested and
 * reused by every surface without touching the network.
 */
export function normalizeOpenHarnessEvent(
  raw: RawOpenHarnessEvent,
  sessionId: string,
): NormalizedAgentEvent | null {
  const props = isRecord(raw.properties) ? raw.properties : {};
  const eventSession = extractSessionId(raw);

  // Session-scoped events for a different session are not ours.
  if (eventSession && eventSession !== sessionId) return null;

  switch (raw.type) {
    case "message.part.delta": {
      const field = asString(props.field);
      const delta = asString(props.delta) ?? "";
      if (!delta) return null;
      if (field === "reasoning") {
        return {
          type: "reasoning.status",
          sessionId,
          timestamp: timestamp(),
          payload: { label: "Thinking", detail: delta },
        };
      }
      // Any text-ish field (text, content) is streamed assistant output.
      if (field === undefined || field === "text" || field === "content") {
        return {
          type: "assistant.delta",
          sessionId,
          messageId: asString(props.messageID) ?? asString(props.messageId),
          timestamp: timestamp(),
          payload: { text: delta },
        };
      }
      return null;
    }

    case "message.part.updated": {
      // Tool activity arrives as an updated `tool` part with a nested state.
      const part = isRecord(props.part) ? props.part : undefined;
      if (!part || asString(part.type) !== "tool") return null;
      const state = isRecord(part.state) ? part.state : undefined;
      const status = asString(state?.status);
      const toolName = asString(part.tool) ?? "tool";
      const toolCallId = asString(part.callID) ?? asString(part.id) ?? toolName;
      if (status === "running" || status === "pending") {
        return {
          type: "tool.started",
          sessionId,
          timestamp: timestamp(),
          payload: {
            toolCallId,
            toolName,
            summary: asString(state?.title),
            arguments: state?.input,
          },
        };
      }
      if (status === "completed" || status === "error") {
        return {
          type: "tool.completed",
          sessionId,
          timestamp: timestamp(),
          payload: {
            toolCallId,
            toolName,
            success: status === "completed",
            summary: asString(state?.title),
            result: status === "error" ? state?.error : state?.output,
          },
        };
      }
      return null;
    }

    case "message.updated": {
      const info = isRecord(props.info) ? props.info : props;
      const role = asString(info.role);
      // Only surface completion when an assistant message finalizes.
      const time = isRecord(info.time) ? info.time : undefined;
      if (role === "assistant" && time && time.completed !== undefined) {
        return {
          type: "assistant.completed",
          sessionId,
          messageId: asString(info.id),
          timestamp: timestamp(),
          payload: { usage: (info as Record<string, unknown>).tokens ?? undefined },
        };
      }
      return null;
    }

    case "permission.asked":
    case "permission.updated": {
      const info = isRecord(props.info) ? props.info : props;
      const requestId = asString(info.id) ?? asString(props.id);
      if (!requestId) return null;
      return {
        type: "permission.requested",
        sessionId,
        timestamp: timestamp(),
        payload: {
          requestId,
          permission: asString(info.type) ?? asString(info.permission) ?? "unknown",
          description:
            asString(info.title) ??
            asString(info.description) ??
            `Permission requested: ${asString(info.type) ?? "action"}`,
          risk: asString(info.risk),
          details: info.metadata ?? info.pattern,
        },
      };
    }

    case "session.status": {
      const info = isRecord(props.info) ? props.info : props;
      const rawStatus = asString(info.status) ?? asString(props.status);
      return {
        type: "session.status",
        sessionId,
        timestamp: timestamp(),
        payload: { status: mapStatus(rawStatus) },
      };
    }

    case "session.idle": {
      return {
        type: "session.status",
        sessionId,
        timestamp: timestamp(),
        payload: { status: "idle" },
      };
    }

    case "session.error": {
      const error = isRecord(props.error) ? props.error : undefined;
      const errorData = isRecord(error?.data) ? error.data : undefined;
      return {
        type: "error",
        sessionId,
        timestamp: timestamp(),
        payload: {
          code: asString(error?.name) ?? asString(props.name) ?? "session_error",
          message:
            asString(error?.message) ??
            asString(errorData?.message) ??
            asString(props.message) ??
            "The agent reported an error.",
          recoverable: false,
        },
      };
    }

    default:
      return null;
  }
}

function mapStatus(raw: string | undefined): "idle" | "busy" | "waiting" | "aborted" | "failed" {
  switch (raw) {
    case "idle":
      return "idle";
    case "waiting":
    case "waiting_permission":
      return "waiting";
    case "aborted":
      return "aborted";
    case "error":
    case "failed":
      return "failed";
    case "busy":
    case "running":
    case "working":
    default:
      return "busy";
  }
}

/** Serialize a normalized event as an SSE `data:` frame. */
export function encodeSseEvent(event: NormalizedAgentEvent | { type: string; [k: string]: unknown }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
