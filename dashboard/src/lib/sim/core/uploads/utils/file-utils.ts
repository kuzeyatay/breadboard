// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/uploads/utils/file-utils.ts
// (the URL/key parsing and UserFile conversion the executor reaches); adapted for
// Breadboard. Sim's file is 1,144 lines covering S3/GCS/Blob presigning, live-doc merge
// and preview resolution — none of which is vendored: Breadboard's engine only needs to
// recognize internal file URLs and normalize file-shaped block inputs.

import type { Logger } from "@/lib/sim/core/logger";
import type { UserFile } from "@/lib/sim/executor/types";

export type StorageContext =
  | "knowledge-base"
  | "chat"
  | "copilot"
  | "mothership"
  | "execution"
  | "workspace"
  | "table-import"
  | "profile-pictures"
  | "og-images"
  | "logs"
  | "workspace-logos";

export const MODEL_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const SERVE_PREFIX = "/api/files/serve/";

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : "";
}

export function isInternalFileUrl(fileUrl: string): boolean {
  if (typeof fileUrl !== "string") return false;

  let path = fileUrl;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  path = path.split(/[?#]/, 1)[0];

  return path.startsWith(SERVE_PREFIX);
}

export function extractStorageKey(filePath: string): string {
  let pathWithoutQuery = filePath.split("?")[0];

  try {
    if (pathWithoutQuery.startsWith("http://") || pathWithoutQuery.startsWith("https://")) {
      pathWithoutQuery = new URL(pathWithoutQuery).pathname;
    }
  } catch {
    // Non-URL input: treat as a bare path.
  }

  if (pathWithoutQuery.startsWith(SERVE_PREFIX)) {
    let key = decodeURIComponent(pathWithoutQuery.slice(SERVE_PREFIX.length));
    if (key.startsWith("s3/")) key = key.slice(3);
    else if (key.startsWith("blob/")) key = key.slice(5);
    else if (key.startsWith("gcs/")) key = key.slice(4);
    return key;
  }
  return pathWithoutQuery;
}

/** Storage keys are prefixed by the bucket/tenant they live in — that prefix is authoritative
 * for *where the bytes are*, not for which module owns them. */
export function inferContextFromKey(key: string): StorageContext {
  if (!key) throw new Error("Cannot infer context from empty key");

  if (key.startsWith("kb/") || key.startsWith("knowledge-base/")) return "knowledge-base";
  if (key.startsWith("chat/")) return "chat";
  if (key.startsWith("copilot/")) return "copilot";
  if (key.startsWith("execution/")) return "execution";
  if (key.startsWith("workspace/")) return "workspace";
  if (key.startsWith("profile-pictures/")) return "profile-pictures";
  if (key.startsWith("og-images/")) return "og-images";
  if (key.startsWith("workspace-logos/")) return "workspace-logos";
  if (key.startsWith("logs/")) return "logs";

  throw new Error(
    `File key must start with a context prefix (kb/, knowledge-base/, chat/, copilot/, execution/, workspace/, profile-pictures/, og-images/, workspace-logos/, or logs/). Got: ${key}`,
  );
}

export function parseInternalFileUrl(fileUrl: string): { key: string; context: StorageContext } {
  const key = extractStorageKey(fileUrl);
  if (!key) throw new Error("Could not extract storage key from internal file URL");

  const url = new URL(fileUrl.startsWith("http") ? fileUrl : `http://localhost${fileUrl}`);
  const contextParam = url.searchParams.get("context");

  return { key, context: (contextParam as StorageContext) || inferContextFromKey(key) };
}

export interface RawFileInput {
  id?: string;
  key?: string;
  path?: string;
  url?: string;
  name: string;
  size: number;
  type?: string;
  uploadedAt?: string | Date;
  expiresAt?: string | Date;
  context?: string;
  base64?: string;
}

function resolveStorageKeyFromRawFile(file: RawFileInput): string | undefined {
  if (file.key) return file.key;
  const candidate = file.path ?? file.url;
  if (!candidate) return undefined;
  const key = extractStorageKey(candidate);
  return key || undefined;
}

function resolveInternalFileUrl(file: RawFileInput, storageKey: string): string {
  if (file.url) return file.url;
  return `${SERVE_PREFIX}${encodeURIComponent(storageKey)}`;
}

function convertToUserFile(
  file: RawFileInput,
  requestId: string,
  logger: Logger,
): UserFile | null {
  const storageKey = resolveStorageKeyFromRawFile(file);
  if (!storageKey) return null;

  const userFile: UserFile = {
    id: file.id || `file-${Date.now()}`,
    name: file.name,
    url: resolveInternalFileUrl(file, storageKey),
    size: file.size,
    type: file.type || "application/octet-stream",
    key: storageKey,
    context: file.context,
    base64: file.base64,
  };

  logger.info(`[${requestId}] Converted file to UserFile: ${userFile.name} (key: ${userFile.key})`);
  return userFile;
}

export function processFilesToUserFiles(
  files: RawFileInput | RawFileInput[],
  requestId: string,
  logger: Logger,
): UserFile[] {
  const filesArray = Array.isArray(files) ? files : [files];
  const userFiles: UserFile[] = [];

  for (const file of filesArray) {
    if (Array.isArray(file)) {
      logger.warn(`[${requestId}] Skipping nested array in file input`);
      continue;
    }

    const userFile = convertToUserFile(file, requestId, logger);
    if (userFile) userFiles.push(userFile);
    else logger.warn(`[${requestId}] Skipping file without storage key: ${file.name || "unknown"}`);
  }

  return userFiles;
}
