// Breadboard replacement for simstudioai/sim's `function_execute` tool (Apache-2.0 —
// apps/sim/tools/function/execute.ts). Sim's version POSTs to an internal
// `/api/function/execute` route (2,823 lines) which fans out to isolated-vm, e2b or
// daytona. Breadboard runs the code in-process on node:vm
// (core/execution/isolated-vm) — no route, no remote sandbox, so this is a
// `directExecution` tool with no request shape at all.

import { executeInIsolatedVM } from "@/lib/sim/core/execution/isolated-vm";
import { generateRequestId } from "@/lib/sim/core/core/utils/request";
import type { CodeExecutionInput, CodeExecutionOutput } from "@/lib/sim/core/tools-shim/function/types";
import type { ToolConfig, ToolResponse } from "@/lib/sim/tools/types";

/** `{{NAME}}` reads a workflow environment variable, matching sim's function runtime. */
function substituteEnvVars(code: string, envVars: Record<string, string>): string {
  return code.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (match, name: string) =>
    Object.hasOwn(envVars, name) ? envVars[name] : match,
  );
}

function readCode(input: CodeExecutionInput["code"]): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map((entry) => entry.content).join("\n");
  return "";
}

export const functionExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: "function_execute",
  name: "Function Execute",
  description: "Runs JavaScript in a sandboxed VM and returns its result and stdout.",
  version: "1.0.0",
  params: {
    code: { type: "string", required: true, visibility: "llm-only", description: "Code to run" },
    timeout: { type: "number", required: false, visibility: "hidden" },
  },
  request: {
    url: "",
    method: "POST",
    headers: () => ({}),
  },
  directExecution: async (params, signal): Promise<ToolResponse> => {
    const language = params.language ?? "javascript";
    if (language !== "javascript") {
      return {
        success: false,
        output: { result: null, stdout: "" },
        error: `Language "${language}" is not supported: Breadboard runs the function block on node:vm, which only executes JavaScript.`,
      };
    }

    const envVars = params.envVars ?? {};
    const contextVariables: Record<string, unknown> = {
      ...(params.workflowVariables ?? {}),
      ...(params.contextVariables ?? {}),
    };

    const vmResult = await executeInIsolatedVM(
      {
        code: substituteEnvVars(readCode(params.code), envVars),
        params: {},
        envVars,
        contextVariables,
        timeoutMs: params.timeout ?? 30_000,
        requestId: generateRequestId(),
      },
      signal ? { signal } : undefined,
    );

    if (vmResult.error) {
      return {
        success: false,
        output: { result: null, stdout: vmResult.stdout },
        error: vmResult.error.message,
      };
    }

    return { success: true, output: { result: vmResult.result, stdout: vmResult.stdout } };
  },
};
