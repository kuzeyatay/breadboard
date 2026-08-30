import type Database from "better-sqlite3";
import {
  ArtifactStoreError,
  getArtifactById,
  listArtifactsForUser,
  type ArtifactRow,
} from "./artifact-store.ts";

export interface AgentArtifactScope {
  userId: number;
  surface: "dashboard_terminal" | "garden_chat";
  clusterId: number | null;
  gardenSlug: string | null;
}

function requireValidScope(scope: AgentArtifactScope): void {
  const terminal =
    scope.surface === "dashboard_terminal" &&
    scope.clusterId === null &&
    scope.gardenSlug === null;
  const garden =
    scope.surface === "garden_chat" &&
    Number.isInteger(scope.clusterId) &&
    scope.clusterId !== null &&
    Boolean(scope.gardenSlug?.trim());
  if (!terminal && !garden) {
    throw new ArtifactStoreError(
      403,
      "artifact_session_scope_mismatch",
      "Artifact session scope is invalid.",
    );
  }
}

/**
 * Resolve the same archive the user can see from the active conversational
 * surface. Terminal owns one user-wide archive; Garden Chat owns one archive
 * per Garden. Neither scope can cross users, surfaces, or Gardens.
 */
export function listArtifactsInAgentScope(
  scope: AgentArtifactScope,
  database?: Database.Database,
): ArtifactRow[] {
  requireValidScope(scope);
  return listArtifactsForUser({
    userId: scope.userId,
    sourceSurface: scope.surface,
    ...(scope.surface === "garden_chat"
      ? { gardenSlug: scope.gardenSlug! }
      : {}),
    database,
  });
}

export function artifactBelongsToAgentScope(
  artifact: ArtifactRow,
  scope: AgentArtifactScope,
): boolean {
  requireValidScope(scope);
  if (
    artifact.user_id !== scope.userId ||
    artifact.source_surface !== scope.surface
  ) {
    return false;
  }
  if (scope.surface === "dashboard_terminal") {
    return artifact.cluster_id === null && !artifact.garden_slug;
  }
  return (
    artifact.cluster_id === scope.clusterId &&
    artifact.garden_slug === scope.gardenSlug
  );
}

export function getArtifactInAgentScope(
  artifactId: string,
  scope: AgentArtifactScope,
  database?: Database.Database,
): ArtifactRow {
  const artifact = getArtifactById(artifactId, database);
  if (!artifact || !artifactBelongsToAgentScope(artifact, scope)) {
    // Deliberately indistinguishable from a missing id: callers must not be
    // able to probe whether another user's or another Garden's artifact exists.
    throw new ArtifactStoreError(404, "artifact_not_found", "Artifact not found.");
  }
  return artifact;
}

export function describeAgentArtifactScope(scope: AgentArtifactScope): string {
  requireValidScope(scope);
  return scope.surface === "dashboard_terminal"
    ? "all of this user's Terminal chats"
    : `all chats in Garden ${scope.gardenSlug}`;
}
