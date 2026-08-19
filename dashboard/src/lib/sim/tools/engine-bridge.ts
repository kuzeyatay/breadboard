// Breadboard's replacement for simstudioai/sim's `executeTool` (Apache-2.0 —
// apps/sim/tools/index.ts, ~2,500 lines). Sim's version layers hosted-key handout, BYOK
// resolution, OAuth token refresh, per-tool rate limits, private-metadata provenance
// forking and an internal-route auth boundary on top of the actual call. None of those
// systems were vendored. What is left is the call itself, in two shapes sim also has:
// a tool's own `directExecution`, or its declared HTTP request.
//
// Named `engine-bridge` rather than `index` because sim's `tools/index.ts` is also the
// registry barrel; here the registry is `tools/registry.ts` and this is only the executor's
// entry point into it.

import { createLogger } from "@/lib/sim/core/logger";
import { getErrorMessage } from "@/lib/sim/core/utils/errors";
import type { ExecutionContext } from "@/lib/sim/executor/types";
import { formatToolRequest } from "@/lib/sim/tools/request-transport";
import type { ToolResponse } from "@/lib/sim/tools/types";
import { getTool, validateRequiredParametersAfterMerge } from "@/lib/sim/tools/utils";

const logger = createLogger("ToolEngineBridge");

export interface ExecuteToolOptions {
  skipPostProcess?: boolean;
  executionContext?: ExecutionContext;
  signal?: AbortSignal;
  abortSignal?: AbortSignal;
}

function timing(startedAt: number): ToolResponse["timing"] {
  const endedAt = Date.now();
  return {
    startTime: new Date(startedAt).toISOString(),
    endTime: new Date(endedAt).toISOString(),
    duration: endedAt - startedAt,
  };
}

async function runHttpTool(
  toolId: string,
  params: Record<string, any>,
  signal: AbortSignal | undefined,
): Promise<ToolResponse> {
  const tool = getTool(toolId);
  if (!tool) throw new Error(`Tool not found: ${toolId}`);

  const prepared = formatToolRequest(tool, params);
  if (prepared.isInternalRoute) {
    // Sim's internal-route tools authenticate against its own API surface, which was not
    // vendored — calling them would hit whatever happens to serve that path here.
    return {
      success: false,
      output: {},
      error: `Tool "${toolId}" targets a sim-internal route that Breadboard does not vendor`,
    };
  }

  const response = await fetch(prepared.url, {
    method: prepared.method,
    headers: prepared.headers,
    ...(prepared.body !== undefined ? { body: prepared.body } : {}),
    ...(signal ? { signal } : {}),
  });

  if (tool.transformResponse) {
    return (await tool.transformResponse(response, params)) as ToolResponse;
  }

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON body; the text is the result.
  }

  return response.ok
    ? { success: true, output: data as Record<string, any>, statusCode: response.status }
    : {
        success: false,
        output: (data ?? {}) as Record<string, any>,
        statusCode: response.status,
        error: `${response.status} ${response.statusText}`,
      };
}

/**
 * Runs one tool by id. Never throws for a tool-level failure — the executor's block
 * handlers all branch on `result.success` and build their own error messages from it, so
 * a thrown error would bypass their diagnostics. A missing tool is reported the same way.
 */
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  options: ExecuteToolOptions = {},
): Promise<ToolResponse> {
  const startedAt = Date.now();
  const signal = options.signal ?? options.abortSignal ?? options.executionContext?.abortSignal;

  const tool = getTool(toolId);
  if (!tool) {
    logger.warn("Tool not available", { toolId });
    return {
      success: false,
      output: {},
      error: `Tool not available: "${toolId}" is not in Breadboard's vendored tool registry (src/lib/sim/tools/registry.ts)`,
      timing: timing(startedAt),
    };
  }

  try {
    validateRequiredParametersAfterMerge(toolId, tool, params);

    const result = tool.directExecution
      ? await tool.directExecution(params, signal)
      : await runHttpTool(toolId, params, signal);

    const withTiming: ToolResponse = { ...result, timing: timing(startedAt) };

    if (tool.postProcess && !options.skipPostProcess && withTiming.success) {
      return await tool.postProcess(withTiming, params, (id, nextParams) =>
        executeTool(id, nextParams, options),
      );
    }
    return withTiming;
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    // A user Stop must propagate; every other failure becomes a result the caller reads.
    if (name === "AbortError" || name === "APIUserAbortError") throw error;
    return {
      success: false,
      output: {},
      error: getErrorMessage(error),
      timing: timing(startedAt),
    };
  }
}
