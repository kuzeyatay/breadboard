import type { OpenHarnessMcpStatus } from "./client.ts";
import {
  getOpenHarnessGateway,
  type OpenHarnessCapabilityDiscovery,
} from "./gateway.ts";
import { resolvePrompt } from "./prompts.ts";
import { listApprovedSkills } from "./skills.ts";
import { ApiError } from "./route-core.ts";
import { listMcpConnections } from "./mcp-connections.ts";

export type CommandHubItemKind = "skill" | "mcp" | "prompt";

export interface CommandHubItem {
  id: string;
  kind: CommandHubItemKind;
  slug: string;
  name: string;
  description: string;
  source?: string;
  installed?: boolean;
  enabled?: boolean;
  healthy?: boolean;
  requiresApproval?: boolean;
  version?: string;
  contentHash?: string;
  unavailableReason?: string;
  favorite?: boolean;
}

export interface ResolvedCommandMessage {
  text: string;
  invocations: Array<{
    kind: CommandHubItemKind;
    slug: string;
    id: string;
    contentHash?: string;
  }>;
  tools?: Record<string, boolean>;
}

export function mcpToolSelection(
  discovery: OpenHarnessCapabilityDiscovery,
  slug: string,
): { selected: string[]; tools: Record<string, boolean> } {
  const prefix = `${slug.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase();
  const selected = discovery.tools.filter((tool) =>
    tool.toLowerCase().startsWith(prefix),
  );
  const mcpPrefixes = Object.keys(discovery.mcp).map((server) =>
    `${server.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase(),
  );
  const mcpTools = discovery.tools.filter((tool) =>
    mcpPrefixes.some((candidate) => tool.toLowerCase().startsWith(candidate)),
  );
  return {
    selected,
    tools: Object.fromEntries(
      mcpTools.map((tool) => [tool, selected.includes(tool)]),
    ),
  };
}

const TOKEN = /^\/(skill|mcp|prompt):([a-z0-9][a-z0-9_.-]*)(?:\s+|$)/i;

export async function resolveCommandMessage(
  userId: number | null,
  rawText: string,
  directory?: string,
): Promise<ResolvedCommandMessage> {
  let remaining = rawText.trimStart();
  const requested: Array<{ kind: CommandHubItemKind; slug: string }> = [];
  while (remaining.startsWith("/")) {
    const match = remaining.match(TOKEN);
    if (!match)
      throw new ApiError(
        400,
        "invalid_slash_command",
        "Malformed slash command. Use /skill:name, /mcp:name, or /prompt:name.",
      );
    requested.push({
      kind: match[1].toLowerCase() as CommandHubItemKind,
      slug: match[2].toLowerCase(),
    });
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (requested.length === 0) return { text: rawText, invocations: [] };
  if (requested.length > 2)
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "Use at most one skill and one MCP connection in a turn.",
    );
  for (const kind of ["skill", "mcp", "prompt"] as const) {
    if (requested.filter((item) => item.kind === kind).length > 1) {
      throw new ApiError(
        400,
        "conflicting_slash_commands",
        `Only one ${kind} command can be used in a turn.`,
      );
    }
  }
  if (
    requested.some((item) => item.kind === "prompt") &&
    requested.length > 1
  ) {
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "A prompt template cannot be combined with another slash command.",
    );
  }

  const invocations: ResolvedCommandMessage["invocations"] = [];
  const instructions: string[] = [];
  let tools: Record<string, boolean> | undefined;
  const skills = listApprovedSkills();
  let discovery: OpenHarnessCapabilityDiscovery | null = null;

  for (const item of requested) {
    if (item.kind === "prompt") {
      const prompt = resolvePrompt(userId, item.slug);
      if (!prompt)
        throw new ApiError(
          404,
          "prompt_not_found",
          "That prompt is unavailable or belongs to another user.",
        );
      invocations.push({ kind: "prompt", slug: item.slug, id: prompt.id });
      instructions.push(
        `[Server-resolved prompt template: ${prompt.title}]\n${prompt.content}`,
      );
      continue;
    }
    if (item.kind === "skill") {
      const skill = skills.find(
        (candidate) =>
          candidate.slug === item.slug &&
          candidate.enabled &&
          candidate.healthy,
      );
      if (!skill)
        throw new ApiError(
          404,
          "skill_not_available",
          "That skill is not installed, approved, and healthy.",
        );
      invocations.push({
        kind: "skill",
        slug: item.slug,
        id: skill.id,
        contentHash: skill.contentHash,
      });
      instructions.push(
        `Load and follow the approved installed skill named "${skill.slug}" for this turn. Report if the skill loader fails.`,
      );
      continue;
    }
    if (userId === null) {
      throw new ApiError(
        403,
        "mcp_authentication_required",
        "Sign in before invoking an MCP connection.",
      );
    }
    const ownedConnection = listMcpConnections(userId).find(
      (connection) => connection.slug === item.slug && connection.enabled,
    );
    if (!ownedConnection) {
      throw new ApiError(
        404,
        "mcp_not_available",
        "That MCP connection is not configured for this user.",
      );
    }
    discovery ??= await getOpenHarnessGateway().capabilityDiscovery(directory);
    const status: OpenHarnessMcpStatus | undefined = discovery.mcp[item.slug];
    if (!status || status.status !== "connected") {
      throw new ApiError(
        409,
        "mcp_not_available",
        `The ${item.slug} MCP connection is not configured and connected.`,
      );
    }
    const selection = mcpToolSelection(discovery, item.slug);
    const selected = selection.selected;
    if (selected.length === 0)
      throw new ApiError(
        409,
        "mcp_tools_unavailable",
        `The ${item.slug} MCP connection exposed no tools.`,
      );
    tools = selection.tools;
    invocations.push({ kind: "mcp", slug: item.slug, id: `mcp:${item.slug}` });
    instructions.push(
      `Use only the selected "${item.slug}" MCP namespace when an external MCP tool is needed for this turn.`,
    );
  }

  return {
    text: `${instructions.join("\n\n")}\n\n[User request]\n${remaining}`.trim(),
    invocations,
    ...(tools ? { tools } : {}),
  };
}
