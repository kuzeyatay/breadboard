// Where the OpenMAIC clone is, and whether a classroom can be generated from it.
//
// The clone is a complete Next.js app — the generation pipeline, the classroom
// player, and the editor are one program — so the runtime is that app, built
// and started as a local service. Nothing runs from the checkout itself: setup
// copies the source into a Breadboard-owned toolchain directory, installs and
// builds it there, and that copy is what serves. The checkout stays exactly as
// it was cloned, which is what lets a `git pull` in it remain a fast-forward.
//
// Availability is therefore three facts: the checkout is there, the toolchain
// copy has its dependencies, and the toolchain copy has been built.

import path from "node:path";
import { externalRuntimePathExists } from "../external-runtime-filesystem.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/** Files that identify a directory as the OpenMAIC clone rather than a namesake. */
const MARKERS = [
  "package.json",
  "next.config.ts",
  path.join("app", "api", "generate-classroom", "route.ts"),
  path.join("packages", "@openmaic", "generation", "package.json"),
];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function isCheckout(candidate: string | null): boolean {
  return Boolean(
    candidate && MARKERS.every((marker) => externalRuntimePathExists(path.join(candidate, marker))),
  );
}

/** The immutable checkout: read by setup, never run from. */
export function resolveClassroomSourceRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.OPENMAIC_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") return isCheckout(explicit) ? explicit : null;
  const candidates = [explicit, path.join(repositoryRoot(), "openmaic")];
  return candidates.find(isCheckout) ?? null;
}

function toolchainsRoot(): string {
  return path.join(dashboardDataDir(), "runtime-v2", "toolchains");
}

/** The built copy the service runs from. Its `data/` holds every classroom. */
export function classroomRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.OPENMAIC_RUNTIME_ROOT) ?? path.join(toolchainsRoot(), "openmaic");
}

/** Where setup stages a new copy before swapping it in. */
export function classroomStagingRoot(token: string): string {
  return path.join(toolchainsRoot(), `.openmaic-stage-${token}`);
}

/**
 * The shim directory setup puts a `pnpm` on. OpenMAIC's postinstall calls a
 * bare `pnpm` for each workspace package, and this machine has none on PATH —
 * corepack is how it is meant to be reached, so the shim forwards to corepack.
 */
export function classroomToolsDir(): string {
  return path.join(toolchainsRoot(), "openmaic-tools");
}

/**
 * Where every classroom lives, and the one directory a rebuild must not touch.
 *
 * OpenMAIC writes its state under `process.cwd()/data` — classrooms, jobs,
 * usage — and the server runs with the runtime copy as its cwd. The runtime
 * copy is replaced wholesale by setup, so `data` inside it is a junction to
 * this directory, which is outside the copy and survives. Found the hard way:
 * the first rebuild deleted the only classroom along with the old runtime.
 */
export function classroomDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.OPENMAIC_DATA_DIR) ?? path.join(dashboardDataDir(), "openmaic-data");
}

/** The path inside the runtime copy that OpenMAIC actually writes to. */
export function classroomDataLink(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(classroomRuntimeRoot(env), "data");
}

/** Next's own CLI inside the runtime copy, run through Node so no shim is spawned. */
export function nextEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const entry = path.join(classroomRuntimeRoot(env), "node_modules", "next", "dist", "bin", "next");
  return externalRuntimePathExists(entry) ? entry : null;
}

/**
 * corepack's JavaScript entry next to the Node binary this process runs on.
 * Run through `process.execPath` for the same reason as Next: a `.cmd` shim on
 * Windows cannot be spawned without a shell, and a shell is a quoting hazard
 * an install does not need.
 */
export function corepackEntry(execPath: string = process.execPath): string | null {
  const entry = path.join(
    path.dirname(execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  return externalRuntimePathExists(entry) ? entry : null;
}

/** Whether the runtime copy's dependencies are installed and its packages built. */
export function installedDependencies(env: NodeJS.ProcessEnv = process.env): {
  next: boolean;
  generation: boolean;
  importer: boolean;
} {
  const root = classroomRuntimeRoot(env);
  return {
    next: Boolean(nextEntry(env)),
    generation: externalRuntimePathExists(
      path.join(root, "packages", "@openmaic", "generation", "dist", "index.js"),
    ),
    // The PPTX parser bundle the build asserts on: the one workspace package
    // whose build fails on Windows without the setup-time fix.
    importer: externalRuntimePathExists(
      path.join(root, "public", "vendor", "maic-importer", "index.js"),
    ),
  };
}

/** Whether `next build` has produced a servable app. */
export function isBuilt(env: NodeJS.ProcessEnv = process.env): boolean {
  return externalRuntimePathExists(path.join(classroomRuntimeRoot(env), ".next", "BUILD_ID"));
}

export interface ClassroomAvailability {
  available: boolean;
  cloned: boolean;
  sourceRoot: string | null;
  runtimeRoot: string;
  installed: boolean;
  built: boolean;
  missing: string[];
  reason?: string;
}

export function classroomAvailability(
  env: NodeJS.ProcessEnv = process.env,
): ClassroomAvailability {
  const sourceRoot = resolveClassroomSourceRoot(env);
  const runtimeRoot = classroomRuntimeRoot(env);
  const dependencies = installedDependencies(env);
  const installed = dependencies.next && dependencies.generation && dependencies.importer;
  const built = installed && isBuilt(env);
  const missing: string[] = [];
  if (!sourceRoot) missing.push("The OpenMAIC clone was not found next to the dashboard.");
  else if (!installed) {
    missing.push(
      dependencies.next
        ? "OpenMAIC's workspace packages are not built."
        : "OpenMAIC's dependencies are not installed yet.",
    );
  } else if (!built) {
    missing.push("OpenMAIC has not been built yet.");
  }
  const reason = !sourceRoot
    ? "The OpenMAIC clone is missing. Clone THU-MAIC/OpenMAIC beside the dashboard, or set OPENMAIC_ROOT."
    : !installed || !built
      ? "Classroom is not set up yet. Open its settings and install it once."
      : undefined;
  return {
    available: Boolean(sourceRoot) && installed && built,
    cloned: Boolean(sourceRoot),
    sourceRoot,
    runtimeRoot,
    installed,
    built,
    missing,
    reason,
  };
}
