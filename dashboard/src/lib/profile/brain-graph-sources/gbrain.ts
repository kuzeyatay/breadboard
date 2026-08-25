import { GBrainClient } from "../../gbrain/client.ts";
import { resolveGBrainConfig } from "../../gbrain/config.ts";
import { deriveSourceId } from "../../gbrain/mapping.ts";
import { scanClusterKnowledge, type KnowledgeNode } from "../../knowledge.ts";
import { INTERNAL_CONCEPT_TYPE } from "../../learning-garden.ts";
import { readSupervisedServiceSnapshot } from "../../supervisor-control.ts";
import {
  gardensForScope,
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
  BrainScope,
} from "../brain-graph-types.ts";

function nodeKind(node: KnowledgeNode): BrainNodeKind {
  if (node.type === "source-document") return "source";
  if (node.type === INTERNAL_CONCEPT_TYPE || node.type === "knowledge-topic") return "concept";
  return "page";
}

function readKnowledge(garden: AuthorizedGarden): KnowledgeNode[] {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return [];
  return scanClusterKnowledge(contentPath, garden.slug, { migrateSources: false }).nodes;
}

export const gbrainBrainSource = {
  name: "gbrain",
  async buildOverview(
    _context: BrainGraphAccessContext,
    _scope: BrainScope,
    _limits: BrainGraphLimits,
    signal?: AbortSignal,
  ): Promise<BrainGraphFragment> {
    const config = resolveGBrainConfig();
    if (config.mode === "disabled") return { nodes: [], edges: [] };
    const lifecycle = await readSupervisedServiceSnapshot("gbrain");
    if (
      lifecycle &&
      (lifecycle.state === "pending" ||
        lifecycle.state === "starting" ||
        lifecycle.state === "stopped" ||
        lifecycle.state === "available-but-stopped")
    ) {
      // This overview is observational. Absence of an active GBrain tree is an
      // ordinary idle state and must not create a warning or cold-start it.
      return { nodes: [], edges: [] };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 750);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const health = await new GBrainClient(config).health(controller.signal);
      if (health.status === "unavailable" || !health.ready) {
        return {
          nodes: [],
          edges: [],
          warnings: [
            {
              source: "gbrain",
              code: "gbrain_unavailable",
              message: "GBrain-derived neighbors are unavailable; canonical relationships remain visible.",
            },
          ],
        };
      }
      if (health.status === "degraded" || health.mode === "lexical_degraded") {
        return {
          nodes: [],
          edges: [],
          warnings: [
            {
              source: "gbrain",
              code: "gbrain_degraded",
              message: "GBrain is running in lexical mode; canonical relationships are unaffected.",
            },
          ],
        };
      }
      return { nodes: [], edges: [] };
    } finally {
      clearTimeout(timer);
    }
  },
  async expand(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    selectedNodeId: string,
    _depth: number,
    _limits: BrainGraphLimits,
    signal?: AbortSignal,
  ): Promise<BrainGraphFragment> {
    const config = resolveGBrainConfig();
    if (config.mode === "disabled") return { nodes: [], edges: [] };
    const gardens = gardensForScope(context, scope);
    let selected:
      | { garden: AuthorizedGarden; knowledge: KnowledgeNode; nodeId: string }
      | undefined;
    const knowledgeByGarden = new Map<number, KnowledgeNode[]>();
    for (const garden of gardens) {
      let knowledge: KnowledgeNode[];
      try {
        knowledge = readKnowledge(garden);
      } catch {
        continue;
      }
      knowledgeByGarden.set(garden.id, knowledge);
      const match = knowledge.find(
        (node) =>
          knowledgeNodeId(garden.slug, nodeKind(node), node.slug) === selectedNodeId,
      );
      if (match) {
        selected = { garden, knowledge: match, nodeId: selectedNodeId };
        break;
      }
    }
    if (!selected || selected.knowledge.type === "source-document") {
      return { nodes: [], edges: [] };
    }

    const authorizedBySource = new Map(
      gardens.map((garden) => [deriveSourceId(garden.id), garden]),
    );
    try {
      const result = await new GBrainClient(config).graph(
        {
          userId: String(context.userId),
          authorizedSourceIds: [...authorizedBySource.keys()],
        },
        selected.knowledge.slug,
        deriveSourceId(selected.garden.id),
        24,
        signal,
      );
      const nodes: BrainNode[] = [];
      const edges: BrainEdge[] = [];
      for (const neighbor of result.neighbors) {
        const garden = authorizedBySource.get(neighbor.sourceId);
        if (!garden) continue;
        let knowledge = knowledgeByGarden.get(garden.id);
        if (!knowledge) {
          try {
            knowledge = readKnowledge(garden);
          } catch {
            continue;
          }
          knowledgeByGarden.set(garden.id, knowledge);
        }
        const canonical = knowledge.find((node) => node.slug === neighbor.pageId);
        if (!canonical) continue;
        const kind = nodeKind(canonical);
        const nodeId = knowledgeNodeId(garden.slug, kind, canonical.slug);
        const organization = garden.organizationId
          ? context.organizations.find(
              (candidate) => candidate.id === garden.organizationId,
            ) ?? null
          : null;
        nodes.push({
          id: nodeId,
          kind,
          label: canonical.title,
          subtitle: canonical.description || canonical.excerpt || undefined,
          href: `/garden/${encodeURIComponent(garden.slug)}?note=${encodeURIComponent(canonical.slug)}`,
          origins: ["canonical", "gbrain-derived"],
          organizationId: organization?.publicId,
          gardenId: gardenNodeId(garden.slug),
          gardenSlug: garden.slug,
          createdAt: canonical.date,
          updatedAt: canonical.date,
          expandable: true,
          metrics: { wordCount: canonical.wordCount },
          metadata: {
            knowledgeType: canonical.type,
            derivedRelation: neighbor.relation,
          },
        });
        edges.push({
          id: brainEdgeId(selected.nodeId, nodeId, "related_to", "gbrain-derived"),
          source: selected.nodeId,
          target: nodeId,
          relation: "related_to" as const,
          origin: "gbrain-derived" as const,
          explicit: false,
          weight: 0.45,
          organizationId: organization?.publicId,
          gardenId: gardenNodeId(garden.slug),
        });
      }
      return {
        nodes,
        edges,
        warnings: result.warnings.length
          ? [
              {
                source: "gbrain",
                code: "gbrain_degraded",
                message: "Some derived neighbors were unavailable; canonical data was preserved.",
              },
            ]
          : [],
      };
    } catch {
      return {
        nodes: [],
        edges: [],
        warnings: [
          {
            source: "gbrain",
            code: "gbrain_unavailable",
            message: "GBrain expansion is unavailable; canonical relationships remain visible.",
          },
        ],
      };
    }
  },
};
