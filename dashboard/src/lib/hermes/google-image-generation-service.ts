import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { normalizeChatmockBaseUrl } from "../chatmock-server.ts";

const DEFAULT_MODEL = "cliproxy/gemini-3.1-flash-image";
const REQUEST_TIMEOUT_MS = 8 * 60 * 1_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface GoogleGeneratedImage {
  buffer: Buffer;
  mimeType: string;
  model: string;
  responseId?: string;
}

export class GoogleImageGenerationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GoogleImageGenerationError";
    this.status = status;
    this.code = code;
  }
}

interface GoogleImageGenerationOptions {
  baseURL: string;
  prompt: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  model?: string;
}

interface ImageCandidate {
  data: string;
  mimeType: string;
}

function text(value: unknown, max = 1_000): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asImageCandidate(value: unknown): ImageCandidate | null {
  const item = record(value);
  if (!item) return null;
  const url = record(item.image_url)?.url ?? item.url;
  if (typeof url !== "string") return null;
  const dataUrl = url.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]*)$/u);
  if (!dataUrl) return null;
  const mimeType = dataUrl[1].toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) return null;
  return { data: dataUrl[2], mimeType };
}

function findImage(payload: unknown): ImageCandidate | null {
  const root = record(payload);
  if (!root) return null;

  const choices = Array.isArray(root.choices) ? root.choices : [];
  for (const choice of choices) {
    const message = record(record(choice)?.message);
    const images = Array.isArray(message?.images) ? message.images : [];
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of [...images, ...content]) {
      const candidate = asImageCandidate(item);
      if (candidate) return candidate;
    }
  }
  return null;
}

function upstreamMessage(payload: unknown): string | null {
  const root = record(payload);
  const error = record(root?.error);
  return text(error?.message) ?? text(root?.output_text) ?? text(root?.message);
}

function decodeImage(candidate: ImageCandidate): Buffer {
  const compact = candidate.data.replace(/\s+/gu, "");
  if (!compact || compact.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_invalid_image",
      "Google image generation returned invalid image data.",
    );
  }
  const buffer = Buffer.from(compact, "base64");
  if (buffer.length < 1 || buffer.length > MAX_IMAGE_BYTES) {
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_invalid_image",
      "Google image generation returned an empty or oversized image.",
    );
  }
  return buffer;
}

export async function generateGoogleImage(
  options: GoogleImageGenerationOptions,
): Promise<GoogleGeneratedImage> {
  const baseURL = normalizeChatmockBaseUrl(options.baseURL);
  const prompt = options.prompt.trim();
  if (!baseURL) {
    throw new GoogleImageGenerationError(
      503,
      "google_image_generation_unconfigured",
      "Breadboard's model service is unavailable for Gemini image generation.",
    );
  }
  if (!prompt) {
    throw new GoogleImageGenerationError(
      400,
      "google_image_generation_prompt_required",
      "Google image generation needs a prompt.",
    );
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${chatmockApiKeyValue()}`,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    signal.throwIfAborted();
    // The runtime owns the proxy address and subscription credentials. Use
    // ChatMock's live catalog so neither a stale port nor another provider's
    // image model can become the Google fallback.
    const catalogResponse = await fetchImpl(`${baseURL}/models`, {
      headers,
      cache: "no-store",
      signal,
    });
    const catalog = await catalogResponse.json().catch(() => null) as unknown;
    signal.throwIfAborted();
    assertSuccessfulResponse(catalogResponse, catalog);
    const model = selectImageModel(catalog, options.model);
    const response = await fetchImpl(`${baseURL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        council: false,
        stream: false,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
      signal,
    });
    const payload = await response.json().catch(() => null) as unknown;
    signal.throwIfAborted();
    assertSuccessfulResponse(response, payload);
    const candidate = findImage(payload);
    if (!candidate) {
      throw new GoogleImageGenerationError(
        502,
        "google_image_generation_empty",
        "The Gemini subscription model did not return a generated image.",
      );
    }
    const responseId = text(record(payload)?.id, 240);
    return {
      buffer: decodeImage(candidate),
      mimeType: candidate.mimeType,
      model,
      ...(responseId ? { responseId } : {}),
    };
  } catch (error) {
    if (options.signal?.aborted) {
      throw new GoogleImageGenerationError(
        499,
        "google_image_generation_aborted",
        "Google image generation was cancelled.",
      );
    }
    if (timeoutSignal.aborted) {
      throw new GoogleImageGenerationError(
        504,
        "google_image_generation_timeout",
        "Google image generation timed out.",
      );
    }
    if (error instanceof GoogleImageGenerationError) throw error;
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_unreachable",
      error instanceof Error && error.message
        ? `Google image generation could not be reached: ${error.message}`
        : "Google image generation could not be reached.",
    );
  }
}

function selectImageModel(payload: unknown, configuredModel?: string): string {
  const data = record(payload)?.data;
  const models = (Array.isArray(data) ? data : [])
    .map((entry) => text(record(entry)?.id, 240))
    .filter((id): id is string => Boolean(id && /^cliproxy\/gemini-[\w.-]*image[\w.-]*$/iu.test(id)))
    .sort();
  const configured = configuredModel?.trim() ||
    process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_MODEL?.trim();
  const preferred = configured
    ? (configured.startsWith("cliproxy/") ? configured : `cliproxy/${configured}`)
    : DEFAULT_MODEL;
  if (models.includes(preferred)) return preferred;
  if (!configured && models.length) return models[0];
  throw new GoogleImageGenerationError(
    503,
    "google_image_generation_unconfigured",
    configured
      ? `The configured Gemini image model (${preferred}) is unavailable from your Google subscription.`
      : "No Gemini image model is available. Connect Google Gemini in Subscriptions and refresh its models.",
  );
}

function assertSuccessfulResponse(response: Response, payload: unknown): void {
  if (!response.ok || record(payload)?.error) {
    const detail = upstreamMessage(payload);
    const suffix = detail ? ` ${detail}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new GoogleImageGenerationError(
        response.status,
        "google_image_generation_credentials_rejected",
        `The Gemini subscription could not authorize image generation. Reconnect Google Gemini in Subscriptions.${suffix}`,
      );
    }
    if (response.status === 429) {
      throw new GoogleImageGenerationError(
        429,
        "google_image_generation_quota_reached",
        `The Gemini subscription's image-generation quota was reached.${suffix}`,
      );
    }
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_upstream_error",
      `Google image generation failed (HTTP ${response.status}).${suffix}`,
    );
  }

}

export function generatedImageFilename(mimeType: string): string {
  if (mimeType === "image/jpeg") return "generated-image.jpg";
  if (mimeType === "image/webp") return "generated-image.webp";
  if (mimeType === "image/gif") return "generated-image.gif";
  return "generated-image.png";
}
