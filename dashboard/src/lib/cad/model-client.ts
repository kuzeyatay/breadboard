// The CAD agent's model loop.
//
// Breadboard drives the loop itself rather than handing the turn to another
// service: it calls the configured provider (ChatMock, OpenAI-compatible) with
// the CAD tool set, executes each proposed tool call locally, and feeds the
// typed result back. Because *we* execute the tools, the attempt budget, the
// authorization, and the audit trail are ours, and the model never touches the
// CAD service or the database.
//
// The provider is not hardcoded: the caller passes whichever model the user
// selected, and the base URL comes from Breadboard's own ChatMock resolution.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  describeTransportFailure,
  isTransportFailure,
  withTransportRetry,
} from "../model-transport.ts";
import { humanizeProviderError } from "../provider-error.ts";
import { CAD_TOOL_DEFINITIONS, runCadTool, type CadToolContext } from "./tools.ts";

// Complex parametric parts can legitimately take several minutes on reasoning
// models. Callers with a deterministic fallback may choose a shorter deadline.
const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;
const MAX_TOOL_RESULT_CHARS = 12_000;

export class CadModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CadModelError";
    this.code = code;
  }
}

interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface CadModelTarget {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  onUsage?: (usage: unknown) => void;
  requestTimeoutMs?: number;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * The upstream's own sentence, unwrapped through Breadboard's shared provider
 * error handling so an internal route id never reaches the reader. Falls back
 * to the status code when the body says nothing useful.
 */
async function providerFailureMessage(response: Response): Promise<string> {
  const fallback = `The model endpoint returned ${response.status}.`;
  let body = "";
  try {
    body = await response.text();
  } catch {
    return fallback;
  }
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    detail =
      typeof parsed.error === "string"
        ? parsed.error
        : (parsed.error?.message ?? "");
  } catch {
    detail = body;
  }
  const humanized = humanizeProviderError(detail).trim();
  return humanized ? `${humanized} (HTTP ${response.status})` : fallback;
}

/**
 * A request that never reached the model, said in words.
 *
 * The three cases look identical from here — undici raises the same bare "fetch
 * failed" whether the person pressed Stop, our own deadline passed, or the
 * gateway went away — so they are told apart by which signal fired rather than
 * by reading the message. Only the last is a fault, and it is the one worth
 * naming precisely: its whole cause is a service the reader can restart.
 */
function unreachable(
  target: CadModelTarget,
  deadline: AbortSignal,
  error: unknown,
  timeoutMs: number,
): CadModelError {
  if (target.signal?.aborted) {
    return new CadModelError("aborted", "The run was stopped before the model answered.");
  }
  if (deadline.aborted) {
    return new CadModelError(
      "model_timeout",
      `The model endpoint did not answer within ${Math.round(timeoutMs / 1_000)}s.`,
    );
  }
  return new CadModelError(
    "model_unreachable",
    describeTransportFailure(error, {
      endpoint: completionsUrl(target.baseUrl),
      lead: "The model could not be reached",
    }),
  );
}

