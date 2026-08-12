// Server-side implementations of the scoped Breadboard GBrain knowledge tools.
//
// These run inside Breadboard, NOT Hermes. The authenticated Garden Chat and
// Terminal agents invoke them through a thin adapter that presents a capability
// token. This module:
//   1. verifies the token and re-derives the authorized garden set from it,
//   2. resolves each authorized garden to its server-owned GBrain source id,
//   3. intersects any requested garden with the authorized set,
//   4. calls the loopback GBrain adapter with a server-derived scope,
//   5. validates every returned citation against the authorized mapping,
//   6. writes a secret-free audit event.
//
// A model argument (garden id, source id, path) can never widen scope: source ids
// are derived server-side and citations are dropped unless they map to a garden
// the token already authorizes. GBrain here is READ-ONLY — capture/edit flow
// through Breadboard proposals, never through this module.

import {
  verifyCapabilityToken,
  tokenAllows,
  type CapabilityToken,
} from "./capability-token.ts";
import { resolveGBrainConfig } from "../gbrain/config.ts";
import { GBrainClient } from "../gbrain/client.ts";
import {
  getOrCreateSourceMapping,
  loadClusterById,
  loadClusterBySlug,
  recordQueryAudit,
} from "../gbrain/mapping.ts";
import { buildAuthorizedIndex, normalizeCitations, type AuthorizedSource } from "../gbrain/citations.ts";
import type {
  GBrainConnectionsOutput,
  GBrainRetrieveOutput,
  GBrainSearchOutput,
  GBrainStatusOutput,
  GBrainSynthesizeOutput,
  GBrainRetrievalMode,
} from "../gbrain/types.ts";

export const GBRAIN_TOOLS = [
  "gbrain_status",
  "gbrain_search",
  "gbrain_retrieve",
  "gbrain_synthesize",
  "gbrain_graph_neighbors",
] as const;

export type GBrainToolName = (typeof GBRAIN_TOOLS)[number];

export interface GBrainToolResult {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
}

interface AuthorizedGarden {
  clusterId: number;
  slug: string;
  name: string;
  sourceId: string;
}

function toMode(raw: string | undefined): GBrainRetrievalMode {
  return raw === "hybrid" ? "hybrid" : "lexical_degraded";
}

/** Re-derive the authorized gardens from the token, resolving each to its
 *  server-owned GBrain source id. This is the ONLY source of authorization. */
function authorizedGardens(token: CapabilityToken): AuthorizedGarden[] {
  const gardens: AuthorizedGarden[] = [];
  const seen = new Set<number>();
  const add = (clusterId: number, slug: string, name: string) => {
    if (seen.has(clusterId)) return;
    seen.add(clusterId);
    const mapping = getOrCreateSourceMapping(clusterId, slug);
    gardens.push({ clusterId, slug, name, sourceId: mapping.sourceId });
  };

  if (token.allowedGardenIds && token.allowedGardenIds.length) {
    for (const id of token.allowedGardenIds) {
      const cluster = loadClusterById(id);
      if (cluster) add(cluster.id, cluster.slug, cluster.name);
    }
  } else if (token.gardenId) {
    const cluster = loadClusterBySlug(token.gardenId);
    if (cluster) add(cluster.id, cluster.slug, cluster.name);
  } else if (token.activeGardenId) {
    const cluster = loadClusterById(token.activeGardenId);
    if (cluster) add(cluster.id, cluster.slug, cluster.name);
  }
  return gardens;
}

/** Intersect a model-requested garden slug with the authorized set. */
function resolveRequested(all: AuthorizedGarden[], requestedSlug: unknown): AuthorizedGarden[] {
  if (typeof requestedSlug !== "string" || !requestedSlug) return all;
  const match = all.find((g) => g.slug === requestedSlug);
  return match ? [match] : []; // requested-but-unauthorized -> empty, fail closed
}

