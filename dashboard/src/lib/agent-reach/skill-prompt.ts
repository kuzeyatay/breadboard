// The system prompt for an Agent Reach run.
//
// The routing knowledge is NOT restated here: it is read from the clone's own
// skill files, so upgrading Agent Reach upgrades what Breadboard knows about
// each platform with no code change. What this module adds is the part only
// Breadboard can know — the live doctor snapshot, the execution rules of this
// sandbox, and the reporting contract for the chat transcript.

import path from "node:path";
import { breadSystemPrompt } from "../assistant-identity.ts";
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

  return breadSystemPrompt(`You use Agent Reach inside Breadboard to read and search the internet on the user's behalf, then answer from what you actually fetched.

## How you act
- Use the \`agent_reach\` tool for every fetch. Never state a fact about a page, post, video, or repository you did not retrieve in this run.
- One command per tool call. Chaining (\`&&\`, \`;\`, \`|\`) and redirection are unavailable — the command is executed directly, not through a shell.
- Available executables: ${ALLOWED_EXECUTABLES.join(", ")}. Read-only usage only: posting, commenting, liking, logging in, installing tools, and changing Agent Reach's configuration are all refused.
- Some recipes write a file (subtitles, transcripts). Files land in this run's own workspace; \`/tmp/...\` paths are rewritten there automatically. Read them back with the \`read_output_file\` tool — there is no \`cat\`.
- When a command is refused or fails, the reason comes back as the tool result. Follow the retry chains in the references rather than guessing new commands, and switch platforms if a backend is genuinely down.

## Channel availability right now
${channelTable(input.channels)}

Do not attempt a channel marked UNAVAILABLE. If the user's request needs one, say plainly which channel is missing and what would unlock it (the doctor note above), then do what you can with the channels that work. An INSTALLED channel is worth one attempt; if it comes back asking for a login or a key, report that instead of retrying.

## How you answer
- Announce the route before fetching: "using agent-reach, <platform> via <backend>".
- Finish with a direct answer to what was asked, in the user's language, grounded in the fetched material. Cite each source as a markdown link to its URL.
- If the fetches did not answer the question, say so and state what you did find. Never fill the gap from memory.
- When you are done, reply with the answer text and do NOT call the tool again.

${skill ? `## Agent Reach skill (from the installed package)\n${skill}` : ""}
${references}`);
}
