// Server-side implementations of the scoped garden/quartz Breadboard tools.
//
// These run inside Breadboard (not OpenHarness). The OpenHarness garden/quartz
// agents invoke them through a thin adapter that presents a capability token;
// this module verifies the token, enforces that the requested garden matches the
// token's scope, and executes the tool against the real Breadboard knowledge
// model (scanClusterKnowledge, retrieveGraphRag, the SQLite store). Results are
// bounded so a single tool call never dumps an entire garden or source file.
//
// Write-like tools never mutate published Quartz markdown. They create typed
// proposals the user reviews and applies through Breadboard.

import path from "node:path";
import db from "../db.ts";
import type { KnowledgeNode } from "../knowledge.ts";
import {
  verifyCapabilityToken,
  tokenAllows,
  type CapabilityToken,
} from "./capability-token.ts";
import { isProposalTool } from "./tool-scopes.ts";
import { createProposal } from "./runtime-store.ts";

export interface GardenToolResult {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
  proposalId?: number;
}

const MAX_EXCERPT_CHARS = 4000;
const MAX_RESULTS = 12;

interface ClusterRow {
  id: number;
  slug: string;
  name: string;
  user_id: number;
}

function loadClusterByIdentifier(gardenId: string | number): ClusterRow | null {
  const row = db.prepare(`
    SELECT id, slug, name, user_id FROM clusters
    WHERE ${typeof gardenId === "number" ? "id" : "slug"} = ?
  `).get(gardenId) as ClusterRow | undefined;
  return row ?? null;
}

function contentPath(): string {
  const value = process.env.QUARTZ_CONTENT_PATH;
  if (!value) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return value;
}

function nodeSummary(node: KnowledgeNode) {
  return {
    slug: node.slug,
    title: node.title,
    type: node.type,
    relPath: node.relPath,
    excerpt: node.excerpt?.slice(0, 400),
    primaryConcepts: node.primaryConcepts?.slice(0, 8),
    sourceAnchors: node.sourceAnchors?.slice(0, 8),
    locations: node.locations?.slice(0, 8),
  };
}

/**
 * Execute a scoped garden tool. `rawToken` is the capability token presented by
 * the OpenHarness tool adapter. Every call re-derives the garden from the token,
 * so a model-supplied garden id can never widen scope.
 */
export async function executeGardenTool(input: {
  rawToken: unknown;
  tool: string;
  args: Record<string, unknown>;
}): Promise<GardenToolResult> {
  const verified = verifyCapabilityToken(input.rawToken);
  if (!verified.ok) {
    return { ok: false, tool: input.tool, error: `Capability token ${verified.reason}` };
  }
  const token = verified.token;

  if (!tokenAllows(token, { tool: input.tool })) {
    return { ok: false, tool: input.tool, error: "Tool not permitted for this session's scope." };
  }

  if (input.tool === "garden_list") {
    const allowed = token.allowedGardenIds ?? (token.activeGardenId ? [token.activeGardenId] : []);
    const placeholders = allowed.map(() => "?").join(",");
    const gardens = allowed.length
      ? db.prepare(`SELECT id, slug, name FROM clusters WHERE id IN (${placeholders}) ORDER BY lower(name), id`)
          .all(...allowed)
      : [];
    return { ok: true, tool: input.tool, data: { gardens } };
  }

  const requestedGarden = typeof input.args.gardenId === "string" || typeof input.args.gardenId === "number"
    ? input.args.gardenId
    : token.gardenId ?? token.activeGardenId;
  if (requestedGarden === undefined) {
    return { ok: false, tool: input.tool, error: "Specify a gardenId for this workspace-level request." };
  }
  if (
    !token.allowedGardenIds &&
    typeof requestedGarden === "string" &&
    !tokenAllows(token, { tool: input.tool, gardenId: requestedGarden })
  ) {
    return { ok: false, tool: input.tool, error: "Tool not permitted for this session's scope." };
  }
  const cluster = loadClusterByIdentifier(requestedGarden);
  if (!cluster) return { ok: false, tool: input.tool, error: "Garden not found." };
  const permitted = token.allowedGardenIds
    ? tokenAllows(token, { tool: input.tool, gardenId: cluster.id })
    : tokenAllows(token, { tool: input.tool, gardenId: cluster.slug });
  if (!permitted) {
    return { ok: false, tool: input.tool, error: "Garden is outside this session's authorized set." };
  }

  try {
    if (isProposalTool(input.tool)) {
      return executeProposalTool(input.tool, cluster, token, input.args);
    }
    return await executeReadTool(input.tool, cluster, input.args);
  } catch (error) {
    return { ok: false, tool: input.tool, error: error instanceof Error ? error.message : "Tool failed." };
  }
}

