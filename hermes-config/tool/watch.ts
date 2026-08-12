import { tool } from "@opencode-ai/plugin"

type WatchArgs = {
  source: string
  question: string
  detail?: "transcript" | "efficient" | "balanced" | "token-burner"
  start?: string
  end?: string
  timestamps?: string[]
  maxFrames?: number
  resolution?: number
  fps?: number
  whisper?: "groq" | "openai"
  noWhisper?: boolean
  noDedup?: boolean
}

export const run = tool({
  description:
    "Process one video with the selected first-party Watch skill. Accepts a public HTTP(S) URL or a local file inside the authorized workspace. Returns a Markdown report, timestamped frame paths, transcript evidence, and bounded visual evidence analyzed through ChatMock. When an image-capable read tool is available, inspect relevant original frames before making fine-grained visual claims.",
  args: {
    source: tool.schema.string().min(1).max(4096).describe("Public video URL or authorized local video path."),
    question: tool.schema.string().min(1).max(8000).describe("The user's question, or a concise request to summarize the video."),
    detail: tool.schema.enum(["transcript", "efficient", "balanced", "token-burner"]).optional(),
    start: tool.schema.string().max(32).optional(),
    end: tool.schema.string().max(32).optional(),
    timestamps: tool.schema.array(tool.schema.string().max(32)).max(40).optional(),
    maxFrames: tool.schema.number().int().min(1).max(250).optional(),
    resolution: tool.schema.number().int().min(256).max(2048).optional(),
    fps: tool.schema.number().min(0.01).max(2).optional(),
    whisper: tool.schema.enum(["groq", "openai"]).optional(),
    noWhisper: tool.schema.boolean().optional(),
    noDedup: tool.schema.boolean().optional(),
  },
  async execute(args: WatchArgs, ctx) {
    const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
    const serviceSecret =
      process.env.HERMES_TOOL_SECRET ||
      process.env.HERMES_PASSWORD ||
      "breadboard-local-dev"
    const response = await fetch(new URL("/api/hermes/tools/watch", dashboardUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": ctx.sessionID,
      },
      body: JSON.stringify({
        action: "watch_run",
        args,
        toolCallId: (ctx as { callID?: string }).callID,
      }),
      signal: AbortSignal.timeout(310_000),
    })
    const data = await response.json().catch(() => ({ ok: false, error: "Invalid Watch response" }))
    if (!response.ok || data.ok === false) {
      return { title: "Watch failed", output: JSON.stringify(data) }
    }
    return {
      title: `Watch: ${args.source.slice(0, 100)}`,
      output: JSON.stringify(data.data),
    }
  },
})
