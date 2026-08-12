// Runs the clone's own SKILL.md auditor over a skill Breadboard just wrote.
//
// The value here is that it is not our checker: `tools/validate_skill.py` is
// maintained against the Agent Skills standard and the three hosts' rules, so
// if Breadboard's generated frontmatter ever drifts from the format, the clone
// says so rather than us discovering it when a skill silently fails to load.
//
// Failure is never fatal. A missing interpreter or an absent clone means the
// skill goes out unvalidated with a note, not that a completed build is thrown
// away.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { cloneRoot } from "./bridge.ts";
import { skillDirectory } from "./store.ts";

const VALIDATE_TIMEOUT_MS = 30_000;

export interface SkillValidation {
  ran: boolean;
  ok: boolean;
  warnings: string[];
}

function pythonCandidates(): string[] {
  const configured = process.env.BOOK_TO_SKILL_PYTHON?.trim();
  const venv =
    process.platform === "win32"
      ? path.join(cloneRoot(), ".venv", "Scripts", "python.exe")
      : path.join(cloneRoot(), ".venv", "bin", "python");
  return [
    ...(configured ? [configured] : []),
    ...(fs.existsSync(venv) ? [venv] : []),
    ...(process.platform === "win32" ? ["python.exe", "python"] : ["python3", "python"]),
  ];
}

function runValidator(python: string, script: string, skillFile: string): Promise<{ code: number; output: string } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, [script, "--lens", "claude", skillFile], {
        cwd: repositoryRoot(),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }
    let output = "";
    let settled = false;
    const finish = (value: { code: number; output: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, VALIDATE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code: code ?? 1, output });
    });
  });
}

export async function validateGeneratedSkill(slug: string): Promise<SkillValidation> {
  const script = path.join(cloneRoot(), "tools", "validate_skill.py");
  const skillFile = path.join(skillDirectory(slug), "SKILL.md");
  if (!fs.existsSync(script) || !fs.existsSync(skillFile)) {
    return { ran: false, ok: true, warnings: [] };
  }

  for (const python of pythonCandidates()) {
    const result = await runValidator(python, script, skillFile);
    if (!result) continue;
    const lines = result.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("WARN") || line.startsWith("ERROR"));
    return {
      ran: true,
      ok: result.code === 0,
      // Errors matter (the skill may not load); warnings are the clone's soft
      // guidelines and would only be noise on every single build.
      warnings: lines.filter((line) => line.startsWith("ERROR")).map((line) => `book-to-skill validator: ${line}`),
    };
  }
  return { ran: false, ok: true, warnings: [] };
}
