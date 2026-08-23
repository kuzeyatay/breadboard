// Where the bolt-slides clone is, and whether it can build a deck.
//
// The clone is a complete Vite + React app rather than a service: there is no
// process to keep alive and nothing to install beyond `npm install` inside it.
// So availability is two facts — the checkout is there, and its dependencies
// are on disk — and the run itself is a `vite build` in a workspace that
// borrows those dependencies.
//
// Nothing is ever written into the checkout. A run gets its own directory under
// the dashboard's data dir, holding a copy of the authoring surface (index.html,
// the engine, the component library, the styles) and a `node_modules` junction
// pointing back at the clone's. That is what lets many decks be built from one
// install while the checkout stays exactly as it was cloned.

import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/** Files that identify a directory as the bolt-slides clone rather than a namesake. */
const MARKERS = [
  "package.json",
  "index.html",
  path.join("src", "deck", "Deck.tsx"),
  path.join("src", "styles", "tokens.css"),
];

/** The packages a `vite build` of this deck cannot proceed without. */
const REQUIRED_PACKAGES = ["vite", "react", "react-dom", "framer-motion", "@vitejs/plugin-react"];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function isCheckout(candidate: string | null): boolean {
  return Boolean(
    candidate && MARKERS.every((marker) => fs.existsSync(path.join(candidate, marker))),
  );
}

export function resolveBoltSlidesRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.BOLT_SLIDES_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") return isCheckout(explicit) ? explicit : null;
  const candidates = [
    explicit,
    path.join(repositoryRoot(), "bolt-slides"),
    path.resolve(process.cwd(), "bolt-slides"),
    path.resolve(process.cwd(), "..", "bolt-slides"),
  ];
  return candidates.find(isCheckout) ?? null;
}

export function boltSlidesWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.BOLT_SLIDES_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "bolt-slides-runs")
  );
}

/** The clone's `node_modules`, which every run's workspace links back to. */
export function boltSlidesModules(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = resolveBoltSlidesRoot(env);
  return root ? path.join(root, "node_modules") : null;
}

/**
 * Vite's own entry point inside the clone, run through Node so no shell shim is
 * spawned — the same trick the Wardrobe runtime uses, and for the same reason:
 * `npx`/`.cmd` shims on Windows are a quoting hazard the build does not need.
 */
export function viteEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const modules = boltSlidesModules(env);
  if (!modules) return null;
  const entry = path.join(modules, "vite", "bin", "vite.js");
  return fs.existsSync(entry) ? entry : null;
}

/** Which of the required packages are actually unpacked in the clone. */
export function missingPackages(env: NodeJS.ProcessEnv = process.env): string[] {
  const modules = boltSlidesModules(env);
  if (!modules) return [...REQUIRED_PACKAGES];
  return REQUIRED_PACKAGES.filter(
    (name) => !fs.existsSync(path.join(modules, ...name.split("/"), "package.json")),
  );
}

export interface BoltSlidesAvailability {
  available: boolean;
  cloned: boolean;
  root: string | null;
  installed: boolean;
  vite: string | null;
  missing: string[];
  reason?: string;
}

export function boltSlidesAvailability(
  env: NodeJS.ProcessEnv = process.env,
): BoltSlidesAvailability {
  const root = resolveBoltSlidesRoot(env);
  if (!root) {
    return {
      available: false,
      cloned: false,
      root: null,
      installed: false,
      vite: null,
      missing: [...REQUIRED_PACKAGES],
      reason:
        "The bolt-slides clone was not found. Clone stackblitz/bolt-slides beside the dashboard, "
        + "or set BOLT_SLIDES_ROOT.",
    };
  }
  const missing = missingPackages(env);
  const vite = viteEntry(env);
  const installed = missing.length === 0 && Boolean(vite);
  return {
    available: installed,
    cloned: true,
    root,
    installed,
    vite,
    missing,
    reason: installed
      ? undefined
      : "Bolt Slides is cloned but its dependencies are not installed. Open its settings and install it once.",
  };
}
