// Breadboard stand-in for sim's providers/attachments.ts (simstudioai/sim, Apache-2.0).
// Sim routes attachments per vendor: an OpenAI/Anthropic `files-api` upload, a Gemini
// `remote-url` fetch, or inline base64, each with its own byte ceiling. Breadboard has one
// provider speaking OpenAI-compatible chat completions against the local model layer, and
// no object storage behind the engine, so the only reachable strategy is inline base64.

import type { UserFile } from "@/lib/sim/executor/types";
import type { ProviderId } from "@/lib/sim/providers/types";

export type ProviderFileStrategy = "inline" | "files-api" | "remote-url";

/** Inline ceiling. Base64 inflates bytes ~4/3, so this bounds the encoded payload too. */
export const INLINE_ATTACHMENT_THRESHOLD_BYTES = 20 * 1024 * 1024;

export function getProviderFileStrategy(_providerId: ProviderId | string): ProviderFileStrategy {
  return "inline";
}

export function shouldUseLargeFilePath(
  _file: Pick<UserFile, "size" | "type">,
  _providerId: ProviderId | string,
): boolean {
  return false;
}

export function supportsFileAttachments(_providerId: ProviderId | string): boolean {
  return true;
}

export function getProviderAttachmentMaxBytes(_providerId: ProviderId | string): number {
  return INLINE_ATTACHMENT_THRESHOLD_BYTES;
}

const MEBIBYTE = 1024 * 1024;

/**
 * Renders a size and the ceiling it broke in one unit derived from the ceiling. The size
 * rounds up and the ceiling rounds down so an over-limit file can never print as the same
 * number as the limit it violated.
 */
export function formatAttachmentSizes(
  bytes: number,
  limitBytes: number,
): { size: string; limit: string } {
  const divisor = limitBytes % MEBIBYTE === 0 ? MEBIBYTE : 1_000_000;
  const render = (value: number, round: (n: number) => number) => {
    const scaled = round((value / divisor) * 100) / 100;
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2);
  };
  return { size: render(bytes, Math.ceil), limit: render(limitBytes, Math.floor) };
}

/**
 * Whether the model can read an attachment's filename. Sim answers yes only for providers
 * that put the name in the request (OpenAI's Files API). Inline base64 parts carry no
 * filename, so nothing the model sees is bound to it.
 */
export function isProviderAttachmentFilenameModelBound(
  _file: UserFile,
  _providerId: ProviderId | string,
  _options: { largeFilePathAvailable?: boolean } = {},
): boolean {
  return false;
}
