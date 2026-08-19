// Breadboard stand-in for sim's providers/file-attachments.server.ts (simstudioai/sim,
// Apache-2.0). Every large-file path reads bytes back out of cloud object storage; sim
// gates on `StorageService.hasCloudStorage()`. Breadboard's engine has no object store, so
// that gate is permanently closed and everything inlines.

import {
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  getProviderFileStrategy,
} from "@/lib/sim/providers/attachments";
import type { ProviderId } from "@/lib/sim/providers/types";

export function getInlineHydrationMaxBytes(_providerId: ProviderId | string): number {
  return INLINE_ATTACHMENT_THRESHOLD_BYTES;
}

export function canUseProviderLargeFilePath(providerId: ProviderId | string): boolean {
  return getProviderFileStrategy(providerId) !== "inline";
}
