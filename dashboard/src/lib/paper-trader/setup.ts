// Building the arena, in Breadboard's own workspace rather than the user's clone.
//
// The build has to change the clone's sources — the arena is a crypto product
// and the desk trades companies too (see ./overlay.ts) — and it has to install a
// dependency tree the clone does not declare. Doing either in the checkout would
// mean the user's next `git pull` there lands on modified files and an untracked
// node_modules. So the whole build happens in `.runtime/paper-trader/backend`:
// sources copied in, patched, compiled, run. The checkout is only ever read.
//
// Three decisions in here come from the same place: native addons on Windows are
// where a friendly `npm install` turns into a compiler hunt.
//
// **The install runs with `--ignore-scripts`.** The clone pins
// `better-sqlite3@^11`, whose prebuilt binaries stop before the Node versions
// shipping today. Without a prebuild its install script falls through to
// node-gyp, node-gyp looks for Visual Studio, and on a machine without the C++
// build tools the whole install fails — having already downloaded everything
// else. Skipping install scripts makes that failure impossible.
//
// **better-sqlite3 is then installed separately, unpinned.** The v12 line does
// publish prebuilds for current Node, and its API surface here is `new
// Database`, `.pragma` and `.prepare`, which has not moved.
//
// **npm rather than pnpm.** The clone is a pnpm workspace, but Breadboard builds
// only the backend and the backend's manifest is self-contained — no
// `workspace:` dependencies — so the desk does not need a package manager the
// machine may not have.

import fs from "node:fs";
import path from "node:path";
import {
  backendDirectory,
  npmExecutable,
  resolvePaperTraderRoot,
  runCommand,
  workspaceDirectory,
  workspaceSource,
  type CommandResult,
} from "./runtime.ts";
import {
  applyPatches,
  copyOverlayFiles,
  OVERLAY_DEPENDENCY,
  overlayFilesPresent,
  PatchError,
} from "./overlay.ts";
import { stopArena } from "./service.ts";

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build",
    unlocks:
      "Copies the arena's backend into Breadboard's own workspace, teaches it about company shares, installs its dependencies and compiles it. Nothing is written into the clone.",
  },
  {
    id: "rebuild",
    label: "Rebuild",
    unlocks:
      "Repeats the build against whatever is in the clone now — the way to pick up a `git pull` there.",
  },
  {
    id: "remove",
    label: "Remove build",
    unlocks:
      "Stops the desk and deletes the build workspace. The portfolio database is kept.",
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
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** The version range that actually has prebuilt binaries for current Node. */
const SQLITE_REPLACEMENT = "better-sqlite3@^12.9.0";

/** `--no-save` keeps the copied manifest identical to the clone's own. */
const NPM_FLAGS = ["--no-audit", "--no-fund", "--no-save", "--no-package-lock"];

/** Keep the tail: npm and tsc put the actual error at the end of their output. */
function tail(result: CommandResult, lines = 25): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

class SetupError extends Error {
  // Assigned in the body rather than declared as a parameter property, so the
  // module can be imported directly by Node's type-stripping — which is how the
  // tests and the build harness reach it, without a bundler in the way.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export { SetupError };

function requireRoot(): string {
  const runtime = resolvePaperTraderRoot();
  if (!runtime) {
    throw new SetupError(404, "The open-alpha-arena clone was not found next to the dashboard.");
  }
  return runtime.root;
}

function requireNpm(): string {
  const npm = npmExecutable();
  if (!npm) {
    throw new SetupError(
      409,
      "npm was not found on PATH. Install Node.js 20 or newer, then try again.",
    );
  }
  return npm;
}

/** The compiler that came with the install, rather than one from the machine. */
function localTsc(): string | null {
  const candidate = path.join(
    workspaceDirectory(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Lay the workspace out from the clone: the manifest, the compiler config, and a
 * fresh copy of the sources. The sources are replaced rather than merged so a
 * file deleted upstream does not linger in a build, and so a previous run's
 * patches are never applied twice.
 */
function stage(root: string): void {
  const source = backendDirectory(root);
  const workspace = workspaceDirectory();
  fs.mkdirSync(workspace, { recursive: true });

  for (const file of ["package.json", "tsconfig.json"]) {
    const from = path.join(source, file);
    if (!fs.existsSync(from)) {
      throw new SetupError(409, `The arena clone is missing backend/${file}.`);
    }
    fs.copyFileSync(from, path.join(workspace, file));
  }

  const target = workspaceSource();
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(source, "src"), target, { recursive: true });

  if (!overlayFilesPresent()) {
    throw new SetupError(
      409,
      "Breadboard's arena overlay sources are missing from scripts/paper-trader-overlay.",
    );
  }
  copyOverlayFiles(target);
  applyPatches(target);
}

async function install(): Promise<SetupResult> {
  const npm = requireNpm();
  const cwd = workspaceDirectory();

  const installed = await runCommand(npm, ["install", ...NPM_FLAGS, "--ignore-scripts"], {
    cwd,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (installed.code !== 0) {
    return {
      ok: false,
      message: installed.timedOut
        ? "The install did not finish in time."
        : "The arena backend's dependencies could not be installed.",
      detail: tail(installed),
    };
  }

  // Two dependencies the copied manifest cannot supply: the SQLite driver whose
  // pinned version has no prebuild for current Node, and the keyless market-data
  // library the equity feed is built on. Installed with their scripts, so their
  // prebuilt binaries are actually fetched.
  const extras = await runCommand(
    npm,
    ["install", ...NPM_FLAGS, SQLITE_REPLACEMENT, OVERLAY_DEPENDENCY],
    { cwd, timeoutMs: INSTALL_TIMEOUT_MS },
  );
  if (extras.code !== 0) {
    return {
      ok: false,
      message: "The desk's market-data and storage dependencies could not be installed.",
      detail: tail(extras),
    };
  }

  return build();
}

async function build(): Promise<SetupResult> {
  const tsc = localTsc();
  if (!tsc) {
    throw new SetupError(409, "There is nothing to build yet — run the full build first.");
  }
  const result = await runCommand(tsc, [], {
    cwd: workspaceDirectory(),
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    return {
      ok: false,
      message: result.timedOut
        ? "The build did not finish in time."
        : "The arena backend did not compile.",
      detail: tail(result),
    };
  }
  return {
    ok: true,
    message: "Paper Trader is built and ready — coins and company shares.",
    detail: "",
  };
}

export async function runSetupAction(action: SetupActionId): Promise<SetupResult> {
  const root = requireRoot();

  try {
    if (action === "remove") {
      // The running backend holds open handles inside the directory about to be
      // deleted, which on Windows makes the removal fail outright.
      await stopArena();
      const workspace = workspaceDirectory();
      if (!fs.existsSync(workspace)) {
        return { ok: true, message: "There was no build to remove.", detail: "" };
      }
      if (path.basename(workspace) !== "backend") {
        throw new SetupError(400, "That path is not a Paper Trader build workspace.");
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      return {
        ok: true,
        message: "Build removed. The portfolio database is untouched.",
        detail: "",
      };
    }

    // Both remaining actions restage from the clone: a rebuild exists precisely
    // to pick up sources that have changed there.
    await stopArena();
    stage(root);

    // A workspace that still has its dependencies only needs compiling again.
    return localTsc() ? await build() : await install();
  } catch (error) {
    if (error instanceof PatchError) {
      return { ok: false, message: error.message, detail: "" };
    }
    throw error;
  }
}
