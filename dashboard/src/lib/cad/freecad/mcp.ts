// One MCP connection per build, owned by the finite Runtime CAD worker.
import { execFile } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CadServiceError } from "../errors.ts";
import { freecadAvailability } from "./config.ts";

export interface FreeCADMcpRequest {
  code: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeFreeCADMcp(input: FreeCADMcpRequest): Promise<string> {
  const env = input.env ?? process.env;
  const status = freecadAvailability(env);
  if (!status.available || !status.python || !status.executable) {
    throw new CadServiceError(status.code, status.message);
  }
  input.signal?.throwIfAborted();
  const client = new Client({ name: "breadboard-freecad", version: "1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: status.python,
    args: ["-c", "from freecad_mcp.server import main; main()", "--only-text-feedback", "--freecadcmd", status.executable],
    // Never expose provider credentials to the third-party bridge.
    env: { ...getDefaultEnvironment(), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    stderr: "pipe",
  });
  let log = "";
  transport.stderr?.on("data", (chunk) => { log = (log + String(chunk)).slice(-4000); });
  let stopped: Promise<void> | undefined;
  const stop = () => stopped ??= new Promise<void>((resolve) => {
    const pid = transport.pid;
    if (pid && process.platform === "win32") {
      execFile(path.join(env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }, () => resolve());
    } else {
      // The Runtime owner also reaps the job's descendants on cancellation.
      void client.close().catch(() => undefined).finally(resolve);
    }
  });
  const abort = () => { void stop(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    await client.connect(transport, { timeout: 20_000, signal: input.signal });
    input.signal?.throwIfAborted();
    const result = await client.callTool({ name: "execute_code_headless", arguments: {
      code: input.code, timeout: input.timeoutMs / 1000,
    } }, undefined, { timeout: input.timeoutMs + 15_000, signal: input.signal });
    const text = (Array.isArray(result.content) ? result.content : [])
      .filter((block) => block.type === "text").map((block) => String(block.text)).join("\n");
    if (result.isError) throw new CadServiceError("freecad_build_failed", text.slice(-8000), { retryable: true });
    return text.slice(-16_000);
  } catch (error) {
    await stop();
    if (input.signal?.aborted) throw new CadServiceError("execution_aborted", "The FreeCAD build was cancelled.");
    if (error instanceof CadServiceError) throw error;
    throw new CadServiceError("freecad_mcp_failed", `FreeCAD MCP failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true, detail: log });
  } finally {
    input.signal?.removeEventListener("abort", abort);
    if (stopped) await stopped;
    await client.close().catch(() => undefined);
  }
}
