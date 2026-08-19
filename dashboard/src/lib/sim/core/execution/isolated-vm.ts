// Breadboard replacement for sim's lib/execution/isolated-vm.ts (simstudioai/sim,
// Apache-2.0). Sim runs user code inside the `isolated-vm` native module in a pooled
// child process, with per-owner queues, memory caps, IPC-brokered fetch and a task mode
// that loads prebuilt bundles. That is a native gyp build and a second process; Breadboard
// runs the same code shape on node:vm in-process instead.
//
// What that costs, stated plainly: node:vm is an isolation boundary, not a security
// boundary — it stops ambient access (no require, process, fetch, Buffer, globalThis of
// the host) but it does not stop a determined escape through a host object's prototype
// chain. The mitigation here is that NOTHING from the host crosses in: every value handed
// to the sandbox is JSON round-tripped first, so the sandbox only ever sees objects built
// from its own intrinsics, and the only value coming back out is a string. Memory is not
// capped (isolated-vm's `memoryLimit` has no node:vm equivalent); time is, on both the
// synchronous and the asynchronous phase.
//
// Dropped from sim's contract: task mode (`task`, `bytesBase64`, `timings`), brokers, and
// the per-owner admission queue (`ownerKey`/`ownerWeight` are accepted and ignored).

import vm from "node:vm";

export interface CodePlaceholderRuntimeBinding {
  name: string;
  kind: "javascript-runtime";
}

export interface IsolatedVMExecutionRequest {
  code: string;
  params: Record<string, unknown>;
  envVars: Record<string, string>;
  contextVariables: Record<string, unknown>;
  runtimeBindings?: CodePlaceholderRuntimeBinding[];
  timeoutMs: number;
  requestId: string;
  ownerKey?: string;
  ownerWeight?: number;
}

export interface IsolatedVMExecutionOptions {
  /** Cancel the execution early. Reported as `termination: 'cancelled'`. */
  signal?: AbortSignal;
}

export interface IsolatedVMError {
  message: string;
  name: string;
  stack?: string;
  line?: number;
  column?: number;
  lineContent?: string;
  /** True when the host, not the user's code, caused the failure. */
  isSystemError?: boolean;
}

export interface IsolatedVMExecutionResult {
  result: unknown;
  stdout: string;
  error?: IsolatedVMError;
  termination?: "timeout" | "cancelled";
}

/** Names that would hand the sandbox a host reference. Never installed. */
const BLOCKED_CONTEXT_NAMES = new Set([
  "require",
  "process",
  "module",
  "exports",
  "global",
  "globalThis",
  "Buffer",
  "fetch",
  "__dirname",
  "__filename",
]);

/** Strips host prototypes: the sandbox must only ever see objects built from its own
 * intrinsics, which is what makes `x.constructor.constructor` inert. */
function toPlainData(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function annotateError(error: IsolatedVMError, code: string): IsolatedVMError {
  const match = /user-function\.js:(\d+):(\d+)/.exec(error.stack ?? "");
  if (!match) return error;
  const line = Number(match[1]);
  const column = Number(match[2]);
  // The wrapper adds 3 lines before user code.
  const userLine = line - 3;
  const lineContent = code.split("\n")[userLine - 1];
  return { ...error, line: userLine, column, lineContent };
}

export async function executeInIsolatedVM(
  req: IsolatedVMExecutionRequest,
  options?: IsolatedVMExecutionOptions,
): Promise<IsolatedVMExecutionResult> {
  const stdoutChunks: string[] = [];
  const append = (prefix: string, args: unknown[]) => {
    stdoutChunks.push(`${prefix}${args.map(stringifyLogValue).join(" ")}\n`);
  };

  const sandbox: Record<string, unknown> = {
    params: toPlainData(req.params) ?? {},
    environmentVariables: toPlainData(req.envVars) ?? {},
    console: {
      log: (...args: unknown[]) => append("", args),
      info: (...args: unknown[]) => append("", args),
      warn: (...args: unknown[]) => append("", args),
      debug: (...args: unknown[]) => append("", args),
      error: (...args: unknown[]) => append("ERROR: ", args),
    },
    setTimeout,
    clearTimeout,
  };

  for (const [key, value] of Object.entries(req.contextVariables)) {
    if (BLOCKED_CONTEXT_NAMES.has(key)) continue;
    sandbox[key] = value === null || value === undefined ? value : toPlainData(value);
  }

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: true, wasm: false },
  });

  // Matches sim's worker wrapper exactly, including the JSON envelope: the only value
  // that crosses back out of the sandbox is a string.
  const wrapped = `
      (async () => {
        try {
          const __userResult = await (async () => {
${req.code}
          })();
          return JSON.stringify({ success: true, result: __userResult });
        } catch (error) {
          const errorInfo = {
            message: error && error.message ? error.message : String(error),
            name: error && error.name ? error.name : 'Error',
            stack: error && error.stack ? error.stack : ''
          };
          console.error(errorInfo.stack || errorInfo.message);
          return JSON.stringify({ success: false, errorInfo });
        }
      })()
    `;

  const timeoutMs = req.timeoutMs > 0 ? req.timeoutMs : 30_000;
  let timer: NodeJS.Timeout | undefined;
  let termination: "timeout" | "cancelled" | undefined;

  try {
    const script = new vm.Script(wrapped, { filename: "user-function.js" });
    // The `timeout` option bounds only the synchronous phase; the race below bounds the
    // asynchronous one. Both are needed — neither alone covers `await`ing user code.
    const running = script.runInContext(context, { timeout: timeoutMs });

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        termination = "timeout";
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      options?.signal?.addEventListener(
        "abort",
        () => {
          termination = "cancelled";
          reject(new Error("Execution cancelled"));
        },
        { once: true },
      );
    });

    const resultJson = await Promise.race([Promise.resolve(running), deadline]);

    if (typeof resultJson !== "string") {
      return { result: resultJson, stdout: stdoutChunks.join("") };
    }

    const parsed = JSON.parse(resultJson) as
      | { success: true; result: unknown }
      | { success: false; errorInfo: IsolatedVMError };

    if (parsed.success) {
      return { result: parsed.result, stdout: stdoutChunks.join("") };
    }
    return {
      result: null,
      stdout: stdoutChunks.join(""),
      error: annotateError(parsed.errorInfo, req.code),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isTimeout =
      termination === "timeout" || (err as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
    return {
      result: null,
      stdout: stdoutChunks.join(""),
      ...(termination || isTimeout ? { termination: isTimeout ? "timeout" : termination } : {}),
      error: annotateError(
        { message: err.message, name: err.name, stack: err.stack },
        req.code,
      ),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
