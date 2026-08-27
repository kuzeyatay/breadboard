import fs from "node:fs";
import path from "node:path";
import { openArtifact, type OpenworkArtifact, type OpenworkConnection } from "./client.ts";

export interface OpenworkRuntimeArtifact extends OpenworkArtifact {
  readonly contentType: string;
  readonly relativePath: string;
}

export const MAX_OPENWORK_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_OPENWORK_ARTIFACTS = 128;
const ARTIFACT_DIRECTORY = "openwork-artifacts";

function samePath(left: string, right: string): boolean {
  const canonical = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return canonical(left) === canonical(right);
}

function contained(candidate: string, root: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const child = normalize(path.resolve(candidate));
  const parent = normalize(path.resolve(root));
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function safeContentType(value: string): string {
  return value.length > 0 && value.length <= 256 && /^[\x20-\x7e]+$/u.test(value)
    ? value
    : "application/octet-stream";
}

function artifactRoot(runtimeWorkspacePath: string): string {
  const workspace = path.resolve(runtimeWorkspacePath);
  const metadata = fs.lstatSync(workspace);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(workspace), workspace)
  ) {
    throw new Error("The OpenWork Runtime workspace is indirect.");
  }
  const root = path.join(workspace, ARTIFACT_DIRECTORY);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootMetadata = fs.lstatSync(root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(root), root) ||
    !contained(root, workspace)
  ) {
    throw new Error("The OpenWork artifact directory is indirect.");
  }
  return root;
}

export async function stageOpenworkRuntimeArtifact(input: {
  readonly connection: OpenworkConnection;
  readonly artifact: OpenworkArtifact;
  readonly runtimeWorkspacePath: string;
  readonly index: number;
  readonly maximumBytes: number;
  readonly signal: AbortSignal;
}): Promise<OpenworkRuntimeArtifact> {
  if (
    !Number.isSafeInteger(input.index) ||
    input.index < 0 ||
    input.index >= MAX_OPENWORK_ARTIFACTS ||
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.maximumBytes > MAX_OPENWORK_ARTIFACT_BYTES ||
    typeof input.artifact.id !== "string" ||
    !input.artifact.id ||
    Buffer.byteLength(input.artifact.id, "utf8") > 1_024 ||
    /\p{Cc}/u.test(input.artifact.id) ||
    typeof input.artifact.path !== "string" ||
    !input.artifact.path ||
    Buffer.byteLength(input.artifact.path, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(input.artifact.path)
  ) {
    throw new Error("OpenWork returned an invalid artifact receipt.");
  }
  const root = artifactRoot(input.runtimeWorkspacePath);
  const relativePath = `${ARTIFACT_DIRECTORY}/artifact-${String(input.index).padStart(4, "0")}.bin`;
  const destination = path.join(input.runtimeWorkspacePath, ...relativePath.split("/"));
  if (!contained(destination, root)) throw new Error("The OpenWork artifact path escaped its root.");
  const temporary = `${destination}.${process.pid}.tmp`;
  let descriptor: number | undefined;
  let total = 0;
  const artifact = await openArtifact(input.connection, input.artifact.id, {
    signal: input.signal,
    maximumBytes: input.maximumBytes,
  });
  const reader = artifact.stream.getReader();
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > input.maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("An OpenWork artifact exceeded its durable output bound.");
      }
      let offset = 0;
      while (offset < value.byteLength) {
        offset += fs.writeSync(descriptor, value, offset, value.byteLength - offset);
      }
    }
    if (artifact.declaredSize !== null && artifact.declaredSize !== total) {
      throw new Error("An OpenWork artifact changed while it was being copied.");
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, destination);
    return {
      id: input.artifact.id,
      path: input.artifact.path,
      size: total,
      updatedAt: Number.isFinite(input.artifact.updatedAt) ? input.artifact.updatedAt : Date.now(),
      contentType: safeContentType(artifact.contentType),
      relativePath,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) throw error;
    }
  }
}

export function isOpenworkRuntimeArtifact(value: unknown): value is OpenworkRuntimeArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    Buffer.byteLength(item.id, "utf8") <= 1_024 &&
    !/\p{Cc}/u.test(item.id) &&
    typeof item.path === "string" &&
    item.path.length > 0 &&
    Buffer.byteLength(item.path, "utf8") <= 4_096 &&
    !/[\u0000\r\n]/u.test(item.path) &&
    Number.isSafeInteger(item.size) &&
    (item.size as number) >= 0 &&
    (item.size as number) <= MAX_OPENWORK_ARTIFACT_BYTES &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt) &&
    typeof item.contentType === "string" &&
    item.contentType.length > 0 &&
    item.contentType.length <= 256 &&
    /^[\x20-\x7e]+$/u.test(item.contentType) &&
    typeof item.relativePath === "string" &&
    /^openwork-artifacts\/artifact-[0-9]{4}\.bin$/u.test(item.relativePath)
  );
}
