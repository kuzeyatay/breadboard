// Building the cloned tutor's Python environment, on the user's word.
//
// This is the heavyweight setup in the integration: llama-index, FAISS,
// PyMuPDF and the document extractors are the better part of a gigabyte. A run
// never triggers it — the agent's settings dialog asks, the user presses the
// button, and everything lands in `DeepTutor/.venv`, which the clone's own
// .gitignore already covers and which `Remove environment` deletes again.
//
// uv is required rather than preferred here, unlike the other Python clone:
// DeepTutor pins `>=3.11,<3.14` on purpose (its compiled wheels have no 3.14
// build), so on a machine whose only Python is newer, `python -m venv` produces
// an environment pip then refuses to install into. uv fetches a matching 3.12
// itself, which turns that dead end into a working install.
//
// `--link-mode=copy` is not a preference either: the repository commonly lives
// in a OneDrive folder, where uv's default hardlinking fails mid-install with
// "the cloud operation cannot be performed on a file with incompatible
// hardlinks" and leaves a half-built environment behind.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveDeepTutorRoot,
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
    unlocks: "Creates DeepTutor/.venv and installs the tutor with its document and retrieval libraries.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the package into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes DeepTutor/.venv. Nothing else in the clone is touched.",
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

// Installing this dependency tree really does take minutes on a cold cache.
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const VENV_TIMEOUT_MS = 8 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 3 * 60 * 1000;

/** The MCP client the scoped file server is reached through. */
const MCP_REQUIREMENT = "mcp>=1.26.0,<2.0.0";

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
  const runtime = resolveDeepTutorRoot();
  if (!runtime) {
    throw new SetupError(404, "The DeepTutor clone was not found next to the dashboard.");
  }
  return runtime.root;
}

async function createEnvironment(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (!uv) {
    const python = findSystemPython();
    throw new SetupError(
      409,
      python
        ? "Deep Tutor needs uv to build its environment: the clone requires Python 3.11–3.13 and uv is what fetches a matching interpreter. Install uv (https://docs.astral.sh/uv/), then try again."
        : "No Python and no uv were found on this machine. Install uv (https://docs.astral.sh/uv/), then try again.",
    );
  }
  const result = await runCommand(uv, ["venv", "--python", "3.12", ".venv"], {
    cwd: root,
    timeoutMs: VENV_TIMEOUT_MS,
  });
  if (result.code !== 0 || !venvPython(root)) {
    return {
      ok: false,
      message: result.timedOut
        ? "Creating the Python environment did not finish in time."
        : "The Python environment could not be created.",
      detail: tail(result),
    };
  }
  return { ok: true, message: "Environment created with uv.", detail: "" };
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
  if (!uv) {
    throw new SetupError(409, "uv is no longer on PATH, so the install cannot run.");
  }

  // An editable install is what the clone's own README documents, and it keeps
  // a `git pull` in the clone effective without a reinstall. `mcp` rides along
  // in the same command: it is an optional extra upstream, and without it the
  // tutor starts fine and then cannot see a single file.
  const install = await runCommand(
    uv,
    ["pip", "install", "--link-mode=copy", "--python", python, "-e", ".", MCP_REQUIREMENT],
    { cwd: root, timeoutMs: INSTALL_TIMEOUT_MS, env: { UV_LINK_MODE: "copy" } },
  );

  if (install.code !== 0) {
    return {
      ok: false,
      message: install.timedOut
        ? "The install did not finish in time."
        : "The tutor could not be installed.",
      detail: tail(install),
    };
  }

  const verify = await runCommand(
    python,
    [
      "-c",
      "import importlib.util as u; from deeptutor.app import DeepTutorApp;"
        + " print('ok mcp' if u.find_spec('mcp') else 'ok')",
    ],
    { cwd: root, timeoutMs: VERIFY_TIMEOUT_MS },
  );
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the tutor still does not import.",
      detail: tail(verify),
    };
  }
  if (!verify.stdout.includes("ok mcp")) {
    return {
      ok: false,
      message:
        "Deep Tutor is installed but the MCP client is missing, so it cannot read your material. Try Repair.",
      detail: tail(verify),
    };
  }
  return { ok: true, message: "Deep Tutor is installed and ready.", detail: "" };
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
        throw new SetupError(400, "That path is not a Deep Tutor environment.");
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
