import path from "node:path";
import {
  dashboardDataDir,
  repositoryRoot,
  runtimeV2ServiceRoot,
  runtimeV2ServiceVenv,
} from "../runtime-paths.ts";
import {
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
} from "../external-runtime-filesystem.ts";

export interface Resource2SkillAvailability {
  available: boolean;
  cloned: boolean;
  root: string | null;
  python: string | null;
  pythonVersion: string;
  bridge: string;
  reason?: string;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolveResource2SkillRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.RESOURCE2SKILL_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && externalRuntimePathExists(path.join(explicit, "core", "agent_executor.py"))
      ? explicit
      : null;
  }
  const candidates = [
    explicit,
    path.join(repositoryRoot(), "Resource2Skill"),
  ];
  return candidates.find((candidate) =>
    Boolean(candidate) && externalRuntimePathExists(path.join(candidate as string, "core", "agent_executor.py")),
  ) ?? null;
}

export function resource2SkillVenv(env: NodeJS.ProcessEnv = process.env): string {
  void env;
  return runtimeV2ServiceVenv("resource2skill");
}

export function resource2SkillPython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resource2SkillVenv(env), "Scripts", "python.exe")
    : path.join(resource2SkillVenv(env), "bin", "python");
}

export function resource2SkillWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.RESOURCE2SKILL_WORKSPACE_ROOT) ?? path.join(dashboardDataDir(), "resource2skill-runs");
}

export function resource2SkillBrowserRoot(): string {
  return path.join(runtimeV2ServiceRoot("resource2skill"), "browsers");
}

export function resource2SkillBridge(): string {
  return path.join(repositoryRoot(), "scripts", "resource2skill-bridge.py");
}

export function resource2SkillAvailability(
  env: NodeJS.ProcessEnv = process.env,
): Resource2SkillAvailability {
  const root = resolveResource2SkillRoot(env);
  const python = resource2SkillPython(env);
  const bridge = resource2SkillBridge();
  if (!root) {
    return { available: false, cloned: false, root: null, python: null, pythonVersion: "", bridge, reason: "The Resource2Skill clone was not found. Set RESOURCE2SKILL_ROOT if it is not at ./Resource2Skill." };
  }
  if (!externalRuntimePathExists(bridge)) {
    return { available: false, cloned: true, root, python: null, pythonVersion: "", bridge, reason: "Breadboard's Resource2Skill bridge is missing." };
  }
  if (!externalRuntimePathExists(python)) {
    return { available: false, cloned: true, root, python: null, pythonVersion: "", bridge, reason: "Resource2Skill is cloned but its Python environment is not installed. Open setup to install it." };
  }
  let receipt: { ready?: unknown; version?: unknown } | null = null;
  try {
    const parsed = JSON.parse(
      externalRuntimeReadUtf8(path.join(resource2SkillVenv(env), "breadboard-runtime.json")),
    ) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      receipt = parsed as { ready?: unknown; version?: unknown };
    }
  } catch {
    // A Runtime setup receipt is written only after the fixed dependency and
    // bridge probes complete successfully.
  }
  if (receipt?.ready !== true || typeof receipt.version !== "string") {
    return { available: false, cloned: true, root, python, pythonVersion: "", bridge, reason: "The Resource2Skill environment is incomplete. Run setup again." };
  }
  const pythonVersion = receipt.version;
  if (!pythonVersion.startsWith("3.11.")) {
    return { available: false, cloned: true, root, python, pythonVersion, bridge, reason: `Resource2Skill requires Python 3.11; found ${pythonVersion || "an unknown version"}.` };
  }
  return {
    available: true,
    cloned: true,
    root,
    python,
    pythonVersion,
    bridge,
  };
}
