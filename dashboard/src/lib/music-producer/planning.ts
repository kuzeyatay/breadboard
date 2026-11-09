import { renderSystemPrompt } from "../system-prompts/service.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { promptWithContext } from "../conversations/agent-context.ts";
import { boundedJson, record } from "../acestep/client.ts";
import { musicFlags, musicRequestSchema, musicSourceSchema, type MusicRequest, type MusicSource } from "./request.ts";
export async function planMusic(input: {
  userId?: number | null;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext: string;
  defaults: {
    duration: number;
    vocalMode: "instrumental" | "vocal";
  };
  explicit: Partial<MusicRequest>;
  sources: Array<{
    source: MusicSource;
    name: string;
  }>;
  resolveSourceRequest?: (source: MusicSource) => MusicRequest | null;
  resolveSourceDuration?: (source: MusicSource) => number;
}, signal: AbortSignal): Promise<MusicRequest> {
  const flags = musicFlags(input.task);
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${chatmockApiKeyValue()}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    body: JSON.stringify({
      model: input.model, reasoning_effort: input.reasoningEffort, messages: [
        {
          role: "system", content: renderSystemPrompt("music-planning", input.userId, { "stored_defaults": String(JSON.stringify(input.defaults)), "sources": String(JSON.stringify(input.sources)) })
        },
        { role: "user", content: promptWithContext(input.task, input.conversationContext) },
      ]
    }),
  });
  if (!response.ok)
    throw new Error(`Music planning failed (ChatMock ${response.status}).`);
  const data = record(await boundedJson(response, 128 * 1024));
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices.length)
    throw new Error("Music planning returned no answer.");
  const content = record(record(choices[0]).message).content;
  if (typeof content !== "string" || content.length > 32000)
    throw new Error("Invalid music plan.");
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
  const planned = record(JSON.parse(cleaned));
  if (typeof planned.error === "string")
    throw new Error(planned.error.slice(0, 1000));
  const lyrics = /(?:^|\n)Lyrics:\s*\r?\n([\s\S]*)$/i.exec(input.task)?.[1];
  const merged = { ...input.defaults, ...planned, ...input.explicit, ...flags, ...(lyrics === undefined ? {} : { lyrics, vocalMode: "vocal" }) };
  if (lyrics !== undefined && flags.vocalMode === "instrumental")
    throw Error("Choose either instrumental music or supplied vocal lyrics.");
  if (merged.source && ["cover", "variation", "repaint"].includes(String(merged.operation)) &&
    !["rewrite", "remove"].includes(String(merged.lyricsAction)) && lyrics === undefined && input.explicit.lyrics === undefined &&
    flags.vocalMode !== "instrumental" && input.explicit.vocalMode !== "instrumental") {
    const prior = input.resolveSourceRequest?.(musicSourceSchema.parse(merged.source));
    if (prior?.lyrics) {
      merged.lyrics = prior.lyrics;
      merged.language = prior.language;
      merged.vocalMode = "vocal";
    }
  }
  if (lyrics !== undefined || input.explicit.lyrics !== undefined)
    merged.lyricsAction = "rewrite";
  if (merged.lyricsAction === "remove") {
    merged.lyrics = "";
    merged.vocalMode = "instrumental";
  }
  if (merged.operation === "repaint" && merged.source && flags.duration === undefined && input.explicit.duration === undefined) {
    merged.duration = input.resolveSourceDuration?.(musicSourceSchema.parse(merged.source)) ?? merged.duration;
  }
  return musicRequestSchema.parse(merged);
}
