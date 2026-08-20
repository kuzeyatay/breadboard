import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath } from "../../learning-garden.ts";
import { scanClusterKnowledge, type KnowledgeNode } from "../../knowledge.ts";
import {
  gardensForScope,
  organizationForScope,
  type AuthorizedGarden,
  type BrainGraphAccessContext,
} from "../brain-graph-auth.ts";
import {
  brainEdgeId,
  gardenNodeId,
  knowledgeNodeId,
} from "../brain-graph-ids.ts";
import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainNode,
  BrainNodeKind,
  BrainRelation,
  BrainScope,
} from "../brain-graph-types.ts";

function publicKnowledgeKind(node: KnowledgeNode): BrainNodeKind {
  if (node.type === "source-document") return "source";
  if (node.type === INTERNAL_CONCEPT_TYPE || node.type === "knowledge-topic") return "concept";
  return "page";
}

function relation(value: string): BrainRelation {
  if (value === "source") return "derived_from";
  if (value === "wikilink") return "links_to";
  return "related_to";
}

function visibleKnowledge(node: KnowledgeNode): boolean {
  return !(
    node.draft === "true" ||
    (node.type !== INTERNAL_CONCEPT_TYPE && isLegacySubtopicRelPath(node.relPath))
  );
}

function gardenFragment(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  garden: AuthorizedGarden,
  perGardenLimit: number,
): BrainGraphFragment {
  const nodes: BrainNode[] = [];
  const edges: BrainEdge[] = [];
  const org = garden.organizationId
    ? context.organizations.find((candidate) => candidate.id === garden.organizationId)
    : null;
  const gardenId = gardenNodeId(garden.slug);
  nodes.push({
    id: gardenId,
    kind: "garden",
    label: garden.name,
    subtitle:
      garden.visibility === "organization" && org
        ? `${org.name} Garden`
        : garden.visibility === "private"
          ? "Private Garden"
          : "Garden",
    href: `/gardens/${encodeURIComponent(garden.slug)}`,
    origins: ["canonical"],
    organizationId: org?.publicId,
    gardenId,
    gardenSlug: garden.slug,
    createdAt: garden.createdAt,
    updatedAt: garden.lastViewedAt ?? undefined,
    expandable: true,
    metrics: { activity: garden.viewCount },
    metadata: {
      visibility: garden.visibility,
      ownedByYou: garden.ownerUserId === context.userId,
    },
  });

  // A Garden owned by the viewer can still be organization-visible. Personal
  // scope deliberately anchors it to the viewer; otherwise it would point at
  // an organization node that is absent from that scope and normalization
  // would silently discard the ownership edge.
  const useOrganizationParent = Boolean(org) && scope.kind !== "personal";
  const parentId = useOrganizationParent ? `organization:${org!.publicId}` : "user:self";
  if (scope.kind !== "organization" || organizationForScope(context, scope)?.id === org?.id) {
    edges.push({
      id: brainEdgeId(
        parentId,
        gardenId,
        useOrganizationParent ? "contains" : "owns",
        useOrganizationParent ? "organization" : "canonical",
      ),
      source: parentId,
      target: gardenId,
      relation: useOrganizationParent ? "contains" : "owns",
      origin: useOrganizationParent ? "organization" : "canonical",
      explicit: true,
      organizationId: org?.publicId,
      gardenId,
      weight: 1.5,
    });
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return {
      nodes,
      edges,
      warnings: [
        {
          source: "gardens",
          code: "content_path_unavailable",
          message: "Canonical Garden files are unavailable; Garden anchors are still shown.",
        },
      ],
    };
  }

  try {
    const knowledge = scanClusterKnowledge(contentPath, garden.slug, { migrateSources: false });
    const visible = knowledge.nodes.filter(visibleKnowledge);
    const ranked = visible
      .sort(
        (left, right) =>
          (right.wordCount > 0 ? 1 : 0) - (left.wordCount > 0 ? 1 : 0) ||
          (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0) ||
          left.slug.localeCompare(right.slug),
      )
      .slice(0, perGardenLimit);
    const visibleSlugs = new Set(ranked.map((node) => node.slug));

    for (const node of ranked) {
      const kind = publicKnowledgeKind(node);
      const nodeId = knowledgeNodeId(garden.slug, kind, node.slug);
      nodes.push({
        id: nodeId,
        kind,
        label: node.title,
        subtitle: node.description || node.excerpt || undefined,
        href: `/garden/${encodeURIComponent(garden.slug)}?note=${encodeURIComponent(node.slug)}`,
        origins: ["canonical"],
        organizationId: org?.publicId,
        gardenId,
        gardenSlug: garden.slug,
        createdAt: node.date,
        updatedAt: node.date,
        expandable: kind !== "concept",
        metrics: { wordCount: node.wordCount, activity: node.locations.length },
        metadata: {
          knowledgeType: node.type,
          sourceType: node.sourceType || null,
          locationCount: node.locations.length,
          tagCount: node.tags.length,
        },
      });
      edges.push({
        id: brainEdgeId(gardenId, nodeId, "contains", "canonical"),
        source: gardenId,
        target: nodeId,
        relation: "contains",
        origin: "canonical",
        explicit: true,
        organizationId: org?.publicId,
        gardenId,
        weight: kind === "source" ? 1.3 : 1,
      });
    }

    for (const edge of knowledge.edges) {
      if (!visibleSlugs.has(edge.source) || !visibleSlugs.has(edge.target)) continue;
      const sourceNode = ranked.find((node) => node.slug === edge.source);
      const targetNode = ranked.find((node) => node.slug === edge.target);
      if (!sourceNode || !targetNode) continue;
      const source = knowledgeNodeId(garden.slug, publicKnowledgeKind(sourceNode), sourceNode.slug);
      const target = knowledgeNodeId(garden.slug, publicKnowledgeKind(targetNode), targetNode.slug);
      const edgeRelation = relation(edge.relation);
      edges.push({
        id: brainEdgeId(source, target, edgeRelation, "canonical"),
        source,
        target,
        relation: edgeRelation,
        origin: "canonical",
        explicit: edge.relation !== "shared-topic",
        organizationId: org?.publicId,
        gardenId,
        weight: edge.relation === "shared-topic" ? 0.55 : 1,
      });
    }

    return {
      nodes,
      edges,
      truncated: visible.length > ranked.length,
    };
  } catch {
    return {
      nodes,
      edges,
      warnings: [
        {
          source: "gardens",
          code: "garden_scan_failed",
          message: `One authorized Garden could not be scanned; its private path was not exposed.`,
        },
      ],
    };
  }
}

export const gardensBrainSource = {
  name: "gardens",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const fragments = gardensForScope(context, scope)
      .slice(0, limits.maxGardens)
      .map((garden) =>
        gardenFragment(context, scope, garden, limits.maxKnowledgeNodesPerGarden),
      );
    return {
      nodes: fragments.flatMap((fragment) => fragment.nodes),
      edges: fragments.flatMap((fragment) => fragment.edges),
      warnings: fragments.flatMap((fragment) => fragment.warnings ?? []),
      truncated:
        gardensForScope(context, scope).length > limits.maxGardens ||
        fragments.some((fragment) => fragment.truncated),
    };
  },
  expand(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    nodeId: string,
    _depth: number,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const garden = gardensForScope(context, scope).find(
      (candidate) => gardenNodeId(candidate.slug) === nodeId,
    );
    if (!garden) return { nodes: [], edges: [] };
    return gardenFragment(
      context,
      scope,
      garden,
      Math.min(900, limits.maxKnowledgeNodesPerGarden * 2),
    );
  },
};
