// Breadboard's replacement for simstudioai/sim's providers/index.ts + its ~26 vendor
// adapters (Apache-2.0). Sim registers one ProviderConfig per vendor SDK and routes by
// model id. Breadboard has a single model layer — ChatMock/CLIProxy behind an
// OpenAI-compatible endpoint — so there is one provider, `breadboard`, and
// `getProviderFromModel` always names it.
//
// The agentic tool loop lives here, exactly as it does in sim's adapters: the model's
// `tool_calls` are executed through the engine's tool bridge, appended as `role: "tool"`
// messages, and the model is called again until it stops asking. Non-streaming only —
// sim's streaming adapters build agent-event streams, which the executor's stream pump
// consumes; a block that requests `stream: true` here still gets a settled response, and
// the block executor's non-streaming path handles it.

import OpenAI from "openai";
import { createLogger } from "@/lib/sim/core/logger";
import { getErrorMessage } from "@/lib/sim/core/utils/errors";
import { localChatmockBaseUrl } from "@/lib/chatmock-server";
import type { StreamingExecution } from "@/lib/sim/executor/types";
import { notBilledCost } from "@/lib/sim/providers/cost-policy";
import {
  type ProviderRuntimeContext,
  executeProviderTool,
  runWithProviderRuntimeContext,
} from "@/lib/sim/providers/runtime-context";
import type {
  FunctionCallResponse,
  Message,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderToolConfig,
} from "@/lib/sim/providers/types";
import { BREADBOARD_PROVIDER_ID, ProviderError } from "@/lib/sim/providers/types";

const logger = createLogger("BreadboardProvider");

/** Bound on model↔tool round trips. Sim caps its adapters the same way so a model that
 * keeps re-calling a failing tool cannot run the block forever. */
const MAX_TOOL_ITERATIONS = 12;

function createClient(request: ProviderRequest): OpenAI {
  return new OpenAI({
    baseURL: localChatmockBaseUrl(),
    apiKey: request.apiKey || process.env.OPENAI_API_KEY || "local",
  });
}

