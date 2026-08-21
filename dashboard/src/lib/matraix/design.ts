// Turning a sentence into a study.
//
// A MatrAIx survey is a precise object: a questionnaire whose choice ids the
// personas must answer with exactly, and a cohort expressed as filters over
// real persona dimensions. A person asking "would parents pay four dollars a
// month for this" has supplied neither. One forced tool call fills both in,
// against the dimensions this persona pool actually has, and Zod refuses
// anything the clone's own survey schema would raise on.
//
// This is the only model call Breadboard makes in a MatrAIx run. Every
// subsequent call is a persona answering the questionnaire, and those are made
// by the clone's own client inside the bridge.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { humanizeProviderError } from "../provider-error.ts";
import { renderDimensionMenu, type MatraixCatalog } from "./catalog.ts";
import { parseWithSchema, studyDraftSchema, type StudyDraft } from "./schemas.ts";
import type { MatraixRequest } from "./identity.ts";

const REQUEST_TIMEOUT_MS = 240_000;

export class MatraixDesignError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MatraixDesignError";
    this.code = code;
  }
}

export interface MatraixDesignTarget {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  onUsage?: (usage: unknown) => void;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

const STUDY_TOOL = {
  name: "submit_study",
  description:
    "Submit the questionnaire and the cohort for a simulated population study.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title", "context", "questions", "filters", "stratify", "groupBy"],
    properties: {
      title: { type: "string", description: "A short name for the study." },
      context: {
        type: "string",
        description:
          "What respondents are told before they answer: the product, message, or choice, "
          + "described concretely enough that a person could form an opinion about it. "
          + "Include any prices, tiers, or constraints the brief gave.",
      },
      askRationale: {
        type: "boolean",
        description:
          "Whether each answer carries one sentence of reasoning. Usually true; the reasons "
          + "are often more useful than the counts.",
      },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 14,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "prompt", "type", "construct", "required", "options"],
          properties: {
            id: { type: "string", description: "Lowercase, e.g. q0, q1, pay_intent." },
            prompt: { type: "string", description: "The question as a respondent reads it." },
            type: {
              type: "string",
              enum: ["single_choice", "multi_choice", "likert", "free_text"],
            },
            construct: {
              type: "string",
              description: "What the question measures, in one or two words.",
            },
            required: { type: "boolean" },
            options: {
              type: "array",
              maxItems: 8,
              description:
                "Required for choice questions, empty otherwise. Options must span the real "
                + "range of positions, including refusal and indifference — a set where every "
                + "option is a shade of yes measures nothing.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label"],
                properties: {
                  id: { type: "string", description: "Lowercase snake_case." },
                  label: { type: "string", description: "The option as a respondent reads it." },
                },
              },
            },
            minValue: { type: ["integer", "null"], description: "Likert only. Usually 1." },
            maxValue: { type: ["integer", "null"], description: "Likert only. Usually 5." },
          },
        },
      },
      filters: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
        description:
          "Persona dimension filters, as dimension → accepted values. Use only dimensions and "
          + "values from the menu. Leave empty when the brief names no particular audience: a "
          + "narrow filter on a small pool leaves too few respondents to say anything.",
      },
      stratify: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description:
          "Dimensions to sample evenly across, so a subgroup is not represented by one person. "
          + "Each combination of values needs at least one respondent, so two dimensions with "
          + "four values each already needs sixteen.",
      },
      groupBy: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description: "Dimensions to break the results down by in the report.",
      },
      cohortRationale: {
        type: "string",
        description: "One sentence: who this cohort is and why it answers the brief.",
      },
    },
  },
};