export async function executeGBrainTool(input: {
  rawToken: unknown;
  tool: string;
  args: Record<string, unknown>;
}): Promise<GBrainToolResult> {
  const config = resolveGBrainConfig();

  const verified = verifyCapabilityToken(input.rawToken);
  if (!verified.ok) {
    return { ok: false, tool: input.tool, error: `Capability token ${verified.reason}` };
  }
  const token = verified.token;

  if (!tokenAllows(token, { tool: input.tool })) {
    return { ok: false, tool: input.tool, error: "Tool not permitted for this session's scope." };
  }

  const gardens = authorizedGardens(token);
  const authorizedIndex = buildAuthorizedIndex(
    gardens.map<AuthorizedSource>((g) => ({ sourceId: g.sourceId, gardenId: g.slug, gardenName: g.name })),
  );

  // status is answerable even when disabled/unavailable.
  if (input.tool === "gbrain_status") {
    return { ok: true, tool: input.tool, data: await statusReport(config, gardens.length) };
  }

  if (config.mode === "disabled") {
    return {
      ok: false,
      tool: input.tool,
      error: "GBrain is disabled. No knowledge retrieval was performed. Breadboard garden tools remain available.",
    };
  }

  if (gardens.length === 0) {
    return { ok: false, tool: input.tool, error: "No authorized gardens in scope for GBrain." };
  }

  const client = new GBrainClient(config);
  const audit = (operation: string, queried: number, resultCount: number, mode: string | null, outcome: string) =>
    recordQueryAudit({
      runtimeSessionId: Number(token.breadboardSessionId) || null,
      userId: token.userId,
      surface: token.surface,
      operation,
      authorizedGardens: gardens.length,
      queriedGardens: queried,
      resultCount,
      mode,
      outcome,
    });

  try {
    switch (input.tool) {
      case "gbrain_search": {
        const scoped = resolveRequested(gardens, input.args.gardenId);
        if (scoped.length === 0) {
          audit("search", 0, 0, null, "empty_scope");
          return { ok: false, tool: input.tool, error: "Requested garden is outside the authorized set." };
        }
        const res = await client.search(
          { userId: String(token.userId), authorizedSourceIds: scoped.map((g) => g.sourceId) },
          String(input.args.query ?? ""),
          scoped.map((g) => g.sourceId),
          Number(input.args.limit) || 8,
        );
        const results = res.results
          .map((r) => {
            const [norm] = normalizeCitations([r.citation], authorizedIndex).citations;
            return norm ? { title: r.title, excerpt: r.excerpt, citation: norm } : null;
          })
          .filter((r): r is GBrainSearchOutput["results"][number] => r !== null);
        audit("search", scoped.length, results.length, res.mode, "ok");
        return {
          ok: true,
          tool: input.tool,
          data: { results, mode: toMode(res.mode), warnings: res.warnings } satisfies GBrainSearchOutput,
        };
      }

      case "gbrain_synthesize": {
        const scoped = resolveRequested(gardens, input.args.gardenId);
        if (scoped.length === 0) {
          audit("synthesize", 0, 0, null, "empty_scope");
          return { ok: false, tool: input.tool, error: "Requested garden is outside the authorized set." };
        }
        const res = await client.synthesize(
          { userId: String(token.userId), authorizedSourceIds: scoped.map((g) => g.sourceId) },
          String(input.args.query ?? ""),
          scoped.map((g) => g.sourceId),
          Number(input.args.limit) || 6,
        );
        const { citations } = normalizeCitations(res.citations, authorizedIndex);
        audit("synthesize", scoped.length, citations.length, res.mode, "ok");
        return {
          ok: true,
          tool: input.tool,
          data: {
            synthesis: res.synthesis,
            citations,
            mode: toMode(res.mode),
            warnings: res.warnings,
          } satisfies GBrainSynthesizeOutput,
        };
      }

      case "gbrain_retrieve": {
        const scoped = resolveRequested(gardens, input.args.gardenId);
        if (scoped.length !== 1) {
          audit("retrieve", 0, 0, null, "empty_scope");
          return { ok: false, tool: input.tool, error: "Specify one authorized garden to retrieve from." };
        }
        const garden = scoped[0];
        const res = await client.retrieve(
          { userId: String(token.userId), authorizedSourceIds: [garden.sourceId] },
          garden.sourceId,
          String(input.args.pageId ?? input.args.pageSlug ?? ""),
        );
        const citation = res.citation ? normalizeCitations([res.citation], authorizedIndex).citations[0] : undefined;
        audit("retrieve", 1, res.found ? 1 : 0, null, res.found ? "ok" : "not_found");
        return {
          ok: true,
          tool: input.tool,
          data: {
            found: res.found,
            title: res.title,
            path: citation?.path,
            content: res.content,
            citation,
            warnings: res.warnings,
          } satisfies GBrainRetrieveOutput,
        };
      }

      case "gbrain_graph_neighbors": {
        const scoped = resolveRequested(gardens, input.args.gardenId);
        if (scoped.length !== 1) {
          audit("graph", 0, 0, null, "empty_scope");
          return { ok: false, tool: input.tool, error: "Specify one authorized garden for connections." };
        }
        const garden = scoped[0];
        const res = await client.graph(
          { userId: String(token.userId), authorizedSourceIds: [garden.sourceId] },
          String(input.args.pageId ?? input.args.pageSlug ?? ""),
          garden.sourceId,
          Number(input.args.limit) || 12,
        );
        const neighbors = res.neighbors
          .map((n) => {
            const source = authorizedIndex.get(n.sourceId);
            return source ? { gardenId: source.gardenId, pageSlug: n.pageId, title: n.title, relation: n.relation } : null;
          })
          .filter((n): n is GBrainConnectionsOutput["neighbors"][number] => n !== null);
        audit("graph", 1, neighbors.length, null, "ok");
        return { ok: true, tool: input.tool, data: { neighbors, warnings: res.warnings } satisfies GBrainConnectionsOutput };
      }

      default:
        return { ok: false, tool: input.tool, error: `Unknown GBrain tool: ${input.tool}` };
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : "error";
    audit(input.tool.replace("gbrain_", ""), 0, 0, null, `error:${code}`);
    if (config.mode === "required") {
      return { ok: false, tool: input.tool, error: `GBrain retrieval failed (${code}).` };
    }
    return {
      ok: false,
      tool: input.tool,
      error: `GBrain is unavailable (${code}). No knowledge retrieval was performed; Breadboard garden tools remain available.`,
    };
  }
}

async function statusReport(
  config: ReturnType<typeof resolveGBrainConfig>,
  configuredGardens: number,
): Promise<GBrainStatusOutput> {
  if (config.mode === "disabled") {
    return {
      state: "disabled",
      mode: null,
      embeddingsAvailable: false,
      configuredGardens,
      message: "GBrain is disabled for this deployment.",
    };
  }
  const health = await new GBrainClient(config).health();
  if (health.status === "unavailable") {
    return {
      state: "unavailable",
      mode: null,
      embeddingsAvailable: false,
      configuredGardens,
      message: "GBrain adapter is unavailable. No knowledge retrieval can be performed right now.",
    };
  }
  const degraded = !health.embeddingsAvailable || health.mode === "lexical_degraded";
  return {
    state: degraded ? "degraded" : "healthy",
    mode: health.mode,
    embeddingsAvailable: health.embeddingsAvailable,
    configuredGardens,
    message: degraded
      ? "GBrain is running in lexical_degraded mode (no embeddings); retrieval is keyword-only."
      : "GBrain is healthy and running hybrid retrieval.",
  };
}
