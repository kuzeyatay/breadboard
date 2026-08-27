// Pure OpenScience state paths shared by the trusted dashboard facade and the
// Runtime-owned service. This module deliberately has no launcher probing or
// child-process imports, so reading a sealed deliverable never loads execution
// authority into Next.js.

import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** Short state root used by the upstream session store on Windows. */
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

/** The durable shared research workspace prepared by Runtime V2 setup. */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENSCIENCE_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "openscience-workspace")
  );
}
