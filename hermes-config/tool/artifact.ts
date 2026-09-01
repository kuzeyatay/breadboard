import { tool } from "@opencode-ai/plugin"

type Args = Record<string, unknown>

async function call(sessionID: string, toolCallId: string | undefined, action: string, args: Args) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.HERMES_TOOL_SECRET || process.env.HERMES_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/hermes/tools/artifacts", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-Hermes-Session-ID": sessionID,
    },
    body: JSON.stringify({ action, args, toolCallId }),
  })
  const data = await response.json().catch(() => ({ ok: false, error: "Invalid artifact response" }))
  if (!response.ok || data.ok === false) return { title: `${action} failed`, output: JSON.stringify(data) }
  return { title: action, output: JSON.stringify(data.data) }
}

const provenance = tool.schema.object({
  mcpServer: tool.schema.string(),
  mcpTool: tool.schema.string(),
  invocationId: tool.schema.string().optional(),
  resourceMetadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
}).optional()

export const create = tool({
  description: "Create a persistent text-backed artifact when a substantial reusable output is better than chat. Supported renderers are text, markdown, docx, pdf, sandboxed html, code, validated JSON, CSV, presentation HTML, and sanitized SVG. Set render=true to immediately produce a preview/download. Use artifact_import for original attached uploads and generated binary or native application files.",
  args: {
    kind: tool.schema.enum(["text", "markdown", "document", "pdf", "html", "code", "data", "spreadsheet", "presentation", "diagram"]),
    renderer: tool.schema.enum(["text", "markdown", "docx", "pdf", "html", "code", "json", "csv", "presentation-html", "svg"]),
    title: tool.schema.string(),
    filename: tool.schema.string().optional(),
    mimeType: tool.schema.string().optional(),
    content: tool.schema.string(),
    render: tool.schema.boolean().default(true),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
    sourceSkill: tool.schema.string().optional(),
    provenance,
  },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_create", args) },
})

export const image_generate = tool({
  description: "Generate an image now and save it as a verified, durable image artifact owned by this response. Use this whenever the user asks to create, draw, render, or generate an image; do not return only a suggested prompt and do not say image generation is unavailable before calling this tool. ChatGPT is always tried first. If it fails, Breadboard automatically uses Google Gemini image generation with the API key configured in Profile, and saves that generated image through the same verified artifact path. When fallback.provider is google_image_generation, say Google generated the image after ChatGPT failed and do not retry. If neither generator can run, state both provider-specific reasons from the error.",
  args: {
    prompt: tool.schema.string(),
    title: tool.schema.string().optional(),
  },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_image_generate", args) },
})

export const read = tool({
  description: "Read the current content and safe metadata of an artifact before revising it. Native Word and PowerPoint files return anchored editable blocks; XLSX returns anchored cells; imported text returns content.",
  args: { artifactId: tool.schema.string() },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_read", args) },
})

export const update = tool({
  description: "Replace an artifact's content. Updating a ready artifact creates a traceable new version and preserves the prior version. For native Word, PowerPoint, or XLSX artifacts, first call artifact_read and pass only changed anchored blocks/cells as patches.",
  args: {
    artifactId: tool.schema.string(),
    content: tool.schema.string().optional(),
    patches: tool.schema.array(tool.schema.object({
      anchor: tool.schema.string(),
      text: tool.schema.string(),
    })).optional(),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
    sourceSkill: tool.schema.string().optional(),
    provenance,
  },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_update", args) },
})

export const append = tool({
  description: "Append incremental content to a generating artifact. Do not use this to overwrite completed versions.",
  args: { artifactId: tool.schema.string(), content: tool.schema.string(), metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(), sourceSkill: tool.schema.string().optional(), provenance },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_append", args) },
})

export const render = tool({
  description: "Validate and render the current artifact version with its registered real renderer.",
  args: { artifactId: tool.schema.string() },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_render", args) },
})

export const finalize = tool({
  description: "Render and finalize the current artifact version as ready. Failures remain visible and never masquerade as completed files.",
  args: { artifactId: tool.schema.string() },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_finalize", args) },
})

export const list = tool({
  description: "List artifacts and supported real renderers in the active artifact scope (all Terminal chats, or all chats in the active Garden) so an existing artifact can be revised instead of duplicated.",
  args: {},
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_list", args) },
})

export const search = tool({
  description: "Search artifact IDs, titles, filenames, types, provenance, metadata, and current contents in the active artifact scope. Use this to locate an existing artifact before artifact_read or artifact_update. If contentSearchTruncated is true, repeat with nextContentOffset as contentOffset.",
  args: {
    query: tool.schema.string(),
    limit: tool.schema.number().int().min(1).max(50).default(20),
    includeContent: tool.schema.boolean().default(true),
    contentOffset: tool.schema.number().int().min(0).max(100000).default(0),
  },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_search", args) },
})

export const fork = tool({
  description: "Create a new traceable version from an existing artifact's content, preserving every earlier version.",
  args: { artifactId: tool.schema.string(), content: tool.schema.string(), metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(), sourceSkill: tool.schema.string().optional(), provenance },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_fork", args) },
})
