import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { parseSemanticMarkdown } from "../garden-semantics.ts";
import type { KnowledgeNode } from "../knowledge.ts";
import type { AuthoredCandidate } from "./scoring.ts";

export const TOPOLOGY_PROVENANCE_FILES = [
  ".breadboard/source-anchors.json",
  ".breadboard/source-visuals.json",
] as const;

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Resolve recorded ownership, never infer a source from an anchor's name. */
export function sourceAnchorEdges(
  gardenDir: string,
  nodes: readonly KnowledgeNode[],
): AuthoredCandidate[] {
  const ledger = record(readJson(path.join(gardenDir, TOPOLOGY_PROVENANCE_FILES[0])));
  const visuals = readJson(path.join(gardenDir, TOPOLOGY_PROVENANCE_FILES[1]));
  const anchors = [
    ...Object.values(ledger).flatMap((value) => Array.isArray(value) ? value : []),
    ...(Array.isArray(visuals) ? visuals : []),
  ];
  const owners = new Map<string, Set<string>>();
  for (const value of anchors) {
    const anchor = record(value);
    const id = anchor.id ?? anchor.sourceVisualId;
    if (typeof id !== "string" || typeof anchor.sourceId !== "string") continue;
    const sources = owners.get(id) ?? new Set<string>();
    sources.add(anchor.sourceId);
    owners.set(id, sources);
  }
  const sourceNodes = new Map(nodes
    .filter((node) => node.type === "source-document")
    .map((node) => [node.slug, node]));
  const edges: AuthoredCandidate[] = [];
  for (const node of nodes) {
    const { data } = parseSemanticMarkdown(node.content);
    const ids = ["sourceAnchors", "sourceVisualIds", "sourceFormulaAnchors"]
      .flatMap((key) => Array.isArray(data[key]) ? data[key] : [])
      .filter((id): id is string => typeof id === "string");
    const references = new Map<string, string[]>();
    for (const id of new Set(ids)) {
      const sources = owners.get(id);
      // Conflicting ownership or a removed/hidden source cannot establish a link.
      if (sources?.size !== 1) continue;
      const sourceId = [...sources][0];
      if (!sourceNodes.has(sourceId) || sourceId === node.slug) continue;
      const evidence = references.get(sourceId) ?? [];
      evidence.push(id);
      references.set(sourceId, evidence);
    }
    for (const [sourceId, ids] of references) {
      edges.push({
        source: `page:${node.slug}`,
        target: `page:${sourceId}`,
        origin: "provenance",
        relationType: "derives-from",
        evidence: ids.sort().map((id) => ({
          kind: "authored",
          label: `Source anchor: ${id}`,
          sourceNodeId: `page:${sourceId}`,
        })),
      });
    }
  }
  return edges;
}
