// Every place a language model touches a Vox Director production.
//
// Three forced tool calls through Breadboard's configured provider (ChatMock),
// so the agent answers on whatever model the person picked in chat. There is no
// second model layer here and there is nowhere to put one: the image backend is
// the repository's ComfyUI, the voice is the repository's Voicebox, and the
// motion is local Python.
//
// Nothing a model returns is trusted until Zod has validated it, and exactly one
// structured repair is attempted before a stage gives up — the tolerance
// `docs/ADDING_AN_AGENT.md` asks for, and the same shape ViMax uses.

import type { z } from "zod";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  beatMapSchema,
  motionPlanBatchSchema,
  parseWithSchema,
  styleChoiceSchema,
  VOX_ARCS,
  VOX_CAMERA_MOVES,
  VOX_ENDINGS,
  VOX_HOOKS,
  VOX_SHOT_SIZES,
  type BeatMapDraft,
  type MotionPlanBatch,
  type StyleChoice,
} from "./schemas.ts";
import {
  BEAT_MAP_SYSTEM,
  MOTION_SYSTEM,
  STYLE_SYSTEM,
  beatMapUserPrompt,
  motionUserPrompt,
  styleUserPrompt,
} from "./prompts.ts";
import type { VoxDirectorRequest } from "./identity.ts";
import type { VoxStyle } from "./types.ts";

const REQUEST_TIMEOUT_MS = 180_000;

