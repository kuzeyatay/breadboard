import { spawn } from "node:child_process";
import {
  OfficeCliError,
  OFFICE_OUTPUT_LIMIT_BYTES,
  OFFICE_RUN_TIMEOUT_MS,
  resolveOfficeCli,
} from "./contract.ts";

export {
  OfficeCliError,
  OFFICE_OUTPUT_LIMIT_BYTES,
  OFFICE_RUN_TIMEOUT_MS,
  containWorkspacePath,
  resolveOfficeCli,
  tokenizeOfficeCommand,
  validateOfficeCommand,
  type ValidatedOfficeCommand,
} from "./contract.ts";

// OfficeCLI (github.com/iOfficeAI/OfficeCLI) is a self-contained native binary
// that reads and writes .docx/.xlsx/.pptx through a document DOM. Breadboard
// pins release v1.0.143 — the same tag the vendored OfficeCLI/ clone is checked
// out at, so the skills the catalog serves describe exactly the binary that
// runs. The binary itself is machine-local (provisioned by
// `npm run setup:officecli` into .runtime/officecli), never committed.

const PINNED_VERSION = "1.0.143";

/**
 * Environment for every OfficeCLI spawn. The pinned binary must never
 * self-update out from under the vendored skills. Runtime V2 Office work is a
 * finite job, so an invocation must not auto-start OfficeCLI's 60-second
 * resident process. Writes are also flushed before returning so non-OfficeCLI
 * readers — the artifact importer, the garden — always see current bytes.
 */
export function officeCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    OFFICECLI_SKIP_UPDATE: "1",
    OFFICECLI_NO_AUTO_RESIDENT: "1",
    OFFICECLI_RESIDENT_FLUSH: "each",
    NO_COLOR: "1",
  };
}

export interface OfficeCliResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

/** Run the pinned binary with an argv that has already been validated. */
export function runOfficeCli(
  argv: string[],
  options: {
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Promise<OfficeCliResult> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const binary = resolveOfficeCli(options.env ?? process.env);
  if (!binary) {
    throw new OfficeCliError(
      503,
      "officecli_unavailable",
      `OfficeCLI ${PINNED_VERSION} is not installed. Run \`npm run setup:officecli\` from the repository root.`,
    );
  }
  const timeoutMs = options.timeoutMs ?? OFFICE_RUN_TIMEOUT_MS;
  return new Promise<OfficeCliResult>((resolvePromise, rejectPromise) => {
    const child = spawn(binary, argv, {
      cwd: options.cwd,
      env: officeCliEnv(options.env ?? process.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        if (stdout.length < OFFICE_OUTPUT_LIMIT_BYTES) stdout += text;
        else truncated = true;
      } else if (stderr.length < 64_000) {
        stderr += text;
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const cancel = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", cancel, { once: true });
    const finished = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    child.on("error", (error) => {
      finished();
      rejectPromise(
        new OfficeCliError(500, "officecli_spawn_failed", `OfficeCLI could not start: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      finished();
      resolvePromise({
        code: code ?? -1,
        stdout: stdout.slice(0, OFFICE_OUTPUT_LIMIT_BYTES),
        stderr,
        truncated,
        timedOut,
      });
    });
  });
}
