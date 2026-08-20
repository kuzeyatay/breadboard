import { resolveGBrainConfig } from "../gbrain/config.ts";
import {
  brainScopeOptions,
  buildBrainGraphAccessContext,
  type BrainGraphAccessContext,
} from "./brain-graph-auth.ts";
import { opaqueBrainId } from "./brain-graph-ids.ts";
import { normalizeBrainGraph } from "./brain-graph-normalize.ts";
import { brainGraphRevision } from "./brain-graph-revision.ts";
import {
  DEFAULT_BRAIN_GRAPH_LIMITS,
  type BrainGraphFragment,
  type BrainGraphLimits,
  type BrainGraphResponse,
  type BrainGraphSourceAdapter,
  type BrainScope,
  type BrainWarning,
} from "./brain-graph-types.ts";
import { artifactsBrainSource } from "./brain-graph-sources/artifacts.ts";
import { buzzBrainSource } from "./brain-graph-sources/buzz.ts";
import { conversationsBrainSource } from "./brain-graph-sources/conversations.ts";
import { gardensBrainSource } from "./brain-graph-sources/gardens.ts";
import { gbrainBrainSource } from "./brain-graph-sources/gbrain.ts";
import { memoriesBrainSource } from "./brain-graph-sources/memories.ts";
import { organizationsBrainSource } from "./brain-graph-sources/organizations.ts";

export type BrainGraphMode = "overview" | "full";

const SOURCES: Array<BrainGraphSourceAdapter<BrainGraphAccessContext>> = [
  organizationsBrainSource,
  gardensBrainSource,
  conversationsBrainSource,
  memoriesBrainSource,
  artifactsBrainSource,
  buzzBrainSource,
  gbrainBrainSource,
];

function limitsForMode(mode: BrainGraphMode): BrainGraphLimits {
  if (mode === "overview") return DEFAULT_BRAIN_GRAPH_LIMITS;
  return {
    ...DEFAULT_BRAIN_GRAPH_LIMITS,
    maxNodes: 2_000,
    maxEdges: 5_000,
    maxKnowledgeNodesPerGarden: 900,
    maxConversations: 240,
    maxArtifacts: 500,
    maxBuzzThreadsPerRoom: 80,
  };
}

function cleanWarnings(warnings: BrainWarning[]): BrainWarning[] {
  return warnings
    .map((warning) => ({
      source: warning.source.slice(0, 40),
      code: warning.code.slice(0, 60),
      message: warning.message.replace(/[\r\n]+/g, " ").slice(0, 220),
    }))
    .filter(
      (warning, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.source === warning.source && candidate.code === warning.code,
        ) === index,
    );
}

