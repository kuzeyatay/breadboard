import os from "node:os";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import OpenAI from "openai";
import type { EasyInputMessage } from "openai/resources/responses/responses";
import { DEFAULT_MODEL } from "../ai-models.ts";
import {
  createImportedArtifact,
  type ArtifactRow,
} from "./artifact-store.ts";
import type { ArtifactContext } from "../socials-manager/artifacts.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";

const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024;

export class ArtifactImageServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ArtifactImageServiceError";
    this.status = status;
    this.code = code;
  }
}

/** How long a quota has left, in words, when the provider says so. */
function describeReset(resetsInSeconds: unknown): string {
  if (typeof resetsInSeconds !== "number" || !Number.isFinite(resetsInSeconds)) return "";
  if (resetsInSeconds <= 0) return "";
  const hours = Math.round(resetsInSeconds / 3_600);
  if (hours < 1) return " It resets within the hour.";
  if (hours < 48) return ` It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`;
  return ` It resets in about ${Math.round(hours / 24)} days.`;
}

/**
 * Turn whatever the SDK threw into an error a person can act on. A rate limit
 * is called a rate limit and keeps its reset time; anything else keeps the
 * upstream message rather than being flattened into "unavailable".
 */
function imageProviderError(error: unknown): ArtifactImageServiceError {
  const record = (error ?? {}) as {
    status?: unknown;
    message?: unknown;
    error?: { message?: unknown; type?: unknown; resets_in_seconds?: unknown };
  };
  const status = typeof record.status === "number" ? record.status : 502;
  const upstream =
    typeof record.error?.message === "string" && record.error.message.trim()
      ? record.error.message.trim()
      : typeof record.message === "string" && record.message.trim()
        ? record.message.trim()
        : "";

  if (status === 429) {
    return new ArtifactImageServiceError(
      429,
      "image_generation_rate_limited",
      `${upstream || "The image provider's usage limit has been reached."}${describeReset(
        record.error?.resets_in_seconds,
      )}`,
    );
  }
  return new ArtifactImageServiceError(
    status,
    "image_generation_unavailable",
    upstream
      ? `Image generation is unavailable from the configured AI provider: ${upstream}`
      : "Image generation is unavailable from the configured AI provider.",
  );
}

/** The output sizes the Responses image tool accepts. */
export const GENERATED_IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;
export type GeneratedImageSize = (typeof GENERATED_IMAGE_SIZES)[number];

export function isGeneratedImageSize(value: unknown): value is GeneratedImageSize {
  return typeof value === "string" && (GENERATED_IMAGE_SIZES as readonly string[]).includes(value);
}

export interface ImageGenerationResult {
  buffer: Buffer;
  providerItemId: string | null;
  /** Raw `usage` from the completed response, when the provider reported any. */
  usage?: unknown;
}

function imageResultFromItem(item: unknown): {
  result: string;
  id: string | null;
} | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (
    record.type !== "image_generation_call" ||
    typeof record.result !== "string" ||
    !record.result.trim()
  ) {
    return null;
  }
  return {
    result: record.result.trim(),
    id: typeof record.id === "string" ? record.id : null,
  };
}

function imageResultFromOutput(output: unknown): {
  result: string;
  id: string | null;
} | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const found = imageResultFromItem(item);
    if (found) return found;
  }
  return null;
}

function decodeGeneratedImage(value: string): Buffer {
  const encoded = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new ArtifactImageServiceError(
      502,
      "image_generation_invalid_result",
      "The image provider returned an invalid image.",
    );
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new ArtifactImageServiceError(
      502,
      "image_generation_invalid_size",
      "The image provider returned an image with an unsupported size.",
    );
  }
  return buffer;
}

/**
 * Invoke the same Responses image tool used by Garden chat, but return a
 * server-side buffer so the result can cross the artifact import boundary.
 *
 * The call streams for a reason that is not about latency: the upstream emits
 * the rendered image on `response.output_item.done` and then completes with an
 * empty `output` array, so a non-streaming read of the final response object
 * sees a successful turn carrying no image at all. Garden chat already consumes
 * the item events; this does the same rather than trusting the aggregate.
 */
