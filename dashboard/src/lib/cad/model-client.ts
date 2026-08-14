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
import { DEFAULT_CAD_ENGINE, type CadEngineId } from "./engines.ts";
import { cadToolDefinitions, runCadTool, type CadToolContext } from "./tools.ts";
import { SUPPORTED_OPERATIONS } from "./solidworks/operations.ts";
import type { CadProjectRow } from "./project-store.ts";
import type { CADDesignSpec, CADValidationIssue } from "./types.ts";

// Complex parametric parts can legitimately take several minutes on reasoning
// models. A timeout is an honest no-result: callers never substitute canned CAD.
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
  options: {
    allowedToolNames?: readonly string[];
    forcedToolName?: string;
    /** The backend whose tool contracts the model is shown. */
    engine?: CadEngineId;
  } = {},
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
    const definitions = cadToolDefinitions(options.engine);
    const allowed = options.allowedToolNames
      ? definitions.filter((tool) => options.allowedToolNames!.includes(tool.name))
      : definitions;
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
            tools: allowed.map((tool) => ({ type: "function", function: tool })),
            tool_choice: options.forcedToolName
              ? { type: "function", function: { name: options.forcedToolName } }
              : "auto",
            parallel_tool_calls: false,
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
  /** Staged runs can expose only the tool appropriate to the current phase. */
  allowedToolNames?: readonly string[];
  /** Force the phase's one required tool instead of waiting for model prose. */
  forcedToolName?: string;
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
    const { content, toolCalls: proposed } = await completion(input, messages, {
      ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
      ...(input.forcedToolName ? { forcedToolName: input.forcedToolName } : {}),
      engine: input.toolContext.engine ?? DEFAULT_CAD_ENGINE,
    });
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

/**
 * Build phase for a project whose structured specification already exists.
 *
 * Keeping this separate from planning fixes a costly failure mode: after
 * `cad_create_project`, the ordinary agent loop used to send the enormous
 * planning turn back to the model and could sit there until the whole request
 * deadline expired. This phase gives the model one job and one tool, then
 * executes the proposed source immediately. A valid build is a terminal
 * result; it never waits for a cosmetic prose completion.
 */
