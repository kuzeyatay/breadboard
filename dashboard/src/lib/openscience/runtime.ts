// Locating the pieces an OpenScience run needs, and where its state lives.
//
// OpenScience is a real runtime, not a prompt pack: the clone is a Bun
// monorepo whose CLI hosts a server, an agent loop, ~290 skills and the
// scientific-database tool layer. So it is wrapped rather than ported — but it
// is not run from the clone's source.
//
// The clone is the *pinned version*, not the executable. Two reasons:
//
//   - `bun install` in the clone is not reliably complete on Windows. It
//     silently drops files from extracted packages (js-yaml's `type/js/*`,
//     @opentelemetry/api's `baggage/*` were both missing after a clean
//     install), and the CLI then dies at import time on whichever one it
//     reaches first. Repairing a dependency tree package by package is not a
//     setup step anyone can trust.
//   - Upstream publishes the same version as a platform binary
//     (`@synsci/openscience-windows-x64` and friends), so there is a supported
//     artifact that needs no monorepo build at all.
//
// Setup therefore npm-installs `@synsci/openscience@<version the clone pins>`
// into a Breadboard-owned prefix. The clone stays the source of truth for which
// version that is — and stays readable — which is the same bargain HyperFrames
// and OfficeCLI already make.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface OpenscienceLauncher {
  /** argv[0] used to invoke the CLI — always Node, running the package's bin. */
  command: string;
  /** Fixed leading arguments (the resolved `bin/openscience` entry point). */
  baseArgs: string[];
  /** Reported version, so a stale install is visible in health. */
  version: string;
  source: "configured" | "managed" | "path";
}

export interface RuntimePiece {
  found: boolean;
  path: string;
  source: string;
}

export interface RuntimeAvailability {
  available: boolean;
  /** The clone exists, even when nothing has been installed yet. */
  cloned: boolean;
  root: string | null;
  cli: (OpenscienceLauncher & { found: true }) | { found: false };
  /** The version an install would pin to, read from the clone. */
  targetVersion: string;
  /** Every missing piece, so the setup panel can list them all at once. */
  missing: string[];
  reason?: string;
}

const VERSION_TIMEOUT_MS = 30_000;
const FALLBACK_VERSION = "latest";

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** The cloned repository — the source of truth for the pinned version. */
export function resolveOpenscienceRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    configured(env.OPENSCIENCE_ROOT),
    path.join(repositoryRoot(), "openscience"),
    path.resolve(process.cwd(), "openscience"),
    path.resolve(process.cwd(), "..", "openscience"),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) &&
        fs.existsSync(path.join(candidate as string, "backend", "cli", "package.json")),
    ) ?? null
  );
}

/** The CLI version this clone ships, so an install matches what is readable. */
export function targetCliVersion(env: NodeJS.ProcessEnv = process.env): string {
  const root = resolveOpenscienceRoot(env);
  if (!root) return FALLBACK_VERSION;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "backend", "cli", "package.json"), "utf8"),
    ) as { version?: unknown };
    const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
    return /^\d+\.\d+\.\d+/.test(version) ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/**
 * The npm prefix Breadboard installs the pinned CLI into. Kept beside the other
 * run data so removing it is a directory delete.
 */
export function managedCliRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENSCIENCE_CLI_ROOT) ?? path.join(dashboardDataDir(), "openscience-cli")
  );
}

/**
 * Server state: the config directory Breadboard writes, and the data directory
 * holding sessions, logs and storage.
 *
 * Deliberately short. OpenScience writes session records through a temporary
 * file whose name carries the session id, a pid and a uuid; under a deep root
 * that path passes Windows' limit and every session creation fails with
 * ENAMETOOLONG — which surfaces only as "Session not found".
 */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENSCIENCE_STATE_ROOT) ?? path.join(dashboardDataDir(), "openscience-state")
  );
}

export function configRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), "config");
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), "data");
}

/**
 * The workspace an OpenScience run works inside. Durable and shared across
 * runs: a research workspace accumulates scripts, datasets, figures and notes,
 * and that accumulation is the point — a run never gets a fresh empty one.
 */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENSCIENCE_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "openscience-workspace")
  );
}

function probeVersion(command: string, baseArgs: readonly string[]): string | null {
  const probe = spawnSync(command, [...baseArgs, "--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: VERSION_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: "1", OPENSCIENCE_DISABLE_AUTOUPDATE: "1" },
  });
  if (probe.error || probe.status !== 0) return null;
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
  return output ? output.split(/\r?\n/)[0].slice(0, 120) : "openscience";
}

function nodeLauncher(
  entry: string,
  source: OpenscienceLauncher["source"],
): OpenscienceLauncher | null {
  if (!fs.existsSync(entry)) return null;
  const version = probeVersion(process.execPath, [entry]);
  return version ? { command: process.execPath, baseArgs: [entry], version, source } : null;
}

/** The entry point inside the managed npm prefix. */
export function managedEntry(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(
    managedCliRoot(env),
    "node_modules",
    "@synsci",
    "openscience",
    "bin",
    "openscience",
  );
}

/**
 * How to invoke the CLI. The bin is a Node launcher that execs the platform
 * binary, so it is always run through Node rather than as a shell shim — that
 * keeps `.cmd` out of the spawn path entirely.
 */
export function resolveLauncher(
  env: NodeJS.ProcessEnv = process.env,
): OpenscienceLauncher | null {
  const explicit = configured(env.OPENSCIENCE_BIN);
  if (explicit && fs.existsSync(explicit)) {
    const launcher = explicit.endsWith(".js") || explicit.endsWith(".mjs") || !path.extname(explicit)
      ? nodeLauncher(explicit, "configured")
      : (() => {
          const version = probeVersion(explicit, []);
          return version
            ? { command: explicit, baseArgs: [] as string[], version, source: "configured" as const }
            : null;
        })();
    if (launcher) return launcher;
  }

  const managed = nodeLauncher(managedEntry(env), "managed");
  if (managed) return managed;

  const onPath = process.platform === "win32" ? "openscience.cmd" : "openscience";
  const version = probeVersion(onPath, []);
  return version ? { command: onPath, baseArgs: [], version, source: "path" } : null;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
  const root = resolveOpenscienceRoot(env);
  const launcher = resolveLauncher(env);
  const missing: string[] = [];
  if (!root) missing.push("The OpenScience clone was not found next to Breadboard.");
  if (!launcher) missing.push("The OpenScience CLI is not installed yet.");
  return {
    available: Boolean(launcher),
    cloned: Boolean(root),
    root,
    cli: launcher ? { ...launcher, found: true } : { found: false },
    targetVersion: targetCliVersion(env),
    missing,
    reason: launcher
      ? undefined
      : "OpenScience is not installed yet. Open its settings and install it once.",
  };
}
