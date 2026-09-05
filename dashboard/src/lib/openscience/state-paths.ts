// Pure OpenScience state paths shared by the trusted dashboard facade and the
// Runtime-owned service. This module deliberately has no launcher probing or
// child-process imports, so reading a sealed deliverable never loads execution
// authority into Next.js.

import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";

/**
 * A Windows path in the spelling the OpenScience server accepts.
 *
 * Runtime V2 hands these roots over as extended-length paths (`\\?\C:\...`),
 * and the Bun-compiled server answers `ENAMETOOLONG` for every file it opens
 * under one — a live Max Research drive lost its workspace participant to
 * `/project/<id>/trust (500): ENAMETOOLONG` on a path 150 characters long.
 * Both roots here end up in that server's environment, so they are plain.
 */
function plainPath(value: string): string {
  return value.replace(/^\\\\\?\\/u, "");
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(plainPath(trimmed)) : null;
}

/** Short state root used by the upstream session store on Windows. */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return plainPath(
    configured(env.OPENSCIENCE_STATE_ROOT) ?? path.join(dashboardDataDir(), "openscience-state"),
  );
}

export function configRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), "config");
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), "data");
}

/** The durable shared research workspace prepared by Runtime V2 setup. */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return plainPath(
    configured(env.OPENSCIENCE_WORKSPACE_ROOT) ??
      path.join(dashboardDataDir(), "openscience-workspace"),
  );
}
