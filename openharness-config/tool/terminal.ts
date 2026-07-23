import { tool } from "@opencode-ai/plugin"

async function execute(sessionID: string, command: string) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.OPENHARNESS_TOOL_SECRET || process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/openharness/tools/terminal", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-OpenHarness-Session-ID": sessionID,
    },
    body: JSON.stringify({ command }),
  })
  const data = await response.json().catch(() => ({ error: "Invalid Terminal response" }))
  if (!response.ok || data.ok === false) {
    return { title: "Terminal command denied", output: JSON.stringify(data) }
  }
  return { title: command, output: JSON.stringify(data.data) }
}

export const execute_command = tool({
  description: "Run one server-authorized read-only inspection, read-only Git, or focused existing test/build/lint/type-check command in the Breadboard repository. The server rejects writes, installs, destructive actions, shell composition, absolute paths, and paths outside the repository.",
  args: {
    command: tool.schema.string().describe("One command, for example pwd, Get-ChildItem, rg pattern dashboard/src, git status, git diff, git log -5, or npm test -- test-name"),
  },
  async execute(args, ctx) {
    return execute(ctx.sessionID, args.command)
  },
})
