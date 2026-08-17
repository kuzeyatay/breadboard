// Every place a language model touches a ViMax production.
//
// Each of ViMax's crew roles is one forced tool call through Breadboard's
// configured provider (ChatMock), so the agent follows whatever model the user
// selected. Nothing a model returns is trusted until Zod has validated it, and
// one structured repair is attempted before a stage gives up — the same
// tolerance upstream buys with its trailing-comma parser and tenacity retries.

import type { z } from "zod";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  characterListSchema,
  parseWithSchema,
  sceneListSchema,
  scriptDescriptionSchema,
  shotDecompositionSchema,
  storyboardSchema,
  storySchema,
  type CharacterList,
  type SceneList,
  type ScriptDescription,
  type ShotDecomposition,
  type Storyboard,
  type StoryDraft,
} from "./schemas.ts";
import {
  CHARACTER_EXTRACTOR_SYSTEM,
  SCREENWRITER_SCENES_SYSTEM,
  SCREENWRITER_STORY_SYSTEM,
  SHOT_DECOMPOSITION_SYSTEM,
  STORYBOARD_ARTIST_SYSTEM,
  charactersUserPrompt,
  decompositionUserPrompt,
  scenesUserPrompt,
  storyUserPrompt,
  storyboardUserPrompt,
} from "./prompts.ts";

const REQUEST_TIMEOUT_MS = 180_000;

