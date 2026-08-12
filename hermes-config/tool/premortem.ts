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
    new URL("/api/hermes/tools/premortem", dashboardUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": sessionID,
      },
      body: JSON.stringify({
        action: "premortem_run",
        args,
        toolCallId,
      }),
    },
  )
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid Premortem response" }))
  if (!response.ok || data.ok === false) {
    return {
      title: "Premortem failed",
      output: JSON.stringify(data),
    }
  }
  return {
    title: `Premortem: ${args.arguments.slice(0, 2).join(" ")}`,
    output: JSON.stringify(data.data),
  }
}

export const run = tool({
  description:
    "Run one bounded command in the selected conversation's pre-mortem workspace. Pass argv items without a leading `premortem`. Start with agent-start, follow the returned workflow state, and use report generate to obtain final Markdown. Destructive commands, arbitrary paths, paid EDSL jobs, and force flags are unavailable.",
  args: {
    arguments: tool.schema
      .array(tool.schema.string().min(1).max(8192))
      .min(1)
      .max(40),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      args,
    )
  },
})