async function executeReadTool(
  tool: string,
  cluster: ClusterRow,
  args: Record<string, unknown>,
): Promise<GardenToolResult> {
  // Lazy-load the heavy knowledge/retrieval modules so the scope-enforcement
  // path (and its tests) never pays for the Quartz publish dependency chain.
  const { scanClusterKnowledge } = await import("../knowledge.ts");
  const { retrieveGraphRag } = await import("../semantic-retrieval.ts");
  const knowledge = scanClusterKnowledge(contentPath(), cluster.slug);

  switch (tool) {
    case "garden_search": {
      const query = String(args.query ?? "").slice(0, 2000);
      const retrieval = await retrieveGraphRag({
        query,
        gardens: [
          { slug: cluster.slug, name: cluster.name, rootPath: path.join(contentPath(), cluster.slug), knowledge },
        ],
        maxChunks: MAX_RESULTS,
      });
      return {
        ok: true,
        tool,
        data: {
          context: retrieval.context.slice(0, MAX_EXCERPT_CHARS),
          sources: retrieval.sources.slice(0, MAX_RESULTS),
          chunks: retrieval.chunks.slice(0, MAX_RESULTS).map((chunk) => ({
            pageTitle: chunk.pageTitle,
            heading: chunk.heading,
            content: chunk.content.slice(0, 800),
            evidenceAnchors: chunk.evidenceAnchors?.slice(0, 6),
            locations: chunk.locations?.slice(0, 6),
          })),
        },
      };
    }

    case "garden_get_page":
    case "garden_get_source_excerpt": {
      const slug = String(args.slug ?? args.pageSlug ?? "");
      const node = knowledge.nodes.find((n) => n.slug === slug || n.relPath === slug);
      if (!node) return { ok: false, tool, error: "Page not found in this garden." };
      return {
        ok: true,
        tool,
        data: {
          ...nodeSummary(node),
          content: node.content?.slice(0, MAX_EXCERPT_CHARS),
        },
      };
    }

    case "garden_get_page_context": {
      const slug = String(args.slug ?? args.pageSlug ?? "");
      const node = knowledge.nodes.find((n) => n.slug === slug || n.relPath === slug);
      if (!node) return { ok: false, tool, error: "Page not found in this garden." };
      const neighbors = knowledge.edges
        .filter((edge) => edge.source === node.slug || edge.target === node.slug)
        .slice(0, MAX_RESULTS)
        .map((edge) => ({
          related: edge.source === node.slug ? edge.target : edge.source,
          relation: edge.relation,
        }));
      return {
        ok: true,
        tool,
        data: { page: nodeSummary(node), neighbors, backlinks: node.related?.slice(0, MAX_RESULTS) },
      };
    }

    case "garden_get_graph_neighbors": {
      const slug = String(args.slug ?? "");
      const neighbors = knowledge.edges
        .filter((edge) => edge.source === slug || edge.target === slug)
        .slice(0, MAX_RESULTS)
        .map((edge) => ({
          related: edge.source === slug ? edge.target : edge.source,
          relation: edge.relation,
        }));
      return { ok: true, tool, data: { slug, neighbors } };
    }

    case "garden_get_learning_spine": {
      const spine = knowledge.nodes
        .filter((n) => n.type === "textbook-page" || n.breadboardType === "learning")
        .slice(0, 40)
        .map((n) => ({ slug: n.slug, title: n.title, locations: n.locations?.slice(0, 4) }));
      return { ok: true, tool, data: { spine } };
    }

    case "garden_get_content_inventory": {
      return {
        ok: true,
        tool,
        data: {
          stats: knowledge.stats,
          documents: knowledge.tree.slice(0, 40).map((item) => ({
            source: item.source.title,
            topics: item.topics.slice(0, 20).map((t) => t.title),
          })),
        },
      };
    }

    case "garden_get_source_figure": {
      const slug = String(args.slug ?? "");
      const node = knowledge.nodes.find((n) => n.slug === slug);
      if (!node) return { ok: false, tool, error: "Source not found." };
      return { ok: true, tool, data: { slug: node.slug, sourcePdf: node.sourcePdf, anchors: node.sourceAnchors?.slice(0, 12) } };
    }

    case "garden_get_recent_events": {
      const rows = db
        .prepare(
          "SELECT kind, page_slug, status, created_at FROM openharness_proposals WHERE garden_id = ? ORDER BY created_at DESC LIMIT 20",
        )
        .all(cluster.slug);
      return { ok: true, tool, data: { events: rows } };
    }

    case "garden_run_proposal_validation": {
      // Lightweight structural validation the model can call before proposing.
      const target = String(args.pageSlug ?? "");
      const exists = knowledge.nodes.some((n) => n.slug === target || n.relPath === target);
      return {
        ok: true,
        tool,
        data: {
          pageExists: exists,
          notes: exists ? "Target page exists; a revision proposal is valid." : "Target page not found; propose a new note instead.",
        },
      };
    }

    default:
      return { ok: false, tool, error: `Unknown read tool: ${tool}` };
  }
}

