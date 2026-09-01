// Where the gods-eye-view clone is, and whether the globe can be served from it.
//
// The clone is a Vite app whose dev server is also its backend: the 3D globe,
// the share-link restore, and the fifteen proxy middlewares that feed the live
// layers (OpenSky, CelesTrak, AIS, FIRMS, …) are all `vite dev`. So the runtime
// is the checkout itself with its dependencies installed in place — there is no
// build step and nothing to copy, unlike OpenMAIC's toolchain.
//
// Availability is two facts: the checkout is there and `npm install` has run
// in it. Google Maps is an optional high-detail source; without it the clone
// starts on its keyless OSM + Re:Earth terrain globe.

import path from "node:path";
import {
  externalRuntimePathExists,
  externalRuntimePortableRealpath,
} from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { googleMapsKeyStatus } from "./credentials.ts";

/** Files that identify a directory as the gods-eye-view clone rather than a namesake. */
const MARKERS = [
  "package.json",
  "vite.config.js",
  path.join("src", "main.js"),
  path.join("src", "sharelink.js"),
];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function checkoutPath(candidate: string | null): string | null {
  if (
    !candidate ||
    !MARKERS.every((marker) =>
      externalRuntimePathExists(path.join(candidate, marker)),
    )
  ) {
    return null;
  }
  try {
    // Runtime V2 deliberately uses Windows verbatim paths (\\?\C:\\...) for
    // trusted filesystem containment. Node 24's main-module resolver cannot
    // consume that spelling as argv[1]: it truncates the script to `C:` and
    // exits with EISDIR. Keep the trust check above, then present the already
    // validated checkout in the normal absolute spelling used by child argv.
    return externalRuntimePortableRealpath(candidate);
  } catch {
    return null;
  }
}

/** The checkout the dev server runs from. */
export function resolveGodsEyeRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.GODS_EYE_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") return checkoutPath(explicit);
  const candidates = [explicit, path.join(repositoryRoot(), "gods-eye-view")];
  for (const candidate of candidates) {
    const checkout = checkoutPath(candidate);
    if (checkout) return checkout;
  }
  return null;
}

/** Vite's own CLI inside the checkout, run through Node so no shim is spawned. */
export function viteEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = resolveGodsEyeRoot(env);
  if (!root) return null;
  const entry = path.join(root, "node_modules", "vite", "bin", "vite.js");
  return externalRuntimePathExists(entry) ? entry : null;
}

export interface GodsEyeAvailability {
  available: boolean;
  cloned: boolean;
  root: string | null;
  installed: boolean;
  keyConfigured: boolean;
  missing: string[];
  reason?: string;
}

export function godsEyeAvailability(env: NodeJS.ProcessEnv = process.env): GodsEyeAvailability {
  const root = resolveGodsEyeRoot(env);
  const installed = Boolean(viteEntry(env));
  const keyConfigured = googleMapsKeyStatus(env).set;
  const missing: string[] = [];
  if (!root) missing.push("The gods-eye-view clone was not found next to the dashboard.");
  else if (!installed) missing.push("The clone's dependencies are not installed yet.");
  const reason = !root
    ? "The gods-eye-view clone is missing. Clone bilawalsidhu/gods-eye-view beside the dashboard, or set GODS_EYE_ROOT."
    : !installed
      ? "God's Eye is not set up yet. Open its settings to install the clone's dependencies."
      : undefined;
  return {
    available: Boolean(root) && installed,
    cloned: Boolean(root),
    root,
    installed,
    keyConfigured,
    missing,
    reason,
  };
}
