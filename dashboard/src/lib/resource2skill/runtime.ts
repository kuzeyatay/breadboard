import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

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
    return explicit && fs.existsSync(path.join(explicit, "core", "agent_executor.py"))
      ? explicit
      : null;
  }
  const candidates = [
    explicit,
    path.join(repositoryRoot(), "Resource2Skill"),
    path.resolve(process.cwd(), "Resource2Skill"),
    path.resolve(process.cwd(), "..", "Resource2Skill"),
  ];
  return candidates.find((candidate) =>
    Boolean(candidate) && fs.existsSync(path.join(candidate as string, "core", "agent_executor.py")),
  ) ?? null;
}

export function resource2SkillVenv(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.RESOURCE2SKILL_VENV) ?? path.join(repositoryRoot(), ".runtime", "resource2skill-venv");
}

export function resource2SkillPython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resource2SkillVenv(env), "Scripts", "python.exe")
    : path.join(resource2SkillVenv(env), "bin", "python");
}

export function resource2SkillWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.RESOURCE2SKILL_WORKSPACE_ROOT) ?? path.join(dashboardDataDir(), "resource2skill-runs");
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
  if (!fs.existsSync(bridge)) {
    return { available: false, cloned: true, root, python: null, pythonVersion: "", bridge, reason: "Breadboard's Resource2Skill bridge is missing." };
  }
  if (!fs.existsSync(python)) {
    return { available: false, cloned: true, root, python: null, pythonVersion: "", bridge, reason: "Resource2Skill is cloned but its Python environment is not installed. Open setup or run npm run setup:resource2skill." };
  }
  const probe = spawnSync(python, ["-c", "import sys; print(sys.version.split()[0]); import mcp, openpyxl, playwright, pptx"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  if (probe.status !== 0) {
    return { available: false, cloned: true, root, python, pythonVersion: "", bridge, reason: "The Resource2Skill environment is incomplete. Run setup again." };
  }
  const pythonVersion = (probe.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
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
