// Breadboard GBrain knowledge tools for Hermes.
//
// These are Breadboard-owned, narrow tools — NOT the raw GBrain MCP surface. The
// model never sees arbitrary source ids, paths, database names, credentials, or
// admin operations. Each tool reads the short-lived capability token from this
// session's isolated workspace and calls Breadboard's internal GBrain route over
// loopback. Breadboard intersects every requested garden with the token's
// server-derived authorized set and validates every citation before returning it.
//
// Distinctions the model must honor (spelled out in each description):
//   * Conversation memory is NOT GBrain. GBrain answers "what knowledge exists in
//     the authorized garden sources?"; conversation memory answers "what happened
//     in this conversation/project?".
//   * GBrain search/synthesis is READ-ONLY. To change a garden, propose it through
//     the garden proposal tools — never assume a write happened.
//   * Preserve citations in the final answer.
//   * If GBrain is unavailable, say so honestly; do not present un-grounded model
//     knowledge as garden-grounded.
//
// Tool naming: this file is `gbrain.ts`, so export `X` is exposed as `gbrain_X`.

import { tool } from "@opencode-ai/plugin"

async function callBreadboard(sessionID: string, toolName: string, args: Record<string, unknown>) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.HERMES_TOOL_SECRET || process.env.HERMES_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/hermes/tools/gbrain", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-Hermes-Session-ID": sessionID,
    },
    body: JSON.stringify({ tool: toolName, args }),
  })
  const data = await response.json().catch(() => ({ ok: false, error: "Invalid tool response" }))
  if (!response.ok || data.ok === false) {
    return { title: `${toolName} failed`, output: JSON.stringify(data) }
  }
  return { title: toolName, output: JSON.stringify(data.data ?? data) }
}

export const status = tool({
  description:
    "Report GBrain knowledge-retrieval status for this conversation: configured, healthy, degraded (lexical-only), unavailable, or disabled. Call this before relying on GBrain so you can be honest about whether garden knowledge retrieval is available.",
  args: {},
  async execute(_args, ctx) {
    return callBreadboard(ctx.sessionID, "gbrain_status", {})
  },
})

export const search = tool({
  description:
    "Search the authorized garden's INDEXED KNOWLEDGE (GBrain hybrid retrieval) and return the most relevant excerpts with citations. This is read-only garden knowledge — it is NOT conversation memory. Preserve the returned citations in your answer. If the result reports lexical_degraded mode, say retrieval was keyword-only.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug to narrow to; omit to use all authorized Gardens").optional(),
    query: tool.schema.string().describe("What to search for in the garden knowledge"),
    limit: tool.schema.number().describe("Max results (default 8)").optional(),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "gbrain_search", { gardenId: args.gardenId, query: args.query, limit: args.limit })
  },
})

export const retrieve = tool({
  description:
    "Retrieve a specific page's full content from the authorized garden index by its page id (as returned in a prior search citation). Read-only.",
  args: {
    gardenId: tool.schema.string().describe("The authorized Garden slug the page belongs to"),
    pageId: tool.schema.string().describe("The page id / slug from a search citation"),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "gbrain_retrieve", { gardenId: args.gardenId, pageId: args.pageId })
  },
})

export const synthesize = tool({
  description:
    "Synthesize an answer across multiple authorized garden sources, returning an extractive summary WITH citations. Use this to compare sources, surface agreements/contradictions, and identify gaps. Read-only — it never invents content and never falls back to un-grounded model knowledge. Preserve every citation.",
  args: {
    gardenId: tool.schema.string().describe("Target Garden slug to narrow to; omit to use all authorized Gardens").optional(),
    query: tool.schema.string().describe("The question to synthesize an answer for"),
    limit: tool.schema.number().describe("Max supporting sources (default 6)").optional(),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "gbrain_synthesize", { gardenId: args.gardenId, query: args.query, limit: args.limit })
  },
})

export const connections = tool({
  description:
    "Return bounded knowledge-graph neighbors (related pages) of a page in the authorized garden index. Read-only relationship lookup.",
  args: {
    gardenId: tool.schema.string().describe("The authorized Garden slug"),
    pageId: tool.schema.string().describe("The page id / slug to find connections for"),
    limit: tool.schema.number().describe("Max neighbors (default 12)").optional(),
  },
  async execute(args, ctx) {
    return callBreadboard(ctx.sessionID, "gbrain_graph_neighbors", { gardenId: args.gardenId, pageId: args.pageId, limit: args.limit })
  },
})
