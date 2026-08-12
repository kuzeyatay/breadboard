// User-initiated setup for the career-ops workspace.
//
// This is a DIFFERENT trust context from ./commands.ts. That module bounds what
// a *model* may run during a chat turn, and deliberately refuses every package
// manager. Here the user is the one asking, from the Agents tab, so installing
// is available — but only as fixed argv this module owns. Nothing a caller sends
// becomes a command: the request names an action from the table below.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import {
  careerOpsEnv,
  dependenciesInstalled,
  invalidateHealth,
  resolveCareerOpsRoot,
} from "./runtime.ts";

export class SetupError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.name = "SetupError";
  }
}

export type SetupAction = "install" | "browsers" | "scaffold";

export const SETUP_ACTIONS: Array<{
  id: SetupAction;
  label: string;
  /** What the user gets once this finishes. */
  unlocks: string;
}> = [
  {
    id: "install",
    label: "Install dependencies",
    unlocks: "Everything career-ops does: evaluation, tracker, CVs, cover letters, reports.",
  },
  {
    id: "browsers",
    label: "Install the scanning browser",
    unlocks: "Portal scanning and reading a job description straight from its URL.",
  },
  {
    id: "scaffold",
    label: "Create the candidate files",
    unlocks:
      "config/profile.yml, modes/_profile.md and a starter cv.md, so the agent can judge fit against you rather than against nobody.",
  },
];

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Files copied into place when the user asks for a scaffold. Each is an upstream
 * template that career-ops's own doctor expects to exist; a file that is already
 * there is never overwritten, because it is the user's.
 */
const SCAFFOLD: Array<{ target: string; template: string }> = [
  { target: "config/profile.yml", template: "config/profile.example.yml" },
  { target: "modes/_profile.md", template: "modes/_profile.template.md" },
  { target: "modes/_custom.md", template: "modes/_custom.template.md" },
  { target: "modes/_brief.md", template: "modes/_brief.template.md" },
  { target: "cv.md", template: "examples/cv-example.md" },
  { target: "portals.yml", template: "templates/portals.example.yml" },
];

/**
 * Run an installer whose argv this module owns. npm and npx are .cmd shims on
 * Windows, which Node refuses to spawn without a shell; `planSpawn` is the
 * repository's answer to that — it resolves the shim and builds a cmd.exe
 * envelope with each argument quoted, so no shell ever sees a joined string.
 */
function runFixed(
  root: string,
  command: string,
  args: string[],
): Promise<{ code: number | null; output: string }> {
  const env = careerOpsEnv();
  const plan = planSpawn(
    command,
    args,
    env,
    (name) => `${name} was not found on this machine, so this setup step cannot run.`,
  );
  if ("error" in plan) return Promise.resolve({ code: null, output: plan.error });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(plan.command, plan.argv, {
        cwd: root,
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: plan.verbatim,
      });
    } catch (error) {
      resolve({ code: null, output: error instanceof Error ? error.message : "spawn failed" });
      return;
    }
    let output = "";
    const append = (chunk: string) => {
      if (output.length < 40_000) output += chunk;
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\n${error.message}`.trim() });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

export interface SetupResult {
  action: SetupAction;
  ok: boolean;
  message: string;
  /** Tail of the installer output, for the panel to show on failure. */
  detail: string;
}

function tail(output: string, lines = 12): string {
  return output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-lines)
    .join("\n");
}

export async function runSetup(action: SetupAction): Promise<SetupResult> {
  const runtime = resolveCareerOpsRoot();
  if (!runtime) {
    throw new SetupError(
      404,
      "not_cloned",
      "The career-ops clone was not found next to the dashboard.",
    );
  }
  const root = runtime.root;

  if (action === "scaffold") {
    const created: string[] = [];
    const skipped: string[] = [];
    for (const entry of SCAFFOLD) {
      const target = path.join(root, ...entry.target.split("/"));
      const template = path.join(root, ...entry.template.split("/"));
      if (fs.existsSync(target)) {
        skipped.push(entry.target);
        continue;
      }
      if (!fs.existsSync(template)) continue;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(template, target);
        created.push(entry.target);
      } catch (error) {
        throw new SetupError(
          500,
          "scaffold_failed",
          `Could not create ${entry.target}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    invalidateHealth();
    return {
      action,
      ok: true,
      message: created.length
        ? `Created ${created.join(", ")}. They are starting points — replace the example CV and profile with the user's own.`
        : "Every candidate file already exists; nothing was overwritten.",
      detail: skipped.length ? `Left alone: ${skipped.join(", ")}` : "",
    };
  }

  if (action === "install") {
    // `--ignore-scripts` skips career-ops's postinstall, which downloads a
    // browser. That is the "browsers" action's job, so a user who only wants
    // evaluation and CVs is not made to wait for a few hundred megabytes.
    const result = await runFixed(root, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
    invalidateHealth();
    const ok = result.code === 0 && dependenciesInstalled(root);
    return {
      action,
      ok,
      message: ok
        ? "career-ops's dependencies are installed."
        : "The dependency install did not finish. The output below says why.",
      detail: tail(result.output),
    };
  }

  const result = await runFixed(root, "npx", ["--yes", "playwright", "install", "chromium"]);
  invalidateHealth();
  const ok = result.code === 0;
  return {
    action,
    ok,
    message: ok
      ? "The scanning browser is installed. Portal scans and URL extraction work now."
      : "The browser install did not finish. The output below says why.",
    detail: tail(result.output),
  };
}
