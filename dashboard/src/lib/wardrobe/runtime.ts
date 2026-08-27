// Locating the Wardrobe clone and the state a run needs.
//
// Unlike most wrapped runtimes, this one is run *from* the clone rather than
// from a published artifact. The whole runtime is the clone's Vite dev server:
// `scripts/import-job-api.mjs` is a Vite plugin, so the pipeline only exists
// while that server is up, and the same server is the gallery the person browses
// afterwards. There is nothing to install separately — `npm install` in the
// clone is the entire setup.
//
// State stays in the clone's own `data/` directory, which upstream gitignores
// and treats as the database. Relocating it would only mean the gallery and the
// agent disagreed about where the wardrobe lives.

import path from "node:path";
import {
  externalRuntimePathExists,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/** Files that identify a directory as the Wardrobe clone rather than a namesake. */
const MARKERS = ["package.json", path.join("scripts", "import-job-api.mjs")];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolveWardrobeRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    configured(env.WARDROBE_ROOT),
    path.join(repositoryRoot(), "wardrobe"),
    path.resolve(process.cwd(), "wardrobe"),
    path.resolve(process.cwd(), "..", "wardrobe"),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) &&
        MARKERS.every((marker) =>
          externalRuntimePathExists(path.join(candidate as string, marker)),
        ),
    ) ?? null
  );
}

/** The immutable source copied and dependency-installed by managed setup. */
export function wardrobeRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.WARDROBE_RUNTIME_ROOT) ??
    path.join(dashboardDataDir(), "runtime-v2", "toolchains", "wardrobe");
}

/** Runtime-owned library, imported assets, and jobs. */
export function wardrobeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.WARDROBE_DATA_DIR) ?? path.join(dashboardDataDir(), "wardrobe-data");
}

export function libraryFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const data = wardrobeDataDir(env);
  return path.join(data, "library.json");
}

/**
 * The identity photo every modeled shot is generated from.
 *
 * It is deliberately a file rather than a stored blob: the clone reads this exact
 * path itself, and a person who already has one at `data/model-reference.png`
 * should not have to upload it a second time.
 */
export function modelReferencePath(env: NodeJS.ProcessEnv = process.env): string | null {
  return configured(env.WARDROBE_MODEL_REFERENCE) ??
    path.join(wardrobeDataDir(env), "model-reference.png");
}

export function hasModelReference(env: NodeJS.ProcessEnv = process.env): boolean {
  const reference = modelReferencePath(env);
  try {
    return Boolean(reference) && externalRuntimeStat(reference as string).isFile();
  } catch {
    return false;
  }
}

/** Vite's own entry point inside the clone, run through Node so no shim is spawned. */
export function viteEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const entry = path.join(wardrobeRuntimeRoot(env), "node_modules", "vite", "bin", "vite.js");
  return externalRuntimePathExists(entry) ? entry : null;
}

/**
 * Whether the clone's dependencies are installed. `sharp` is checked separately
 * from Vite because it is the one prebuilt binary here: an install that resolved
 * every JavaScript package but failed to fetch sharp's platform binary produces
 * a server that starts and then fails every single garment at the trim step.
 */
export function installedDependencies(env: NodeJS.ProcessEnv = process.env): {
  vite: boolean;
  sharp: boolean;
} {
  const root = wardrobeRuntimeRoot(env);
  return {
    vite: Boolean(viteEntry(env)),
    sharp: externalRuntimePathExists(path.join(root, "node_modules", "sharp", "package.json")),
  };
}

export interface WardrobeAvailability {
  available: boolean;
  cloned: boolean;
  root: string | null;
  installed: boolean;
  /**
   * Whether the identity photo exists. This gates the whole agent rather than
   * only the modeled stage: the clone refuses to accept a photo at all until a
   * reference is present, because every import it knows how to do ends in a
   * modeled shot.
   */
  hasModelReference: boolean;
  modelReference: string | null;
  dataDir: string | null;
  missing: string[];
  reason?: string;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): WardrobeAvailability {
  const root = resolveWardrobeRoot(env);
  const dependencies = installedDependencies(env);
  const installed = dependencies.vite && dependencies.sharp;
  const reference = hasModelReference(env);
  const missing: string[] = [];
  if (!root) missing.push("The Wardrobe clone was not found next to Breadboard.");
  else if (!installed) {
    missing.push(
      dependencies.vite
        ? "Wardrobe's image toolchain (sharp) is not installed."
        : "Wardrobe's dependencies are not installed yet.",
    );
  }
  if (root && !reference) {
    missing.push("No identity photo has been added yet.");
  }
  const reason = !root
    ? "The Wardrobe clone is missing. Clone tandpfun/wardrobe next to the dashboard."
    : !installed
      ? "Wardrobe is not installed yet. Open its settings and install it once."
      : !reference
        ? "Wardrobe needs a photo of you before it can import anything. Add one in its settings."
        : undefined;
  return {
    available: Boolean(root) && installed && reference,
    cloned: Boolean(root),
    root,
    installed,
    hasModelReference: reference,
    modelReference: modelReferencePath(env),
    dataDir: wardrobeDataDir(env),
    missing,
    reason,
  };
}
