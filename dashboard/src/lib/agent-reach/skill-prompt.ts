import { renderSystemPrompt } from "../system-prompts/service.ts";
// The system prompt for an Agent Reach run.
//
// The routing knowledge is NOT restated here: it is read from the clone's own
// skill files, so upgrading Agent Reach upgrades what Breadboard knows about
// each platform with no code change. What this module adds is the part only
// Breadboard can know — the live doctor snapshot, the execution rules of this
// sandbox, and the reporting contract for the chat transcript.

import path from "node:path";
import { externalRuntimeReadUtf8 } from "../external-runtime-filesystem.ts";
import { ALLOWED_EXECUTABLES } from "./commands.ts";
import type { ChannelHealth } from "./runtime.ts";

/** Which reference doc covers which channel, per Agent Reach's routing table. */
const REFERENCES: Record<string, string> = {
  exa_search: "search.md",
  xiaohongshu: "social.md",
  twitter: "social.md",
  bilibili: "social.md",
  v2ex: "social.md",
  reddit: "social.md",
  facebook: "social.md",
  instagram: "social.md",
  linkedin: "career.md",
  github: "dev.md",
  web: "web.md",
  rss: "web.md",
  youtube: "video.md",
  xiaoyuzhou: "video.md",
};

function readIfPresent(file: string): string {
  try {
    return externalRuntimeReadUtf8(file);
  } catch {
    return "";
  }
}

/**
 * Doctor's own legend is: ok = works, warn = installed but may need config or a
 * login, off/error = nothing installed. So `warn` is worth trying and reporting
 * honestly about — it is deliberately conservative. Exa, for instance, reports
 * `warn` with no backend once configured, because doctor refuses to claim a
 * remote service works without calling it; the search itself succeeds.
 */
export function channelUsable(channel: ChannelHealth): boolean {
  return channel.status === "ok" || channel.status === "warn";
}

function channelTable(channels: ChannelHealth[]): string {
  if (!channels.length) {
    return "The doctor report is unavailable. Assume only zero-config channels (web via Jina Reader, RSS, V2EX) work, and verify with `agent-reach doctor --json`.";
  }
  const rows = channels.map((channel) => {
    const state =
      channel.status === "ok"
        ? `LIVE via ${channel.activeBackend ?? "its default backend"}`
        : channel.status === "warn"
          ? `INSTALLED${channel.activeBackend ? ` via ${channel.activeBackend}` : ""} — worth trying; may still need a login or key`
          : "UNAVAILABLE";
    // The first line of the doctor message is the actionable part; the rest is
    // multi-line install instructions that would swamp the prompt.
    const note = channel.message.split(/\r?\n/)[0]?.trim() ?? "";
    return `- ${channel.channel}: ${state}${note ? ` — ${note}` : ""}`;
  });
  return rows.join("\n");
}

export interface PromptInput {
  userId?: number | null;
  root: string;
  channels: ChannelHealth[];
  workspace: string;
}

export function buildSystemPrompt(input: PromptInput): string {
  const skillDir = path.join(input.root, "agent_reach", "skill");
  const skill = readIfPresent(path.join(skillDir, "SKILL_en.md"));
  const usable = new Set(
    input.channels.filter(channelUsable).map((channel) => channel.channel),
  );
  // Only the references for channels that actually work right now, so the model
  // is not tempted by command groups whose backend is missing.
  const referenceFiles = [
    ...new Set(
      Object.entries(REFERENCES)
        .filter(([channel]) => usable.has(channel))
        .map(([, file]) => file),
    ),
  ];
  const references = referenceFiles
    .map((file) => {
      const body = readIfPresent(path.join(skillDir, "references", file));
      return body ? `\n### reference: ${file}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return renderSystemPrompt("research-agent", input.userId, { "executables": String(ALLOWED_EXECUTABLES.join(", ")), "channels": String(channelTable(input.channels)), "skill": String(skill ? `## Agent Reach skill (from the installed package)\n${skill}` : ""), "references": String(references) });
}
