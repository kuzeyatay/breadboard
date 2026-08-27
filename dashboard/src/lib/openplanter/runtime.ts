import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directPath(candidate: string, kind: "file" | "directory"): string | null {
  const resolved = path.resolve(candidate);
  try {
    const metadata = fs.lstatSync(resolved);
    if (
      metadata.isSymbolicLink() ||
      (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
      !samePath(fs.realpathSync.native(resolved), resolved)
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function isOpenPlanterClone(candidate: string): boolean {
  return Boolean(
    directPath(candidate, "directory") &&
      directPath(path.join(candidate, "agent", "runtime.py"), "file") &&
      directPath(path.join(candidate, "agent", "builder.py"), "file") &&
      directPath(path.join(candidate, "pyproject.toml"), "file"),
  );
}

/** Resolve only a trusted, direct clone. Runtime profiles seal OPENPLANTER_ROOT. */
export function resolveOpenPlanterRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = configured(env.OPENPLANTER_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isOpenPlanterClone(explicit) ? explicit : null;
  }
  const candidates = [explicit, path.join(repositoryRoot(), "OpenPlanter")].filter(
    (value): value is string => Boolean(value),
  );
  return candidates.find(isOpenPlanterClone) ?? null;
}

function dashboardRuntimeRoot(env: NodeJS.ProcessEnv): string {
  const configuredRoot =
    configured(env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT) ??
    configured(env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR);
  if (configuredRoot) return configuredRoot;
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd())
    : path.join(repositoryRoot(), "dashboard");
}

export function openPlanterRunnerPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return directPath(
    path.join(dashboardRuntimeRoot(env), "scripts", "openplanter-chatmock-runner.py"),
    "file",
  );
}

/**
 * The executable is selected only by the sealed worker environment. A bare
 * default is resolved through the worker profile's closed PATH, never through
 * renderer input.
 */
export function openPlanterPythonCommand(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.OPENPLANTER_PYTHON?.trim();
  if (explicit) {
    if (Buffer.byteLength(explicit, "utf8") > 4_096 || /[\u0000\r\n]/u.test(explicit)) {
      return null;
    }
    if (path.isAbsolute(explicit)) return directPath(explicit, "file");
    if (explicit !== "python" && explicit !== "python3") return null;
    return explicit;
  }
  return process.platform === "win32" ? "python" : "python3";
}

export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  reason?: string;
  installed: boolean;
} {
  const root = resolveOpenPlanterRoot(env);
  if (!root) {
    return { available: false, installed: false, reason: "OpenPlanter clone was not found" };
  }
  if (!openPlanterRunnerPath(env)) {
    return {
      available: false,
      installed: true,
      reason: "OpenPlanter ChatMock bridge is missing",
    };
  }
  if (!openPlanterPythonCommand(env)) {
    return { available: false, installed: true, reason: "Python 3 is unavailable" };
  }
  return { available: true, installed: true };
}
