// One-time preparation for God's Eye: `npm install` in the checkout.
//
// Unlike OpenMAIC there is no build and no Breadboard-owned copy — the Vite dev
// server runs straight from the clone, and npm's node_modules tree, unlike
// pnpm's junctions, is happy where it is installed. What stays true is the
// rule from ADDING_AN_AGENT.md: an install runs only because a person pressed
// the button in the settings dialog. A run must never install anything.

import { spawn } from "node:child_process";
import path from "node:path";
import {
  externalRuntimePathExists,
  externalRuntimePortableRealpath,
} from "../external-runtime-filesystem.ts";
import { googleMapsKeyStatus } from "./credentials.ts";
import { godsEyeAvailability, resolveGodsEyeRoot } from "./runtime.ts";
import { currentService } from "./service.ts";

export interface GodsEyeSetupProgress {
  running: boolean;
  step: string;
  log: string;
  error: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardGodsEyeSetup?: GodsEyeSetupProgress | null;
};

function progress(): GodsEyeSetupProgress {
  return (
    runtimeGlobal.__breadboardGodsEyeSetup ?? {
      running: false,
      step: "",
      log: "",
      error: "",
      startedAt: null,
      finishedAt: null,
    }
  );
}

/** npm's JavaScript entry next to the Node binary this process runs on. */
export function npmEntry(execPath: string = process.execPath): string | null {
  const entry = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!externalRuntimePathExists(entry)) return null;
  try {
    // The packaged runtime uses a trusted Windows verbatim path. Node accepts
    // that spelling for its executable, but not for the JavaScript entry in
    // argv[1], so hand the child the normal absolute spelling after checking it.
    return externalRuntimePortableRealpath(entry);
  } catch {
    return null;
  }
}

export function setupStatus() {
  const availability = godsEyeAvailability();
  const service = currentService();
  const key = googleMapsKeyStatus();
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    installed: availability.installed,
    key,
    service: { running: Boolean(service), baseUrl: service?.baseUrl ?? "" },
    setup: progress(),
  };
}

/**
 * Install the clone's dependencies in the background. Returns at once; the
 * settings dialog polls `setupStatus` for the tail of the log. The argv is
 * fixed — nothing a model produces reaches this function.
 */
export function startGodsEyeSetup(): GodsEyeSetupProgress {
  const current = progress();
  if (current.running) return current;
  const root = resolveGodsEyeRoot();
  if (!root) {
    const failed: GodsEyeSetupProgress = {
      running: false,
      step: "clone",
      log: "",
      error: "The gods-eye-view clone was not found next to the dashboard.",
      startedAt: null,
      finishedAt: new Date().toISOString(),
    };
    runtimeGlobal.__breadboardGodsEyeSetup = failed;
    return failed;
  }
  const npm = npmEntry();
  if (!npm) {
    const failed: GodsEyeSetupProgress = {
      running: false,
      step: "npm",
      log: "",
      error: "npm was not found next to this Node runtime, so the install cannot be run here.",
      startedAt: null,
      finishedAt: new Date().toISOString(),
    };
    runtimeGlobal.__breadboardGodsEyeSetup = failed;
    return failed;
  }

  const state: GodsEyeSetupProgress = {
    running: true,
    step: "installing dependencies",
    log: "",
    error: "",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  runtimeGlobal.__breadboardGodsEyeSetup = state;

  const child = spawn(
    process.execPath,
    [npm, "install", "--no-audit", "--no-fund", "--loglevel", "info"],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  const collect = (chunk: string) => {
    state.log = `${state.log}${chunk}`.slice(-8_000);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("error", (error) => {
    state.running = false;
    state.error = error.message;
    state.finishedAt = new Date().toISOString();
  });
  child.on("exit", (code) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    if (code !== 0) {
      state.error = `npm install exited with code ${code}. ${state.log.slice(-400)}`.trim();
    } else {
      state.step = "installed";
    }
  });
  return state;
}
