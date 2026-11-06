import { ArtifactImageServiceError, generateArtifactImage } from "./artifact-image-service.ts";
import { generateGoogleImage, generatedImageFilename } from "./google-image-generation-service.ts";

export async function generateImageWithProviderFallback(input: {
  baseURL: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<{
  buffer: Buffer;
  filename: string;
  providerMetadata: Record<string, unknown>;
  fallback?: {
    provider: "google_image_generation";
    model: string;
    generationFailure: string;
    explanation: string;
  };
}> {
  try {
    const generated = await generateArtifactImage({
      baseURL: input.baseURL,
      prompt: input.prompt,
      signal: input.signal,
    });
    return {
      buffer: generated.buffer,
      filename: "generated-image.png",
      providerMetadata: {
        imageProvider: "chatgpt",
        ...(generated.providerItemId
          ? { providerItemId: generated.providerItemId }
          : {}),
      },
    };
  } catch (generationError) {
    if (input.signal.aborted) throw generationError;
    const generationFailure = imageGenerationFailureReason(generationError);
    try {
      const fallback = await generateGoogleImage({
        baseURL: input.baseURL,
        prompt: input.prompt,
        signal: input.signal,
      });
      return {
        buffer: fallback.buffer,
        filename: generatedImageFilename(fallback.mimeType),
        providerMetadata: {
          imageProvider: "google",
          imageModel: fallback.model,
          primaryGenerationFailure: generationFailure,
          ...(fallback.responseId
            ? { providerResponseId: fallback.responseId }
            : {}),
        },
        fallback: {
          provider: "google_image_generation",
          model: fallback.model,
          generationFailure,
          explanation: "ChatGPT image generation failed, so Google Gemini generated this image instead.",
        },
      };
    } catch (fallbackError) {
      if (input.signal.aborted) throw fallbackError;
      throw new ArtifactImageServiceError(
        503,
        "image_generation_fallback_unavailable",
        combinedImageGenerationFailureReason(generationFailure, fallbackError),
      );
    }
  }
}

function imageGenerationFailureReason(error: unknown): string {
  if (error instanceof ArtifactImageServiceError) {
    return error.message.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "ChatGPT image generation did not complete.";
}

function combinedImageGenerationFailureReason(
  generationFailure: string,
  fallbackError: unknown,
): string {
  const googleFailure =
    fallbackError instanceof Error
      ? fallbackError.message.trim()
      : "Google image generation did not complete.";
  return [
    `ChatGPT image generation failed: ${sentence(generationFailure)}`,
    `Google image generation fallback also failed: ${sentence(googleFailure)}`,
  ].join(" ");
}

function sentence(message: string): string {
  return /[.!?]$/u.test(message) ? message : `${message}.`;
}

