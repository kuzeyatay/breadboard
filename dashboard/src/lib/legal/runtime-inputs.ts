import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ChatAttachment } from "../chat-attachments.ts";
import { describeDocumentSummary } from "../document-attachments.ts";
import {
  documentFiguresDirectory,
  findDocumentBlob,
  listDocumentFigures,
} from "../conversations/document-blob-store.ts";
import { ApiError } from "../hermes/route-core.ts";
import type { OuterAgentRuntimeBlobInput } from "../runtime-v2/outer-agent-run.ts";
import {
  createLegalRuntimeBundleInput,
  type LegalBundleSource,
} from "./runtime-attachment-bundle.ts";

export interface LegalRuntimeContentManifest {
  readonly taskBytes: number;
  readonly memoryBytes: number;
  readonly conversationBytes: number;
}

export type LegalRuntimeAttachmentManifest =
  | {
      readonly kind: "document";
      readonly name: string;
      readonly format: "docx" | "xlsx" | "pptx" | "pdf" | "odt" | "ods" | "odp";
      readonly inputIndex: number;
      readonly description: string;
      readonly editable: boolean;
      readonly hasExtractedText: boolean;
      readonly figures: readonly string[];
    }
  | { readonly kind: "text"; readonly name: string; readonly inputIndex: number }
  | { readonly kind: "image"; readonly name: string; readonly inputIndex: number }
  | {
      readonly kind: "skipped";
      readonly name: string;
      readonly reason: "unreadable-document" | "oversized-image" | "unsupported";
      readonly attachmentType: "document" | "image" | "video" | "audio" | "model" | "product";
    };

export interface PreparedLegalRuntimeInputs {
  readonly content: LegalRuntimeContentManifest;
  readonly attachments: readonly LegalRuntimeAttachmentManifest[];
  readonly inputBlobs: readonly OuterAgentRuntimeBlobInput[];
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 8 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 2 * 1024 * 1024 * 1024;

function bufferInput(
  displayName: string,
  bytes: Buffer,
): OuterAgentRuntimeBlobInput {
  return {
    displayName,
    mediaType: "application/octet-stream",
    sizeBytes: bytes.byteLength,
    stream: () => Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
  };
}

function fileInput(
  displayName: string,
  filePath: string,
): OuterAgentRuntimeBlobInput {
  const direct = path.resolve(filePath);
  const metadata = fs.lstatSync(direct);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The Legal Agent attachment is not a direct file.");
  }
  return {
    displayName,
    mediaType: "application/octet-stream",
    sizeBytes: metadata.size,
    stream: () => Readable.toWeb(fs.createReadStream(direct)) as ReadableStream<Uint8Array>,
  };
}

function validFigurePaths(userId: number, blobId: string, names: readonly string[]): Array<{
  name: string;
  filePath: string;
}> {
  const directory = documentFiguresDirectory({ userId, blobId });
  let canonicalDirectory: string;
  try {
    canonicalDirectory = fs.realpathSync.native(directory);
  } catch {
    return [];
  }
  const prefix = canonicalDirectory.endsWith(path.sep)
    ? canonicalDirectory
    : `${canonicalDirectory}${path.sep}`;
  const figures: Array<{ name: string; filePath: string }> = [];
  for (const name of names) {
    if (!/^figure-\d{1,4}\.[a-z0-9]{1,5}$/iu.test(name)) continue;
    try {
      const direct = path.resolve(canonicalDirectory, name);
      const metadata = fs.lstatSync(direct);
      const canonical = fs.realpathSync.native(direct);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        !canonical.startsWith(prefix)
      ) continue;
      figures.push({ name, filePath: canonical });
    } catch {
      // A missing derived figure degrades this document exactly as before.
    }
  }
  return figures;
}

/**
 * Resolve attachment ownership in Next, then turn bytes into Runtime uploads.
 * The returned request manifest contains only fixed input ordinals and bounded
 * metadata; source paths and document contents never enter request JSON.
 */
