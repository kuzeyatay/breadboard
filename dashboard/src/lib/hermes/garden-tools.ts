// Server-side implementations of the scoped garden/quartz Breadboard tools.
//
// These run inside Breadboard (not Hermes). The Hermes garden/quartz
// agents invoke them through a thin adapter that presents a capability token;
// this module verifies the token, enforces that the requested garden matches the
// token's scope, and executes the tool against the real Breadboard knowledge
// model (scanClusterKnowledge, retrieveGraphRag, the SQLite store). Results are
// bounded so a single tool call never dumps an entire garden or source file.
//
// Write-like tools never mutate published Quartz markdown on their own account.
// They create typed proposals the user reviews and applies through Breadboard.
//
// The exceptions are the direct writers. `garden_save_note` writes a new note:
// it exists to serve an explicit "save this to my garden" instruction, so the
// review step it would otherwise add is a step the user already took. The
// structure tools (`garden_create_folder`, `garden_move_page`,
// `garden_rename_folder`, `garden_delete_folder`) are the same bargain applied
// to organization: they change where content lives, never what it says. All of
// them are restricted to what makes that reasoning hold — an authenticated
// surface, and the garden's own owner.

import path from "node:path";
import db from "../db.ts";
import type { KnowledgeNode } from "../knowledge.ts";
import {
  verifyCapabilityToken,
  tokenAllows,
  type CapabilityToken,
} from "./capability-token.ts";
import { GARDEN_STRUCTURE_TOOLS, isProposalTool } from "./tool-scopes.ts";
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

function proposalFolder(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) =>
      segment
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .slice(0, 12)
    .join("/")
    .slice(0, 400);
}

interface ClusterRow {
  id: number;
  slug: string;
  name: string;
  user_id: number;
}

