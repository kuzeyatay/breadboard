import "server-only";

// A workflow run's result, saved into a Garden workspace as a Spaces file.
//
// The result is read from the run's own stored record, never from the client,
// so the file is exactly what the workflow produced. A file the workflow made
// (a video, an image, a PDF, a spreadsheet…) is saved as that file; text is
// saved as Markdown, or as HTML when it is an HTML document. Either way it lands
// in the workspace's Spaces folder with its real extension, so Spaces lists it
// under the matching section (Videos, Designs, PDF, Docs, Markdown…).

import db from "@/lib/db";
import { OFFICE_KINDS } from "@/lib/office/types";
import { saveToSpaces } from "@/lib/spaces/garden-save";
import type { GardenFileEntry } from "@/lib/garden-files/types";

const MAX_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SPACES_EXTENSIONS = new Set(OFFICE_KINDS.flatMap((kind) => kind.extensions));
const FILE_KEYS = new Set(["files", "file", "video", "image", "images", "attachments", "document"]);

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf", "text/markdown": "md", "text/html": "html", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export class OutputSaveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type FileCandidate = { name?: string; mime?: string; url?: string; base64?: string };

const extensionOfName = (value: string | undefined): string => {
  if (!value) return "";
  const clean = value.split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  return dot >= 0 && dot > clean.lastIndexOf("/") ? clean.slice(dot + 1).toLowerCase() : "";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function looksLikeFileUrl(value: string): boolean {
  if (value.startsWith("data:")) return /^data:[\w.+-]+\/[\w.+-]+;base64,/.test(value);
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return SPACES_EXTENSIONS.has(extensionOfName(new URL(value).pathname));
  } catch {
    return false;
  }
}

/** The first file the output carries: a file object, a data URI, or a link to a file Spaces opens. */
function findFile(value: unknown, depth = 0): FileCandidate | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return looksLikeFileUrl(trimmed) ? { url: trimmed } : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFile(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name : undefined;
  const mime = typeof value.type === "string" ? value.type : typeof value.mimeType === "string" ? value.mimeType : undefined;
  if (typeof value.base64 === "string" && (name || mime)) return { name, mime, base64: value.base64 };
  if (typeof value.url === "string" && (name || mime || looksLikeFileUrl(value.url))) return { name, mime, url: value.url };
  // Files usually sit under these keys; look there before the rest of the object.
  const entries = Object.entries(value).sort(([a], [b]) => Number(!FILE_KEYS.has(a)) - Number(!FILE_KEYS.has(b)));
  for (const [, child] of entries) {
    const found = findFile(child, depth + 1);
    if (found) return found;
  }
  return null;
}

async function fileBytes(file: FileCandidate): Promise<{ bytes: Buffer; extension: string }> {
  let bytes: Buffer;
  let mime = file.mime;
  if (file.base64) {
    bytes = Buffer.from(file.base64.replace(/^data:[^,]*,/, ""), "base64");
  } else if (file.url?.startsWith("data:")) {
    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s.exec(file.url);
    if (!match) throw new OutputSaveError(422, "The file in this result could not be read.");
    mime = mime ?? match[1];
    bytes = Buffer.from(match[2] ?? "", "base64");
  } else if (file.url && /^https?:\/\//i.test(file.url)) {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(() => null);
    if (!response?.ok) throw new OutputSaveError(502, "The file in this result could not be downloaded.");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new OutputSaveError(413, "The file in this result is too large to save.");
    bytes = Buffer.from(await response.arrayBuffer());
    mime = mime ?? response.headers.get("content-type")?.split(";")[0]?.trim();
  } else {
    throw new OutputSaveError(422, "The file in this result is not stored anywhere Breadboard can read.");
  }
  if (bytes.length > MAX_BYTES) throw new OutputSaveError(413, "The file in this result is too large to save.");
  const extension = [extensionOfName(file.name), extensionOfName(file.url?.startsWith("data:") ? undefined : file.url), mime ? MIME_EXTENSIONS[mime] ?? "" : ""]
    .find((candidate) => candidate && SPACES_EXTENSIONS.has(candidate));
  if (!extension) throw new OutputSaveError(422, "This result is a kind of file Spaces does not open.");
  return { bytes, extension };
}

/** The readable text of a result: an agent's reply, a string, or the structured value as JSON. */
function resultText(output: unknown): string {
  if (typeof output === "string") return output;
  if (isRecord(output)) {
    for (const key of ["content", "text", "markdown", "result", "data"]) {
      if (typeof output[key] === "string" && (output[key] as string).trim()) return output[key] as string;
    }
    if (isRecord(output.response) || typeof output.response === "string") return resultText(output.response);
  }
  return ["```json", JSON.stringify(output, null, 2), "```"].join("\n");
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

export async function saveRunOutputToSpaces(input: {
  userId: number;
  workflowId: string;
  runId: string;
  gardenId: string;
  title: string;
}): Promise<GardenFileEntry> {
  const row = db
    .prepare(
      `SELECT r.output AS output FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ? AND r.workflow_id = ? AND w.user_id = ?`,
    )
    .get(input.runId, input.workflowId, input.userId) as { output: string | null } | undefined;
  if (!row) throw new OutputSaveError(404, "That run was not found.");
  let output: unknown = null;
  try {
    output = row.output === null ? null : JSON.parse(row.output);
  } catch {
    output = row.output;
  }
  if (output === null || output === undefined || output === "") {
    throw new OutputSaveError(422, "This run has no result to save.");
  }

  const file = findFile(output);
  if (file) {
    const { bytes, extension } = await fileBytes(file);
    return saveToSpaces(input.userId, { gardenId: input.gardenId, title: input.title, extension }, streamOf(bytes));
  }
  const text = resultText(output);
  const extension = /^\s*(<!doctype html|<html[\s>])/i.test(text) ? "html" : "md";
  return saveToSpaces(input.userId, { gardenId: input.gardenId, title: input.title, extension }, streamOf(Buffer.from(text, "utf8")));
}
