// Breadboard garden/quartz custom tools for OpenHarness.
//
// These are the ONLY capabilities the breadboard-garden and breadboard-quartz
// agents may use to touch garden content. Each tool is a thin, schema-validated
// adapter that:
//   1. reads the short-lived capability token from this session's isolated
//      workspace (written there by the Breadboard gateway, never in the prompt),
//   2. calls back to Breadboard's internal tool endpoint over the loopback,
//   3. returns the bounded, structured result to the model.
//
// The garden/quartz agents have no shell, file, git, or network tools — only
// these. Breadboard intersects every requested garden with the token's
// server-derived authorization set, so a model argument can never grant access.
//
// Tool naming: this file is `garden.ts`, so each export `X` is exposed to the
// model as `garden_X` (e.g. export `search` → tool `garden_search`).

import { tool } from "@opencode-ai/plugin"
async function callBreadboard(sessionID: string, toolName: string, args: Record<string, unknown>) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.OPENHARNESS_TOOL_SECRET || process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/openharness/tools/garden", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-OpenHarness-Session-ID": sessionID,
    },
    // The garden id is always taken from the capability token server-side; we
    // pass it only so the endpoint can reject a mismatch defensively.
    body: JSON.stringify({ tool: toolName, args }),
  })
  const data = await response.json().catch(() => ({ ok: false, error: "Invalid tool response" }))
  if (!response.ok || data.ok === false) {
    return { title: `${toolName} failed`, output: JSON.stringify(data) }
  }
  return { title: toolName, output: JSON.stringify(data.data ?? data) }
}

export const list = tool({
  description: "List the Gardens this conversation is currently authorized to inspect.",
  args: {},
  async execute(_args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_list", {})
  },
})

export const search = tool({
  description:
    "Search this garden's grounded knowledge (pages, sources, concepts) and return the most relevant excerpts with their source citations. Use this to answer questions from the garden's own material.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    query: tool.schema.string().describe("What to search for in the garden"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_search", { gardenId: args.gardenId, query: args.query })
  },
})

export const get_page = tool({
  description: "Fetch a single page from this garden by slug, including its content and metadata.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The page slug or relative path"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_page", { gardenId: args.gardenId, slug: args.slug })
  },
})

export const get_page_context = tool({
  description: "Fetch a page plus its graph neighbors and backlinks, for tracing relationships.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The page slug or relative path"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_page_context", { gardenId: args.gardenId, slug: args.slug })
  },
})

export const get_source_excerpt = tool({
  description: "Fetch a source document excerpt from this garden by slug, for citing original material.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The source page slug"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_source_excerpt", { gardenId: args.gardenId, slug: args.slug })
  },
})

export const get_source_figure = tool({
  description: "Fetch a source figure/anchor reference from this garden by slug.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The source page slug"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_source_figure", { gardenId: args.gardenId, slug: args.slug })
  },
})

export const get_graph_neighbors = tool({
  description: "Fetch the knowledge-graph neighbors of a page/concept in this garden.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The node slug"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_graph_neighbors", { gardenId: args.gardenId, slug: args.slug })
  },
})

export const get_learning_spine = tool({
  description: "Fetch this garden's Learning Spine (ordered learning pages) to understand progression.",
  args: { gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional() },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_learning_spine", { gardenId: args.gardenId })
  },
})

export const get_content_inventory = tool({
  description: "Fetch a bounded inventory of this garden's documents, topics, and stats.",
  args: { gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional() },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_content_inventory", { gardenId: args.gardenId })
  },
})

export const get_recent_events = tool({
  description: "Fetch recent agent proposal activity for this garden.",
  args: { gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional() },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_get_recent_events", { gardenId: args.gardenId })
  },
})

export const run_proposal_validation = tool({
  description: "Validate a proposed change against this garden before proposing it (checks page existence, etc.).",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    pageSlug: tool.schema.string().describe("The page the proposal targets"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_run_proposal_validation", { gardenId: args.gardenId, pageSlug: args.pageSlug })
  },
})

export const create_note_proposal = tool({
  description:
    "Propose a NEW note for this garden. This does NOT publish anything — it creates a proposal the user reviews and applies through Breadboard. Cite evidence anchors.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    title: tool.schema.string().describe("Proposed note title"),
    content: tool.schema.string().describe("Proposed note markdown content"),
    rationale: tool.schema.string().describe("Why this note should exist"),
    evidenceAnchorIds: tool.schema.array(tool.schema.string()).describe("Supporting source anchor ids").default([]),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_create_note_proposal", {
      title: args.title,
      gardenId: args.gardenId,
      content: args.content,
      rationale: args.rationale,
      evidenceAnchorIds: args.evidenceAnchorIds,
    })
  },
})

export const propose_page_revision = tool({
  description:
    "Propose a revision to an existing page. This does NOT overwrite anything — it creates a proposal the user reviews, diffs, validates, and applies through Breadboard.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    pageSlug: tool.schema.string().describe("The page to revise"),
    patchOrReplacement: tool.schema.string().describe("The proposed replacement markdown or patch"),
    rationale: tool.schema.string().describe("Why this revision is warranted"),
    evidenceAnchorIds: tool.schema.array(tool.schema.string()).describe("Supporting source anchor ids").default([]),
    affectedConcepts: tool.schema.array(tool.schema.string()).describe("Concepts touched by this revision").default([]),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_propose_page_revision", {
      pageSlug: args.pageSlug,
      gardenId: args.gardenId,
      patchOrReplacement: args.patchOrReplacement,
      rationale: args.rationale,
      evidenceAnchorIds: args.evidenceAnchorIds,
      affectedConcepts: args.affectedConcepts,
    })
  },
})

export const propose_visualization = tool({
  description:
    "Propose an interactive visualization for a page. Creates a proposal the user reviews and applies; nothing is published directly.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    pageSlug: tool.schema.string().describe("The page the visualization belongs to"),
    description: tool.schema.string().describe("What the visualization shows"),
    spec: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("Structured visualization spec").default({}),
    rationale: tool.schema.string().describe("Why this visualization helps").default(""),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_propose_visualization", {
      pageSlug: args.pageSlug,
      gardenId: args.gardenId,
      description: args.description,
      spec: args.spec,
      rationale: args.rationale,
    })
  },
})