export async function runCadProjectBuildPhase(input: CadModelTarget & {
  project: CadProjectRow;
  toolContext: CadToolContext;
  /** Test seam; production executes Breadboard's local typed CAD tool. */
  runTool?: typeof runCadTool;
  maxBuildSteps?: number;
  /**
   * Requirements the kernel cannot check, evaluated against the design that was
   * just built. A valid solid that misses one of them is not finished, and the
   * repair the model can make is the one it is told about — so the unmet
   * requirements go back into this conversation rather than being discovered
   * after the run has ended.
   */
  acceptance?: (projectId: string) => CADValidationIssue[];
}): Promise<CadAgentLoopResult> {
  const spec = JSON.parse(input.project.design_spec_json) as CADDesignSpec;
  const parameters = Object.fromEntries(
    spec.parameters.map((parameter) => [parameter.id, parameter.value]),
  );
  const execute = input.runTool ?? runCadTool;
  const maxBuildSteps = Math.max(
    1,
    Math.min(input.maxBuildSteps ?? 2, input.toolContext.attemptsRemaining),
  );
  const engine: CadEngineId = input.toolContext.engine ?? DEFAULT_CAD_ENGINE;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are the source-generation phase of Breadboard's Parametric CAD agent.",
        "The project and its structured design specification already exist. Do not plan it again and do not create another project.",
        ...(engine === "solidworks"
          ? [
              "Call cad_generate_model now with one complete SolidWorks operation program as JSON.",
              `The only operations are ${SUPPORTED_OPERATIONS.join(", ")}; there is no chamfer, Hole Wizard, revolve, sweep, loft or pattern.`,
              "Build the outer body first with a closed sketch and an extrude, then remove material with sketch-and-cut. A hole is a circle cut deeper than the body is thick.",
              "Every coordinate, radius and depth is in millimetres.",
            ]
          : [
              "Call cad_generate_model now with one complete, deterministic CadQuery program.",
              "Use DEFAULT_PARAMS plus build_model(params), keep all geometry in millimetres, and return a dict of named solids.",
            ]),
        "Implement every non-reference component as the requested number of named printable solids.",
        "Implement the specification's fit, retention, clearance, alignment and serviceability constraints in actual geometry.",
        "Read every editable parameter from the parameter map and use it in its named geometry; remove no-op parameters instead of exposing fake controls.",
        "Returned printable bodies must not overlap by positive volume in assembled coordinates. Model mating clearances and aligned joint features explicitly.",
        "If a required feature has no constraint carrying its exact id, send that constraint in the same call's `constraints`.",
        "If the specification has no `assembly` and this design has more than one body or any bought part, send `assembly` too: overview, hardware with real sizes and quantities, and ordered steps naming the component ids each step joins.",
        "Prefer robust primitives and booleans over fragile decorative fillets. Never return prose instead of the tool call.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Build existing project ${input.project.id}.`,
        "Its validated design specification follows:",
        JSON.stringify(spec),
      ].join("\n"),
    },
  ];
  const toolCalls: CadAgentLoopResult["toolCalls"] = [];
  let answer = "";

  for (let step = 0; step < maxBuildSteps; step += 1) {
    if (input.signal?.aborted) {
      return {
        answer,
        projectId: input.project.id,
        toolCalls,
        stoppedBecause: "aborted",
      };
    }
    const buildTarget: CadModelTarget = {
      ...input,
      // High reasoning on a large source payload can spend the full request
      // deadline without yielding a tool call. The structured plan is already
      // done, so medium is the reliable ceiling for this synthesis phase.
      reasoningEffort: ["none", "minimal", "low", "medium"].includes(
        input.reasoningEffort ?? "",
      )
        ? input.reasoningEffort
        : "medium",
      requestTimeoutMs: Math.min(input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 240_000),
    };
    const completed = await completion(buildTarget, messages, {
      allowedToolNames: ["cad_generate_model"],
      forcedToolName: "cad_generate_model",
      engine,
    });
    if (completed.content) answer = completed.content;
    const proposed = completed.toolCalls.find(
      (call) => call.function.name === "cad_generate_model",
    );
    if (!proposed) {
      answer = answer || "The model returned no CAD source for the existing project.";
      break;
    }
    messages.push({
      role: "assistant",
      content: completed.content,
      tool_calls: [proposed],
    });

    let rawArguments: Record<string, unknown>;
    try {
      const parsed = JSON.parse(proposed.function.arguments || "{}") as unknown;
      rawArguments =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      rawArguments = {};
    }
    // The model writes geometry; Breadboard owns identity, parameter values,
    // and execution limits. Never let a generated tool payload switch project
    // or silently discard the values the planning phase exposed to the user.
    const toolArguments = {
      ...rawArguments,
      projectId: input.project.id,
      parameters,
      timeoutMs: 120_000,
      note:
        typeof rawArguments.note === "string" && rawArguments.note.trim()
          ? rawArguments.note
          : step === 0
            ? "Generate the first model from the saved design specification."
            : "Repair the previous model from its CAD build diagnostics.",
    };
    let result: Record<string, unknown>;
    try {
      result = await execute("cad_generate_model", toolArguments, input.toolContext);
    } catch (error) {
      result = {
        ok: false,
        error: "tool_error",
        message: error instanceof Error ? error.message : "The CAD build failed.",
      };
    }
    const summary = summariseToolResult("cad_generate_model", result);
    toolCalls.push({ name: "cad_generate_model", ok: result.ok !== false, summary });
    messages.push({
      role: "tool",
      tool_call_id: proposed.id,
      content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
    });
    if (result.ok !== false && result.validationPassed === true) {
      const unmet = input.acceptance?.(input.project.id) ?? [];
      if (!unmet.length) {
        return {
          answer: "The CAD source was generated, built, and geometrically validated.",
          projectId: input.project.id,
          toolCalls,
          stoppedBecause: "answered",
        };
      }
      answer =
        `The geometry is valid, but ${unmet.length} required product feature` +
        `${unmet.length === 1 ? " is" : "s are"} still missing: ` +
        unmet.map((issue) => issue.feature ?? issue.code).join(", ");
      if (step + 1 >= maxBuildSteps) break;
      messages.push({
        role: "user",
        content: [
          "The solid is geometrically valid, but it does not yet satisfy the product's acceptance",
          "requirements. Each one below is missing either the geometry itself or a design-spec",
          "constraint carrying its exact id. Rewrite the program so the feature really exists —",
          "do not merely rename a body or repeat the requirement in prose — and call",
          "cad_generate_model again, sending the missing ids in that call's `constraints`.",
          ...unmet.map(
            (issue) =>
              `- ${issue.feature ?? issue.code}: ${issue.message}${
                issue.repairHint ? ` ${issue.repairHint}` : ""
              }`,
          ),
        ].join("\n"),
      });
    }
  }

  return {
    answer,
    projectId: input.project.id,
    toolCalls,
    stoppedBecause: "step_limit",
  };
}