function tableExists(context: BrainGraphAccessContext, name: string): boolean {
  const row = context.database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function capabilities(context: BrainGraphAccessContext) {
  return {
    buzz: tableExists(context, "buzz_rooms"),
    gbrain: resolveGBrainConfig().mode !== "disabled",
    organization: context.organizations.length > 0,
    expansion: true,
    pathFinding: true,
  };
}

function layoutKey(context: BrainGraphAccessContext, scope: BrainScope): string {
  return opaqueBrainId(
    "layout",
    `${context.userId}:${scope.kind}:${scope.kind === "organization" ? scope.organizationId : ""}`,
  );
}

async function buildFragments(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  limits: BrainGraphLimits,
  signal?: AbortSignal,
): Promise<{
  fragments: BrainGraphFragment[];
  adapterMs: Record<string, number>;
}> {
  const adapterMs: Record<string, number> = {};
  const fragments = await Promise.all(
    SOURCES.map(async (source): Promise<BrainGraphFragment> => {
      const started = performance.now();
      try {
        return await source.buildOverview(context, scope, limits, signal);
      } catch {
        return {
          nodes: [],
          edges: [],
          warnings: [
            {
              source: source.name,
              code: "source_unavailable",
              message: `${source.name} data is unavailable; other authorized sources are still shown.`,
            },
          ],
        };
      } finally {
        adapterMs[source.name] = Math.round((performance.now() - started) * 10) / 10;
      }
    }),
  );
  return { fragments, adapterMs };
}

export async function buildBrainGraph(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  options: { mode?: BrainGraphMode; signal?: AbortSignal } = {},
): Promise<BrainGraphResponse> {
  const started = performance.now();
  const limits = limitsForMode(options.mode ?? "overview");
  const { fragments, adapterMs } = await buildFragments(
    context,
    scope,
    limits,
    options.signal,
  );
  const normalized = normalizeBrainGraph(fragments, limits);
  const warnings = cleanWarnings(fragments.flatMap((fragment) => fragment.warnings ?? []));
  const revision = brainGraphRevision(scope, normalized.nodes, normalized.edges);
  const buildMs = Math.round((performance.now() - started) * 10) / 10;
  const diagnostics = {
    buildMs,
    adapterMs,
    overviewNodeCount: normalized.nodes.length,
    overviewEdgeCount: normalized.edges.length,
    truncated: normalized.truncated,
  };

  // Counts and timings only; never labels, text, paths, source ids, or payloads.
  console.info("[brain-graph]", JSON.stringify(diagnostics));
  return {
    revision,
    layoutKey: layoutKey(context, scope),
    generatedAt: new Date().toISOString(),
    scope,
    nodes: normalized.nodes,
    edges: normalized.edges,
    counts: normalized.counts,
    truncated: normalized.truncated,
    warnings,
    scopeOptions: brainScopeOptions(context),
    capabilities: capabilities(context),
    diagnostics,
  };
}

export async function expandBrainGraph(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  nodeId: string,
  depth = 1,
  signal?: AbortSignal,
): Promise<BrainGraphResponse> {
  const started = performance.now();
  const limits = limitsForMode("full");
  const overview = await buildBrainGraph(context, scope, { signal });
  const selected = overview.nodes.find((node) => node.id === nodeId);
  if (!selected) {
    const error = new Error("That Knowledge Map node is not available.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 404;
    error.code = "node_not_found";
    throw error;
  }

  const adapterMs: Record<string, number> = {};
  const fragments = await Promise.all(
    SOURCES.filter((source) => source.expand).map(
      async (source): Promise<BrainGraphFragment> => {
        const sourceStarted = performance.now();
        try {
          return await source.expand!(
            context,
            scope,
            nodeId,
            Math.max(1, Math.min(2, Math.trunc(depth))),
            limits,
            signal,
          );
        } catch {
          return {
            nodes: [],
            edges: [],
            warnings: [
              {
                source: source.name,
                code: "expansion_unavailable",
                message: `${source.name} expansion is temporarily unavailable.`,
              },
            ],
          };
        } finally {
          adapterMs[source.name] =
            Math.round((performance.now() - sourceStarted) * 10) / 10;
        }
      },
    ),
  );
  const expansionSeed: BrainGraphFragment = { nodes: [selected], edges: [] };
  const fragment = normalizeBrainGraph([expansionSeed, ...fragments], limits);
  const combined = normalizeBrainGraph(
    [
      { nodes: overview.nodes, edges: overview.edges },
      { nodes: fragment.nodes, edges: fragment.edges },
    ],
    limits,
  );
  const revision = brainGraphRevision(scope, combined.nodes, combined.edges);
  const buildMs = Math.round((performance.now() - started) * 10) / 10;
  return {
    revision,
    layoutKey: overview.layoutKey,
    generatedAt: new Date().toISOString(),
    scope,
    nodes: fragment.nodes,
    edges: fragment.edges,
    counts: combined.counts,
    truncated: combined.truncated,
    warnings: cleanWarnings(fragments.flatMap((item) => item.warnings ?? [])),
    scopeOptions: overview.scopeOptions,
    capabilities: overview.capabilities,
    diagnostics: {
      buildMs,
      adapterMs,
      overviewNodeCount: combined.nodes.length,
      overviewEdgeCount: combined.edges.length,
      truncated: combined.truncated,
    },
  };
}

export { buildBrainGraphAccessContext };