async function completion(
  target: CadModelTarget,
  messages: ChatMessage[],
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const controller = new AbortController();
  const timeoutMs = Math.max(15_000, target.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const onAbort = () => controller.abort();
  target.signal?.addEventListener("abort", onAbort);
  try {
    // Re-sent once or twice if it never arrives: a design is a dozen of these
    // calls over several minutes, and losing all of it to one dropped
    // connection — a local gateway restarting is enough — is the difference
    // between a part and an apology.
    const response = await withTransportRetry(
      () =>
        fetch(completionsUrl(target.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${chatmockApiKeyValue()}`,
          },
          body: JSON.stringify({
            model: target.model,
            messages,
            tools: CAD_TOOL_DEFINITIONS.map((tool) => ({ type: "function", function: tool })),
            tool_choice: "auto",
            ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
          }),
          signal: controller.signal,
        }),
      { ...(target.signal ? { signal: target.signal } : {}) },
    ).catch((error: unknown) => {
      throw unreachable(target, controller.signal, error, timeoutMs);
    });
    if (!response.ok) {
      // The upstream usually says why, and says it to the person who can act on
      // it ("the usage limit has been reached", "try another model"). That
      // sentence is worth far more than the status code, so it is unwrapped and
      // shown rather than replaced with a generic failure.
      throw new CadModelError(
        response.status === 429 || response.status === 402
          ? "model_rate_limited"
          : "model_unavailable",
        await providerFailureMessage(response),
      );
    }
    // The body is a second place the connection can die — a gateway killed
    // between its headers and its answer sends a complete-looking 200 and then
    // nothing, which surfaces here as "terminated" rather than as a status.
    const data = (await response.json().catch((error: unknown) => {
      if (isTransportFailure(error)) throw unreachable(target, controller.signal, error, timeoutMs);
      throw new CadModelError(
        "invalid_response",
        "The model endpoint returned a response Breadboard could not read.",
      );
    })) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
      usage?: unknown;
    };
    if (data.usage) target.onUsage?.(data.usage);
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new CadModelError("empty_response", "The model returned no message.");
    }
    return {
      content: (message.content ?? "").trim(),
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    };
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

export interface CadAgentLoopInput extends CadModelTarget {
  systemPrompt: string;
  userMessage: string;
  toolContext: CadToolContext;
  /** Hard ceiling on model turns. The build budget is enforced separately. */
  maxSteps?: number;
}

export interface CadAgentLoopResult {
  /** The model's closing message. */
  answer: string;
  /** The project the turn worked on, if it created or loaded one. */
  projectId: string | null;
  toolCalls: Array<{ name: string; ok: boolean; summary: string }>;
  stoppedBecause: "answered" | "step_limit" | "aborted";
}

function summariseToolResult(name: string, result: Record<string, unknown>): string {
  if (result.ok === false) {
    // Argument-validation refusals carry the exact field that failed; without
    // them the model gets "did not validate" and no way to repair it.
    const issues = Array.isArray(result.issues) ? result.issues.slice(0, 4).join("; ") : "";
    return [
      `${name} failed: ${String(result.message ?? result.error ?? "unknown error")}`,
      issues,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (name === "cad_create_project") return `project ${String(result.projectId)} created`;
  if (name === "cad_generate_model" || name === "cad_update_parameters") {
    return `revision ${String(result.revision)} — ${String(result.status)}`;
  }
  if (name === "cad_validate_model") {
    return `validation ${result.passed ? "passed" : "failed"} on revision ${String(result.revision)}`;
  }
  if (name === "cad_export_model") {
    const exports = Array.isArray(result.exports) ? result.exports.length : 0;
    return `${exports} file(s)`;
  }
  return "ok";
}

export async function runCadAgentLoop(input: CadAgentLoopInput): Promise<CadAgentLoopResult> {
  const maxSteps = input.maxSteps ?? 12;
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userMessage },
  ];
  const toolCalls: CadAgentLoopResult["toolCalls"] = [];
  let answer = "";

  for (let step = 0; step < maxSteps; step += 1) {
    if (input.signal?.aborted) {
      return { answer, projectId: input.toolContext.projectId ?? null, toolCalls, stoppedBecause: "aborted" };
    }
    const { content, toolCalls: proposed } = await completion(input, messages);
    if (content) answer = content;
    messages.push({
      role: "assistant",
      content,
      ...(proposed.length ? { tool_calls: proposed } : {}),
    });

    if (!proposed.length) {
      return {
        answer,
        projectId: input.toolContext.projectId ?? null,
        toolCalls,
        stoppedBecause: "answered",
      };
    }

    for (const call of proposed) {
      if (input.signal?.aborted) {
        return {
          answer,
          projectId: input.toolContext.projectId ?? null,
          toolCalls,
          stoppedBecause: "aborted",
        };
      }
      let parsedArguments: unknown = {};
      try {
        parsedArguments = JSON.parse(call.function.arguments || "{}");
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: "invalid_arguments",
            message: "The tool arguments were not valid JSON.",
          }),
        });
        continue;
      }

      let result: Record<string, unknown>;
      try {
        result = await runCadTool(call.function.name, parsedArguments, input.toolContext);
      } catch (error) {
        result = {
          ok: false,
          error: "tool_error",
          message: error instanceof Error ? error.message : "The CAD tool failed.",
        };
      }
      const summary = summariseToolResult(call.function.name, result);
      toolCalls.push({ name: call.function.name, ok: result.ok !== false, summary });

      const serialized = JSON.stringify(result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          serialized.length > MAX_TOOL_RESULT_CHARS
            ? `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)`
            : serialized,
      });
    }
  }

  return {
    answer,
    projectId: input.toolContext.projectId ?? null,
    toolCalls,
    stoppedBecause: "step_limit",
  };
}
