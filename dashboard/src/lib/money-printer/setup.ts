// Building the cloned project's Python environment, on the user's word.
//
// This is the one heavyweight setup in the integration: moviepy, faster-whisper,
// streamlit, litellm, the Azure speech SDK and the whole FastAPI stack are well
// over a gigabyte. A run never triggers it — the agent's settings ask, the user
// presses the button, and everything lands in `MoneyPrinterTurbo/.venv`, which
// the clone's own .gitignore already covers and which `Remove environment`
// deletes again.
//
// uv is preferred when it is on PATH, and `uv sync --frozen` is what the
// project's own README documents: it installs the exact set pinned in uv.lock
// rather than re-resolving, which is the difference between the versions the
// project tests against and whatever resolves today. It can also fetch a
// matching interpreter itself, which matters because ctranslate2 (via
// faster-whisper) publishes no wheel for the newest Python, so a system
// interpreter that is ahead of the wheels falls back to a source build and
// fails.
//
// uv is told to copy rather than hardlink. Its default is to hardlink from its
// own cache into the environment, which fails outright when the checkout sits in
// a cloud-synced folder — OneDrive placeholders reject the link with "The cloud
// operation cannot be performed on a file with incompatible hardlinks", part-way
// through the install. Copying costs disk and a little time; hardlinking costs
// the whole install.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveMoneyPrinterRoot,
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
      "Creates MoneyPrinterTurbo/.venv and installs the video pipeline, its API server and its speech engine.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the pinned dependency set into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Stops the service and deletes MoneyPrinterTurbo/.venv. Videos already made are artifacts and are not touched.",
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
const INSTALL_TIMEOUT_MS = 40 * 60 * 1000;
const VENV_TIMEOUT_MS = 5 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 4 * 60 * 1000;

/** See the note at the top of the file: hardlinking breaks on synced folders. */
const UV_ENV = { UV_LINK_MODE: "copy" };

/** Keep the tail: pip and uv put the actual error at the end of their output. */
function tail(result: CommandResult, lines = 25): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
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
  const runtime = resolveMoneyPrinterRoot();
  if (!runtime) {
    throw new SetupError(404, "The MoneyPrinterTurbo clone was not found next to the dashboard.");
  }
  return runtime.root;
}

/**
 * The install the project documents. `uv sync` builds the environment and
 * installs into it in one step, so there is no separate venv creation on this
 * path.
 */
async function syncWithUv(root: string, uv: string): Promise<SetupResult> {
  const result = await runCommand(uv, ["sync", "--frozen", "--python", "3.12"], {
    cwd: root,
    timeoutMs: INSTALL_TIMEOUT_MS,
    env: UV_ENV,
  });
  if (result.code !== 0 || !venvPython(root)) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "uv could not install the project's pinned dependencies.",
      detail: tail(result),
    };
  }
  return { ok: true, message: "Environment built with uv.", detail: "" };
}

/**
 * The fallback for a machine without uv: the stdlib's own venv plus pip against
 * requirements.txt, which the project keeps in step with pyproject for exactly
 * this case.
 */
async function installWithPip(root: string): Promise<SetupResult> {
  if (!venvPython(root)) {
    const python = findSystemPython();
    if (!python) {
      throw new SetupError(
        409,
        "No Python was found on this machine. Install Python 3.11, 3.12 or 3.13 (or uv), then try again.",
      );
    }
    const created = await runCommand(python, ["-m", "venv", ".venv"], {
      cwd: root,
      timeoutMs: VENV_TIMEOUT_MS,
    });
    if (created.code !== 0 || !venvPython(root)) {
      return {
        ok: false,
        message: "The Python environment could not be created.",
        detail: tail(created),
      };
    }
  }

  const python = venvPython(root);
  if (!python) {
    return {
      ok: false,
      message: "The environment disappeared before the install started.",
      detail: "",
    };
  }
  const result = await runCommand(
    python,
    ["-m", "pip", "install", "-r", "requirements.txt"],
    {
      cwd: root,
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: { PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    },
  );
  if (result.code !== 0) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The dependencies could not be installed.",
      detail: tail(result),
    };
  }
  return { ok: true, message: "Environment built.", detail: "" };
}

/**
 * The API server is what Breadboard actually starts, so that is what the
 * verification has to import — a successful install with a broken ctranslate2
 * build would otherwise read as ready.
 */
async function verify(root: string): Promise<SetupResult> {
  const python = venvPython(root);
  if (!python) {
    return { ok: false, message: "The environment disappeared after the install.", detail: "" };
  }
  const result = await runCommand(python, ["-c", "import app.asgi, uvicorn; print('ok')"], {
    cwd: root,
    timeoutMs: VERIFY_TIMEOUT_MS,
  });
  if (result.code !== 0 || !result.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the API server still does not import.",
      detail: tail(result),
    };
  }
  return { ok: true, message: "MoneyPrinter is installed and ready.", detail: "" };
}

export async function runSetupAction(action: SetupActionId): Promise<SetupResult> {
  const root = requireRoot();
  try {
    if (action === "remove") {
      // The running service holds open file handles inside the very directory
      // about to be deleted, which on Windows makes the removal fail outright.
      await stopService();
      const target = venvDirectory(root);
      if (!fs.existsSync(target)) {
        return { ok: true, message: "There was no environment to remove.", detail: "" };
      }
      // Refuse anything that is not the directory this module creates, so a
      // misconfigured root can never delete a real tree.
      if (path.basename(target) !== ".venv") {
        throw new SetupError(400, "That path is not a MoneyPrinter environment.");
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, message: "Environment removed.", detail: "" };
    }

    if (action === "reinstall") {
      if (!venvPython(root)) {
        throw new SetupError(409, "There is no environment to repair yet. Build it first.");
      }
      // A repair replaces the code the running service imported.
      await stopService();
    }

    const uv = uvPath();
    const installed = uv ? await syncWithUv(root, uv) : await installWithPip(root);
    if (!installed.ok) return installed;
    return await verify(root);
  } finally {
    invalidateHealth();
  }
}
