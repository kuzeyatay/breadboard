import {
  listArtifactsForUser,
  type ArtifactRow,
} from "../../hermes/artifact-store.ts";
import {
  gardensForScope,
  type BrainGraphAccessContext,
} from "../brain-graph-auth.ts";
import {
  agentNodeId,
  artifactNodeId,
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

function uniqueArtifacts(rows: ArtifactRow[]): ArtifactRow[] {
  return [...new Map(rows.map((artifact) => [artifact.id, artifact])).values()];
}

export const artifactsBrainSource = {
  name: "artifacts",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const scopedGardens = gardensForScope(context, scope);
    const scopedGardenIds = new Set(scopedGardens.map((garden) => garden.id));
    const gardensById = new Map(scopedGardens.map((garden) => [garden.id, garden]));
    const artifacts = uniqueArtifacts([
      ...listArtifactsForUser({
        userId: context.userId,
        sourceSurface: "dashboard_terminal",
        database: context.database,
      }),
      ...listArtifactsForUser({
        userId: context.userId,
        sourceSurface: "garden_chat",
        database: context.database,
      }),
    ])
      .filter(
        (artifact) =>
          artifact.status === "ready" &&
          (scope.kind !== "organization" ||
            (artifact.cluster_id !== null && scopedGardenIds.has(artifact.cluster_id))),
      )
      .sort(
        (left, right) =>
          (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0),
      )
      .slice(0, limits.maxArtifacts);

    for (const artifact of artifacts) {
      const nodeId = artifactNodeId(artifact.id);
      const garden = artifact.cluster_id === null
        ? null
        : gardensById.get(artifact.cluster_id) ?? null;
      const organization = garden?.organizationId
        ? context.organizations.find(
            (candidate) => candidate.id === garden.organizationId,
          ) ?? null
        : null;
      nodes.push({
        id: nodeId,
        kind: "artifact",
        label: artifact.title,
        subtitle: `${artifact.kind} · version ${artifact.current_version}`,
        href: artifact.conversation_public_id
          ? `/dashboard?conversation=${encodeURIComponent(artifact.conversation_public_id)}&artifact=${encodeURIComponent(artifact.id)}`
          : "/dashboard",
        origins: ["artifact"],
        organizationId: organization?.publicId,
        gardenId: garden ? gardenNodeId(garden.slug) : undefined,
        gardenSlug: garden?.slug,
        createdAt: artifact.created_at,
        updatedAt: artifact.updated_at,
        expandable: true,
        metrics: { activity: artifact.current_version },
        metadata: {
          kind: artifact.kind,
          version: artifact.current_version,
          mimeType: artifact.mime_type,
          byteSize: artifact.byte_size,
          highlighted: artifact.highlight !== null,
        },
      });
      edges.push({
        id: brainEdgeId("user:self", nodeId, "owns", "artifact"),
        source: "user:self",
        target: nodeId,
        relation: "owns",
        origin: "artifact",
        explicit: true,
        organizationId: organization?.publicId,
      });
      if (artifact.conversation_public_id) {
        const target = conversationNodeId(artifact.conversation_public_id);
        edges.push({
          id: brainEdgeId(nodeId, target, "produced", "artifact"),
          source: nodeId,
          target,
          relation: "produced",
          origin: "artifact",
          explicit: true,
          organizationId: organization?.publicId,
        });
      }
      if (garden) {
        const target = gardenNodeId(garden.slug);
        edges.push({
          id: brainEdgeId(nodeId, target, "created_in", "artifact"),
          source: nodeId,
          target,
          relation: "created_in",
          origin: "artifact",
          explicit: true,
          organizationId: organization?.publicId,
          gardenId: target,
        });
      }
      if (artifact.source_skill) {
        const agentId = agentNodeId(artifact.source_skill);
        nodes.push({
          id: agentId,
          kind: "agent",
          label: artifact.source_skill,
          subtitle: "Producing skill",
          origins: ["agent", "artifact"],
          organizationId: organization?.publicId,
          expandable: true,
          metadata: { human: false },
        });
        edges.push({
          id: brainEdgeId(nodeId, agentId, "generated_by", "agent"),
          source: nodeId,
          target: agentId,
          relation: "generated_by",
          origin: "agent",
          explicit: true,
          organizationId: organization?.publicId,
        });
      }
    }

    return { nodes, edges, truncated: artifacts.length >= limits.maxArtifacts };
  },
};
