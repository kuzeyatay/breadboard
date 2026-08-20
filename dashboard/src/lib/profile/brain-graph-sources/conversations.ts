import {
  listConversationsForUser,
  type ConversationRow,
} from "../../conversations/store.ts";
import {
  gardensForScope,
  type BrainGraphAccessContext,
} from "../brain-graph-auth.ts";
import {
  agentNodeId,
  brainEdgeId,
  conversationNodeId,
  gardenNodeId,
} from "../brain-graph-ids.ts";
import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainNode,
  BrainScope,
} from "../brain-graph-types.ts";

function inScope(
  conversation: ConversationRow,
  scope: BrainScope,
  gardenIds: Set<number>,
): boolean {
  if (scope.kind !== "organization") return true;
  return (
    conversation.default_garden_id !== null && gardenIds.has(conversation.default_garden_id)
  );
}

export const conversationsBrainSource = {
  name: "conversations",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const gardens = gardensForScope(context, scope);
    const gardenIds = new Set(gardens.map((garden) => garden.id));
    const gardenById = new Map(gardens.map((garden) => [garden.id, garden]));
    const conversations = listConversationsForUser(context.userId, context.database)
      .filter((conversation) => inScope(conversation, scope, gardenIds))
      .slice(0, limits.maxConversations);

    for (const conversation of conversations) {
      const nodeId = conversationNodeId(conversation.public_id);
      const garden =
        conversation.default_garden_id === null
          ? null
          : gardenById.get(conversation.default_garden_id) ?? null;
      const organization = garden?.organizationId
        ? context.organizations.find(
            (candidate) => candidate.id === garden.organizationId,
          ) ?? null
        : null;
      nodes.push({
        id: nodeId,
        kind: "conversation",
        label: conversation.title || "Untitled conversation",
        subtitle: garden ? `${garden.name} · ${conversation.surface}` : conversation.surface,
        href: `/dashboard?conversation=${encodeURIComponent(conversation.public_id)}`,
        origins: ["conversation"],
        organizationId: organization?.publicId,
        gardenId: garden ? gardenNodeId(garden.slug) : undefined,
        gardenSlug: garden?.slug,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        expandable: true,
        metrics: { activity: conversation.next_order_index },
        metadata: {
          surface: conversation.surface,
          scope: conversation.scope_kind,
          pinned: conversation.pinned_at !== null,
          highlighted: conversation.highlight !== null,
        },
      });
      edges.push({
        id: brainEdgeId("user:self", nodeId, "owns", "conversation"),
        source: "user:self",
        target: nodeId,
        relation: "owns",
        origin: "conversation",
        explicit: true,
        organizationId: organization?.publicId,
        gardenId: garden ? gardenNodeId(garden.slug) : undefined,
      });

      if (garden) {
        const target = gardenNodeId(garden.slug);
        edges.push({
          id: brainEdgeId(nodeId, target, "created_in", "conversation"),
          source: nodeId,
          target,
          relation: "created_in",
          origin: "conversation",
          explicit: true,
          organizationId: organization?.publicId,
          gardenId: target,
        });
      }

      if (conversation.active_agency_agent_slug) {
        const agentId = agentNodeId(conversation.active_agency_agent_slug);
        nodes.push({
          id: agentId,
          kind: "agent",
          label: conversation.active_agency_agent_slug,
          subtitle: "Agency agent",
          origins: ["agent"],
          organizationId: organization?.publicId,
          gardenId: garden ? gardenNodeId(garden.slug) : undefined,
          expandable: true,
          metadata: { human: false },
        });
        edges.push({
          id: brainEdgeId(agentId, nodeId, "participated_in", "agent"),
          source: agentId,
          target: nodeId,
          relation: "participated_in",
          origin: "agent",
          explicit: true,
          organizationId: organization?.publicId,
        });
      }
    }

    return { nodes, edges, truncated: conversations.length >= limits.maxConversations };
  },
};

