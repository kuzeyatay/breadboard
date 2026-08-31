import path from "node:path";

import { readThoughtTopology } from "../../thought-topology/storage.ts";
import type {
  ThoughtTopology,
  TopologyEdge,
  TopologyNode,
} from "../../thought-topology/types.ts";
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

function topologyNodeKind(node: TopologyNode): BrainNodeKind {
  if (node.kind === "source") return "source";
  if (node.kind === "internal-concept") return "concept";
  return "page";
}

function topologyRelation(edge: TopologyEdge): BrainRelation {
  if (edge.relationType === "derives-from") return "derived_from";
  if (edge.relationType === "part-of") return "belongs_to";
  if (edge.relationType === "applies-to" || edge.relationType === "example-of") {
    return "supports";
  }
  return "related_to";
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
      graphModel: "thought-topology",
    },
  });

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

  const contentRoot = process.env.QUARTZ_CONTENT_PATH;
  if (!contentRoot) {
    return {
      nodes,
      edges,
      warnings: [{
        source: "thought-topology",
        code: "content_path_unavailable",
        message: "Thought Topology files are unavailable; Garden anchors are still shown.",
      }],
    };
  }

  const topology = readThoughtTopology(path.join(contentRoot, garden.slug));
  if (!topology) {
    return {
      nodes,
      edges,
      warnings: [{
        source: "thought-topology",
        code: "topology_unavailable",
        message: "One authorized Garden is waiting for its Thought Topology to be generated.",
      }],
    };
  }

  return topologyFragment(topology, {
    nodes,
    edges,
    garden,
    gardenId,
    organizationId: org?.publicId,
    perGardenLimit,
  });
}

function topologyFragment(
  topology: ThoughtTopology,
  context: {
    nodes: BrainNode[];
    edges: BrainEdge[];
    garden: AuthorizedGarden;
    gardenId: string;
    organizationId?: string;
    perGardenLimit: number;
  },
): BrainGraphFragment {
  const { garden, gardenId, organizationId } = context;
  const nodes = [...context.nodes];
  const edges = [...context.edges];
  const folderIdByTopologyId = new Map<string, string>();
  const pageIdByTopologyId = new Map<string, string>();
  const allFolders = [...topology.folders]
    .sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
  for (const folder of allFolders) {
    if (!folder.path) folderIdByTopologyId.set(folder.id, gardenId);
  }
  const folders = allFolders.filter((folder) => Boolean(folder.path));
  const pageBudget = Math.max(0, context.perGardenLimit - folders.length - 1);
  const pages = [...topology.nodes]
    .sort(
      (left, right) =>
        right.wordCount - left.wordCount || left.slug.localeCompare(right.slug),
    )
    .slice(0, pageBudget);

  for (const folder of folders) {
    const nodeId = knowledgeNodeId(garden.slug, "folder", folder.path || folder.id);
    folderIdByTopologyId.set(folder.id, nodeId);
    nodes.push({
      id: nodeId,
      kind: "folder",
      label: folder.title,
      subtitle: folder.summary.text || undefined,
      href: folder.pageSlug
        ? `/garden/${encodeURIComponent(garden.slug)}?note=${encodeURIComponent(folder.pageSlug)}`
        : undefined,
      origins: ["canonical", "thought-topology"],
      organizationId,
      gardenId,
      gardenSlug: garden.slug,
      updatedAt: topology.build.generatedAt,
      expandable: true,
      metrics: { activity: folder.nodeCount },
      metadata: {
        graphModel: "thought-topology",
        folderPath: folder.path,
        folderDepth: folder.depth,
        summaryState: folder.summary.state,
      },
    });
  }

  for (const folder of folders) {
    const target = folderIdByTopologyId.get(folder.id);
    if (!target) continue;
    const source = folder.parentId
      ? folderIdByTopologyId.get(folder.parentId)
      : gardenId;
    if (!source) continue;
    edges.push({
      id: brainEdgeId(source, target, "contains", "canonical"),
      source,
      target,
      relation: "contains",
      origin: "canonical",
      explicit: true,
      weight: folder.parentId ? 1.25 : 1.45,
      organizationId,
      gardenId,
    });
  }

  for (const page of pages) {
    const kind = topologyNodeKind(page);
    const nodeId = knowledgeNodeId(garden.slug, kind, page.slug);
    pageIdByTopologyId.set(page.id, nodeId);
    nodes.push({
      id: nodeId,
      kind,
      label: page.title,
      subtitle: page.summary.text || undefined,
      href: `/garden/${encodeURIComponent(garden.slug)}?note=${encodeURIComponent(page.slug)}`,
      origins: ["canonical", "thought-topology"],
      organizationId,
      gardenId,
      gardenSlug: garden.slug,
      updatedAt: topology.build.generatedAt,
      expandable: kind !== "concept",
      metrics: { wordCount: page.wordCount },
      metadata: {
        graphModel: "thought-topology",
        knowledgeType: page.knowledgeType,
        primaryConcepts: page.primaryConcepts.join(" · "),
        summaryState: page.summary.state,
      },
    });
    const folderId = folderIdByTopologyId.get(page.folderId);
    if (folderId) {
      edges.push({
        id: brainEdgeId(folderId, nodeId, "contains", "canonical"),
        source: folderId,
        target: nodeId,
        relation: "contains",
        origin: "canonical",
        explicit: true,
        weight: kind === "source" ? 1.25 : 1.05,
        organizationId,
        gardenId,
      });
    }
  }

  for (const edge of topology.edges) {
    const source = pageIdByTopologyId.get(edge.source);
    const target = pageIdByTopologyId.get(edge.target);
    if (!source || !target) continue;
    const relation = topologyRelation(edge);
    const origin = "thought-topology" as const;
    edges.push({
      id: brainEdgeId(source, target, relation, origin),
      source,
      target,
      relation,
      origin,
      explicit: edge.origin !== "inferred",
      confidence: edge.score,
      weight: edge.score,
      organizationId,
      gardenId,
      semanticRelation: edge.relationType,
      direction: edge.direction,
      explanation: edge.explanation.text || undefined,
      evidence: edge.evidence.slice(0, 6).map((item) => item.label),
    });
  }

  return {
    nodes,
    edges,
    truncated: topology.nodes.length > pages.length,
    warnings: topology.build.state === "ready"
      ? []
      : [{
          source: "thought-topology",
          code: `topology_${topology.build.state}`,
          message: `One Garden's Thought Topology is ${topology.build.state}; its last safe graph is shown.`,
        }],
  };
}

export const gardensBrainSource = {
  name: "thought-topology",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const gardens = gardensForScope(context, scope);
    const fragments = gardens
      .slice(0, limits.maxGardens)
      .map((garden) => gardenFragment(context, scope, garden, limits.maxKnowledgeNodesPerGarden));
    return {
      nodes: fragments.flatMap((fragment) => fragment.nodes),
      edges: fragments.flatMap((fragment) => fragment.edges),
      warnings: fragments.flatMap((fragment) => fragment.warnings ?? []),
      truncated:
        gardens.length > limits.maxGardens || fragments.some((fragment) => fragment.truncated),
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
