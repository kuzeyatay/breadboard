// Building the cloned project's Python environment, on the user's word.
//
// This is the one heavyweight setup in the integration: litellm, pandas,
// akshare, tushare, pytdx, baostock, yfinance, futu-api, longbridge, FastAPI,
// newspaper3k and six notification SDKs are well over a gigabyte. A run never
// triggers it — the settings dialog asks, the user presses the button, and
// everything lands in `daily_stock_analysis/.venv`, which the clone's own
// .gitignore already covers and which `Remove environment` deletes again.
//
// uv is preferred when it is on PATH: it can fetch a compatible interpreter
// itself, which matters because several of these wheels lag the newest CPython
// by a release or two, and a missing wheel means a source build that fails.
// `python -m venv` plus pip is the fallback, and it uses the interpreter already
// found by the runtime probe.
//
// uv is told to copy rather than hardlink. Its default is to hardlink from its
// own cache into the environment, which fails outright when the checkout sits in
// a cloud-synced folder — OneDrive placeholders reject the link with "The cloud
// operation cannot be performed on a file with incompatible hardlinks",
// part-way through the install. Copying costs disk; hardlinking costs the whole
// install.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveStockAnalystRoot,
  runCommand,
  stateHome,
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
      "Creates daily_stock_analysis/.venv and installs the analysis backend, its market-data sources and its API server.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the requirements into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Stops the service and deletes daily_stock_analysis/.venv. Nothing else in the clone is touched.",
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
const VERIFY_TIMEOUT_MS = 6 * 60 * 1000;

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
  const runtime = resolveStockAnalystRoot();
  if (!runtime) {
    throw new SetupError(404, "The daily_stock_analysis clone was not found next to the dashboard.");
  }
  return runtime.root;
}

async function createEnvironment(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (uv) {
    // `--python 3.12` lets uv download a matching interpreter when the machine
    // has none in range: the newest system Python is usually ahead of what this
    // tree's compiled wheels are built for.
    const result = await runCommand(uv, ["venv", "--python", "3.12", ".venv"], {
      cwd: root,
      timeoutMs: VENV_TIMEOUT_MS,
      env: UV_ENV,
    });
    if (result.code === 0 && venvPython(root)) {
      return { ok: true, message: "Environment created with uv.", detail: "" };
    }
    // uv failing here is usually "no interpreter available and downloads are
    // off"; fall through to the stdlib path rather than stopping.
  }

  const python = findSystemPython();
  if (!python) {
    throw new SetupError(
      409,
      "No Python was found on this machine. Install Python 3.11, 3.12 or 3.13 (or uv), then try again.",
    );
  }
  const result = await runCommand(python, ["-m", "venv", ".venv"], {
    cwd: root,
    timeoutMs: VENV_TIMEOUT_MS,
  });
  if (result.code !== 0 || !venvPython(root)) {
    return {
      ok: false,
      message: "The Python environment could not be created.",
      detail: tail(result),
    };
  }
  return { ok: true, message: "Environment created.", detail: "" };
}

async function installProject(root: string): Promise<SetupResult> {
  const python = venvPython(root);
  if (!python) {
    return {
      ok: false,
      message: "The environment disappeared before the install started.",
      detail: "",
    };
  }
  const uv = uvPath();
  // The clone has no packaging metadata — `pyproject.toml` is formatter
  // configuration only — so `requirements.txt` is the whole install, and the
  // backend is run from the checkout rather than from site-packages.
  const result = uv
    ? await runCommand(uv, ["pip", "install", "--python", python, "-r", "requirements.txt"], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
        env: UV_ENV,
      })
    : await runCommand(python, ["-m", "pip", "install", "-r", "requirements.txt"], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
        env: { PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      });

  if (result.code !== 0) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The requirements could not be installed.",
      detail: tail(result),
    };
  }

  // The API server is what Breadboard actually starts, so that is what the
  // verification has to import — a successful pip run with one broken data-source
  // wheel behind it would otherwise read as ready. The throwaway `ENV_FILE` keeps
  // the check from loading the user's own configuration.
  const home = stateHome();
  const verify = await runCommand(python, ["-c", "import uvicorn, api.app; print('ok')"], {
    cwd: root,
    timeoutMs: VERIFY_TIMEOUT_MS,
    env: {
      ENV_FILE: path.join(home, "probe.env"),
      DATABASE_PATH: path.join(home, "data", "stock_analysis.db"),
      LOG_DIR: path.join(home, "logs"),
    },
  });
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the API server still does not import.",
      detail: tail(verify),
    };
  }
  return {
    ok: true,
    message: "Stock Analyst is installed and ready.",
    detail: "",
  };
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
        throw new SetupError(400, "That path is not a Stock Analyst environment.");
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, message: "Environment removed.", detail: "" };
    }

    if (action === "install" && !venvPython(root)) {
      const created = await createEnvironment(root);
      if (!created.ok) return created;
    }

    if (action === "reinstall") {
      if (!venvPython(root)) {
        throw new SetupError(409, "There is no environment to repair yet. Build it first.");
      }
      // A repair replaces the code the running service imported.
      await stopService();
    }

    return await installProject(root);
  } finally {
    invalidateHealth();
  }
}
