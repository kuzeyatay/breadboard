import { tool } from "@opencode-ai/plugin"

// Long work is not killed: the dashboard hands back a handle for a command that
// outlives one wait, and collection only has to outlast that command's own
// wall-clock ceiling. The ceiling is whatever the server granted this command —
// reported back on every slice — so choosing a longer timeout automatically
// buys the collecting loop the time to see it through.
const COLLECT_SLACK_MS = 60_000
const FALLBACK_CEILING_MS = 1_200_000

function grantedCeilingMs(data: Record<string, unknown>): number {
  const record = data?.data
  if (record && typeof record === "object") {
    const granted = (record as Record<string, unknown>).maxRuntimeMs
    if (typeof granted === "number" && granted > 0) return granted
  }
  return FALLBACK_CEILING_MS
}

async function post(sessionID: string, payload: Record<string, unknown>) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.HERMES_TOOL_SECRET || process.env.HERMES_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/hermes/tools/terminal", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-Hermes-Session-ID": sessionID,
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({ error: "Invalid Terminal response" }))
  return { response, data }
}

async function request(
  sessionID: string,
  command: string,
  options: { timeoutSeconds?: number; permissionGranted?: boolean } = {},
) {
  const started = await post(sessionID, {
    command,
    ...(typeof options.timeoutSeconds === "number"
      ? { timeoutSeconds: options.timeoutSeconds }
      : {}),
    ...(options.permissionGranted ? { permissionGranted: true } : {}),
  })
  return collect(sessionID, started)
}

/** Keep collecting a still-running command until it finishes or the budget ends. */
async function collect(
  sessionID: string,
  current: { response: Response; data: Record<string, unknown> },
) {
  const deadline = Date.now() + grantedCeilingMs(current.data) + COLLECT_SLACK_MS
  let latest = current
  while (latest.response.ok) {
    const result = latest.data?.data
    if (!result || typeof result !== "object") break
    const record = result as Record<string, unknown>
    if (record.running !== true || typeof record.commandId !== "string") break
    if (Date.now() >= deadline) {
      return {
        response: latest.response,
        data: {
          ...latest.data,
          data: { ...record, running: false, timedOut: true },
        },
      }
    }
    latest = await post(sessionID, { commandId: record.commandId })
  }
  return latest
}

function result(command: string, response: Response, data: Record<string, unknown>) {
  if (!response.ok || data.ok === false) {
    return { title: "Terminal command denied", output: JSON.stringify(data) }
  }
  return { title: command, output: JSON.stringify(data.data) }
}

export const execute_command = tool({
  description: "Run a command on the user's computer, including downloading any URL or file type to an exact destination. You choose how long the command may run. Read-only inspection and focused verification commands may run automatically; every other valid command, including every download, pauses for the user's explicit permission before it executes. Approval applies only to the exact command shown. Downloaded content is not opened or executed automatically. If permission is denied, do not claim the command ran.",
  args: {
    command: tool.schema.string().describe("The exact command to run. Breadboard displays this exact text in any required permission prompt."),
    timeoutSeconds: tool.schema
      .number()
      .describe(
        "How long this command may run before it is killed, in seconds. Choose it from the work you are asking for rather than leaving it to a default: a few seconds for a status check or a small directory listing, a minute or two for a build or test run, many minutes for a scan of a large tree or a whole drive, and longer still for a big download. Breadboard keeps the command running and waits for it — you do not need to poll. Omitting this uses 1200 (20 minutes). The value is clamped to the server's ceiling, and the ceiling actually applied comes back as maxRuntimeMs in the result.",
      )
      .optional(),
  },
  async execute(args, ctx) {
    const initial = await request(ctx.sessionID, args.command, {
      timeoutSeconds: args.timeoutSeconds,
    })
    if (
      initial.response.status === 428 &&
      initial.data &&
      typeof initial.data === "object" &&
      initial.data.code === "terminal_permission_required"
    ) {
      const description = typeof initial.data.error === "string"
        ? initial.data.error
        : "This command is outside Breadboard's automatic safe-command policy."
      const commandIdentity = `command:${encodeURIComponent(args.command)}`
      await ctx.ask({
        permission: "terminal_execute_command",
        patterns: [commandIdentity],
        always: [commandIdentity],
        metadata: {
          command: args.command,
          description: `Run this command on your computer? ${description}`,
        },
      })
      const approved = await request(ctx.sessionID, args.command, {
        timeoutSeconds: args.timeoutSeconds,
        permissionGranted: true,
      })
      return result(args.command, approved.response, approved.data)
    }
    return result(args.command, initial.response, initial.data)
  },
})
