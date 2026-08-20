import { listDurableMemories } from "../../conversations/memory-inspection.ts";
import {
  conversationNodeId,
  brainEdgeId,
  gardenNodeId,
  memoryNodeId,
} from "../brain-graph-ids.ts";
import type { BrainGraphAccessContext } from "../brain-graph-auth.ts";
import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainNode,
  BrainScope,
} from "../brain-graph-types.ts";

function memoryLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 84 ? compact : `${compact.slice(0, 81).trimEnd()}…`;
}

export const memoriesBrainSource = {
  name: "memories",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    if (scope.kind === "organization") return { nodes: [], edges: [] };
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const gardensById = new Map(
      context.readableGardens.map((garden) => [String(garden.id), garden]),
    );
    const conversationIds = new Map(
      (
        context.database
          .prepare("SELECT id, public_id FROM conversations WHERE user_id = ?")
          .all(context.userId) as Array<{ id: number; public_id: string }>
      ).map((conversation) => [conversation.id, conversation.public_id]),
    );
    const memories = listDurableMemories(
      context.userId,
      { includeSuperseded: false, limit: limits.maxMemories },
      context.database,
    );

    for (const memory of memories) {
      const nodeId = memoryNodeId(memory.id);
      const garden = memory.scope === "garden" && memory.scopeId
        ? gardensById.get(memory.scopeId) ?? null
        : null;
      nodes.push({
        id: nodeId,
        kind: "memory",
        label: memoryLabel(memory.content),
        subtitle: `${memory.kind.replaceAll("_", " ")} · ${memory.state}`,
        origins: ["memory"],
        gardenId: garden ? gardenNodeId(garden.slug) : undefined,
        gardenSlug: garden?.slug,
        createdAt: memory.createdAt,
        updatedAt: memory.lastConfirmedAt ?? memory.createdAt,
        expandable: true,
        metrics: { activity: Math.round(memory.salience * 20) },
        metadata: {
          kind: memory.kind,
          state: memory.state,
          scope: memory.scope,
          confidence: memory.confidence,
          salience: memory.salience,
        },
      });
      edges.push({
        id: brainEdgeId("user:self", nodeId, "owns", "memory"),
        source: "user:self",
        target: nodeId,
        relation: "owns",
        origin: "memory",
        explicit: true,
      });

      if (garden) {
        const target = gardenNodeId(garden.slug);
        edges.push({
          id: brainEdgeId(nodeId, target, "about", "memory"),
          source: nodeId,
          target,
          relation: "about",
          origin: "memory",
          explicit: true,
          gardenId: target,
        });
      }
      if (memory.sourceConversationId !== null) {
        const publicId = conversationIds.get(memory.sourceConversationId);
        if (publicId) {
          const target = conversationNodeId(publicId);
          edges.push({
            id: brainEdgeId(nodeId, target, "derived_from", "memory"),
            source: nodeId,
            target,
            relation: "derived_from",
            origin: "memory",
            explicit: true,
          });
        }
      }
    }
    return { nodes, edges, truncated: memories.length >= limits.maxMemories };
  },
};
