import { tool } from "@opencode-ai/plugin"

type Args = Record<string, unknown>

async function call(sessionID: string, toolCallId: string | undefined, action: string, args: Args) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.OPENHARNESS_TOOL_SECRET || process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/openharness/tools/artifacts", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-OpenHarness-Session-ID": sessionID,
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
  description: "Create a persistent artifact when a substantial reusable output is better than chat. Use chat for short answers. Supported renderers are text, markdown, docx, pdf, and sandboxed html. Set render=true to immediately produce a preview/download. Unsupported media/video/presentation/spreadsheet generation must not be claimed.",
  args: {
    kind: tool.schema.enum(["text", "markdown", "document", "pdf", "html"]),
    renderer: tool.schema.enum(["text", "markdown", "docx", "pdf", "html"]),
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

export const read = tool({
  description: "Read the current content and safe metadata of an artifact in this conversation before revising it.",
  args: { artifactId: tool.schema.string() },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_read", args) },
})

export const update = tool({
  description: "Replace an artifact's content. Updating a ready artifact creates a traceable new version and preserves the prior version.",
  args: { artifactId: tool.schema.string(), content: tool.schema.string(), metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(), sourceSkill: tool.schema.string().optional(), provenance },
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
  description: "List artifacts and supported real renderers in this conversation so an existing artifact can be revised instead of duplicated.",
  args: {},
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_list", args) },
})

export const fork = tool({
  description: "Create a new traceable version from an existing artifact's content, preserving every earlier version.",
  args: { artifactId: tool.schema.string(), content: tool.schema.string(), metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(), sourceSkill: tool.schema.string().optional(), provenance },
  async execute(args, ctx) { return call(ctx.sessionID, (ctx as { callID?: string }).callID, "artifact_fork", args) },
})
