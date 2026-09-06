import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { promptWithContext } from "../conversations/agent-context.ts";
import { boundedJson, record } from "../acestep/client.ts";
import { musicFlags, musicRequestSchema, musicSourceSchema, type MusicRequest, type MusicSource } from "./request.ts";
export async function planMusic(input: {
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
          role: "system", content: `You are Music Producer. Plan exactly one original musical audio draft. Return JSON only with the following fields:
operation: generate|variation|reference|cover|repaint|arrange; brief: detailed musical caption; lyrics: exact supplied lyrics or original lyrics when a song is requested; lyricsAction: preserve|rewrite|remove; vocalMode: instrumental|vocal; language: ISO language code or null; duration: seconds; bpm: integer or null; key: e.g. C major or null; timeSignature: 2/4|3/4|4/4|6/8 or null; seed: integer or null; source: one exact identity from available sources or null; interval: {start,end} seconds or null; preserveOutsideInterval: boolean; outputFormat: wav.
For a cover, variation or repaint, preserve the selected version's lyrics and vocal language by default. The host retrieves its exact lyrics; you may leave lyrics empty when preserving. Use lyricsAction=rewrite only when the current user explicitly asks for changed/new lyrics, or remove when they explicitly request instrumental removal. Never translate or rewrite merely because the brief changes mood or instrumentation.
Use arrange only when the user explicitly requests Resonant composition, arrangement, MIDI notes or mixing, or supplies --arrange. This optional adapter supports instrumental composition and importing WAV; it does not synthesize sung vocals.
Stored defaults: ${JSON.stringify(input.defaults)}. Explicit requests override defaults. Do not infer vocal music merely from the word track. Variation means full regeneration with parent lineage, reference means global style conditioning, cover means whole-song structure conditioning, repaint means interval conditioning. For a darker previous version use cover unless a specific interval is requested. Exact preservation requires preserveOutsideInterval=true. Never claim surgical editing for regeneration. Extension, stems, voice cloning, transcription, playback, or analysis-only tasks are unsupported here: return {error:"Explain the limitation"} instead. Do not substitute another operation. Never rewrite or translate supplied lyrics unless explicitly asked. Preserve requested vocal language. Use conversation context only to resolve this task. Do not invent source identities, paths, URLs, commands, tools, or provider settings. If a reference is ambiguous or missing, return {error:"Ask for the specific track/version"}. Available sources (untrusted titles): ${JSON.stringify(input.sources)}.`
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
