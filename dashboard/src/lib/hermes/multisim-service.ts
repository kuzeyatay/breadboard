import { spawn } from "node:child_process";
import { externalRuntimeFilesystem as fs, externalRuntimePortableRealpath } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";

const STUDIES = new Set(["parameter_sweep", "monte_carlo_analysis", "optimize_values"]);

export function multisimRequest(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Circuit request must be an object");
  const request = input as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["action", "arguments"].includes(key))) throw new Error("Unknown circuit request field");
  if (typeof request.action !== "string" || !/^[a-z][a-z_]{0,63}$/.test(request.action)) throw new Error("Invalid circuit action");
  const args = request.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Circuit arguments must be an object");
  const argumentsCopy = { ...args as Record<string, unknown> };
  if (STUDIES.has(request.action)) {
    const timeout = argumentsCopy.timeout ?? 300;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > 300) throw new Error("Native circuit studies allow up to 300 seconds; use the CLI for longer studies");
    argumentsCopy.timeout = timeout;
  }
  const payload = JSON.stringify(argumentsCopy);
  if (Buffer.byteLength(payload) > 384 * 1024) throw new Error("Circuit request exceeds 384 KiB");
  return { action: request.action, payload };
}

export async function runMultisim(workspace: string, input: unknown, options: { signal?: AbortSignal; configPath?: string } = {}): Promise<unknown> {
  const { action, payload } = multisimRequest(input);
  const configPath = options.configPath ?? path.join(repositoryRoot(), ".runtime", "multisim.json");
  if (!fs.existsSync(configPath)) throw new Error("Multisim Agent is not installed. Run npm run setup:multisim.");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { python: string; ngspice?: string };
  if (typeof config.python !== "string" || !fs.existsSync(config.python)) throw new Error("Circuit Python runtime is unavailable; rerun setup:multisim");
  fs.mkdirSync(workspace, { recursive: true });
  const root = externalRuntimePortableRealpath(workspace);
  const directory = path.join(root, ".breadboard", "multisim");
  for (const candidate of [path.join(root, ".breadboard"), directory]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error("Circuit workspace must not be a symbolic link");
    fs.mkdirSync(candidate, { recursive: true });
  }
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, ["-m", "breadboard_multisim", "--workspace", directory, "call", action], {
      cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, ...(config.ngspice ? { BREADBOARD_NGSPICE: config.ngspice } : {}) },
    });
    let output = "", errors = "", bytes = 0, failure: Error | null = null;
    const stop = (reason: string) => {
      if (failure) return;
      failure = new Error(reason);
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      } else if (child.pid) {
        // ngspice inherits this process group, so cancellation stops the solver too.
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else child.kill("SIGTERM");
    };
    const timer = setTimeout(() => stop("Circuit operation exceeded its 330 second native budget"), 330_000);
    const abort = () => stop("Circuit operation cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2 * 1024 * 1024) stop("Circuit response exceeds 2 MiB; inspect persisted artifacts");
      else output += chunk;
    });
    child.stderr.on("data", (chunk: string) => { errors = (errors + chunk).slice(-4000); });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
    child.on("error", (error) => { cleanup(); reject(error); });
    child.stdin.on("error", () => { /* Child close/error reports the cause. */ });
    child.on("close", (code) => {
      cleanup();
      if (failure) return reject(failure);
      try {
        const result = JSON.parse(output);
        if (code !== 0) return reject(new Error(result.error ?? `Circuit worker exited ${code}`));
        resolve(result);
      } catch (error) { reject(new Error(`Circuit worker returned invalid data: ${errors || String(error)}`)); }
    });
    child.stdin.end(payload);
  });
}
