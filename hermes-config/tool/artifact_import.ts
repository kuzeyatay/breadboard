import { tool } from "@opencode-ai/plugin"

type Args = Record<string, unknown>

async function call(
  sessionID: string,
  toolCallId: string | undefined,
  args: Args,
) {
  const dashboardUrl =
    process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret =
    process.env.HERMES_TOOL_SECRET ||
    process.env.HERMES_PASSWORD ||
    "breadboard-local-dev"
  const response = await fetch(
    new URL("/api/hermes/tools/artifacts", dashboardUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": sessionID,
      },
      body: JSON.stringify({
        action: "artifact_import",
        args,
        toolCallId,
      }),
    },
  )
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid artifact response" }))
  if (!response.ok || data.ok === false) {
    return {
      title: "artifact_import failed",
      output: JSON.stringify(data),
    }
  }
  return { title: "artifact_import", output: JSON.stringify(data.data) }
}

export default tool({
  description:
    "Save an original file as a durable artifact in this exact chat. For a file attached to the current user message, pass its exact attachmentName (or 1-based attachmentIndex); path, kind, title, and filename are inferred and the original bytes are preserved. For a generated workspace file, pass path, kind, and title. Supports every chat upload format. The server verifies ownership, signatures, paths, and size limits.",
  args: {
    kind: tool.schema.enum([
      "text",
      "markdown",
      "document",
      "pdf",
      "image",
      "audio",
      "video",
      "presentation",
      "spreadsheet",
      "html",
      "diagram",
      "data",
      "code",
      "unknown",
      "model",
    ]).optional(),
    title: tool.schema.string().optional(),
    path: tool.schema.string().optional(),
    attachmentName: tool.schema.string().optional(),
    attachmentIndex: tool.schema.number().int().min(1).max(10).optional(),
    filename: tool.schema.string().optional(),
    metadata: tool.schema
      .record(tool.schema.string(), tool.schema.unknown())
      .optional(),
    sourceSkill: tool.schema.string().optional(),
    provenance: tool.schema
      .object({
        mcpServer: tool.schema.string(),
        mcpTool: tool.schema.string(),
        invocationId: tool.schema.string().optional(),
        resourceMetadata: tool.schema
          .record(tool.schema.string(), tool.schema.unknown())
          .optional(),
      })
      .optional(),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      args,
    )
  },
})