export function prepareLegalRuntimeInputs(input: {
  readonly userId: number;
  readonly task: string;
  readonly memoryContext: string;
  readonly conversationContext: string;
  readonly attachments: readonly ChatAttachment[];
}): PreparedLegalRuntimeInputs {
  const task = Buffer.from(input.task, "utf8");
  const memory = Buffer.from(input.memoryContext, "utf8");
  const conversation = Buffer.from(input.conversationContext, "utf8");
  const sources: LegalBundleSource[] = [
    { kind: "task", attachmentIndex: null, name: null, bytes: task },
    ...(memory.byteLength
      ? [{ kind: "memory" as const, attachmentIndex: null, name: null, bytes: memory }]
      : []),
    ...(conversation.byteLength
      ? [{ kind: "conversation" as const, attachmentIndex: null, name: null, bytes: conversation }]
      : []),
  ];
  const manifests: LegalRuntimeAttachmentManifest[] = [];
  const rawInputs: OuterAgentRuntimeBlobInput[] = [];

  for (let attachmentIndex = 0; attachmentIndex < input.attachments.length; attachmentIndex += 1) {
    const attachment = input.attachments[attachmentIndex]!;
    if (attachment.type === "document") {
      const blob = findDocumentBlob({ userId: input.userId, blobId: attachment.blobId });
      if (!blob) {
        manifests.push({
          kind: "skipped",
          name: attachment.name,
          reason: "unreadable-document",
          attachmentType: "document",
        });
        continue;
      }
      const inputIndex = rawInputs.length + 1;
      rawInputs.push(fileInput(`legal-attachment-${inputIndex}.bin`, blob.path));
      const extracted = Buffer.from((attachment.text ?? "").trim(), "utf8");
      if (extracted.byteLength) {
        sources.push({
          kind: "document-text",
          attachmentIndex,
          name: null,
          bytes: extracted,
        });
      }
      const requestedFigures = attachment.figures?.length
        ? attachment.figures
        : listDocumentFigures({ userId: input.userId, blobId: attachment.blobId });
      const figures = validFigurePaths(input.userId, attachment.blobId, requestedFigures);
      for (const figure of figures) {
        sources.push({
          kind: "document-figure",
          attachmentIndex,
          name: figure.name,
          filePath: figure.filePath,
        });
      }
      manifests.push({
        kind: "document",
        name: attachment.name,
        format: blob.format,
        inputIndex,
        description: describeDocumentSummary(attachment.summary),
        editable: blob.format !== "pdf",
        hasExtractedText: extracted.byteLength > 0,
        figures: figures.map((figure) => figure.name),
      });
      continue;
    }

    if (attachment.type === "text") {
      const bytes = Buffer.from(attachment.text.slice(0, MAX_TEXT_CHARS), "utf8");
      const inputIndex = rawInputs.length + 1;
      rawInputs.push(bufferInput(`legal-attachment-${inputIndex}.bin`, bytes));
      manifests.push({ kind: "text", name: attachment.name, inputIndex });
      continue;
    }

    if (attachment.type === "image") {
      const comma = attachment.dataUrl.indexOf(",");
      const bytes = Buffer.from(attachment.dataUrl.slice(comma + 1), "base64");
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        manifests.push({
          kind: "skipped",
          name: attachment.name,
          reason: "oversized-image",
          attachmentType: "image",
        });
        continue;
      }
      const inputIndex = rawInputs.length + 1;
      rawInputs.push(bufferInput(`legal-attachment-${inputIndex}.bin`, bytes));
      manifests.push({ kind: "image", name: attachment.name, inputIndex });
      continue;
    }

    manifests.push({
      kind: "skipped",
      name: attachment.name,
      reason: "unsupported",
      attachmentType: attachment.type,
    });
  }

  const bundle = createLegalRuntimeBundleInput(sources);
  const inputBlobs = [bundle, ...rawInputs];
  const totalBytes = inputBlobs.reduce((total, entry) => total + entry.sizeBytes, 0);
  if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
    throw new ApiError(
      413,
      "payload_too_large",
      "The Legal Agent attachments exceed the Runtime input limit.",
    );
  }
  return {
    content: {
      taskBytes: task.byteLength,
      memoryBytes: memory.byteLength,
      conversationBytes: conversation.byteLength,
    },
    attachments: manifests,
    inputBlobs,
  };
}
