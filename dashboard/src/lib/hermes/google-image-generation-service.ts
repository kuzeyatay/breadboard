const GOOGLE_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.1-flash-image";
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
  interactionId?: string;
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
  apiKey: string;
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
  const rawData = text(item.data, 48 * 1024 * 1024);
  if (!rawData) return null;
  const dataUrl = rawData.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/su);
  const data = dataUrl?.[2] ?? rawData;
  const mimeType = (
    dataUrl?.[1] ??
    text(item.mime_type, 100) ??
    text(item.mimeType, 100) ??
    "image/png"
  ).toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) return null;
  return { data, mimeType };
}

function findImage(payload: unknown): ImageCandidate | null {
  const root = record(payload);
  if (!root) return null;

  const direct = asImageCandidate(root.output_image);
  if (direct) return direct;

  const outputs = Array.isArray(root.outputs) ? root.outputs : [];
  for (const output of outputs) {
    const outputRecord = record(output);
    const candidate = asImageCandidate(outputRecord?.image) ?? asImageCandidate(output);
    if (candidate) return candidate;
  }

  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    const stepRecord = record(step);
    const content = Array.isArray(stepRecord?.content) ? stepRecord.content : [];
    for (const item of content) {
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
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
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
  const apiKey = options.apiKey.trim();
  const prompt = options.prompt.trim();
  const model = options.model?.trim() ||
    process.env.BREADBOARD_GOOGLE_IMAGE_GENERATION_MODEL?.trim() ||
    DEFAULT_MODEL;
  if (!apiKey) {
    throw new GoogleImageGenerationError(
      503,
      "google_image_generation_unconfigured",
      "Google image generation is not configured for this profile. Add a Gemini API key in Profile.",
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
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(GOOGLE_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input: [{ type: "text", text: prompt }],
      }),
      signal,
    });
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
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_unreachable",
      error instanceof Error && error.message
        ? `Google image generation could not be reached: ${error.message}`
        : "Google image generation could not be reached.",
    );
  }

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const detail = upstreamMessage(payload);
    const suffix = detail ? ` ${detail}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new GoogleImageGenerationError(
        response.status,
        "google_image_generation_credentials_rejected",
        `Google rejected the Gemini API key.${suffix}`,
      );
    }
    if (response.status === 429) {
      throw new GoogleImageGenerationError(
        429,
        "google_image_generation_quota_reached",
        `Google image-generation quota was reached.${suffix}`,
      );
    }
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_upstream_error",
      `Google image generation failed (HTTP ${response.status}).${suffix}`,
    );
  }

  const candidate = findImage(payload);
  if (!candidate) {
    const detail = upstreamMessage(payload);
    throw new GoogleImageGenerationError(
      502,
      "google_image_generation_empty",
      detail
        ? `Google did not return a generated image: ${detail}`
        : "Google did not return a generated image.",
    );
  }

  const root = record(payload);
  return {
    buffer: decodeImage(candidate),
    mimeType: candidate.mimeType,
    model,
    ...(text(root?.id, 240) ? { interactionId: text(root?.id, 240)! } : {}),
  };
}

export function generatedImageFilename(mimeType: string): string {
  if (mimeType === "image/jpeg") return "generated-image.jpg";
  if (mimeType === "image/webp") return "generated-image.webp";
  if (mimeType === "image/gif") return "generated-image.gif";
  return "generated-image.png";
}
