import { externalRuntimePath as path } from "../external-runtime-path.ts";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { LoopxError } from "./request.ts";

export interface LoopxPaths {
  home: string;
  runtimeRoot: string;
  project: string;
  registry: string;
  snapshot: string;
  stateFile: string;
  goalId: string;
}

function configuredPath(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

export function loopxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ENABLE_LOOPX?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function conversationGoalId(conversationPublicId: string): string {
  const slug = conversationPublicId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!slug) {
    throw new LoopxError(
      "loopx_invalid_conversation",
      "A LoopX goal needs a conversation identifier.",
    );
  }
  return `bb-${slug}`;
}

export function loopxHome(env: NodeJS.ProcessEnv = process.env): string {
  return configuredPath(env.BREADBOARD_LOOPX_HOME) ??
    path.join(dashboardDataDir(), "loopx-goals");
}

export function loopxPaths(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): LoopxPaths {
  const goalId = conversationGoalId(conversationPublicId);
  const home = loopxHome(env);
  const project = path.join(home, "conversations", goalId);
  return {
    home,
    runtimeRoot: path.join(home, "runtime"),
    project,
    registry: path.join(project, ".loopx", "registry.json"),
    snapshot: path.join(project, "snapshot.json"),
    stateFile: path.join(project, ".codex", "goals", goalId, "ACTIVE_GOAL_STATE.md"),
    goalId,
  };
}

export function loopxGoalExists(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    return fs.existsSync(loopxPaths(conversationPublicId, env).registry);
  } catch {
    return false;
  }
}
