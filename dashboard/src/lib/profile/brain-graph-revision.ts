import crypto from "node:crypto";
import type { BrainEdge, BrainNode, BrainScope } from "./brain-graph-types.ts";

export function brainGraphRevision(
  scope: BrainScope,
  nodes: readonly BrainNode[],
  edges: readonly BrainEdge[],
): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(scope));
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(`n\0${node.id}\0${node.kind}\0${node.updatedAt ?? node.createdAt ?? ""}\0`);
  }
  for (const edge of [...edges].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(`e\0${edge.id}\0${edge.source}\0${edge.target}\0`);
  }
  return `brain_${hash.digest("base64url").slice(0, 20)}`;
}