export async function generateArtifactImage(input: {
  baseURL: string;
  prompt: string;
  sourceImage?: { dataUrl: string } | null;
  /**
   * References when one is not enough. The Wardrobe agent's modeled shot needs
   * two — the person and the garment — and an outfit needs one per piece, so the
   * single-reference field is the common case rather than the only one. When
   * both are given the list wins; order is preserved, because a prompt that says
   * "the person in Image 1 wearing Image 2" is reading positions.
   */
  sourceImages?: ReadonlyArray<{ dataUrl: string }>;
  /** Requested output size. Defaults to letting the model pick. */
  size?: GeneratedImageSize;
}): Promise<ImageGenerationResult> {
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" }
  > = [{ type: "input_text", text: input.prompt }];
  const references =
    input.sourceImages && input.sourceImages.length
      ? input.sourceImages
      : input.sourceImage
        ? [input.sourceImage]
        : [];
  for (const reference of references) {
    content.push({ type: "input_image", image_url: reference.dataUrl, detail: "auto" });
  }
  const messages: EasyInputMessage[] = [
    {
      type: "message",
      role: "user",
      content,
    },
  ];
  const client = new OpenAI({
    baseURL: input.baseURL,
    apiKey: process.env.OPENAI_API_KEY || "local",
  });

  let stream;
  try {
    stream = await client.responses.create({
      model: DEFAULT_MODEL,
      instructions:
        "Create the requested image. If a reference image is provided, edit that image while preserving details the prompt does not ask to change.",
      input: messages,
      stream: true,
      store: false,
      tools: [
        {
          type: "image_generation",
          action: references.length ? "edit" : "generate",
          background: "auto",
          output_format: "png",
          quality: "auto",
          size: input.size ?? "auto",
        },
      ],
      tool_choice: { type: "image_generation" },
    });
  } catch (error) {
    // The provider's own reason is the only thing that tells a person what to
    // do next — a quota that resets on Thursday needs a different response than
    // a model that cannot draw at all. Collapsing every failure into one
    // sentence hid exactly that, so the upstream status and message are kept.
    throw imageProviderError(error);
  }

  let generated: { result: string; id: string | null } | null = null;
  // Kept only as a last resort: a partial frame is a real image, so a stream
  // that dies after the last partial still beats failing the request.
  let partial: { result: string; id: string | null } | null = null;
  let refusal: string | null = null;
  let usage: unknown;
  try {
    for await (const event of stream) {
      // Token accounting arrives with the completed response, which is normally
      // after the image itself — so it is read before the early exit below.
      if (event.type === "response.completed" && event.response.usage) {
        usage = event.response.usage;
      }
      if (generated) continue;
      if (event.type === "response.output_item.done") {
        generated = imageResultFromItem(event.item);
      } else if (event.type === "response.completed") {
        generated = imageResultFromOutput(event.response.output);
      } else if (event.type === "response.failed" || event.type === "error") {
        const record = event as unknown as Record<string, unknown>;
        const response = record.response as { error?: { message?: unknown } } | undefined;
        const message = response?.error?.message ?? record.message;
        if (typeof message === "string" && message.trim()) refusal = message.trim();
      } else if (event.type === "response.image_generation_call.partial_image") {
        const record = event as unknown as Record<string, unknown>;
        if (typeof record.partial_image_b64 === "string" && record.partial_image_b64.trim()) {
          partial = {
            result: record.partial_image_b64.trim(),
            id: typeof record.item_id === "string" ? record.item_id : null,
          };
        }
      }
    }
  } catch {
    if (!generated && !partial) {
      throw new ArtifactImageServiceError(
        502,
        "image_generation_unavailable",
        "Image generation is unavailable from the configured AI provider.",
      );
    }
  }

  const image = generated ?? partial;
  if (!image) {
    throw new ArtifactImageServiceError(
      502,
      "image_generation_empty",
      refusal ?? "The image provider did not return an image.",
    );
  }
  return {
    buffer: decodeGeneratedImage(image.result),
    providerItemId: image.id,
    ...(usage ? { usage } : {}),
  };
}

/** Import an in-memory raster as a normal, verified, durable image artifact. */
export async function importArtifactImage(input: {
  context: ArtifactContext;
  buffer: Buffer;
  title: string;
  filename?: string;
  parentArtifactId?: string | null;
  assistantMessageId?: number | null;
  toolCallId?: string | null;
  metadata?: Record<string, unknown>;
  sourceTool: "artifact_image_generate" | "artifact_image_edit" | "artifact_image_upload";
}): Promise<ArtifactRow> {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifact-image-"));
  const stagedName = (input.filename ?? "image.png")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "image.png";
  const stagedFile = path.join(stagingRoot, stagedName);
  try {
    fs.writeFileSync(stagedFile, input.buffer, { flag: "wx" });
    return await createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: input.assistantMessageId ?? null,
      toolCallId: input.toolCallId ?? null,
      surface: input.context.surface,
      kind: "image",
      title: input.title,
      filename: input.filename ?? "image.png",
      authorizedRoot: stagingRoot,
      filePath: stagedFile,
      parentArtifactId: input.parentArtifactId ?? null,
      metadata: input.metadata,
      sourceHermesTool: input.sourceTool,
    });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}
