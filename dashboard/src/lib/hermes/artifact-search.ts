import type { PresentedArtifact } from "./artifact-types.ts";

/** In-progress work belongs in the chat that started it, not in the archive. */
export function filterArtifactsForArchive(
  artifacts: PresentedArtifact[],
): PresentedArtifact[] {
  return artifacts.filter((artifact) => artifact.status !== "generating");
}

/**
 * Match the useful, human-facing identity of an artifact without indexing its
 * potentially large generated contents in the browser.
 */
export function artifactMatchesSearch(
  artifact: PresentedArtifact,
  query: string,
): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;

  const metadataLabels = Object.values(artifact.metadata)
    .filter(
      (value): value is string | number | boolean =>
        typeof value === "number" ||
        typeof value === "boolean" ||
        (typeof value === "string" && value.length <= 500),
    )
    .slice(0, 20);
  const haystack = [
    artifact.id,
    artifact.title,
    artifact.filename,
    artifact.kind,
    artifact.renderer,
    artifact.mimeType,
    artifact.status,
    artifact.version,
    artifact.sourceSkill,
    artifact.sourceMcpServer,
    artifact.sourceMcpTool,
    artifact.sourceHermesTool,
    artifact.error?.message,
    ...metadataLabels,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join("\n")
    .toLocaleLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export function filterArtifactsForSearch(
  artifacts: PresentedArtifact[],
  query: string,
): PresentedArtifact[] {
  if (!query.trim()) return artifacts;
  return artifacts.filter((artifact) => artifactMatchesSearch(artifact, query));
}
