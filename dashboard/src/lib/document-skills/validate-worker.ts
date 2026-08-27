// Worker-only adapter around the vendored book-to-skill validator. Production
// Next code reaches this module only through the Runtime V2 Office worker.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";
import { cloneRoot } from "./bridge.ts";

const VALIDATE_TIMEOUT_MS = 30_000;

export interface SkillValidation {
  ran: boolean;
  ok: boolean;
  warnings: string[];
}

function pythonCandidates(): string[] {
  const configured = process.env.BOOK_TO_SKILL_PYTHON?.trim();
  const venv = process.platform === "win32"
    ? path.join(cloneRoot(), ".venv", "Scripts", "python.exe")
    : path.join(cloneRoot(), ".venv", "bin", "python");
  return [
    ...(configured ? [configured] : []),
    ...(fs.existsSync(venv) ? [venv] : []),
    ...(process.platform === "win32" ? ["python.exe", "python"] : ["python3", "python"]),
  ];
}

function runValidator(
  python: string,
  script: string,
  skillFile: string,
  signal?: AbortSignal,
): Promise<{ code: number; output: string } | null> {
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
    const cancel = () => child.kill("SIGKILL");
    const finish = (value: { code: number; output: string } | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, VALIDATE_TIMEOUT_MS);
    signal?.addEventListener("abort", cancel, { once: true });
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

export async function validateGeneratedSkillFileInWorker(
  skillFile: string,
  options: { signal?: AbortSignal } = {},
): Promise<SkillValidation> {
  const script = path.join(cloneRoot(), "tools", "validate_skill.py");
  if (!fs.existsSync(script) || !fs.existsSync(skillFile)) {
    return { ran: false, ok: true, warnings: [] };
  }
  for (const python of pythonCandidates()) {
    if (options.signal?.aborted) return { ran: false, ok: true, warnings: [] };
    const result = await runValidator(python, script, skillFile, options.signal);
    if (!result) continue;
    const lines = result.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("WARN") || line.startsWith("ERROR"));
    return {
      ran: true,
      ok: result.code === 0,
      warnings: lines
        .filter((line) => line.startsWith("ERROR"))
        .map((line) => `book-to-skill validator: ${line}`),
    };
  }
  return { ran: false, ok: true, warnings: [] };
}
