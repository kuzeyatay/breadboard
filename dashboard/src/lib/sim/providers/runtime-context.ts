// Breadboard adaptation of simstudioai/sim (Apache-2.0) — apps/sim/providers/runtime-context.ts.
// Sim binds a per-request AsyncLocalStorage so a model-emitted tool call inherits the
// executor's identity and its resolved-secret trace registry without threading them through
// every provider adapter. Kept verbatim in shape; sim's copilot result projection (which
// rewrites a tool result before it re-enters the model) is dropped — that lives in its
// copilot request layer, which was not vendored.

import { AsyncLocalStorage } from "node:async_hooks";
import { getErrorMessage } from "@/lib/sim/core/utils/errors";
import type { ExecutionContext } from "@/lib/sim/executor/types";
import type { ResolvedSecretTraceRegistry } from "@/lib/sim/executor/utils/resolved-secret-trace-registry";
import { type ExecuteToolOptions, executeTool } from "@/lib/sim/tools/engine-bridge";
import type { ToolResponse } from "@/lib/sim/tools/types";

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry;
  /** Trusted server execution context inherited by model-emitted tool calls. */
  executionContext?: ExecutionContext;
}

export type ExecuteProviderToolOptions = ExecuteToolOptions;

export interface ProviderToolExecutionResult {
  /** Original tool response retained for workflow outputs, traces, costs and files. */
  rawResponse: ToolResponse;
  /** Copy safe to serialize into the next model request. */
  modelResponse: ToolResponse;
}

const providerRuntimeContext = new AsyncLocalStorage<ProviderRuntimeContext | undefined>();

export function runWithProviderRuntimeContext<T>(
  context: ProviderRuntimeContext | undefined,
  callback: () => T,
): T {
  return providerRuntimeContext.run(context, callback);
}

export function getProviderRuntimeContext(): ProviderRuntimeContext | undefined {
  return providerRuntimeContext.getStore();
}

export async function executeProviderTool(
  toolId: string,
  params: Record<string, any>,
  options: ExecuteProviderToolOptions = {},
): Promise<ProviderToolExecutionResult> {
  const runtimeContext = providerRuntimeContext.getStore();

  try {
    const executionContext = options.executionContext ?? runtimeContext?.executionContext;
    const result = await executeTool(toolId, params, {
      ...options,
      ...(executionContext ? { executionContext } : {}),
    });
    return { rawResponse: result, modelResponse: result };
  } catch (error) {
    const errorName =
      error && typeof error === "object" && "name" in error ? String(error.name) : undefined;
    // A user Stop must abort the loop, not become a tool result the model reasons about.
    if (errorName === "AbortError" || errorName === "APIUserAbortError") throw error;
    const response: ToolResponse = { success: false, output: {}, error: getErrorMessage(error) };
    return { rawResponse: response, modelResponse: response };
  }
}
