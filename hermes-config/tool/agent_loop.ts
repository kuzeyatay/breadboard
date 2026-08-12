import { tool } from "@opencode-ai/plugin"

async function call(
  sessionID: string,
  toolCallId: string | undefined,
  args: { arguments: string[] },
) {
  const dashboardUrl =
    process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret =
    process.env.HERMES_TOOL_SECRET ||
    process.env.HERMES_PASSWORD ||
    "breadboard-local-dev"
  const response = await fetch(
    new URL("/api/hermes/tools/agent-loop", dashboardUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": sessionID,
      },
      body: JSON.stringify({
        action: "agent_loop_run",
        args,
        toolCallId,
      }),
    },
  )
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid loop kit response" }))
  if (!response.ok || data.ok === false) {
    return {
      title: "Loop kit failed",
      output: JSON.stringify(data),
    }
  }
  return {
    title: `Loop kit: ${args.arguments[0]}`,
    output: JSON.stringify(data.data),
  }
}

export const run = tool({
  description:
    "Run one Agent Loop Engineering Kit command in the current conversation's workspace. Pass argv items without a leading `hermes-loop`. Available commands: init, validate, score, dry-run, render-receipt, privacy-scan. Every path must be relative to the workspace. The kit only designs, checks and dry-runs a loop contract: it never executes the loop's real task and never creates cron, webhook or Kanban automation.",
  args: {
    arguments: tool.schema
      .array(tool.schema.string().min(1).max(512))
      .min(1)
      .max(12),
  },
  async execute(args, ctx) {
    return call(ctx.sessionID, (ctx as { callID?: string }).callID, args)
  },
})
