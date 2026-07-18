// Structured capability-gap reporting and official skills.sh discovery for the
// terminal/capability-scout workspace. The signed token permits only these two
// actions and is never exposed to a browser.

import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"

type Capability = { token: string; dashboardUrl: string }

function readCapability(worktree: string): Capability {
  return JSON.parse(fs.readFileSync(path.join(worktree, ".breadboard", "capability.json"), "utf8")) as Capability
}

async function call(worktree: string, action: "capability_gap" | "capability_search", args: Record<string, unknown>) {
  const capability = readCapability(worktree)
  const response = await fetch(new URL("/api/openharness/tools/capabilities", capability.dashboardUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${capability.token}` },
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
    return call(ctx.worktree, "capability_gap", args)
  },
})

export const search = tool({
  description: "Search the real skills.sh ecosystem through Breadboard's official Skills CLI adapter. Metadata only.",
  args: { query: tool.schema.string() },
  async execute(args, ctx) {
    return call(ctx.worktree, "capability_search", { query: args.query })
  },
})
