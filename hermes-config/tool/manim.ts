import { tool } from "@opencode-ai/plugin"

type ManimArgs = {
  title: string
  description: string
  code: string
  sceneName?: string
  quality?: "draft" | "standard" | "high"
}

export const create = tool({
  description:
    "Render one self-contained Manim Community scene in a guarded, network-disabled container and publish the verified MP4 as a durable chat artifact.",
  args: {
    title: tool.schema.string().min(1).max(240),
    description: tool.schema.string().min(1).max(1000),
    code: tool.schema.string().min(1).max(65536),
    sceneName: tool.schema.string().min(1).max(64).optional(),
    quality: tool.schema.enum(["draft", "standard", "high"]).optional(),
  },
  async execute(args: ManimArgs, ctx) {
    const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
    const serviceSecret =
      process.env.HERMES_TOOL_SECRET ||
      process.env.HERMES_PASSWORD ||
      "breadboard-local-dev"
    const response = await fetch(new URL("/api/hermes/tools/manim", dashboardUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": ctx.sessionID,
      },
      body: JSON.stringify({
        action: "manim_create",
        args,
        toolCallId: (ctx as { callID?: string }).callID,
      }),
      signal: AbortSignal.timeout(320_000),
    })
    const data = await response.json().catch(() => ({ ok: false, error: "Invalid Manim response" }))
    if (!response.ok || data.ok === false) {
      return { title: "Manim render failed", output: JSON.stringify(data) }
    }
    return { title: `Manim: ${args.title}`, output: JSON.stringify(data.data) }
  },
})
