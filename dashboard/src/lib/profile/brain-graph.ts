import {
  brainScopeOptions,
  buildBrainGraphAccessContext,
  type BrainGraphAccessContext,
} from "./brain-graph-auth.ts";
import { brainGraphCache, type BrainGraphCache } from "./brain-graph-cache.ts";
import { opaqueBrainId } from "./brain-graph-ids.ts";
import { normalizeBrainGraph } from "./brain-graph-normalize.ts";
import { brainGraphRevision } from "./brain-graph-revision.ts";
import type {
  BrainGraphFragment,
  BrainGraphResponse,
  BrainGraphSourceAdapter,
  BrainScope,
  BrainWarning,
} from "./brain-graph-types.ts";
import { gardensBrainSource } from "./brain-graph-sources/gardens.ts";


// The Knowledge map draws Gardens: their folders, pages and the viewer's own
// chats beside the pages they cited. Account objects the map cannot place
// (memories, artifacts, Buzz rooms) are not built for it.
const SOURCES: Array<BrainGraphSourceAdapter<BrainGraphAccessContext>> = [
  gardensBrainSource,
];

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
            candidate.source === warning.source &&
            candidate.code === warning.code &&
            candidate.message === warning.message,
        ) === index,
    );
}

function capabilities(context: BrainGraphAccessContext) {
  return {
    thoughtTopology: true,
    organization: context.organizations.length > 0,
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
        return await source.buildOverview(context, scope, signal);
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
  options: { signal?: AbortSignal; cache?: BrainGraphCache | null } = {},
): Promise<BrainGraphResponse> {
  const cache = options.cache === undefined ? brainGraphCache : options.cache;
  if (!cache) return buildBrainGraphUncached(context, scope, options.signal);
  // A cached build is shared with every concurrent requester, so one caller
  // going away must not abort (and then cache) a degraded graph for the rest.
  return cache.build(context, scope, () => buildBrainGraphUncached(context, scope));
}

// Cross-Garden edges are computed at read time, outside the per-Garden build.
const crossActivity = new Map<string, Map<string, { score: number; at?: number }>>();
async function buildBrainGraphUncached(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  signal?: AbortSignal,
): Promise<BrainGraphResponse> {
  const started = performance.now();
  const { fragments, adapterMs } = await buildFragments(context, scope, signal);
  const normalized = normalizeBrainGraph(fragments);
  const warnings = cleanWarnings(fragments.flatMap((fragment) => fragment.warnings ?? []));
  if (!warnings.some(warning => warning.code === "source_unavailable")) {
    const key = layoutKey(context, scope) + "|" + normalized.nodes.filter(n => n.kind === "garden").map(n => n.id).sort().join("|");
    const prior = crossActivity.get(key);
    const next = new Map<string, { score: number; at?: number }>();
    for (const edge of normalized.edges) {
      if (edge.semanticRelation !== "cross-garden-related") continue;
      const old = prior?.get(edge.id);
      const score = edge.confidence ?? 0;
      edge.changedAt ??= prior && (!old || score - old.score >= .03) ? Date.now() : old?.at;
      next.set(edge.id, { score, at: edge.changedAt });
    }
    crossActivity.delete(key); crossActivity.set(key, next);
    if (crossActivity.size > 24) crossActivity.delete(crossActivity.keys().next().value!);
  }
  const revision = brainGraphRevision(scope, normalized.nodes, normalized.edges);
  const buildMs = Math.round((performance.now() - started) * 10) / 10;
  const diagnostics = {
    buildMs,
    adapterMs,
    overviewNodeCount: normalized.nodes.length,
    overviewEdgeCount: normalized.edges.length,
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
    warnings,
    scopeOptions: brainScopeOptions(context),
    capabilities: capabilities(context),
    diagnostics,
  };
}

export { buildBrainGraphAccessContext };