/** Inline base64 is the only attachment strategy here — see providers/attachments. */
function toChatContent(
  message: Message,
): string | OpenAI.Chat.ChatCompletionContentPart[] {
  const files = message.files ?? [];
  if (files.length === 0) return message.content ?? "";

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const file of files) {
    if (!file.base64) continue;
    if (file.type?.startsWith("image/")) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${file.type};base64,${file.base64}` },
      });
    } else {
      parts.push({
        type: "text",
        text: `[attachment ${file.name} (${file.type})]\n${Buffer.from(file.base64, "base64").toString("utf8")}`,
      });
    }
  }
  return parts.length > 0 ? parts : (message.content ?? "");
}

function toChatMessages(request: ProviderRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (request.systemPrompt) messages.push({ role: "system", content: request.systemPrompt });

  for (const message of request.messages ?? []) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.tool_call_id ?? "",
        content: message.content ?? "",
      });
      continue;
    }
    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      });
      continue;
    }
    if (message.role === "system") {
      messages.push({ role: "system", content: message.content ?? "" });
      continue;
    }
    messages.push({ role: "user", content: toChatContent(message) });
  }

  // `context` is the agent block's user prompt when no explicit message array was built.
  if (request.context) messages.push({ role: "user", content: request.context });
  return messages;
}

function toChatTools(tools: ProviderToolConfig[] | undefined): OpenAI.Chat.ChatCompletionTool[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters?.properties ?? {},
        required: tool.parameters?.required ?? [],
      },
    },
  }));
}

function resolveToolChoice(
  tools: ProviderToolConfig[] | undefined,
): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
  if (!tools || tools.length === 0) return undefined;
  const forced = tools.find((tool) => tool.usageControl === "force");
  if (forced) return { type: "function", function: { name: forced.id } };
  return "auto";
}

/**
 * Merges the model's arguments onto the block's preset params. Preset wins: a param the
 * user filled in was stripped from the schema the model saw, and `modelBlockedParams`
 * names ones it must never supply even if it invents them anyway.
 */
function mergeToolParams(
  tool: ProviderToolConfig,
  modelArguments: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set(tool.modelBlockedParams ?? []);
  const fromModel: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(modelArguments)) {
    if (!blocked.has(key)) fromModel[key] = value;
  }
  const merged = { ...fromModel, ...tool.params };
  return tool.paramsTransform ? tool.paramsTransform(merged) : merged;
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function executeChatRequest(request: ProviderRequest): Promise<ProviderResponse> {
  const startedAt = Date.now();
  const startTime = new Date(startedAt).toISOString();
  const client = createClient(request);

  const toolsById = new Map((request.tools ?? []).map((tool) => [tool.id, tool]));
  const chatTools = toChatTools(request.tools);
  const messages = toChatMessages(request);

  const toolCalls: FunctionCallResponse[] = [];
  const toolResults: Record<string, unknown>[] = [];
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let firstResponseTime: number | undefined;
  let iterations = 0;

  try {
    for (; iterations < MAX_TOOL_ITERATIONS; iterations++) {
      const completion = await client.chat.completions.create(
        {
          model: request.model,
          messages,
          ...(chatTools.length > 0
            ? { tools: chatTools, tool_choice: resolveToolChoice(request.tools) }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.responseFormat
            ? {
                response_format: {
                  type: "json_schema" as const,
                  json_schema: {
                    name: request.responseFormat.name || "response",
                    schema: request.responseFormat.schema,
                    ...(request.responseFormat.strict !== undefined
                      ? { strict: request.responseFormat.strict }
                      : {}),
                  },
                },
              }
            : {}),
          stream: false,
        },
        request.abortSignal ? { signal: request.abortSignal } : undefined,
      );

      firstResponseTime ??= Date.now() - startedAt;
      inputTokens += completion.usage?.prompt_tokens ?? 0;
      outputTokens += completion.usage?.completion_tokens ?? 0;

      const choice = completion.choices?.[0];
      const message = choice?.message;
      if (!message) break;

      const requestedCalls = message.tool_calls ?? [];
      if (requestedCalls.length === 0) {
        content = message.content ?? "";
        break;
      }

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: requestedCalls,
      });
      if (message.content) content = message.content;

      for (const call of requestedCalls) {
        if (call.type !== "function") continue;
        const tool = toolsById.get(call.function.name);
        const callStartedAt = Date.now();
        const modelArguments = parseArguments(call.function.arguments);

        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Tool "${call.function.name}" is not available to this block.`,
          });
          toolCalls.push({
            name: call.function.name,
            arguments: modelArguments,
            startTime: new Date(callStartedAt).toISOString(),
            endTime: new Date().toISOString(),
            duration: 0,
            success: false,
          });
          continue;
        }

        const params = mergeToolParams(tool, modelArguments);
        const { rawResponse, modelResponse } = await executeProviderTool(tool.id, params, {
          ...(request.abortSignal ? { signal: request.abortSignal } : {}),
        });

        const endedAt = Date.now();
        toolCalls.push({
          name: tool.name || tool.id,
          arguments: modelArguments,
          startTime: new Date(callStartedAt).toISOString(),
          endTime: new Date(endedAt).toISOString(),
          duration: endedAt - callStartedAt,
          input: params,
          output: rawResponse.output,
          result: rawResponse.output,
          success: rawResponse.success,
        });
        toolResults.push(rawResponse as unknown as Record<string, unknown>);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            modelResponse.success
              ? (modelResponse.output ?? {})
              : { error: modelResponse.error ?? "Tool execution failed" },
          ),
        });
      }
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      logger.warn("Tool loop hit its iteration cap", {
        model: request.model,
        iterations,
      });
    }

    const endedAt = Date.now();
    return {
      content,
      model: request.model,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(toolResults.length > 0 ? { toolResults } : {}),
      timing: {
        startTime,
        endTime: new Date(endedAt).toISOString(),
        duration: endedAt - startedAt,
        ...(firstResponseTime !== undefined ? { firstResponseTime } : {}),
        iterations: iterations + 1,
      },
      cost: { ...notBilledCost(), pricing: { input: 0, output: 0, updatedAt: "1970-01-01" } },
    };
  } catch (error) {
    const endedAt = Date.now();
    throw new ProviderError(
      getErrorMessage(error),
      { startTime, endTime: new Date(endedAt).toISOString(), duration: endedAt - startedAt },
      { cause: error },
    );
  }
}

export const breadboardProvider: ProviderConfig = {
  id: BREADBOARD_PROVIDER_ID,
  name: "Breadboard",
  description: "Breadboard's local model layer (ChatMock / CLIProxy) over an OpenAI-compatible API",
  version: "1.0.0",
  models: [],
  defaultModel: process.env.SIM_ENGINE_DEFAULT_MODEL || "gpt-5",
  executeRequest: executeChatRequest,
};

export const providers: Record<string, ProviderConfig> = {
  [BREADBOARD_PROVIDER_ID]: breadboardProvider,
};

export function getProviderExecutor(providerId: string): ProviderConfig | undefined {
  return providers[providerId] ?? breadboardProvider;
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest,
  runtimeContext?: ProviderRuntimeContext,
): Promise<ProviderResponse | ReadableStream | StreamingExecution> {
  const provider = getProviderExecutor(providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  // Bound here rather than passed down: model-emitted tool calls happen deep inside the
  // loop and must inherit the executor's identity without every adapter forwarding it.
  return runWithProviderRuntimeContext(runtimeContext, () => provider.executeRequest(request));
}

export type { ProviderRuntimeContext };
