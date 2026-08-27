// Read-only OpenScience setup status. The authenticated Runtime V2 setup job
// owns package installation and workspace creation; product service processes
// may only verify those outputs before launch.

import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import {
  resolveOpenscienceRoot,
  runtimeAvailability,
} from "./runtime.ts";
import { workspaceRoot } from "./state-paths.ts";

export interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  cli: { found: boolean; version: string; source: string };
  workspace: { path: string; isolated: boolean };
  /** The version an install would pin to, read from the clone. */
  targetVersion: string;
}

function directDirectory(candidate: string): boolean {
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  return Boolean(metadata?.isDirectory() && !metadata.isSymbolicLink());
}

function directFile(candidate: string): boolean {
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  return Boolean(metadata?.isFile() && !metadata.isSymbolicLink());
}

/** Whether the managed workspace is its own direct version-control root. */
export function workspaceIsolated(env: NodeJS.ProcessEnv = process.env): boolean {
  const root = workspaceRoot(env);
  return directDirectory(root) && directDirectory(path.join(root, ".git"));
}

function workspacePrepared(env: NodeJS.ProcessEnv = process.env): boolean {
  const root = workspaceRoot(env);
  return workspaceIsolated(env) && directFile(path.join(root, "package.json"));
}

/**
 * Verify the workspace prepared by the Runtime job. This deliberately never
 * creates a directory, writes a manifest, or launches Git from a service
 * process; an unavailable setup remains visibly unavailable.
 */
export function ensureWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const root = workspaceRoot(env);
  if (!workspacePrepared(env)) {
    throw new Error(
      "OpenScience setup has not prepared an isolated workspace. Run OpenScience setup and try again.",
    );
  }
  return root;
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const root = resolveOpenscienceRoot(env);
  const prepared = workspacePrepared(env);
  return {
    ready: availability.available && prepared,
    reason: availability.reason ?? (
      prepared
        ? ""
        : "The isolated OpenScience workspace has not been prepared. Run OpenScience setup."
    ),
    clone: { found: Boolean(root), path: root ?? "" },
    cli: {
      found: availability.cli.found,
      version: availability.cli.found ? availability.cli.version : "",
      source: availability.cli.found ? availability.cli.source : "",
    },
    workspace: { path: workspaceRoot(env), isolated: workspaceIsolated(env) },
    targetVersion: availability.targetVersion,
  };
}
