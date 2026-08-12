// Drawing a frame, through whichever model on this machine can actually draw.
//
// The first version of this agent assumed one way to make an image: the
// Responses `image_generation` tool on the chat model. That is one backend, and
// when its quota is gone every frame fails — which is how a run produced a
// text-only film. Breadboard usually has more than one drawing model available
// (a Gemini image model reached through CLIProxy costs a Google subscription,
// not the ChatGPT quota), so the agent asks the provider what it has and uses
// the first one that works.
//
// Order: an explicitly configured model, then any image-capable model the
// provider advertises, then the Responses image tool. Each attempt reports why
// it failed, and the reasons travel with the film.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  ArtifactImageServiceError,
  generateArtifactImage,
} from "../hermes/artifact-image-service.ts";
import type { VimaxImageGenerator } from "./identity.ts";

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export interface DrawnBytes {
  buffer: Buffer;
  mimeType: string;
  /** Which model drew it, for the film's own record. */
  backend: string;
}

export interface DrawFailure {
  reason: string;
  /** True when every later frame would fail the same way. */
  exhausted: boolean;
}

export type DrawAttempt = { ok: true; drawn: DrawnBytes } | { ok: false; failure: DrawFailure };

function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * Image-capable models the provider advertises, best first.
 *
 * There is no capability flag in the OpenAI model list, so the name is the only
 * signal available: a model with "image" in its id draws. Preview and "lite"
 * variants sort last — they are the cheapest to fall back to, not the first
 * choice for a film frame.
 */
export async function discoverImageModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const response = await fetch(modelsUrl(baseUrl), {
      headers: { authorization: `Bearer ${chatmockApiKeyValue()}` },
      signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
      .filter((id) => /image/i.test(id));
    return ids.sort((left, right) => rank(left) - rank(right));
  } catch {
    return [];
  }
}

function rank(id: string): number {
  let score = 0;
  if (/lite|mini|small/i.test(id)) score += 2;
  if (/preview|experimental/i.test(id)) score += 1;
  return score;
}

function decodeDataUrl(url: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(url.trim());
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return null;
  return { buffer, mimeType: match[1].toLowerCase() };
}

/** Every data URL an image model might have answered with, wherever it put it. */
function imagesFromMessage(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const record = message as {
    images?: unknown;
    content?: unknown;
  };
  const urls: string[] = [];

  // `images: [{ image_url: { url } }]` — what the Gemini bridge returns.
  if (Array.isArray(record.images)) {
    for (const entry of record.images) {
      const url = (entry as { image_url?: { url?: unknown }; url?: unknown } | null)?.image_url?.url ??
        (entry as { url?: unknown } | null)?.url;
      if (typeof url === "string") urls.push(url);
    }
  }
  // Multi-part content with an image part.
  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const url = (part as { image_url?: { url?: unknown } } | null)?.image_url?.url;
      if (typeof url === "string") urls.push(url);
    }
  }
  // A bare data URL inside a text answer.
  if (typeof record.content === "string") {
    const match = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i.exec(record.content);
    if (match) urls.push(match[0]);
  }
  return urls;
}

/**
 * Draw with a chat-completions image model.
 *
 * `council: false` matters: Breadboard's council mediates normal chat requests
 * and would try to answer a drawing request with text. This is a request for
 * pixels, so it goes straight to the provider.
 */
