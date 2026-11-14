// Convert one source to Markdown for the *-to-markdown skills.
//
// These are the Garden's own readers with everything after "we have Markdown"
// cut off: no Garden write, no knowledge extraction, no Learn. A web page goes
// through the same reader a Garden link import uses, a document through AnyDoc
// (the Garden upload parser) or the chat's PDF reader, a video link through
// Watch, and an attached recording through the local Whisper engine (SubsAI).
//
// The one model call is OCR of a scanned PDF page, and it uses the model the
// chat turn is running on; the caller passes it in.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { messageAttachments } from "./conversations/uploads.ts";
import { findDocumentBlob } from "./conversations/document-blob-store.ts";
import { findAudioBlob } from "./conversations/audio-blob-store.ts";
import { findVideoBlob } from "./conversations/video-blob-store.ts";
import { findStoredFileBlob } from "./conversations/stored-file-blob-store.ts";
import { storedFileText } from "./conversations/stored-file-text.ts";
import type { StoredFileAttachmentFormat } from "./stored-file-attachments.ts";
import type { DocumentAttachmentFormat } from "./document-attachments.ts";

export const TO_MARKDOWN_TOOL = "to_markdown";
export const TO_MARKDOWN_SKILLS = [
  "document-to-markdown",
  "link-to-markdown",
  "video-to-markdown",
  "audio-to-markdown",
] as const;

/** How far back a "convert the file I sent" may reach. */
const LOOKBACK = 12;

export class ToMarkdownError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ToMarkdownError";
    this.code = code;
    this.status = status;
  }
}

export interface AttachedSource {
  name: string;
  kind: "document" | "audio" | "video" | "file";
  format: string;
  path: string;
}

export interface MarkdownResult {
  title: string;
  markdown: string;
  /** How it was read, for the model and the audit log. */
  method: string;
}

/** This conversation's attachments, newest first, by the name the model was shown. */
export function attachedSources(
  userId: number,
  messages: ReadonlyArray<{ role: string; metadata?: string | null }>,
): AttachedSource[] {
  const found: AttachedSource[] = [];
  const seen = new Set<string>();
  for (const message of [...messages.slice(-LOOKBACK)].reverse()) {
    if (message.role !== "user") continue;
    for (const attachment of messageAttachments(message.metadata ?? null)) {
      if (seen.has(attachment.name)) continue;
      const blobId = "blobId" in attachment ? attachment.blobId : undefined;
      if (!blobId) continue;
      const blob =
        attachment.type === "document" ? findDocumentBlob({ userId, blobId })
        : attachment.type === "audio" ? findAudioBlob({ userId, blobId })
        : attachment.type === "video" ? findVideoBlob({ userId, blobId })
        : attachment.type === "file" ? findStoredFileBlob({ userId, blobId })
        : null;
      if (!blob) continue;
      seen.add(attachment.name);
      found.push({
        name: attachment.name,
        kind: attachment.type as AttachedSource["kind"],
        format: blob.format,
        path: blob.path,
      });
    }
  }
  return found;
}

function pickAttachment(source: string, attachments: readonly AttachedSource[]): AttachedSource {
  const wanted = source.trim().toLowerCase();
  const match =
    attachments.find((entry) => entry.name.toLowerCase() === wanted) ??
    attachments.find((entry) => path.basename(entry.name).toLowerCase() === path.basename(wanted));
  if (match) return match;
  throw new ToMarkdownError(
    "to_markdown_source_not_found",
    attachments.length
      ? `No attachment is named "${source}". Attached: ${attachments.map((entry) => entry.name).join(", ")}.`
      : "Nothing is attached to this conversation and the source is not an http(s) URL. Ask the person to attach the file or paste the link.",
  );
}

function stem(name: string): string {
  return path.parse(name).name || name;
}

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Subtitle cues into paragraphs of about a minute, each led by its timestamp. */
export function cuesToMarkdown(cues: ReadonlyArray<{ start: number; text: string }>, windowSeconds = 60): string {
  const paragraphs: string[] = [];
  let start = -Infinity;
  let words: string[] = [];
  const flush = () => {
    if (words.length) paragraphs.push(`**[${clock(start)}]** ${words.join(" ")}`);
    words = [];
  };
  for (const cue of cues) {
    if (cue.start - start >= windowSeconds) {
      flush();
      start = cue.start;
    }
    words.push(cue.text.trim());
  }
  flush();
  return paragraphs.join("\n\n");
}

