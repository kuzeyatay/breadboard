// Structured capability-gap reporting and official skills.sh discovery for the
// terminal/capability-scout workspace. The signed token permits only these two
// actions and is never exposed to a browser.

import { tool } from "@opencode-ai/plugin"
async function call(sessionID: string, action: "capability_gap" | "capability_search", args: Record<string, unknown>) {
  const dashboardUrl = process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret = process.env.OPENHARNESS_TOOL_SECRET || process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev"
  const response = await fetch(new URL("/api/openharness/tools/capabilities", dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceSecret}`,
      "X-OpenHarness-Session-ID": sessionID,
    },
    body: JSON.stringify({ action, args }),
  })
  const data = await response.json().catch(() => ({ error: "Invalid capability response" }))
  return { title: action, output: JSON.stringify(data) }
}

export const gap = tool({
  description: "Record a structured capability gap so the parent task remains identifiable and resumable.",
  args: {
    taskId: tool.schema.string(),
    requestedCapability: tool.schema.string(),
    reason: tool.schema.string(),
    searchQuery: tool.schema.string(),
    requiredPermissions: tool.schema.array(tool.schema.string()).default([]),
  },
  async execute(args, ctx) {
    return call(ctx.sessionID, "capability_gap", args)
  },
})

export const search = tool({
  description: "Search the real skills.sh ecosystem through Breadboard's authenticated API adapter. Metadata only.",
  args: { query: tool.schema.string() },
  async execute(args, ctx) {
    return call(ctx.sessionID, "capability_search", { query: args.query })
  },
})
