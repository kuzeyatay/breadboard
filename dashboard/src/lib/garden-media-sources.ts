import {
  scanClusterKnowledge,
  type KnowledgeNode,
} from "./knowledge.ts";
import { gardenMediaKind } from "./garden-media-kind.ts";

export interface SelectedGardenMediaSources {
  audio: KnowledgeNode[];
  video: KnowledgeNode[];
}

/** Resolve UI selection slugs against the authorized Garden, never the client. */
export function selectedGardenMediaSources(input: {
  contentPath: string;
  clusterSlug: string;
  selectedSlugs: readonly string[];
}): SelectedGardenMediaSources {
  const wanted = new Set(input.selectedSlugs);
  const selected = scanClusterKnowledge(input.contentPath, input.clusterSlug).nodes.filter(
    (node) => wanted.has(node.slug) && node.type === "source-document",
  );
  return {
    audio: selected.filter((node) => gardenMediaKind(node) === "audio"),
    video: selected.filter((node) => gardenMediaKind(node) === "video"),
  };
}
