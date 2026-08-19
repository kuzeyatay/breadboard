// Turning "here is a document" into "here are the pages that answer this".
//
// This runs on the newest user message, at the three server entry points that
// already resolve document attachments. For every attached document with a
// usable index it asks ColPali which pages look like an answer, and rewrites
// the attachment into those pages: their text where the extraction marks page
// boundaries, and their pictures always.
//
// The pictures are the point. ColPali ranks pages by what they *look* like, so
// the page it returns is often one whose text says nothing useful — a chart, a
// scanned table, a diagram with the numbers in it. Sending back only the text
// of such a page would retrieve the right page and then throw away the reason
// it was right.
//
// Everything degrades to today's behaviour. No index, a stale one, a service
// that is down, a format with no renderer, a question that arrives while the
// document is still being read — each returns the attachment untouched, whole
// text and all.

import { colpaliMode, colpaliModel, colpaliTopK } from "./config.ts";
import { indexIsUsable, readIndexStatus } from "./index-status.ts";
import { readCachedPage } from "./indexer.ts";
import { colpaliSearch } from "./service.ts";
import { findDocumentBlob } from "../conversations/document-blob-store.ts";
import type { ChatAttachment } from "../chat-attachments.ts";

/**
 * Page markers the extractors leave behind.
 *
 * A PDF is read by `/api/extract-text`, which writes `[[Page 7]]`; a deck is
 * read by `document-structure/pptx.ts`, which writes `## Slide 7`. A Word file
 * and a workbook have neither, and correctly so — a .docx has no pages until
 * something paginates it. Where there is no marker the text cannot be split by
 * page, so it is left whole and only the pictures are added.
 */
const PAGE_MARKER = /^(?:\[\[Page (\d+)\]\]|## Slide (\d+)(?::.*)?)\s*$/gm;

interface PageSlice {
  pageNumber: number;
  text: string;
}

export function splitTextByPage(text: string): PageSlice[] | null {
  const marks: Array<{ pageNumber: number; start: number; bodyStart: number }> = [];
  PAGE_MARKER.lastIndex = 0;
  for (let match = PAGE_MARKER.exec(text); match !== null; match = PAGE_MARKER.exec(text)) {
    const pageNumber = Number.parseInt(match[1] ?? match[2] ?? "", 10);
    if (!Number.isInteger(pageNumber)) continue;
    marks.push({ pageNumber, start: match.index, bodyStart: match.index + match[0].length });
  }
  if (marks.length === 0) return null;

  return marks.map((mark, index) => ({
    pageNumber: mark.pageNumber,
    text: text.slice(mark.start, index + 1 < marks.length ? marks[index + 1].start : undefined).trim(),
  }));
}

function retrievedText(
  name: string,
  fullText: string,
  pages: readonly number[],
): string {
  const slices = splitTextByPage(fullText);
  if (slices === null) return fullText;

  const wanted = new Set(pages);
  const kept = slices.filter((slice) => wanted.has(slice.pageNumber));
  if (kept.length === 0) return fullText;

  // Kept in document order, not in score order. A model reading three pages of
  // a contract should meet them the way the contract does; the ranking has
  // already done its job by choosing which three.
  kept.sort((left, right) => left.pageNumber - right.pageNumber);

  // The header is not decoration. Without it the model cannot tell a document
  // it has been given in full from one it has been given three pages of, and
  // will answer "the document does not mention X" with total confidence.
  const header =
    `# ${name}\n\n_Showing the ${kept.length} page${kept.length === 1 ? "" : "s"} of ` +
    `${slices.length} most relevant to the question, chosen by visual page search. ` +
    `Each page's image is attached. Ask again to search the rest._`;
  return [header, ...kept.map((slice) => slice.text)].join("\n\n");
}

/**
 * Rewrites document attachments into their retrieved pages.
 *
 * Call after `resolveDocumentAttachments`, which is what guarantees `text` is
 * populated and the blob belongs to this user.
 */
export async function retrieveDocumentAttachments(
  userId: number,
  attachments: readonly ChatAttachment[],
  query: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatAttachment[]> {
  if (colpaliMode(env) === "disabled") return [...attachments];
  if (!query.trim()) return [...attachments];
  if (!attachments.some((attachment) => attachment.type === "document")) {
    return [...attachments];
  }

  const modelId = colpaliModel(env);
  const topK = colpaliTopK(env);
  const rewritten: ChatAttachment[] = [];
  // Page images ride at the end of the list rather than beside their document.
  // `attachmentOrderManifest` numbers attachments so that "the third
  // screenshot" resolves to the user's third screenshot; pages inserted inline
  // would renumber the files the person actually attached.
  const pageImages: ChatAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.type !== "document") {
      rewritten.push(attachment);
      continue;
    }

    const blob = findDocumentBlob({ userId, blobId: attachment.blobId });
    if (!blob) {
      rewritten.push(attachment);
      continue;
    }

    const status = readIndexStatus(blob.path);
    if (!indexIsUsable(status, modelId)) {
      rewritten.push(attachment);
      continue;
    }

    const found = await colpaliSearch(attachment.blobId, query, env, topK);
    if (!found.ok || found.pages.length === 0) {
      rewritten.push(attachment);
      continue;
    }

    const pageNumbers = found.pages.map((page) => page.pageNumber);
    const text = attachment.text?.trim()
      ? retrievedText(attachment.name, attachment.text, pageNumbers)
      : attachment.text ?? "";

    rewritten.push({ ...attachment, text });

    for (const pageNumber of [...pageNumbers].sort((left, right) => left - right)) {
      const base64 = await readCachedPage(blob.path, pageNumber);
      if (!base64) continue;
      pageImages.push({
        type: "image",
        // Named for where it came from, because the model is about to be shown
        // a picture with no other context: "page 12 of supply.pdf" is the
        // difference between a citation and a guess.
        name: `${attachment.name} — page ${pageNumber}`,
        dataUrl: `data:image/png;base64,${base64}`,
      });
    }
  }

  return [...rewritten, ...pageImages];
}