function loadClusterByIdentifier(gardenId: string | number): ClusterRow | null {
  const row = db
    .prepare(
      `
    SELECT id, slug, name, user_id FROM clusters
    WHERE ${typeof gardenId === "number" ? "id" : "slug"} = ?
  `,
    )
    .get(gardenId) as ClusterRow | undefined;
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
 * the Hermes tool adapter. Every call re-derives the garden from the token,
 * so a model-supplied garden id can never widen scope.
 */
export async function executeGardenTool(input: {
  rawToken: unknown;
  tool: string;
  args: Record<string, unknown>;
}): Promise<GardenToolResult> {
  const verified = verifyCapabilityToken(input.rawToken);
  if (!verified.ok) {
    return {
      ok: false,
      tool: input.tool,
      error: `Capability token ${verified.reason}`,
    };
  }
  const token = verified.token;

  if (!tokenAllows(token, { tool: input.tool })) {
    return {
      ok: false,
      tool: input.tool,
      error: "Tool not permitted for this session's scope.",
    };
  }

  if (input.tool === "garden_list") {
    const allowed =
      token.allowedGardenIds ??
      (token.activeGardenId ? [token.activeGardenId] : []);
    const placeholders = allowed.map(() => "?").join(",");
    const gardens = allowed.length
      ? db
          .prepare(
            `SELECT id, slug, name FROM clusters WHERE id IN (${placeholders}) ORDER BY lower(name), id`,
          )
          .all(...allowed)
      : [];
    return { ok: true, tool: input.tool, data: { gardens } };
  }

  const requestedGarden =
    typeof input.args.gardenId === "string" ||
    typeof input.args.gardenId === "number"
      ? input.args.gardenId
      : (token.gardenId ?? token.activeGardenId);
  if (requestedGarden === undefined) {
    return {
      ok: false,
      tool: input.tool,
      error: "Specify a gardenId for this workspace-level request.",
    };
  }
  if (
    !token.allowedGardenIds &&
    typeof requestedGarden === "string" &&
    !tokenAllows(token, { tool: input.tool, gardenId: requestedGarden })
  ) {
    return {
      ok: false,
      tool: input.tool,
      error: "Tool not permitted for this session's scope.",
    };
  }
  const cluster = loadClusterByIdentifier(requestedGarden);
  if (!cluster)
    return { ok: false, tool: input.tool, error: "Garden not found." };
  const permitted = token.allowedGardenIds
    ? tokenAllows(token, { tool: input.tool, gardenId: cluster.id })
    : tokenAllows(token, { tool: input.tool, gardenId: cluster.slug });
  if (!permitted) {
    return {
      ok: false,
      tool: input.tool,
      error: "Garden is outside this session's authorized set.",
    };
  }

  try {
    if (input.tool === "garden_save_note") {
      return await executeSaveNote(cluster, token, input.args);
    }
    if ((GARDEN_STRUCTURE_TOOLS as readonly string[]).includes(input.tool)) {
      return await executeStructureTool(input.tool, cluster, token, input.args);
    }
    if (isProposalTool(input.tool)) {
      return executeProposalTool(input.tool, cluster, token, input.args);
    }
    return await executeReadTool(input.tool, cluster, input.args);
  } catch (error) {
    return {
      ok: false,
      tool: input.tool,
      error: error instanceof Error ? error.message : "Tool failed.",
    };
  }
}

async function executeReadTool(
  tool: string,
  cluster: ClusterRow,
  args: Record<string, unknown>,
): Promise<GardenToolResult> {
  const topologyGraph = async (
    start: unknown,
    overrides: Record<string, unknown> = {},
  ) => {
    const [{ readThoughtTopology }, { queryThoughtTopologyGraph }] =
      await Promise.all([
        import("../thought-topology/storage.ts"),
        import("./thought-topology-graph.ts"),
      ]);
    const topology = readThoughtTopology(
      path.join(contentPath(), cluster.slug),
    );
    return topology
      ? queryThoughtTopologyGraph(topology, {
          start,
          depth: overrides.depth,
          limit: overrides.limit,
          minWeight: overrides.minWeight,
          relationTypes: overrides.relationTypes,
          includeHierarchy: overrides.includeHierarchy,
        })
      : null;
  };

  if (tool === "garden_get_graph_neighbors") {
    const slug = String(args.slug ?? args.pageSlug ?? args.pageId ?? "");
    const thoughtTopology = await topologyGraph(slug, args);
    if (thoughtTopology) {
      if (!thoughtTopology.startNode) {
        return {
          ok: false,
          tool,
          error: "Node not found in this Garden's Thought Topology.",
          data: { availableMatches: thoughtTopology.availableMatches ?? [] },
        };
      }
      return { ok: true, tool, data: thoughtTopology };
    }
  }

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
          {
            slug: cluster.slug,
            name: cluster.name,
            rootPath: path.join(contentPath(), cluster.slug),
            knowledge,
          },
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
      const node = knowledge.nodes.find(
        (n) => n.slug === slug || n.relPath === slug,
      );
      if (!node)
        return { ok: false, tool, error: "Page not found in this garden." };
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
      const node = knowledge.nodes.find(
        (n) => n.slug === slug || n.relPath === slug,
      );
      if (!node)
        return { ok: false, tool, error: "Page not found in this garden." };
      const neighbors = knowledge.edges
        .filter(
          (edge) => edge.source === node.slug || edge.target === node.slug,
        )
        .slice(0, MAX_RESULTS)
        .map((edge) => ({
          related: edge.source === node.slug ? edge.target : edge.source,
          relation: edge.relation,
        }));
      return {
        ok: true,
        tool,
        data: {
          page: nodeSummary(node),
          neighbors,
          backlinks: node.related?.slice(0, MAX_RESULTS),
          thoughtTopology: await topologyGraph(node.slug, {
            depth: 1,
            limit: 20,
          }),
        },
      };
    }

    case "garden_get_graph_neighbors": {
      const slug = String(args.slug ?? args.pageSlug ?? args.pageId ?? "");
      // A Garden still building its first topology remains readable through the
      // old links, but the response identifies that degraded representation.
      const neighbors = knowledge.edges
        .filter((edge) => edge.source === slug || edge.target === slug)
        .slice(0, MAX_RESULTS)
        .map((edge) => ({
          related: edge.source === slug ? edge.target : edge.source,
          relation: edge.relation,
        }));
      return {
        ok: true,
        tool,
        data: {
          format: "legacy-links",
          slug,
          neighbors,
          topologyPending: true,
        },
      };
    }

    case "garden_get_learning_spine": {
      const spine = knowledge.nodes
        .filter(
          (n) => n.type === "textbook-page" || n.breadboardType === "learning",
        )
        .slice(0, 40)
        .map((n) => ({
          slug: n.slug,
          title: n.title,
          locations: n.locations?.slice(0, 4),
        }));
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
      return {
        ok: true,
        tool,
        data: {
          slug: node.slug,
          sourcePdf: node.sourcePdf,
          anchors: node.sourceAnchors?.slice(0, 12),
        },
      };
    }

    case "garden_get_recent_events": {
      const rows = db
        .prepare(
          "SELECT kind, page_slug, status, created_at FROM hermes_proposals WHERE garden_id = ? ORDER BY created_at DESC LIMIT 20",
        )
        .all(cluster.slug);
      return { ok: true, tool, data: { events: rows } };
    }

    case "garden_run_proposal_validation": {
      // Lightweight structural validation the model can call before proposing.
      const target = String(args.pageSlug ?? "");
      const exists = knowledge.nodes.some(
        (n) => n.slug === target || n.relPath === target,
      );
      return {
        ok: true,
        tool,
        data: {
          pageExists: exists,
          notes: exists
            ? "Target page exists; a revision proposal is valid."
            : "Target page not found; propose a new note instead.",
        },
      };
    }

    default:
      return { ok: false, tool, error: `Unknown read tool: ${tool}` };
  }
}