async function transcribeFile(input: {
  file: AttachedSource;
  userId: number;
  conversationId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { subsAiInstalled, writeSubtitleFile, parseSrt } = await import("./subsai/transcribe.ts");
  if (!subsAiInstalled()) {
    throw new ToMarkdownError(
      "to_markdown_transcriber_missing",
      "The local transcription engine is not installed. Build it once from the Video Use agent's settings (Build subtitles), then try again.",
      409,
    );
  }
  const destination = path.join(os.tmpdir(), `to-markdown-${randomUUID()}.srt`);
  try {
    await writeSubtitleFile({
      runtimeScope: { userId: input.userId, gardenId: null, conversationId: input.conversationId },
      media: input.file.path,
      format: "srt",
      destination,
      signal: input.signal,
    });
    const cues = parseSrt(fs.readFileSync(destination, "utf8"));
    if (!cues.length) {
      throw new ToMarkdownError("to_markdown_no_speech", `No speech was found in ${input.file.name}.`, 422);
    }
    return cuesToMarkdown(cues);
  } finally {
    fs.rmSync(destination, { force: true });
  }
}

async function readDocumentFile(input: {
  file: AttachedSource;
  userId: number;
  model: string;
  baseURL?: string;
  signal?: AbortSignal;
}): Promise<{ markdown: string; method: string }> {
  const bytes = fs.readFileSync(input.file.path);
  if (input.file.format === "pdf") {
    // Page by page: the text layer where there is one, the chat's model reads
    // the page image where there is not.
    const { readPdfAttachment } = await import("./pdf-attachment-reader.ts");
    const reading = await readPdfAttachment(bytes, {
      userId: input.userId,
      model: input.model,
      baseURL: input.baseURL,
      signal: input.signal,
    });
    return {
      markdown: reading.text.replace(/^\[\[Page (\d+)\]\]$/gm, "<!-- page $1 -->"),
      method: reading.ocrPages.length
        ? `pdf text layer + OCR of ${reading.ocrPages.length} page(s) with ${input.model}`
        : "pdf text layer",
    };
  }
  const { anydocFormatForExtension } = await import("./anydoc/formats.ts");
  if (anydocFormatForExtension(input.file.format)) {
    const { convertWithAnydoc, AnydocUnavailableError } = await import("./anydoc/convert.ts");
    try {
      const converted = await convertWithAnydoc({ bytes, ext: input.file.format });
      return { markdown: converted.markdown, method: "anydoc" };
    } catch (error) {
      if (!(error instanceof AnydocUnavailableError)) throw error;
      // Fall through to the chat's own readers below.
    }
  }
  if (input.file.kind === "file") {
    return {
      markdown: storedFileText({
        name: input.file.name,
        format: input.file.format as StoredFileAttachmentFormat,
        bytes,
      }),
      method: "stored file text",
    };
  }
  const { readDocument } = await import("./document-structure/index.ts");
  return {
    markdown: readDocument(input.file.format as DocumentAttachmentFormat, bytes).markdown,
    method: "document reader",
  };
}

export async function convertToMarkdown(input: {
  source: string;
  title?: string;
  userId: number;
  conversationId: string;
  attachments: readonly AttachedSource[];
  /** The model the chat turn runs on. */
  model: string;
  baseURL?: string;
  /** Watch needs an authorized directory even for a URL. */
  workspaceRoot: string;
  signal?: AbortSignal;
}): Promise<MarkdownResult> {
  const source = input.source.trim();
  if (/^https?:\/\//i.test(source)) {
    const { hasVideoUrl } = await import("./hermes/watch-intent.ts");
    if (hasVideoUrl(source)) {
      const { runWatch } = await import("./hermes/watch-service.ts");
      const result = await runWatch({
        userId: input.userId,
        conversationId: input.conversationId,
        workspaceRoot: input.workspaceRoot,
        signal: input.signal,
        args: {
          source,
          question: "Return the full transcript.",
          detail: "transcript",
          timestamps: [],
          noWhisper: false,
        },
      });
      return {
        title: input.title || source,
        markdown: `Source: <${source}>\n\n${result.report}`,
        method: "video captions or Whisper transcript (Watch)",
      };
    }
    const { convertUrlToMarkdown } = await import("./url-to-markdown.ts");
    const { appendSourceFigures } = await import("./website-to-markdown.ts");
    const page = await convertUrlToMarkdown({ url: source, signal: input.signal });
    const markdown = await appendSourceFigures(page.markdown, page.originalUrl, { signal: input.signal });
    return {
      title: input.title || page.title || source,
      markdown: `Source: <${page.originalUrl}>\n\n${markdown}`,
      method: `web reader (${page.provider})`,
    };
  }

  const file = pickAttachment(source, input.attachments);
  if (file.kind === "audio" || file.kind === "video") {
    return {
      title: input.title || stem(file.name),
      markdown: await transcribeFile({ file, userId: input.userId, conversationId: input.conversationId, signal: input.signal }),
      method: "local Whisper transcript (SubsAI)",
    };
  }
  const read = await readDocumentFile({
    file,
    userId: input.userId,
    model: input.model,
    baseURL: input.baseURL,
    signal: input.signal,
  });
  if (!read.markdown.trim()) {
    throw new ToMarkdownError("to_markdown_empty", `${file.name} produced no text.`, 422);
  }
  return { title: input.title || stem(file.name), markdown: read.markdown, method: read.method };
}
