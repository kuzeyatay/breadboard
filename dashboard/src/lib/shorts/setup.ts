// Building the clone's Python environment, on the user's word.
//
// A run never triggers this. faster-whisper alone brings CTranslate2 and, on
// first use, downloads a Whisper model; opencv is another hundred megabytes.
// That is a decision worth asking for rather than taking behind a button that
// said "make shorts".
//
// The environment is `AI-Youtube-Shorts-Generator/.venv` and holds exactly what
// requirements-local.txt lists — the clone's own file, so the install stays
// whatever upstream says it is.

import fs from "node:fs";
import path from "node:path";
import {
  findSystemPython,
  invalidateHealth,
  resolveShortsRoot,
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
    unlocks:
      "Creates AI-Youtube-Shorts-Generator/.venv and installs yt-dlp, faster-whisper and opencv. Several minutes and a few hundred megabytes.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the dependencies into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Deletes AI-Youtube-Shorts-Generator/.venv. Nothing else in the clone is touched.",
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
const VERIFY_TIMEOUT_MS = 3 * 60 * 1000;

/** Keep the tail: pip and uv put the actual error at the end of their output. */
function tail(result: CommandResult, lines = 25): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

class SetupError extends Error {
  // A plain field, for the same reason as UploadError: the test runner strips
  // types instead of compiling them, and a parameter property does not survive.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export { SetupError };

function requireRoot(): string {
  const runtime = resolveShortsRoot();
  if (!runtime) {
    throw new SetupError(
      404,
      "The AI-Youtube-Shorts-Generator clone was not found next to the dashboard.",
    );
  }
  return runtime.root;
}

async function createEnvironment(root: string): Promise<SetupResult> {
  const uv = uvPath();
  if (uv) {
    // `--python 3.12` lets uv download a matching interpreter when the machine
    // has none, and keeps the version away from the bleeding edge that the
    // CTranslate2 and opencv wheels do not build for yet.
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

async function installDependencies(root: string): Promise<SetupResult> {
  const python = venvPython(root);
  if (!python) {
    return {
      ok: false,
      message: "The environment disappeared before the install started.",
      detail: "",
    };
  }
  const requirements = path.join(root, "requirements-local.txt");
  if (!fs.existsSync(requirements)) {
    return {
      ok: false,
      message: "The clone has no requirements-local.txt to install from.",
      detail: "",
    };
  }
  const uv = uvPath();
  const result = uv
    ? await runCommand(
        uv,
        ["pip", "install", "--python", python, "-r", "requirements-local.txt"],
        { cwd: root, timeoutMs: INSTALL_TIMEOUT_MS },
      )
    : await runCommand(
        python,
        ["-m", "pip", "install", "-r", "requirements-local.txt"],
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

  // The clone itself is not a package — it is imported from its own directory —
  // so the check that matters is that every local-mode import works from there.
  const verify = await runCommand(
    python,
    [
      "-c",
      "import shorts_generator, yt_dlp, faster_whisper, cv2, openai; print('ok')",
    ],
    { cwd: root, timeoutMs: VERIFY_TIMEOUT_MS },
  );
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the dependencies still do not import.",
      detail: tail(verify),
    };
  }
  return {
    ok: true,
    message:
      "Shorts is ready. The first run also downloads a Whisper model, which takes a few minutes more.",
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
        throw new SetupError(400, "That path is not a Shorts environment.");
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

    return await installDependencies(root);
  } finally {
    invalidateHealth();
  }
}
