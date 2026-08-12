import { spawn } from "node:child_process";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";

export interface IfixAiFailureEvidence {
  prompt: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface IfixAiFailure {
  id: string;
  name: string;
  category: string;
  score: number;
  threshold: number;
  status: string;
  evidence: IfixAiFailureEvidence[];
}

export interface IfixAiRunResult {
  ok: true;
  score: number | null;
  grade: string;
  passed: boolean;
  partial: boolean;
  abortReason: string | null;
  selfJudged: boolean;
  judgeRelation: string;
  categories: Record<string, number>;
  tests: Record<string, { status: string; score: number }>;
  failures: IfixAiFailure[];
  warnings: string[];
  reports: Record<string, string>;
}

export interface IfixAiBridgeRequest {
  endpoint: string;
  apiKey: string;
  model: string;
  judgeModel: string | null;
  fixture: string;
  suite: string;
  seed: number;
  timeoutSeconds: number;
  judgeMaxCalls: number;
  systemPrompt: string;
  outputDir: string;
}

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;

function boundedAppend(current: string, chunk: Buffer, maximum: number): string {
  if (Buffer.byteLength(current) >= maximum) return current;
  return (current + chunk.toString("utf8")).slice(0, maximum);
}

function parseBridgeOutput(stdout: string): IfixAiRunResult {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("iFixAi runner returned no result");
  const value = JSON.parse(line) as { ok?: boolean; error?: string } & Partial<IfixAiRunResult>;
  if (!value.ok) throw new Error(value.error || "iFixAi runner failed");
  if (!value.reports || !value.categories || !value.tests || !Array.isArray(value.failures)) {
    throw new Error("iFixAi runner returned an invalid result contract");
  }
  return value as IfixAiRunResult;
}

export async function runIfixAiBridge(input: {
  python: string;
  bridgePath: string;
  timeoutMs: number;
  request: IfixAiBridgeRequest;
}): Promise<IfixAiRunResult> {
  return await new Promise<IfixAiRunResult>((resolve, reject) => {
    const root = repositoryRoot();
    const child = spawn(input.python, [input.bridgePath], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        IFIXAI_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        // Development may run the source checkout directly. Packaged Python
        // has iFixAi installed and simply ignores this absent source path.
        PYTHONPATH: [path.join(root, "iFixAi"), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, result?: IfixAiRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result as IfixAiRunResult);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("iFixAi runner exceeded its bounded process timeout"));
    }, input.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk, MAX_STDOUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk, MAX_STDERR_BYTES);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      try {
        const result = parseBridgeOutput(stdout);
        if (code !== 0) {
          finish(new Error(`iFixAi runner exited ${code}: ${stderr.trim() || "unknown failure"}`));
          return;
        }
        finish(undefined, result);
      } catch (error) {
        finish(
          new Error(
            `${error instanceof Error ? error.message : String(error)}${
              stderr.trim() ? `: ${stderr.trim()}` : ""
            }`,
          ),
        );
      }
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(JSON.stringify(input.request));
  });
}
