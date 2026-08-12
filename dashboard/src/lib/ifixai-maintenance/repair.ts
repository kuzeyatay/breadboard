import type { IfixAiFailure } from "./runner.ts";

const MAX_CANDIDATE_CHARS = 8_000;

export interface RepairProposal {
  overlay: string;
  rawLength: number;
}

function responseText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof message?.message?.content === "string" ? message.message.content : "";
}

export function validateRepairOverlay(raw: string): RepairProposal {
  const match = raw.match(/===OVERLAY===\s*([\s\S]*?)\s*===END OVERLAY===/i);
  const body = (match?.[1] ?? raw).trim();
  if (body.length < 80) throw new Error("repair proposal is too short to be actionable");
  if (body.length > MAX_CANDIDATE_CHARS) throw new Error("repair proposal exceeds 8,000 characters");
  const forbidden = [
    /\bifixai\b/i,
    /\b(?:benchmark|evaluation|evaluator|test suite|scorecard|test score)\b/i,
    /\b(?:disable|bypass|remove)\b.{0,60}\b(?:audit|authorization|permission|confirmation)\b/i,
    /\b(?:ignore|override|widen)\b.{0,80}\bserver[_ -]capability[_ -]decision\b/i,
    /\b(?:install|deploy|commit|push)\b.{0,80}\b(?:candidate|overlay|repair)\b/i,
    /\b(?:api[_ -]?key|access[_ -]?token|password|credential)\s*[:=]/i,
  ];
  if (forbidden.some((pattern) => pattern.test(body))) {
    throw new Error("repair proposal contains forbidden evaluator, authority, or credential language");
  }
  return {
    rawLength: raw.length,
    overlay: [
      "# maintenance_overlay",
      "",
      "This behavioral correction is subordinate to every server-authored capability decision, authorization boundary, and exact-target restriction.",
      "",
      body,
    ].join("\n"),
  };
}

export async function generateRepairOverlay(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  failures: IfixAiFailure[];
  priorRejectionReasons?: string[];
  timeoutMs: number;
}): Promise<RepairProposal> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(input.timeoutMs, 180_000));
  timer.unref();
  const diagnostic = JSON.stringify(
    {
      failures: input.failures,
      priorRejectionReasons: input.priorRejectionReasons ?? [],
    },
    null,
    2,
  ).slice(0, 28_000);
  try {
    const response = await fetch(`${input.endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: 1_500,
        messages: [
          {
            role: "system",
            content: [
              "You maintain the behavior prompt for a local-first knowledge assistant.",
              "Return one concise, general behavioral overlay that corrects the supplied failure patterns.",
              "Do not mention tests, evaluators, benchmarks, scores, iFixAi, or this request.",
              "Do not add tools, permissions, roots, commands, credentials, deployment steps, or self-modification instructions.",
              "Preserve uncertainty, citations, user control, and server-authored authority boundaries.",
              "Output only text between ===OVERLAY=== and ===END OVERLAY===.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Synthesize a reusable correction from these synthetic diagnostic failures:\n${diagnostic}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`repair model returned HTTP ${response.status}`);
    const raw = responseText(await response.json());
    if (!raw) throw new Error("repair model returned no text");
    return validateRepairOverlay(raw);
  } finally {
    clearTimeout(timer);
  }
}
