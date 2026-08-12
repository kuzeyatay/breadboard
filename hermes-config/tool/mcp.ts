import { tool } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"

type McpArgs = {
  connection: string
  tool: string
  args: Record<string, unknown>
}

async function request(
  sessionID: string,
  toolCallId: string | undefined,
  args: McpArgs,
  permissionGranted = false,
) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.HERMES_TOOL_SECRET || process.env.HERMES_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/hermes/tools/mcp", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-Hermes-Session-ID": sessionID,
    },
    body: JSON.stringify({
      ...args,
      toolCallId,
      ...(permissionGranted ? { permissionGranted: true } : {}),
    }),
  })
  const data = await response.json().catch(() => ({
    ok: false,
    error: "Invalid connected-app response",
  })) as Record<string, unknown>
  return { response, data }
}

function result(action: string, response: Response, data: Record<string, unknown>) {
  if (!response.ok || data.ok === false) {
    return {
      title: `${action} denied`,
      output: JSON.stringify(data),
    }
  }
  return {
    title: action,
    output: JSON.stringify(data.data ?? data),
  }
}

export const call = tool({
  description:
    "Call one exact action on a Breadboard connection selected for this turn. " +
    "Use only connection and action names listed in the current system context. " +
    "Breadboard revalidates ownership, arguments, and permissions; write actions " +
    "pause for the user's approval.",
  args: {
    connection: tool.schema.string(),
    tool: tool.schema.string(),
    args: tool.schema.record(tool.schema.string(), tool.schema.unknown()).default({}),
  },
  async execute(args, ctx) {
    const callID = (ctx as { callID?: string }).callID
    const initial = await request(ctx.sessionID, callID, args)
    if (
      initial.response.status === 428 &&
      initial.data.code === "connected_app_permission_required"
    ) {
      const argumentHash = createHash("sha256")
        .update(JSON.stringify(args.args))
        .digest("hex")
      const actionIdentity = `${args.connection}:${args.tool}:${argumentHash}`
      const description =
        typeof initial.data.error === "string"
          ? initial.data.error
          : `Allow ${args.tool} to change data in ${args.connection}?`
      await ctx.ask({
        permission: "mcp_call",
        patterns: [actionIdentity],
        always: [actionIdentity],
        metadata: {
          connection: args.connection,
          action: args.tool,
          arguments: args.args,
          description,
        },
      })
      const approved = await request(ctx.sessionID, callID, args, true)
      return result(args.tool, approved.response, approved.data)
    }
    return result(args.tool, initial.response, initial.data)
  },
})
