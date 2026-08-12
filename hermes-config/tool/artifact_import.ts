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
    "Import a finished image, audio, video, PPTX, XLSX/CSV, diagram, data, or code file from the current server-authorized workspace as a durable artifact in this exact chat. The server rejects traversal, symlinks, MIME spoofing, unsafe SVG, oversized files, and files outside the workspace.",
  args: {
    kind: tool.schema.enum([
      "image",
      "audio",
      "video",
      "presentation",
      "spreadsheet",
      "diagram",
      "data",
      "code",
    ]),
    title: tool.schema.string(),
    path: tool.schema.string(),
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