export class VoxModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VoxModelError";
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
      throw new VoxModelError(
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
      throw new VoxModelError("empty_response", "The model returned no structured result.");
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new VoxModelError("invalid_json", "The model returned malformed JSON.");
    }
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Run one stage: call the tool, validate, and on a schema failure tell the model
 * exactly which fields were wrong and ask once more. A stage that fails twice
 * throws rather than letting a half-formed beat map into a production that is
 * about to spend minutes of local rendering on it.
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
  throw new VoxModelError(
    "invalid_stage_output",
    `${second.error} ${second.issues.slice(0, 3).join("; ")}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// Tool parameter schemas — the JSON Schema half of `schemas.ts`
// ---------------------------------------------------------------------------

const BEAT_MAP_TOOL: ToolDefinition = {
  name: "submit_beat_map",
  description: "Submit the beat map for this explainer.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "logline", "arc", "ending", "language", "beats"],
    properties: {
      title: { type: "string", description: "A short title for the film." },
      logline: { type: "string", description: "One sentence: the idea this film carries." },
      arc: {
        type: "string",
        enum: [...VOX_ARCS],
        description: "The narrative arc from the story layer that fits this topic.",
      },
      ending: { type: "string", enum: [...VOX_ENDINGS] },
      language: { type: "string", description: "Two-letter language code for the narration." },
      beats: {
        type: "array",
        minItems: 1,
        maxItems: 14,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "narration", "background", "feel", "hook", "shots"],
          properties: {
            title: {
              type: "string",
              description:
                "The cut-out headline baked into this beat's poster. Two or three words, capitals.",
            },
            narration: {
              type: "string",
              description:
                "What the narrator says over this beat. Plain spoken prose, no markup, no stage directions.",
            },
            background: {
              type: "string",
              description: "One bold flat paper background colour, in plain words.",
            },
            feel: { type: "string", description: "The tone of this beat in two or three words." },
            hook: {
              type: ["string", "null"],
              enum: [...VOX_HOOKS, null],
              description: "The hook pattern. Set on beat one; null on the rest.",
            },
            shots: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "id",
                  "duration",
                  "shotSize",
                  "cameraMove",
                  "scene",
                  "elementMotion",
                  "title",
                ],
                properties: {
                  id: { type: "string", description: "\"a\" for the wide, \"b\" for the cut-in." },
                  duration: { type: "number", minimum: 1, maximum: 9 },
                  shotSize: { type: "string", enum: [...VOX_SHOT_SIZES] },
                  cameraMove: {
                    type: "string",
                    enum: [...VOX_CAMERA_MOVES],
                    description:
                      "One flat-safe move. Never the same as the adjacent beat's.",
                  },
                  scene: {
                    type: "string",
                    description:
                      "The poster described as separate paper cut-out pieces, each with clear edges: the subject, a prop, a text strip, a decorative scrap.",
                  },
                  elementMotion: {
                    type: "string",
                    description:
                      "What moves inside the frame — several things at once, as rigid paper. Never morphing or melting.",
                  },
                  title: {
                    type: "boolean",
                    description: "True on the wide shot only, so the headline shows once per beat.",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const STYLE_TOOL: ToolDefinition = {
  name: "submit_style",
  description: "Submit the visual look this film is made in.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [
      "theme",
      "idiom",
      "palette",
      "typeStyle",
      "finish",
      "mood",
      "motionStyle",
      "captionStyle",
      "rationale",
    ],
    properties: {
      theme: {
        type: "string",
        description: "The exact preset name from the library, or \"custom\".",
      },
      idiom: { type: "string", description: "The collage idiom, named as a medium and an era." },
      palette: { type: "string", description: "A limited palette, colours named in plain words." },
      typeStyle: { type: "string", description: "A real, named headline type style." },
      finish: { type: "string", description: "The print finish and paper texture." },
      mood: { type: "string" },
      motionStyle: { type: "string", enum: ["calm", "punchy", "max"] },
      captionStyle: { type: "string", enum: ["white", "paper"] },
      rationale: { type: "string", description: "One sentence on why this look suits this topic." },
    },
  },
};

const MOTION_TOOL: ToolDefinition = {
  name: "submit_motion_plans",
  description: "Submit the element and camera plan for every poster.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["shots"],
    properties: {
      shots: {
        type: "array",
        maxItems: 28,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "plan"],
          properties: {
            key: { type: "string", description: "The shot key, exactly as it was given." },
            plan: {
              type: "object",
              additionalProperties: false,
              required: ["elements", "cameraZoom", "cameraShake", "confetti", "starburst"],
              properties: {
                elements: {
                  type: "array",
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "bbox", "mode", "entrance", "from", "start", "spin"],
                    properties: {
                      name: {
                        type: "string",
                        description: "A lower-case word: headline, hero, chart, coin.",
                      },
                      bbox: {
                        type: "array",
                        minItems: 4,
                        maxItems: 4,
                        items: { type: "number", minimum: 0, maximum: 1000 },
                        description:
                          "[x0, y0, x1, y1] on a 0-1000 grid over the poster, x0<x1 and y0<y1.",
                      },
                      mode: { type: "string", enum: ["crop", "cutout"] },
                      entrance: {
                        type: "string",
                        enum: ["fly_in", "slap", "drop", "pop_settle"],
                      },
                      from: { type: "string", enum: ["L", "R", "T", "B"] },
                      start: {
                        type: "number",
                        minimum: 0,
                        maximum: 8,
                        description: "Seconds into this shot when the piece starts arriving.",
                      },
                      spin: { type: "number", minimum: -20, maximum: 20 },
                    },
                  },
                },
                cameraZoom: { type: "number", minimum: 1, maximum: 1.3 },
                cameraShake: { type: "boolean" },
                confetti: { type: "boolean" },
                starburst: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// The three stages
// ---------------------------------------------------------------------------

export function writeBeatMap(
  target: ModelTarget,
  input: {
    request: VoxDirectorRequest;
    cloneRoot: string;
    conversation?: string;
    previousProduction?: string;
  },
): Promise<BeatMapDraft> {
  return structuredStage<BeatMapDraft>(target, {
    system: BEAT_MAP_SYSTEM,
    user: beatMapUserPrompt(input),
    tool: BEAT_MAP_TOOL,
    schema: beatMapSchema,
    label: "The beat map",
  });
}

export function chooseStyle(
  target: ModelTarget,
  input: {
    request: VoxDirectorRequest;
    title: string;
    arc: string;
    beatSummary: string;
    cloneRoot: string;
    themes: Record<string, Record<string, string>>;
  },
): Promise<StyleChoice> {
  return structuredStage<StyleChoice>(target, {
    system: STYLE_SYSTEM,
    user: styleUserPrompt(input),
    tool: STYLE_TOOL,
    schema: styleChoiceSchema,
    label: "The style choice",
  });
}

export function planMotion(
  target: ModelTarget,
  input: Parameters<typeof motionUserPrompt>[0],
): Promise<MotionPlanBatch> {
  return structuredStage<MotionPlanBatch>(target, {
    system: MOTION_SYSTEM,
    user: motionUserPrompt(input),
    tool: MOTION_TOOL,
    schema: motionPlanBatchSchema,
    label: "The motion plan",
  });
}

/**
 * The style a preset resolves to when the model named one.
 *
 * The library is the quality floor: a preset the clone ships is better written
 * than anything a model composes on the spot, so a named preset's own fields
 * win over the model's paraphrase of them. Only a genuinely custom theme keeps
 * what the model wrote.
 */
export function resolveStyle(
  choice: StyleChoice,
  themes: Record<string, Record<string, string>>,
): VoxStyle {
  const preset = themes[choice.theme];
  return {
    theme: choice.theme,
    idiom: preset?.idiom || choice.idiom || "modern-flat",
    palette: preset?.palette || choice.palette,
    typeStyle: preset?.type_style || choice.typeStyle,
    finish: preset?.finish || choice.finish,
    mood: preset?.mood || choice.mood,
    motionStyle:
      (preset?.motion_style as VoxStyle["motionStyle"] | undefined) ?? choice.motionStyle,
    rationale: choice.rationale,
    captionStyle: choice.captionStyle,
  };
}
