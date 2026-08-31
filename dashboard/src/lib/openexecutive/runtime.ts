import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot, runtimeV2ServiceVenv } from "../runtime-paths.ts";

export interface OpenExecutiveRuntime {
  root: string;
  source: "configured" | "repository";
}
export interface OpenExecutiveHealth {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  bridgeFound: boolean;
  reason: string | null;
}

function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "packages", "core", "pyproject.toml")) &&
    fs.existsSync(
      path.join(
        candidate,
        "packages",
        "core",
        "openexecutive",
        "orchestrator",
        "executive.py",
      ),
    )
  );
}

export function resolveOpenExecutiveRoot(
  env: NodeJS.ProcessEnv = process.env,
): OpenExecutiveRuntime | null {
  const configured = env.OPENEXECUTIVE_ROOT?.trim();
  const candidates: OpenExecutiveRuntime[] = [
    ...(configured
      ? [{ root: path.resolve(configured), source: "configured" as const }]
      : []),
    {
      root: path.join(repositoryRoot(), "OpenExecutive"),
      source: "repository" as const,
    },
  ];
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function openExecutiveBridgePath(): string | null {
  const candidate = path.join(repositoryRoot(), "scripts", "openexecutive-bridge.py");
  return fs.existsSync(candidate) ? candidate : null;
}

export function openExecutivePython(): string | null {
  const venv = runtimeV2ServiceVenv("openexecutive");
  const candidate =
    process.platform === "win32"
      ? path.join(venv, "Scripts", "python.exe")
      : path.join(venv, "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

export function openExecutiveHealth(): OpenExecutiveHealth {
  const runtime = resolveOpenExecutiveRoot();
  const bridgeFound = Boolean(openExecutiveBridgePath());
  const environmentReady = Boolean(openExecutivePython());
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady,
      bridgeFound,
      reason: "The OpenExecutive clone was not found next to Breadboard.",
    };
  }
  if (!environmentReady) {
    return {
      available: false,
      cloned: true,
      root: runtime.root,
      environmentReady: false,
      bridgeFound,
      reason:
        "Open Executive is cloned but its managed Python environment has not been built yet.",
    };
  }
  if (!bridgeFound) {
    return {
      available: false,
      cloned: true,
      root: runtime.root,
      environmentReady: true,
      bridgeFound: false,
      reason: "Breadboard's Open Executive bridge is missing.",
    };
  }
  return {
    available: true,
    cloned: true,
    root: runtime.root,
    environmentReady: true,
    bridgeFound: true,
    reason: null,
  };
}
