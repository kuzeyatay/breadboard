import db from "../db.ts";
import {
  ensureGraftIndex,
  graftRunContextFor,
  type GraftIndexState,
  type GraftRunContext,
} from "./index-service.ts";

/**
 * Per-Garden opt-out for the graft code index.
 *
 * The directory is `code-index/` rather than `graft/` because this repository's
 * .gitignore carries graft's own unanchored `graft/` rule, which would ignore a
 * source directory of that name — and `graft build` re-adds the rule whenever it
 * is missing, so anchoring it would not hold.
 *
 * On by default, for every Garden and every repository: a coding agent that
 * knows the shape of the repository it was pointed at is the behaviour worth
 * defaulting to, and `clusters.graft_enabled` exists so a Garden can be taken
 * back to plain filesystem search when that is what the work needs.
 */
export function graftEnabledForGarden(
  userId: number,
  gardenSlug: string,
): boolean {
  const row = db
    .prepare("SELECT graft_enabled FROM clusters WHERE user_id = ? AND slug = ?")
    .get(userId, gardenSlug) as { graft_enabled?: number | null } | undefined;
  // A Garden that predates the column, or a row this user cannot see, both read
  // as the default rather than as "off".
  return row ? row.graft_enabled !== 0 : true;
}

/**
 * What the coding agents in this Garden should be handed. Null means this run
 * proceeds without graft — the setting is off, the CLI is missing, or the graph
 * is still building (this call is what starts that build).
 */
export function graftRunContext(
  userId: number,
  repository: { path: string; gardenSlug: string },
): GraftRunContext | null {
  if (!graftEnabledForGarden(userId, repository.gardenSlug)) return null;
  return graftRunContextFor(repository.path);
}

/**
 * Called when a repository is connected to a Garden, so the graph is usually
 * built by the time the first coding agent runs against it.
 */
export function prepareGraftIndex(repositoryPath: string): GraftIndexState {
  return ensureGraftIndex(repositoryPath);
}
