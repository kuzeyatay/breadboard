import type {
  NormalizedAgentEvent,
  PermissionRisk,
} from "../hermes/events.ts";
import {
  createEmDashFilter,
  stripEmDashes,
  type EmDashFilter,
} from "../prose-punctuation.ts";
import {
  humanizeProviderError,
  isProviderErrorText,
  providerErrorResponse,
} from "../provider-error.ts";

export interface RawHermesEvent {
  type: string;
  session_id?: string;
  payload?: unknown;
}

export interface HermesEventNormalizationState {
  assistantText: string;
  /**
   * Assistant prose is em-dash-free by policy. Filtering here rather than in
   * the browser keeps the streamed text and the persisted message identical:
   * `assistantText` is what the conversation store writes.
   */
  emDash: EmDashFilter;
}

export function createHermesEventNormalizationState(): HermesEventNormalizationState {
  return { assistantText: "", emDash: createEmDashFilter() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The persona tag an orchestrator prepends to a delegated task's goal text. */
const DELEGATION_PERSONA_TAG = /^\s*\[persona:\s*([a-z0-9][a-z0-9-]*)\]\s*/i;

function parsePersonaSlug(goal: string | undefined): string | undefined {
  if (!goal) return undefined;
  const match = goal.match(DELEGATION_PERSONA_TAG);
  return match ? match[1].toLowerCase() : undefined;
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

/**
 * Breadboard's Hermes plugin reports failures with `tool_error()`, which returns
 * a JSON *string* (`{"error": "..."}`) rather than an object. Without parsing it
 * the default below reported a failed tool call as a success, so the model saw
 * "the tool worked" and the transcript disagreed with the audit trail.
 */
function resultRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  const text = asString(value)?.trim();
  if (!text || !text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toolSucceeded(payload: Record<string, unknown>): boolean {
  if (
    payload.timedOut === true ||
    (typeof payload.exitCode === "number" && payload.exitCode !== 0)
  ) {
    return false;
  }
  if (typeof payload.success === "boolean") return payload.success;
  if (typeof payload.is_error === "boolean") return !payload.is_error;
  if (asString(payload.error)?.trim()) return false;
  for (const candidate of [payload.result, payload.output, payload.content]) {
    const record = resultRecord(candidate);
    if (!record) continue;
    if (
      record.timedOut === true ||
      (typeof record.exitCode === "number" && record.exitCode !== 0)
    ) {
      return false;
    }
    if (typeof record.success === "boolean") return record.success;
    if (typeof record.ok === "boolean") return record.ok;
    if (asString(record.error)?.trim()) return false;
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
  const messageId = asString(payload.turn_id);

  // Seal the streamed text accumulated so far as a narration segment. An
  // agentic turn interleaves commentary with tool calls; without sealing,
  // every consumer gluing assistant.delta text ends up presenting the whole
  // run's narration as one repetitive answer. Returns the events to emit
  // before whatever triggered the seal (a held em-dash chunk first, so the
  // sealed segment is byte-identical to what consumers accumulated).
  const sealStreamedSegment = (): NormalizedAgentEvent[] => {
    const events: NormalizedAgentEvent[] = [];
    const held = state.emDash.flush();
    if (held) {
      state.assistantText += held;
      events.push({
        type: "assistant.delta",
        sessionId: publicSessionId,
        ...(messageId ? { messageId } : {}),
        timestamp,
        payload: { text: held },
      });
    }
    if (state.assistantText.trim()) {
      events.push({
        type: "assistant.segment",
        sessionId: publicSessionId,
        ...(messageId ? { messageId } : {}),
        timestamp,
        payload: { text: state.assistantText, streamed: true },
      });
    }
    state.assistantText = "";
    state.emDash = createEmDashFilter();
    return events;
  };

  switch (raw.type) {
    case "message.start":
      state.assistantText = "";
      state.emDash = createEmDashFilter();
      return [{
        type: "session.status",
        sessionId: publicSessionId,
        timestamp,
        payload: { status: "busy" },
      }];

    case "message.delta": {
      const raw = asString(payload.text) ?? "";
      if (!raw) return [];
      // A held-back chunk is not lost: it is emitted once the next delta (or
      // the completion flush) settles what follows the dash.
      const text = state.emDash.push(raw);
      if (!text) return [];
      state.assistantText += text;
      return [{
        type: "assistant.delta",
        sessionId: publicSessionId,
        ...(messageId ? { messageId } : {}),
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
      const raw = asString(payload.text)?.trim();
      if (!raw) return [];
      // Runtime status lines carry the same wrapped upstream errors as a failed
      // completion ("❌ Non-retryable error (HTTP 400): … returned HTTP 400: …"),
      // and they are read as a progress label, so they get the same treatment.
      const detail = isProviderErrorText(raw)
        ? humanizeProviderError(raw) || raw
        : raw;
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
      // Text streamed before a tool call is by definition commentary about the
      // work, not the final answer — seal it so the answer buffer starts fresh.
      // Usually a no-op: the loop emits `message.interim` for the same text
      // before its tool calls, and that seal already drained the buffer.
      return [...sealStreamedSegment(), {
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

    case "message.interim": {
      // The loop announces each mid-turn assistant commentary message (tool
      // narration, acknowledgements, an attempted answer before a
      // verify-on-stop nudge) the moment it is appended, before its tool
      // calls execute. `already_streamed` says whether the same text already
      // went out via message.delta — then the streamed buffer IS the segment.
      if (payload.already_streamed === true) return sealStreamedSegment();
      const text = stripEmDashes(asString(payload.text) ?? "").trim();
      if (!text) return [];
      return [{
        type: "assistant.segment",
        sessionId: publicSessionId,
        ...(messageId ? { messageId } : {}),
        timestamp,
        payload: { text, streamed: false },
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

    case "subagent.start":
    case "subagent.complete":
    case "subagent.thinking": {
      const subagentId =
        asString(payload.subagent_id) ?? asString(payload.subagentId);
      if (!subagentId) return [];
      const goal = asString(payload.goal);
      const status: "running" | "thinking" | "done" | "failed" =
        raw.type === "subagent.thinking"
          ? "thinking"
          : raw.type === "subagent.start"
            ? "running"
            : toolSucceeded(payload)
              ? "done"
              : "failed";
      const parentId =
        asString(payload.parent_id) ?? asString(payload.parentId);
      return [{
        type: "subagent.update",
        sessionId: publicSessionId,
        timestamp,
        payload: {
          subagentId,
          ...(parentId ? { parentId } : {}),
          ...(asNumber(payload.depth) !== undefined
            ? { depth: asNumber(payload.depth) }
            : {}),
          ...(goal ? { goal } : {}),
          ...(parsePersonaSlug(goal)
            ? { personaSlug: parsePersonaSlug(goal) }
            : {}),
          status,
          summary: safeSingleLine(payload.preview) ?? safeSingleLine(payload.summary),
          ...(asString(payload.model) ? { model: asString(payload.model) } : {}),
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
            !["overwrite", "delete", "sensitive"].includes(risk) &&
            (choices.length === 0 ||
              choices.includes("session") ||
              choices.includes("always")),
        },
      }];
    }

    case "message.complete": {
      const status = terminalStatus(payload.status);
      const rawText = asString(payload.text) ?? "";
      // A failed turn's "text" is the upstream's refusal, not an answer. Show
      // that sentence — it is what tells the user what to do — rather than the
      // stack of wrappers each layer added on the way here.
      const fullText = stripEmDashes(
        status === "failed" && rawText ? providerErrorResponse(rawText) : rawText,
      );
      const events: NormalizedAgentEvent[] = [];
      // Settle anything the streaming filter was still holding, so the
      // accumulated text can be compared against the completion on equal terms.
      const held = state.emDash.flush();
      if (held) {
        state.assistantText += held;
        events.push({
          type: "assistant.delta",
          sessionId: publicSessionId,
          ...(messageId ? { messageId } : {}),
          timestamp,
          payload: { text: held },
        });
      }
      if (fullText && fullText !== state.assistantText) {
        const residual = fullText.startsWith(state.assistantText)
          ? fullText.slice(state.assistantText.length)
          : state.assistantText
            ? // Normally a rewritten completion means the stream already said
              // it. A failure is the exception: the refusal replaces the text
              // rather than continuing it, so append it to whatever streamed
              // instead of dropping the only explanation the user gets.
              status === "failed" && !state.assistantText.includes(fullText)
              ? `\n\n${fullText}`
              : ""
            : fullText;
        if (residual) {
          state.assistantText += residual;
          events.push({
            type: "assistant.delta",
            sessionId: publicSessionId,
            ...(messageId ? { messageId } : {}),
            timestamp,
            payload: { text: residual },
          });
        }
      }
      events.push({
        type: "assistant.completed",
        sessionId: publicSessionId,
        ...(messageId ? { messageId } : {}),
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
        payload: { status },
      });
      return events;
    }

    case "error": {
      const message = providerErrorResponse(
        payload.message,
        "The Hermes agent runtime reported an error.",
      );
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
