// Building the cloned framework's Python environment, on the user's word.
//
// This is the one heavyweight setup in the integration: LangGraph, pandas,
// yfinance and stockstats are a few hundred megabytes. A run never triggers it
// — the Agents tab asks, the user presses the button, and everything lands in
// `tradingagents/.venv`, which the clone's own .gitignore already covers and
// which `Remove environment` deletes again.
//
// uv is preferred when it is on PATH: it can fetch a compatible interpreter
// itself, which matters because the clone needs 3.10+ and the system Python is
// whatever the machine happens to have. `python -m venv` plus pip is the
// fallback, and it uses the interpreter already found by the runtime probe.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveTradingAgentsRoot,
  runCommand,
  uvPath,
  venvDirectory,
  venvPython,
  type CommandResult,
} from "./runtime.ts";

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks: "Creates tradingagents/.venv and installs the framework and its data libraries.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the package into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes tradingagents/.venv. Nothing else in the clone is touched.",
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

// Installing the dependency tree really does take minutes on a cold cache.
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const VENV_TIMEOUT_MS = 5 * 60 * 1000;

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
  const runtime = resolveTradingAgentsRoot();
  if (!runtime) {
    throw new SetupError(404, "The tradingagents clone was not found next to the dashboard.");
  }
  return runtime.root;
}

async function createEnvironment(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (uv) {
    // `--python 3.12` lets uv download a matching interpreter when the machine
    // has none: the newest system Python is often ahead of what the scientific
    // wheels in this tree are built for.
    const result = await runCommand(uv, ["venv", "--python", "3.12", ".venv"], {
      cwd: root,
      timeoutMs: VENV_TIMEOUT_MS,
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
      "No Python was found on this machine. Install Python 3.10 or newer (or uv), then try again.",
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

async function installPackage(root: string): Promise<SetupResult> {
  const python = venvPython(root);
  if (!python) {
    return {
      ok: false,
      message: "The environment disappeared before the install started.",
      detail: "",
    };
  }
  const uv = uvPath();
  // An editable install is what the clone's own README documents, and it keeps
  // a `git pull` in the clone effective without a reinstall.
  const result = uv
    ? await runCommand(uv, ["pip", "install", "--python", python, "-e", "."], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
      })
    : await runCommand(python, ["-m", "pip", "install", "-e", "."], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
        env: { PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      });

  if (result.code !== 0) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The framework could not be installed.",
      detail: tail(result),
    };
  }

  const verify = await runCommand(python, ["-c", "import tradingagents; print('ok')"], {
    cwd: root,
    timeoutMs: VENV_TIMEOUT_MS,
  });
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the package still does not import.",
      detail: tail(verify),
    };
  }
  return {
    ok: true,
    message: "TradingAgents is installed and ready.",
    detail: "",
  };
}

export async function runSetupAction(action: SetupActionId): Promise<SetupResult> {
  const root = requireRoot();
  try {
    if (action === "remove") {
      const target = venvDirectory(root);
      if (!fs.existsSync(target)) {
        return { ok: true, message: "There was no environment to remove.", detail: "" };
      }
      // Refuse anything that is not the directory this module creates, so a
      // misconfigured root can never delete a real tree.
      if (path.basename(target) !== ".venv") {
        throw new SetupError(400, "That path is not a TradingAgents environment.");
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, message: "Environment removed.", detail: "" };
    }

    if (action === "install" && !venvPython(root)) {
      const created = await createEnvironment(root);
      if (!created.ok) return created;
    }

    if (action === "reinstall" && !venvPython(root)) {
      throw new SetupError(409, "There is no environment to repair yet. Build it first.");
    }

    return await installPackage(root);
  } finally {
    invalidateHealth();
  }
}