/**
 * Keep derived retrieval state in step with a write, exactly as an applied
 * proposal does. Never allowed to fail the mutation that preceded it: GBrain
 * being disabled or misconfigured must not undo a saved or moved note.
 */
async function resyncGardenRetrieval(
  clusterId: number,
  reason: string,
): Promise<void> {
  try {
    const { enqueueGardenSync } = await import("../gbrain/sync.ts");
    enqueueGardenSync(clusterId, reason);
    const { ensureSyncWorkerStarted } =
      await import("../gbrain/sync-worker.ts");
    // Bounded one-shot Runtime queue kick; it does not start a Next.js timer.
    ensureSyncWorkerStarted();
  } catch {
    // Retrieval indexing is derived state; the write itself already succeeded.
  }
}

/**
 * Write a new note straight into the garden, through the same canonical
 * document service the authoring UI and an applied proposal both use.
 *
 * The two checks below are what license skipping review: an anonymous Quartz
 * reader can never reach this, and neither can a visitor to someone else's
 * public garden. Everyone who gets past them is writing to their own garden
 * from a chat they are authenticated in.
 */
async function executeSaveNote(
  cluster: ClusterRow,
  token: CapabilityToken,
  args: Record<string, unknown>,
): Promise<GardenToolResult> {
  const tool = "garden_save_note";
  if (
    token.surface !== "dashboard_terminal" &&
    token.surface !== "garden_chat"
  ) {
    return {
      ok: false,
      tool,
      error: "Saving notes requires a signed-in Breadboard chat.",
    };
  }
  if (!Number.isInteger(token.userId) || token.userId !== cluster.user_id) {
    return {
      ok: false,
      tool,
      error: "Only the Garden's owner can save notes into it.",
    };
  }

  const title = String(args.title ?? "")
    .trim()
    .slice(0, 300);
  const content = String(args.content ?? "");
  if (!title) return { ok: false, tool, error: "A note title is required." };
  if (!content.trim())
    return { ok: false, tool, error: "The note has no content to save." };

  // "Rewrite naturally", when the user has it on as a standing preference. A
  // note is written by the server into the garden, so the browser switch cannot
  // reach it - this is the moment the text becomes a file. Failure is silent
  // and keeps the original: a rewrite must never cost somebody their note.
  const { humanizeStoredText } = await import("../humanizer/auto-server.ts");
  const stored = (
    await humanizeStoredText(
      cluster.user_id,
      content.slice(0, 100000),
      "garden_note",
    )
  ).text;

  const { createGardenDocument } = await import("../garden-documents.ts");
  const document = await createGardenDocument({
    userId: cluster.user_id,
    clusterSlug: cluster.slug,
    title,
    content: stored,
    folder: proposalFolder(args.folder),
    tags: Array.isArray(args.tags)
      ? args.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 12)
      : ["assistant-response"],
  });

  await resyncGardenRetrieval(cluster.id, "garden_save_note");

  return {
    ok: true,
    tool,
    data: {
      saved: true,
      gardenId: cluster.slug,
      gardenName: cluster.name,
      title,
      folder: document.folder,
      slug: document.slug,
      relPath: document.relPath,
    },
  };
}

/**
 * Reorganize the garden: inspect its tree, create folders, move a note between
 * them, rename a folder, or delete one.
 *
 * These run through the same canonical structure service the authoring UI uses,
 * so a move the agent makes and a move the user drags are the same operation.
 * The guard is identical to `executeSaveNote`'s and for the same reason: an
 * anonymous Quartz reader can never reach this, and neither can a visitor to
 * someone else's public garden. What is left is the owner rearranging their own
 * garden from a chat they are signed in to.
 */
