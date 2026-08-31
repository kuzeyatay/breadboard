import "server-only";

// The one place the teaching subsystem talks to a model.
//
// It goes through ChatMock, the local OpenAI-compatible gateway the rest of
// Breadboard already uses, so teaching inherits the user's configured model and
// needs no key of its own. The endpoint is resolved per call rather than stored:
// the desktop build assigns ChatMock's port at startup, so a cached one goes
// stale on the next restart.

import { chatmockEndpoint, chatmockModel } from "../ui-tars/model-provider.ts";
import { teachWarn } from "./redaction.ts";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface ModelTextPart {
  type: "text";
  text: string;
}

export interface ModelImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type ModelContentPart = ModelTextPart | ModelImagePart;

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string | ModelContentPart[];
}

export interface ModelRequest {
  messages: ModelMessage[];
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  model?: string;
}

export interface ModelReply {
  text: string;
  model: string;
}

export class ModelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailable";
  }
}

function endpoint(): string {
  return chatmockEndpoint().replace(/\/+$/u, "");
}

export async function callModel(request: ModelRequest): Promise<ModelReply> {
  const model = request.model?.trim() || chatmockModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${endpoint()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ModelUnavailable(
      request.signal?.aborted
        ? "The analysis was cancelled."
        : `The local model gateway could not be reached: ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ModelUnavailable(
      `The model gateway returned ${response.status}. ${body.slice(0, 300)}`.trim(),
    );
  }

  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    throw new ModelUnavailable("The model's answer was larger than the analysis accepts.");
  }

  let payload: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    throw new ModelUnavailable("The model gateway's answer could not be read.");
  }

  const content = payload.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
            )
            .join("")
        : "";
  if (!text.trim()) throw new ModelUnavailable("The model returned an empty answer.");
  return { text, model };
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Models fence JSON, prefix it with a sentence, or do both, and a strict parse
 * that fails on any of those turns a good analysis into a lost demonstration.
 * Brace matching from the first `{` is what survives all three.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidates = [fenced?.[1], text].filter((value): value is string => typeof value === "string");

  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const slice = candidate.slice(start, index + 1);
          try {
            const parsed = JSON.parse(slice) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // Keep looking: a brace inside prose can open a run that is not JSON.
          }
          break;
        }
      }
    }
  }
  teachWarn("model", "no JSON object was found in the model's answer", { length: text.length });
  throw new ModelUnavailable("The model did not return the structured answer the analysis needs.");
}
