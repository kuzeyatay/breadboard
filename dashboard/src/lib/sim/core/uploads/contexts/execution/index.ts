// Breadboard stand-in for sim's lib/uploads/contexts/execution (simstudioai/sim,
// Apache-2.0). Sim writes tool-produced files into per-execution object storage and hands
// back a UserFile pointing at `/api/files/serve/execution/...`. Breadboard has no such
// store, so bytes stay in-process: the returned UserFile carries them as a data URL and an
// inline base64 field, which is what every downstream consumer (attachments, the model
// input path) actually reads.

import type { UserFile } from "@/lib/sim/executor/types";

export interface ExecutionFileContext {
  workspaceId: string;
  workflowId?: string;
  executionId: string;
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") {
    const dataUrl = /^data:[^,]*;base64,([\s\S]*)$/i.exec(data.trim());
    return Buffer.from(dataUrl ? dataUrl[1] : data, "base64");
  }
  throw new Error("Unsupported raw file data: expected Buffer, Uint8Array or base64 string");
}

function buildUserFile(
  context: ExecutionFileContext,
  buffer: Buffer,
  fileName: string,
  contentType: string,
): UserFile {
  const base64 = buffer.toString("base64");
  const key = `execution/${context.executionId || "local"}/${Date.now()}-${fileName}`;
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    url: `data:${contentType};base64,${base64}`,
    size: buffer.length,
    type: contentType,
    key,
    context: "execution",
    base64,
  };
}

export async function uploadExecutionFile(
  context: ExecutionFileContext,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  _userId?: string,
): Promise<UserFile> {
  return buildUserFile(context, fileBuffer, fileName, contentType);
}

export async function uploadFileFromRawData(
  rawData: {
    name?: string;
    filename?: string;
    data?: unknown;
    mimeType?: string;
    contentType?: string;
    size?: number;
  },
  context: ExecutionFileContext,
  _userId?: string,
): Promise<UserFile> {
  const fileName = rawData.name || rawData.filename || "file";
  const contentType = rawData.mimeType || rawData.contentType || "application/octet-stream";
  return buildUserFile(context, toBuffer(rawData.data), fileName, contentType);
}
