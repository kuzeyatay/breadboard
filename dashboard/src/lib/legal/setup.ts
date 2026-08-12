// Building the harness's Python environment, on the user's word.
//
// A run never triggers this — the Agents tab asks, the user presses the button,
// and everything lands in `harvey-labs/.venv`, which the clone's own .gitignore
// already covers and which `Remove environment` deletes again.
//
// The install list is deliberately not the clone's `pyproject.toml`. That file
// is written for the benchmark: it pulls in four provider SDKs, matplotlib and
// seaborn for the comparison dashboards, and pytest. Breadboard reaches the
// model through ChatMock's OpenAI-compatible endpoint and renders nothing, so
// installing those would be several hundred megabytes to run no code. What is
// listed here is what the harness actually imports on the path we drive:
// the OpenAI SDK, the document readers, and the libraries the .docx/.xlsx/.pptx
// skill scripts import. Plus one addition of our own — `pypandoc-binary`, which
// ships the pandoc that reading a Word file needs, so nothing has to be
// installed system-wide.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveLegalRoot,
  runCommand,
  uvPath,
  venvDirectory,
  venvPython,
  type CommandResult,
} from "./runtime.ts";

/** What the harness imports on the path Breadboard drives, and nothing else. */
export const RUNTIME_PACKAGES = [
  // The model, through ChatMock.
  "openai",
  // The `read` tool's parsers.
  "pdfplumber",
  "markitdown",
  "openpyxl",
  "pandas",
  // What the document skill scripts import.
  "python-docx",
  "python-pptx",
  "docxtpl",
  "lxml",
  "defusedxml",
  "diff-match-patch",
  // Pandoc, bundled rather than required of the machine.
  "pypandoc-binary",
] as const;

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates harvey-labs/.venv and installs the harness's document libraries and a bundled pandoc.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the libraries into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes harvey-labs/.venv. Nothing else in the clone is touched.",
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
  const runtime = resolveLegalRoot();
  if (!runtime) {
    throw new SetupError(404, "The harvey-labs clone was not found next to the dashboard.");
  }
  return runtime.root;
}

async function createEnvironment(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (uv) {
    // The clone caps itself at Python 3.13, and the machine's own interpreter
    // is often ahead of that — uv fetching a matching one is the whole reason
    // it is preferred here rather than a nicety.
    const result = await runCommand(uv, ["venv", "--python", "3.13", ".venv"], {
      cwd: root,
      timeoutMs: VENV_TIMEOUT_MS,
      env: { UV_LINK_MODE: "copy" },
    });
    if (result.code === 0 && venvPython(root)) {
      return { ok: true, message: "Environment created with uv.", detail: "" };
    }
  }

  const python = findSystemPython();
  if (!python) {
    throw new SetupError(
      409,
      "No Python was found on this machine. Install uv, or Python 3.12 or 3.13, then try again.",
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

async function installPackages(root: string): Promise<SetupResult> {
  const python = venvPython(root);
  if (!python) {
    return {
      ok: false,
      message: "The environment disappeared before the install started.",
      detail: "",
    };
  }
  const uv = uvPath();
  const result = uv
    ? await runCommand(uv, ["pip", "install", "--python", python, ...RUNTIME_PACKAGES], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
        // OneDrive-backed checkouts do not tolerate uv's hardlink cache.
        env: { UV_LINK_MODE: "copy" },
      })
    : await runCommand(python, ["-m", "pip", "install", ...RUNTIME_PACKAGES], {
        cwd: root,
        timeoutMs: INSTALL_TIMEOUT_MS,
        env: { PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      });

  if (result.code !== 0) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The harness libraries could not be installed.",
      detail: tail(result),
    };
  }

  // The venv can exist with a half-finished install behind it, so importing
  // the harness itself is the only check that means anything.
  const verify = await runCommand(
    python,
    [
      "-c",
      [
        "import sys",
        "sys.path.insert(0, sys.argv[1])",
        "from harness.agent_loop import run_agent",
        "from harness.tools import get_all_tool_definitions",
        "import docx, pptx, openpyxl, pdfplumber, markitdown",
        "print('ok')",
      ].join("\n"),
      root,
    ],
    { cwd: root, timeoutMs: VENV_TIMEOUT_MS },
  );
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the harness still does not import.",
      detail: tail(verify),
    };
  }
  return { ok: true, message: "The Legal Agent is installed and ready.", detail: "" };
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
        throw new SetupError(400, "That path is not a Legal Agent environment.");
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

    return await installPackages(root);
  } finally {
    invalidateHealth();
  }
}