function systemPrompt(catalog: MatraixCatalog, request: MatraixRequest): string {
  return [
    "You design instruments for MatrAIx, which answers a question by putting it to a",
    "sampled population of persona agents rather than to one assistant.",
    "",
    "Write the questionnaire the brief needs and choose the cohort that should answer it.",
    "",
    "How to write questions that measure something:",
    "- Ask about behaviour and trade-offs, not approval. 'Would you like this' is answered",
    "  yes by almost everyone and tells you nothing.",
    "- Every choice set must contain a real refusal and a real indifference, worded as",
    "  reasonably as the positive options.",
    "- Put any price, tier, or constraint from the brief into the context, and then ask",
    "  questions that force a choice against it.",
    "- Between four and eight questions is usually right. One likert question is useful as a",
    "  summary measure; a questionnaire made only of likert questions is not.",
    "",
    "The cohort:",
    `- This study samples ${request.respondents} respondents from a pool of ${catalog.count}`,
    "  personas. Filters cut that pool down, so filter only for what the brief actually asks",
    "  for. Every filtered-out persona is a respondent you do not get.",
    "- Use only the dimensions and values below, spelled exactly as they appear.",
    "",
    "Dimensions available in this persona pool:",
    renderDimensionMenu(catalog),
  ].join("\n");
}

function userPrompt(request: MatraixRequest, conversationContext?: string): string {
  const stated: string[] = [];
  if (Object.keys(request.filters).length) {
    stated.push(
      `The person specified these filters, which are fixed: ${Object.entries(request.filters)
        .map(([key, values]) => `${key} = ${values.join(", ")}`)
        .join("; ")}.`,
    );
  }
  if (request.stratify.length) {
    stated.push(`They asked to sample evenly across: ${request.stratify.join(", ")}.`);
  }
  if (request.groupBy.length) {
    stated.push(`They asked for the results broken down by: ${request.groupBy.join(", ")}.`);
  }
  return [
    conversationContext ? `## Conversation so far\n\n${conversationContext}\n` : "",
    "## The brief",
    "",
    request.brief,
    stated.length ? `\n## Already decided\n\n${stated.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callTool(
  target: MatraixDesignTarget,
  messages: ChatMessage[],
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
        tools: [{ type: "function", function: STUDY_TOOL }],
        tool_choice: { type: "function", function: { name: STUDY_TOOL.name } },
        ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } | string };
        detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "");
      } catch {
        detail = body;
      }
      throw new MatraixDesignError(
        "model_unavailable",
        humanizeProviderError(detail).trim() ||
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
      throw new MatraixDesignError(
        "empty_response",
        "The model returned no questionnaire.",
      );
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new MatraixDesignError("invalid_json", "The model returned malformed JSON.");
    }
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Design the study, with exactly one repair attempt.
 *
 * The repair exists because the failures here are mechanical — a choice
 * question with one option, a likert scale inverted — and naming them back is
 * usually enough. A second failure throws rather than starting a run against a
 * questionnaire that will make the clone raise once per respondent.
 */
export async function designStudy(input: {
  target: MatraixDesignTarget;
  catalog: MatraixCatalog;
  request: MatraixRequest;
  conversationContext?: string;
}): Promise<StudyDraft> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.catalog, input.request) },
    { role: "user", content: userPrompt(input.request, input.conversationContext) },
  ];
  const first = await callTool(input.target, messages);
  const parsed = parseWithSchema(studyDraftSchema, first, "The study");
  if (parsed.ok) return parsed.value;

  const repaired = await callTool(input.target, [
    ...messages,
    { role: "assistant", content: JSON.stringify(first).slice(0, 8_000) },
    {
      role: "user",
      content: [
        `The study was rejected: ${parsed.error}`,
        parsed.issues.length ? `Problems:\n- ${parsed.issues.join("\n- ")}` : "",
        "Call the tool again with the same questions, corrected to fit the schema.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]);
  const second = parseWithSchema(studyDraftSchema, repaired, "The study");
  if (second.ok) return second.value;
  throw new MatraixDesignError(
    "invalid_study",
    `${second.error} ${second.issues.slice(0, 3).join("; ")}`.trim(),
  );
}
