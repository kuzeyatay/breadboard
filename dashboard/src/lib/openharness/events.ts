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
        location?: string;
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
        location?: string;
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
        risk: PermissionRisk;
        affectedPaths: string[];
        command?: string;
        sourcePath?: string;
        destinationPath?: string;
        allowSession: boolean;
      };
    }
  | {
      type: "verification.updated";
      sessionId: string;
      timestamp: string;
      payload: {
        state:
          | "verified"
          | "partially_verified"
          | "unverified"
          | "contradicted"
          | "not_applicable";
        evidence: unknown[];
        unsupportedClaims: string[];
        assumptions: string[];
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

export type PermissionRisk =
  | "write"
  | "overwrite"
  | "move"
  | "delete"
  | "execute"
  | "network"
  | "sensitive"
  | "install";

export interface RawOpenHarnessEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface OpenHarnessEventNormalizationState {
  reasoningPartIds: Set<string>;
}

export function createOpenHarnessEventNormalizationState(): OpenHarnessEventNormalizationState {
  return { reasoningPartIds: new Set<string>() };
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
 * surface, return null. A per-subscription state lets us distinguish text
 * deltas belonging to OpenHarness reasoning parts from assistant answer text.
 */
export function normalizeOpenHarnessEvent(
  raw: RawOpenHarnessEvent,
  sessionId: string,
  normalizationState?: OpenHarnessEventNormalizationState,
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
      const partId = asString(props.partID) ?? asString(props.partId);
      const isReasoningDelta =
        field === "reasoning" ||
        (field === "text" &&
          Boolean(partId && normalizationState?.reasoningPartIds.has(partId)));
      if (isReasoningDelta) {
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
      const part = isRecord(props.part) ? props.part : undefined;
      if (!part) return null;
      const partType = asString(part.type);
      if (partType === "reasoning") {
        const partId = asString(part.id);
        if (partId && normalizationState) {
          const time = isRecord(part.time) ? part.time : undefined;
          if (time?.end !== undefined) {
            normalizationState.reasoningPartIds.delete(partId);
          } else {
            normalizationState.reasoningPartIds.add(partId);
          }
        }
        return {
          type: "reasoning.status",
          sessionId,
          timestamp: timestamp(),
          payload: { label: "Thinking" },
        };
      }
      // Tool activity arrives as an updated `tool` part with a nested state.
      if (partType !== "tool") return null;
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
            location: safeToolLocation(toolName, state),
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
            location: safeToolLocation(toolName, state),
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
          payload: {
            usage: (info as Record<string, unknown>).tokens ?? undefined,
          },
        };
      }
      return null;
    }

    case "permission.asked":
    case "permission.updated": {
      const info = isRecord(props.info) ? props.info : props;
      const requestId = asString(info.id) ?? asString(props.id);
      if (!requestId) return null;
      const permission =
        asString(info.type) ?? asString(info.permission) ?? "unknown";
      const description =
        asString(info.title) ??
        asString(info.description) ??
        `Permission requested: ${permission}`;
      const metadata = isRecord(info.metadata) ? info.metadata : {};
      const paths = extractAffectedPaths(metadata, info.pattern);
      const risk = permissionRisk(permission, description, metadata);
      return {
        type: "permission.requested",
        sessionId,
        timestamp: timestamp(),
        payload: {
          requestId,
          permission,
          description,
          risk,
          affectedPaths: paths,
          command: asString(metadata.command),
          sourcePath:
            asString(metadata.sourcePath) ?? asString(metadata.source),
          destinationPath:
            asString(metadata.destinationPath) ??
            asString(metadata.destination),
          allowSession: !["overwrite", "delete", "sensitive"].includes(risk),
        },
      };
    }

    case "session.status": {
      const info = isRecord(props.info) ? props.info : props;
      const nestedStatus = isRecord(info.status)
        ? info.status
        : isRecord(props.status)
          ? props.status
          : undefined;
      const rawStatus =
        asString(info.status) ??
        asString(info.type) ??
        asString(props.status) ??
        asString(nestedStatus?.type) ??
        asString(nestedStatus?.status);
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
          code:
            asString(error?.name) ?? asString(props.name) ?? "session_error",
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

function safeToolLocation(
  toolName: string,
  state: Record<string, unknown> | undefined,
): string | undefined {
  const input = isRecord(state?.input) ? state.input : {};
  const name = toolName.toLowerCase();
  const candidate =
    name === "read" ||
    name === "edit" ||
    name === "write" ||
    name === "patch" ||
    name === "apply_patch"
      ? (input.filePath ?? input.path)
      : name === "glob" || name === "grep"
        ? input.path
        : name === "webfetch" || name === "fetch"
          ? input.url
          : name.startsWith("garden_")
            ? (input.slug ?? input.pageSlug ?? input.gardenId)
            : undefined;
  const value = asString(candidate)?.trim();
  return value && value.length <= 2_000 && !/[\r\n]/.test(value)
    ? value
    : undefined;
}

function extractAffectedPaths(
  metadata: Record<string, unknown>,
  pattern: unknown,
): string[] {
  const values = [
    metadata.path,
    metadata.filepath,
    metadata.source,
    metadata.sourcePath,
    metadata.destination,
    metadata.destinationPath,
    ...(Array.isArray(metadata.paths) ? metadata.paths : []),
    ...(Array.isArray(pattern) ? pattern : []),
  ];
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length < 1_000,
      ),
    ),
  ].slice(0, 20);
}

function permissionRisk(
  permission: string,
  description: string,
  metadata: Record<string, unknown>,
): PermissionRisk {
  const text =
    `${permission} ${description} ${String(metadata.command ?? "")}`.toLowerCase();
  if (/credential|secret|token|ssh|browser profile/.test(text))
    return "sensitive";
  if (/delete|remove|rm\b|clean\b/.test(text)) return "delete";
  if (/overwrite|replace/.test(text)) return "overwrite";
  if (/move|rename/.test(text)) return "move";
  if (/install|dependency|package/.test(text)) return "install";
  if (/web|network|fetch|http|mcp/.test(text)) return "network";
  if (/bash|shell|execute|run /.test(text)) return "execute";
  return "write";
}

function mapStatus(
  raw: string | undefined,
): "idle" | "busy" | "waiting" | "aborted" | "failed" {
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
export function encodeSseEvent(
  event: NormalizedAgentEvent | { type: string; [k: string]: unknown },
): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
