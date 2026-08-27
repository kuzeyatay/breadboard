// Breadboard garden/quartz custom tools for Hermes.
//
// These are the ONLY capabilities the breadboard-garden and breadboard-quartz
// agents may use to touch garden content. Each tool is a thin, schema-validated
// adapter that:
//   1. authenticates the Hermes process and session to Breadboard's loopback
//      endpoint, where a short-lived capability is minted from server state,
//   2. returns the bounded, structured result to the model.
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
  const serviceSecret = process.env.HERMES_TOOL_SECRET || process.env.HERMES_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/hermes/tools/garden", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-Hermes-Session-ID": sessionID,
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

export const save_note = tool({
  description:
    "Save a NEW note into the user's own Garden immediately. Use this when the user asked for the content to be saved or added; it writes the note and needs no further approval. Only adds new notes — it never edits or overwrites existing Garden pages.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    folder: tool.schema.string().describe("Optional nested folder path inside the target Garden, e.g. 'course/week-4'").optional(),
    title: tool.schema.string().describe("Note title"),
    content: tool.schema.string().describe("Note markdown content"),
    tags: tool.schema.array(tool.schema.string()).describe("Optional topic tags").default([]),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_save_note", {
      title: args.title,
      gardenId: args.gardenId,
      folder: args.folder,
      content: args.content,
      tags: args.tags,
    })
  },
})

export const list_files = tool({
  description:
    "List this Garden's structure: every folder and which folder each note currently sits in. Call this before moving anything so both the note slug and the destination folder are known to exist.",
  args: { gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional() },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_list_files", { gardenId: args.gardenId })
  },
})

export const create_folder = tool({
  description:
    "Create a folder in the user's own Garden immediately. Nested paths are created in full. Use this when the user asked for a folder or when a requested destination does not exist yet.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    folder: tool.schema.string().describe("Nested folder path to create, e.g. 'course/week-4'"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_create_folder", { gardenId: args.gardenId, folder: args.folder })
  },
})

export const move_page = tool({
  description:
    "Move one existing note into another folder of the user's own Garden immediately. The note keeps its slug and title, so existing links still resolve; only its location changes. Use an empty destination to move it to the Garden root.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    slug: tool.schema.string().describe("The note's slug, as returned by garden_list_files"),
    toFolder: tool.schema.string().describe("Destination folder path; empty string moves the note to the Garden root").default(""),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_move_page", {
      gardenId: args.gardenId,
      slug: args.slug,
      toFolder: args.toFolder,
    })
  },
})

export const rename_folder = tool({
  description:
    "Rename an existing folder in the user's own Garden immediately, keeping it in the same parent. The notes inside keep their slugs, so links still resolve.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    folder: tool.schema.string().describe("The existing folder path to rename, e.g. 'course/week-4'"),
    name: tool.schema.string().describe("The new name for that folder alone, with no slashes"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_rename_folder", {
      gardenId: args.gardenId,
      folder: args.folder,
      name: args.name,
    })
  },
})

export const delete_folder = tool({
  description:
    "PERMANENTLY delete a folder from the user's own Garden along with every note inside it. There is no undo. Only call this when the user explicitly asked to delete this exact folder and was told what it contains.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    folder: tool.schema.string().describe("The folder path to delete, e.g. 'course/week-4'"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_delete_folder", { gardenId: args.gardenId, folder: args.folder })
  },
})

export const create_note_proposal = tool({
  description:
    "Propose a NEW note for this garden. This does NOT publish anything — it creates a proposal the user reviews and applies through Breadboard. Cite evidence anchors.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug; omit to use the active Garden").optional(),
    folder: tool.schema.string().describe("Optional nested folder path inside the target Garden").optional(),
    title: tool.schema.string().describe("Proposed note title"),
    content: tool.schema.string().describe("Proposed note markdown content"),
    rationale: tool.schema.string().describe("Why this note should exist"),
    evidenceAnchorIds: tool.schema.array(tool.schema.string()).describe("Supporting source anchor ids").default([]),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "garden_create_note_proposal", {
      title: args.title,
      gardenId: args.gardenId,
      folder: args.folder,
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
