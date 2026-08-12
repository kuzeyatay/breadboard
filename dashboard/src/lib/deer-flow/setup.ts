// Building the cloned DeerFlow backend's Python environment, on the user's word.
//
// This is the one heavyweight setup in the integration: LangGraph, LangChain,
// FastAPI, the two local workspace packages and their transitive tree are well
// over a gigabyte. A run never triggers it — the agent's settings panel asks,
// the user presses the button, and everything lands in `deer-flow/backend/.venv`,
// which the clone's own .gitignore already covers and which "Remove environment"
// deletes again.
//
// `uv sync --all-packages` is the only install path, because it is the only one
// that resolves the backend's own uv workspace: `deerflow-harness` and
// `deerflow-extension-api` are local path members, and a plain pip install of
// the backend leaves both out — the Gateway then imports and dies on the first
// request instead of at install time.
//
// uv is told to copy rather than hardlink. Its default is to hardlink from its
// own cache into the environment, which fails outright when the checkout sits in
// a cloud-synced folder — OneDrive placeholders reject the link part-way through
// a thousand-package install.

import fs from "node:fs";
import path from "node:path";
import {
  backendDirectory,
  invalidateHealth,
  resolveDeerFlowRoot,
  runCommand,
  uvPath,
  venvDirectory,
  venvPython,
  type CommandResult,
} from "./runtime.ts";
import { stopService } from "./service.ts";

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates deer-flow/backend/.venv and installs the Gateway, the agent harness and their dependencies.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Re-syncs the environment against the clone's current lockfile.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Stops the Gateway and deletes deer-flow/backend/.venv. Nothing else in the clone is touched.",
  },
] as const;

export type SetupActionId = (typeof SETUP_ACTIONS)[number]["id"];

export function isSetupAction(value: unknown): value is SetupActionId {
  return SETUP_ACTIONS.some((action) => action.id === value);
}

export interface SetupResult {
  ok: boolean;
  message: string;
  /** Command output, trimmed to the tail that explains a failure. */
  detail: string;
}

// This tree genuinely takes tens of minutes on a cold wheel cache.
const SYNC_TIMEOUT_MS = 40 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000;

/** See the note at the top of the file: hardlinking breaks on synced folders. */
const UV_ENV = { UV_LINK_MODE: "copy" };

/** Keep the tail: uv puts the actual error at the end of its output. */
function tail(result: CommandResult, lines = 25): string {
  return `${result.stdout}\n${result.stderr}`
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines)
    .join("\n");
}

class SetupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export { SetupError };

function requireRoot(): string {
  const runtime = resolveDeerFlowRoot();
  if (!runtime) {
    throw new SetupError(404, "The DeerFlow clone was not found next to the dashboard.");
  }
  return runtime.root;
}

async function sync(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (!uv) {
    throw new SetupError(
      409,
      "DeerFlow's backend is a uv workspace, so building it needs uv. Install it from docs.astral.sh/uv, then try again.",
    );
  }
  const backend = backendDirectory(root);
  const result = await runCommand(uv, ["sync", "--all-packages"], {
    cwd: backend,
    timeoutMs: SYNC_TIMEOUT_MS,
    env: UV_ENV,
  });
  if (result.code !== 0 || !venvPython(root)) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The DeerFlow environment could not be built.",
      detail: tail(result),
    };
  }

  // The Gateway is what Breadboard actually starts, so that is what the
  // verification has to import — a successful sync with a missing workspace
  // member would otherwise read as ready.
  const python = venvPython(root);
  const verify = await runCommand(
    python as string,
    ["-c", "import app.gateway.app, uvicorn; print('ok')"],
    { cwd: backend, timeoutMs: VERIFY_TIMEOUT_MS, env: { PYTHONPATH: backend } },
  );
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the DeerFlow Gateway still does not import.",
      detail: tail(verify),
    };
  }
  return { ok: true, message: "DeerFlow is installed and ready.", detail: "" };
}

export async function runSetupAction(action: SetupActionId): Promise<SetupResult> {
  const root = requireRoot();
  try {
    if (action === "remove") {
      // The running Gateway holds open file handles inside the very directory
      // about to be deleted, which on Windows makes the removal fail outright.
      await stopService();
      const target = venvDirectory(root);
      if (!fs.existsSync(target)) {
        return { ok: true, message: "There was no environment to remove.", detail: "" };
      }
      // Refuse anything that is not the directory this module creates, so a
      // misconfigured root can never delete a real tree.
      if (path.basename(target) !== ".venv") {
        throw new SetupError(400, "That path is not a DeerFlow environment.");
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, message: "Environment removed.", detail: "" };
    }

    if (action === "reinstall") {
      if (!venvPython(root)) {
        throw new SetupError(409, "There is no environment to repair yet. Build it first.");
      }
      // A repair replaces the code the running Gateway imported.
      await stopService();
    }

    return await sync(root);
  } finally {
    invalidateHealth();
  }
}
