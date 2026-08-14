import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { resource2SkillAvailability, resolveResource2SkillRoot } from "./runtime.ts";

export interface Resource2SkillSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  runtime: { found: boolean; python: string; version: string };
  domains: { web: boolean; ppt: boolean; excel: boolean; blender: boolean; reaper: boolean };
}

function commandExists(command: string): boolean {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [command], { stdio: "ignore", windowsHide: true });
  return result.status === 0;
}

function pythonProbe(python: string | null, root: string | null, source: string): boolean {
  if (!python || !root) return false;
  const result = spawnSync(python, ["-c", source], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
    timeout: 20_000,
  });
  return result.status === 0;
}

export function setupStatus(): Resource2SkillSetupStatus {
  const availability = resource2SkillAvailability();
  const env = process.env;
  const soundfont = env.VWS_REAPER_SOUNDFONT?.trim();
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    runtime: { found: Boolean(availability.python), python: availability.python ?? "", version: availability.pythonVersion },
    domains: {
      web: availability.available && pythonProbe(
        availability.python,
        availability.root,
        "from pathlib import Path; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); ok=Path(p.chromium.executable_path).is_file(); p.stop(); raise SystemExit(0 if ok else 1)",
      ),
      ppt: availability.available && commandExists("soffice"),
      excel: availability.available,
      blender: availability.available && pythonProbe(availability.python, availability.root, "import bpy"),
      reaper: availability.available && commandExists("fluidsynth") && Boolean(soundfont && fs.existsSync(path.resolve(soundfont))),
    },
  };
}

const setupGlobal = globalThis as typeof globalThis & {
  __breadboardResource2SkillSetup?: Promise<{ ok: boolean; message: string; status: Resource2SkillSetupStatus }>;
};

export function installResource2Skill(action: "install-runtime" | "install-web" | "install-blender") {
  if (setupGlobal.__breadboardResource2SkillSetup) return setupGlobal.__breadboardResource2SkillSetup;
  const operation = new Promise<{ ok: boolean; message: string; status: Resource2SkillSetupStatus }>((resolve) => {
    if (!resolveResource2SkillRoot()) {
      resolve({ ok: false, message: "The Resource2Skill clone was not found.", status: setupStatus() });
      return;
    }
    const script = path.join(repositoryRoot(), "scripts", "setup-resource2skill.mjs");
    const args = [script, "--json"];
    if (action === "install-web") args.push("--with-web");
    if (action === "install-blender") args.push("--with-blender");
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let output = "";
    const collect = (chunk: string) => { output = `${output}${chunk}`.slice(-16_000); };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => resolve({ ok: false, message: error.message, status: setupStatus() }));
    child.on("exit", (code) => {
      const status = setupStatus();
      const last = output.trim().split(/\r?\n/).at(-1) ?? "";
      let message = code === 0 ? "Resource2Skill is ready." : `Setup failed (exit ${code ?? "unknown"}).`;
      try {
        const parsed = JSON.parse(last) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        if (code !== 0 && last) message = last.slice(0, 600);
      }
      resolve({ ok: code === 0 && status.ready, message, status });
    });
  }).finally(() => { setupGlobal.__breadboardResource2SkillSetup = undefined; });
  setupGlobal.__breadboardResource2SkillSetup = operation;
  return operation;
}
