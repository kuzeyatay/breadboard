import db from "../db.ts";
import { getActiveRuntimeRun, getLatestRuntimeRun } from "./run-store.ts";
import type { CapabilityToken } from "./capability-token.ts";

/** Resolve the owned run before a tool saves content; never revive a stopped turn. */
export function activeRunForToken(token: CapabilityToken, requireActive = false) {
  const id = Number(token.breadboardSessionId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const owner = db.prepare("SELECT user_id FROM hermes_runtime_sessions WHERE id = ?").get(id) as { user_id: number } | undefined;
  if (owner?.user_id !== token.userId) return null;
  const run = getActiveRuntimeRun(id) ?? getLatestRuntimeRun(id);
  if (requireActive && run && run.status !== "active") throw new Error("This turn was stopped; nothing was saved.");
  return run?.status === "active" ? run : null;
}