export class VimaxModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VimaxModelError";
    this.code = code;
  }
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelTarget {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  /** Raw `usage` from each completion, so a run reports what it actually spent. */
  onUsage?: (usage: unknown) => void;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

async function callTool(
  target: ModelTarget,
  messages: ChatMessage[],
  tool: ToolDefinition,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  target.signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(completionsUrl(target.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: target.model,
        messages,
        tools: [{ type: "function", function: tool }],
        tool_choice: { type: "function", function: { name: tool.name } },
        ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new VimaxModelError(
        "model_unavailable",
        `The model endpoint returned ${response.status}.`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
      usage?: unknown;
    };
    if (data.usage) target.onUsage?.(data.usage);
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      throw new VimaxModelError("empty_response", "The model returned no structured result.");
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new VimaxModelError("invalid_json", "The model returned malformed JSON.");
    }
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Run one crew role: call the tool, validate, and on a schema failure tell the
 * model exactly which fields were wrong and ask once more. A stage that fails
 * twice throws rather than letting a half-formed scene into the production.
 */
async function structuredStage<T>(
  target: ModelTarget,
  input: {
    system: string;
    user: string;
    tool: ToolDefinition;
    schema: z.ZodType<T>;
    label: string;
  },
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];
  const first = await callTool(target, messages, input.tool);
  const parsed = parseWithSchema(input.schema, first, input.label);
  if (parsed.ok) return parsed.value;

  const repaired = await callTool(
    target,
    [
      ...messages,
      { role: "assistant", content: JSON.stringify(first).slice(0, 8_000) },
      {
        role: "user",
        content: [
          `${input.label} was rejected: ${parsed.error}`,
          parsed.issues.length ? `Problems:\n- ${parsed.issues.join("\n- ")}` : "",
          "Call the tool again with the same creative content, corrected to fit the schema.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    input.tool,
  );
  const second = parseWithSchema(input.schema, repaired, input.label);
  if (second.ok) return second.value;
  throw new VimaxModelError(
    "invalid_stage_output",
    `${second.error} ${second.issues.slice(0, 3).join("; ")}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// Tool parameter schemas — the JSON Schema half of `schemas.ts`
// ---------------------------------------------------------------------------

const STORY_TOOL: ToolDefinition = {
  name: "submit_story",
  description: "Submit the developed story for the film.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "logline", "story", "style"],
    properties: {
      title: { type: "string", description: "An engaging, relevant title." },
      logline: { type: "string", description: "One sentence: who wants what, and what stops them." },
      story: {
        type: "string",
        description:
          "The full narrative, structured beginning to end, vivid and filmable. 300-900 words.",
      },
      style: {
        type: "string",
        description:
          "The visual style the film should be drawn in, e.g. 'Cartoon', 'gritty live-action', 'watercolour'. Honour the requested style if one was given.",
      },
    },
  },
};

const SCRIPT_DESCRIPTION_TOOL: ToolDefinition = {
  name: "submit_script_description",
  description: "Name and classify a screenplay that already exists.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "logline", "style"],
    properties: {
      title: { type: "string", description: "The screenplay's title, or a fitting one." },
      logline: { type: "string", description: "One sentence: who wants what, and what stops them." },
      style: {
        type: "string",
        description: "The visual style this screenplay should be shot in.",
      },
    },
  },
};

const SCENES_TOOL: ToolDefinition = {
  name: "submit_scenes",
  description: "Submit the screenplay, divided into scenes.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["scenes"],
    properties: {
      scenes: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "location", "timeOfDay", "atmosphere", "script"],
          properties: {
            heading: { type: "string", description: "Slugline, e.g. 'EXT. SCHOOL GYM - DAY'." },
            location: { type: "string" },
            timeOfDay: { type: "string", description: "DAY, NIGHT, DUSK, and so on." },
            atmosphere: {
              type: "string",
              description: "Light, weather, mood and texture of the place, in visual terms.",
            },
            script: {
              type: "string",
              description:
                "The scene's screenplay: action lines with <Name> tags, and dialogue. One continuous time and place.",
            },
          },
        },
      },
    },
  },
};

const CHARACTERS_TOOL: ToolDefinition = {
  name: "submit_characters",
  description: "Submit every character the script needs.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["characters"],
    properties: {
      characters: {
        type: "array",
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["identifier", "isVisible", "staticFeatures", "dynamicFeatures"],
          properties: {
            identifier: { type: "string", description: "The name used everywhere in the script." },
            isVisible: {
              type: "boolean",
              description: "False for a character who is never seen, such as a narrator.",
            },
            staticFeatures: {
              type: "string",
              description:
                "Physical appearance and physique only — what rarely changes. Concrete and visual.",
            },
            dynamicFeatures: {
              type: ["string", "null"],
              description: "Clothing, accessories and carried items. Null when not visible.",
            },
          },
        },
      },
    },
  },
};

const STORYBOARD_TOOL: ToolDefinition = {
  name: "submit_storyboard",
  description: "Submit the shot list for this scene.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["shots"],
    properties: {
      shots: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "camIdx",
            "visualDescription",
            "audioDescription",
            "durationSeconds",
            "dialogue",
            "narration",
          ],
          properties: {
            camIdx: {
              type: "integer",
              minimum: 0,
              description:
                "Camera position index within this scene. Reuse an existing index whenever the shot can be filmed from it.",
            },
            visualDescription: {
              type: "string",
              description:
                "Vivid, filmable description of the shot: size, angle, where each element sits in frame, which way each character faces. Character names in angle brackets.",
            },
            audioDescription: {
              type: "string",
              description:
                "Audio for the shot, e.g. '[Sound Effect] rain on a tin roof' or '[Speaker] Alice (anxious): We have to go.'",
            },
            durationSeconds: { type: "number", minimum: 1, maximum: 20 },
            dialogue: {
              type: "array",
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["speaker", "line", "emotion"],
                properties: {
                  speaker: { type: "string" },
                  line: { type: "string" },
                  emotion: { type: "string" },
                },
              },
            },
            narration: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

const DECOMPOSITION_TOOL: ToolDefinition = {
  name: "submit_shot_decomposition",
  description: "Split one shot into its first frame, its motion, and its last frame.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [
      "firstFrameDescription",
      "firstFrameCharacterIdxs",
      "lastFrameDescription",
      "lastFrameCharacterIdxs",
      "motion",
      "variation",
      "variationReason",
    ],
    properties: {
      firstFrameDescription: {
        type: "string",
        description: "A pure snapshot of the opening image: composition, posture, lighting.",
      },
      firstFrameCharacterIdxs: {
        type: "array",
        items: { type: "integer", minimum: 0 },
        description: "Indices, from the character list, of who is visible in the first frame.",
      },
      lastFrameDescription: { type: "string", description: "A pure snapshot of the closing image." },
      lastFrameCharacterIdxs: { type: "array", items: { type: "integer", minimum: 0 } },
      motion: {
        type: "string",
        description:
          "Camera movement and in-frame movement between the two frames. Refer to characters by visible features, never by name.",
      },
      variation: { type: "string", enum: ["large", "medium", "small"] },
      variationReason: { type: "string" },
    },
  },
};

// ---------------------------------------------------------------------------
// The crew
// ---------------------------------------------------------------------------

export function developStory(
  target: ModelTarget,
  input: {
    idea: string;
    userRequirement: string;
    previousFilm?: string;
    conversation?: string;
  },
): Promise<StoryDraft> {
  return structuredStage<StoryDraft>(target, {
    system: SCREENWRITER_STORY_SYSTEM,
    user: storyUserPrompt(input),
    tool: STORY_TOOL,
    schema: storySchema,
    label: "The story",
  });
}

/**
 * Script2Video mode: the screenplay already exists, so the screenwriter only
 * names it. Deliberately not `developStory` with an instruction bolted on —
 * that would spend a full story generation to read back a title.
 */
export function describeScript(
  target: ModelTarget,
  script: string,
): Promise<ScriptDescription> {
  return structuredStage<ScriptDescription>(target, {
    system: SCREENWRITER_SCENES_SYSTEM,
    user: `<SCRIPT>\n${script.trim()}\n</SCRIPT>\n\nName this screenplay. Do not rewrite it.`,
    tool: SCRIPT_DESCRIPTION_TOOL,
    schema: scriptDescriptionSchema,
    label: "The screenplay description",
  });
}

export function writeScenes(
  target: ModelTarget,
  input: { story: string; userRequirement: string },
): Promise<SceneList> {
  return structuredStage<SceneList>(target, {
    system: SCREENWRITER_SCENES_SYSTEM,
    user: scenesUserPrompt(input),
    tool: SCENES_TOOL,
    schema: sceneListSchema,
    label: "The screenplay",
  });
}

export function extractCharacters(
  target: ModelTarget,
  script: string,
): Promise<CharacterList> {
  return structuredStage<CharacterList>(target, {
    system: CHARACTER_EXTRACTOR_SYSTEM,
    user: charactersUserPrompt(script),
    tool: CHARACTERS_TOOL,
    schema: characterListSchema,
    label: "The character list",
  });
}

export function designStoryboard(
  target: ModelTarget,
  input: { script: string; charactersText: string; userRequirement: string },
): Promise<Storyboard> {
  return structuredStage<Storyboard>(target, {
    system: STORYBOARD_ARTIST_SYSTEM,
    user: storyboardUserPrompt(input),
    tool: STORYBOARD_TOOL,
    schema: storyboardSchema,
    label: "The storyboard",
  });
}

export function decomposeShot(
  target: ModelTarget,
  input: { visualDescription: string; charactersText: string },
): Promise<ShotDecomposition> {
  return structuredStage<ShotDecomposition>(target, {
    system: SHOT_DECOMPOSITION_SYSTEM,
    user: decompositionUserPrompt(input),
    tool: DECOMPOSITION_TOOL,
    schema: shotDecompositionSchema,
    label: "The shot decomposition",
  });
}