function executeProposalTool(
  tool: string,
  cluster: ClusterRow,
  token: CapabilityToken,
  args: Record<string, unknown>,
): GardenToolResult {
  const evidence = Array.isArray(args.evidenceAnchorIds)
    ? args.evidenceAnchorIds.filter((a): a is string => typeof a === "string").slice(0, 40)
    : [];
  const rationale = typeof args.rationale === "string" ? args.rationale.slice(0, 4000) : null;

  if (tool === "garden_create_note_proposal") {
    const proposal = createProposal({
      clusterId: cluster.id,
      gardenId: cluster.slug,
      surface: token.surface,
      kind: "note",
      rationale,
      payload: {
        title: String(args.title ?? "Untitled note").slice(0, 300),
        content: String(args.content ?? "").slice(0, 20000),
      },
      evidenceAnchors: evidence,
      createdByUserId: token.userId,
      runtimeSessionId: Number(token.breadboardSessionId) || null,
    });
    return { ok: true, tool, proposalId: proposal.id, data: { proposalId: proposal.id, status: "pending" } };
  }

  if (tool === "garden_propose_page_revision") {
    const proposal = createProposal({
      clusterId: cluster.id,
      gardenId: cluster.slug,
      surface: token.surface,
      kind: "page_revision",
      pageSlug: typeof args.pageSlug === "string" ? args.pageSlug : null,
      rationale,
      payload: {
        pageSlug: String(args.pageSlug ?? ""),
        patchOrReplacement: String(args.patchOrReplacement ?? "").slice(0, 40000),
        affectedConcepts: Array.isArray(args.affectedConcepts)
          ? args.affectedConcepts.filter((c): c is string => typeof c === "string").slice(0, 40)
          : [],
      },
      evidenceAnchors: evidence,
      createdByUserId: token.userId,
      runtimeSessionId: Number(token.breadboardSessionId) || null,
    });
    return { ok: true, tool, proposalId: proposal.id, data: { proposalId: proposal.id, status: "pending" } };
  }

  if (tool === "garden_propose_visualization") {
    const proposal = createProposal({
      clusterId: cluster.id,
      gardenId: cluster.slug,
      surface: token.surface,
      kind: "visualization",
      pageSlug: typeof args.pageSlug === "string" ? args.pageSlug : null,
      rationale,
      payload: {
        pageSlug: String(args.pageSlug ?? ""),
        spec: args.spec ?? {},
        description: String(args.description ?? "").slice(0, 4000),
      },
      evidenceAnchors: evidence,
      createdByUserId: token.userId,
      runtimeSessionId: Number(token.breadboardSessionId) || null,
    });
    return { ok: true, tool, proposalId: proposal.id, data: { proposalId: proposal.id, status: "pending" } };
  }

  return { ok: false, tool, error: `Unknown proposal tool: ${tool}` };
}
