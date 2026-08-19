// Breadboard stand-in for sim's lib/uploads/utils/user-file-base64.server.ts
// (simstudioai/sim, Apache-2.0). Sim streams file bytes out of S3/GCS/Blob, enforces
// per-provider inline byte budgets and caches the result. Breadboard has no object store
// behind the engine: a UserFile that already carries `base64` (the only way bytes reach a
// Breadboard workflow today) passes through unchanged, and one that does not stays
// un-hydrated — the agent handler already reports a clear error for an attachment with no
// inline bytes and no provider upload path.

import type { Logger } from "@/lib/sim/core/logger";
import { isUserFileWithMetadata } from "@/lib/sim/core/core/utils/user-file";
import { isPlainRecord } from "@/lib/sim/core/utils/object";
import type { UserFile } from "@/lib/sim/executor/types";
import type { WorkspaceFileSecretProvenanceIdentity } from "@/lib/sim/core/uploads/contexts/workspace/workspace-file-secret-provenance";

export interface Base64HydrationOptions {
  requestId?: string;
  workspaceId?: string;
  workflowId?: string;
  executionId?: string;
  largeValueExecutionIds?: string[];
  largeValueKeys?: string[];
  fileKeys?: string[];
  allowLargeValueWorkflowScope?: boolean;
  userId?: string;
  logger?: Logger;
  maxBytes?: number;
  allowUnknownSize?: boolean;
  timeoutMs?: number;
  cacheTtlSeconds?: number;
  preserveLargeValueMetadata?: boolean;
  onServableFileContributors?: (
    file: UserFile,
    contributors: readonly WorkspaceFileSecretProvenanceIdentity[],
  ) => Promise<void>;
}

export async function hydrateUserFileWithBase64(
  file: UserFile,
  options: Base64HydrationOptions,
): Promise<UserFile> {
  // No contributors to report: nothing in Breadboard binds secret provenance to a file.
  await options.onServableFileContributors?.(file, []);
  return file;
}

export async function hydrateUserFilesWithBase64<T>(
  value: T,
  options: Base64HydrationOptions,
): Promise<T> {
  if (Array.isArray(value)) {
    return (await Promise.all(
      value.map((entry) => hydrateUserFilesWithBase64(entry, options)),
    )) as unknown as T;
  }
  if (isUserFileWithMetadata(value)) {
    return (await hydrateUserFileWithBase64(value, options)) as unknown as T;
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = await hydrateUserFilesWithBase64(entry, options);
    }
    return out as unknown as T;
  }
  return value;
}

export function containsUserFileWithMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (isUserFileWithMetadata(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsUserFileWithMetadata(item));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).some((item) => containsUserFileWithMetadata(item));
}