async function executeStructureTool(
  tool: string,
  cluster: ClusterRow,
  token: CapabilityToken,
  args: Record<string, unknown>,
): Promise<GardenToolResult> {
  const {
    GardenFilesystemError,
    createGardenFolder,
    deleteGardenFolder,
    listGardenTree,
    moveGardenDocument,
    renameGardenFolder,
  } = await import("../garden-filesystem.ts");

  if (
    token.surface !== "dashboard_terminal" &&
    token.surface !== "garden_chat"
  ) {
    return {
      ok: false,
      tool,
      error: "Organizing a Garden requires a signed-in Breadboard chat.",
    };
  }
  // Reading the tree is safe for any authorized garden; changing it is not.
  if (
    tool !== "garden_list_files" &&
    (!Number.isInteger(token.userId) || token.userId !== cluster.user_id)
  ) {
    return {
      ok: false,
      tool,
      error: "Only the Garden's owner can change how it is organized.",
    };
  }

  const identity = { gardenId: cluster.slug, gardenName: cluster.name };
  try {
    if (tool === "garden_list_files") {
      return {
        ok: true,
        tool,
        data: { ...identity, ...listGardenTree({ clusterSlug: cluster.slug }) },
      };
    }
    if (tool === "garden_create_folder") {
      const result = await createGardenFolder({
        userId: cluster.user_id,
        clusterSlug: cluster.slug,
        folder: args.folder,
      });
      await resyncGardenRetrieval(cluster.id, tool);
      return {
        ok: true,
        tool,
        data: { ...identity, created: true, ...result },
      };
    }
    if (tool === "garden_move_page") {
      const result = await moveGardenDocument({
        userId: cluster.user_id,
        clusterSlug: cluster.slug,
        slug: args.slug ?? args.pageSlug,
        toFolder: args.toFolder ?? args.folder,
      });
      await resyncGardenRetrieval(cluster.id, tool);
      return {
        ok: true,
        tool,
        data: {
          ...identity,
          moved: true,
          ...result,
          destination: result.folder || "Garden root",
        },
      };
    }
    if (tool === "garden_rename_folder") {
      const result = await renameGardenFolder({
        userId: cluster.user_id,
        clusterSlug: cluster.slug,
        folder: args.folder,
        name: args.name ?? args.newName,
      });
      await resyncGardenRetrieval(cluster.id, tool);
      return {
        ok: true,
        tool,
        data: { ...identity, renamed: true, ...result },
      };
    }
    if (tool === "garden_delete_folder") {
      const result = await deleteGardenFolder({
        userId: cluster.user_id,
        clusterSlug: cluster.slug,
        clusterId: cluster.id,
        folder: args.folder,
      });
      await resyncGardenRetrieval(cluster.id, tool);
      return {
        ok: true,
        tool,
        data: {
          ...identity,
          deleted: true,
          ...result,
          deletedNoteCount: result.deletedSlugs.length,
        },
      };
    }
    return { ok: false, tool, error: `Unknown structure tool: ${tool}` };
  } catch (error) {
    if (error instanceof GardenFilesystemError) {
      return { ok: false, tool, error: error.message };
    }
    throw error;
  }
}

function executeProposalTool(
  tool: string,
  cluster: ClusterRow,
  token: CapabilityToken,
  args: Record<string, unknown>,
): GardenToolResult {
  const evidence = Array.isArray(args.evidenceAnchorIds)
    ? args.evidenceAnchorIds
        .filter((a): a is string => typeof a === "string")
        .slice(0, 40)
    : [];
  const rationale =
    typeof args.rationale === "string" ? args.rationale.slice(0, 4000) : null;

  if (tool === "garden_create_note_proposal") {
    const proposal = createProposal({
      clusterId: cluster.id,
      gardenId: cluster.slug,
      surface: token.surface,
      kind: "note",
      rationale,
      payload: {
        title: String(args.title ?? "Untitled note").slice(0, 300),
        content: String(args.content ?? "").slice(0, 100000),
        folder: proposalFolder(args.folder),
        tags: Array.isArray(args.tags)
          ? args.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map((tag) => tag.trim())
              .filter(Boolean)
              .slice(0, 12)
          : [],
      },
      evidenceAnchors: evidence,
      createdByUserId: token.userId,
      runtimeSessionId: Number(token.breadboardSessionId) || null,
    });
    return {
      ok: true,
      tool,
      proposalId: proposal.id,
      data: {
        proposalId: proposal.id,
        status: "pending",
        gardenId: cluster.slug,
        folder: proposalFolder(args.folder),
      },
    };
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
        patchOrReplacement: String(args.patchOrReplacement ?? "").slice(
          0,
          40000,
        ),
        affectedConcepts: Array.isArray(args.affectedConcepts)
          ? args.affectedConcepts
              .filter((c): c is string => typeof c === "string")
              .slice(0, 40)
          : [],
      },
      evidenceAnchors: evidence,
      createdByUserId: token.userId,
      runtimeSessionId: Number(token.breadboardSessionId) || null,
    });
    return {
      ok: true,
      tool,
      proposalId: proposal.id,
      data: { proposalId: proposal.id, status: "pending" },
    };
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
    return {
      ok: true,
      tool,
      proposalId: proposal.id,
      data: { proposalId: proposal.id, status: "pending" },
    };
  }

  return { ok: false, tool, error: `Unknown proposal tool: ${tool}` };
}