async function drawWithChatModel(input: {
  baseUrl: string;
  model: string;
  prompt: string;
  reference?: { dataUrl: string } | null;
  signal?: AbortSignal;
}): Promise<DrawAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);
  try {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
    if (input.reference) {
      content.push({ type: "image_url", image_url: { url: input.reference.dataUrl } });
    }
    const response = await fetch(completionsUrl(input.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: input.model,
        council: false,
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        failure: {
          reason: `${input.model} returned ${response.status}. ${body.slice(0, 300)}`.trim(),
          // A quota or an auth failure will refuse every later frame too.
          exhausted: [401, 402, 403, 429].includes(response.status) || response.status >= 500,
        },
      };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: unknown }>;
      error?: { message?: unknown };
    };
    if (body.error) {
      const message = typeof body.error.message === "string" ? body.error.message : "";
      return {
        ok: false,
        failure: { reason: `${input.model}: ${message || "no image returned"}`, exhausted: true },
      };
    }
    for (const url of imagesFromMessage(body.choices?.[0]?.message)) {
      const decoded = decodeDataUrl(url);
      if (decoded) {
        return { ok: true, drawn: { ...decoded, backend: input.model } };
      }
    }
    return {
      ok: false,
      failure: {
        reason: `${input.model} answered without an image.`,
        // A model that can talk but not draw is the wrong model, not a blip.
        exhausted: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: `${input.model}: ${error instanceof Error ? error.message : "request failed"}`,
        exhausted: true,
      },
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

/** Draw with the Responses image tool on the chat model. */
async function drawWithResponsesTool(input: {
  baseUrl: string;
  prompt: string;
  reference?: { dataUrl: string } | null;
}): Promise<DrawAttempt> {
  try {
    const generated = await generateArtifactImage({
      baseURL: input.baseUrl,
      prompt: input.prompt,
      sourceImage: input.reference ?? null,
    });
    return {
      ok: true,
      drawn: {
        buffer: generated.buffer,
        mimeType: "image/png",
        backend: "responses image tool",
      },
    };
  } catch (error) {
    const service = error instanceof ArtifactImageServiceError ? error : null;
    return {
      ok: false,
      failure: {
        reason: service?.message ?? (error instanceof Error ? error.message : "no image"),
        exhausted: service
          ? [401, 402, 403, 429].includes(service.status) ||
            service.code === "image_generation_unavailable"
          : true,
      },
    };
  }
}

/**
 * A drawing plan for one run: the models to try, in order, decided once so a
 * 40-frame film does not re-discover the provider's catalogue per frame.
 */
export interface ImagePlan {
  /** Chat-completions image models, best first. */
  models: string[];
  /** Whether the Responses image tool is still worth trying. */
  responsesTool: boolean;
}

export async function planImageBackends(input: {
  baseUrl: string;
  configuredModel?: string | null;
  /**
   * Which generator the person asked for. `auto` tries every image model and
   * then the chat model's tool; naming one restricts the plan to it, so a run
   * that asks for Gemini fails as Gemini rather than quietly drawing with
   * something else.
   */
  generator?: VimaxImageGenerator;
  signal?: AbortSignal;
}): Promise<ImagePlan> {
  const generator = input.generator ?? "auto";

  // ChatGPT draws through the Responses image tool on the chat model, not
  // through a separate image model.
  if (generator === "chatgpt") return { models: [], responsesTool: true };

  const configured = input.configuredModel?.trim();
  const discovered = await discoverImageModels(input.baseUrl, input.signal);
  const all = [configured, ...discovered].filter(
    (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
  );
  const models = generator === "gemini" ? all.filter((model) => /gemini/i.test(model)) : all;
  return { models, responsesTool: generator === "auto" };
}

/**
 * Draw one image, trying each backend in the plan until one produces pixels.
 * A backend that fails in a way that will not change is dropped from the plan,
 * so the rest of the film does not pay for the same failure again.
 */
export async function drawImageBytes(input: {
  baseUrl: string;
  plan: ImagePlan;
  prompt: string;
  reference?: { dataUrl: string } | null;
  signal?: AbortSignal;
}): Promise<DrawAttempt> {
  const reasons: string[] = [];

  for (const model of [...input.plan.models]) {
    const attempt = await drawWithChatModel({
      baseUrl: input.baseUrl,
      model,
      prompt: input.prompt,
      reference: input.reference ?? null,
      signal: input.signal,
    });
    if (attempt.ok) return attempt;
    reasons.push(attempt.failure.reason);
    if (attempt.failure.exhausted) {
      input.plan.models = input.plan.models.filter((entry) => entry !== model);
    }
  }

  if (input.plan.responsesTool) {
    const attempt = await drawWithResponsesTool({
      baseUrl: input.baseUrl,
      prompt: input.prompt,
      reference: input.reference ?? null,
    });
    if (attempt.ok) return attempt;
    reasons.push(attempt.failure.reason);
    if (attempt.failure.exhausted) input.plan.responsesTool = false;
  }

  const dry = input.plan.models.length === 0 && !input.plan.responsesTool;
  return {
    ok: false,
    failure: {
      reason: reasons[0] ?? "No image model is available from the configured provider.",
      exhausted: dry,
    },
  };
}
