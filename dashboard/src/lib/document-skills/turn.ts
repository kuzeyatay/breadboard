// What a chat turn does with the documents it can see.
//
// One rule decides everything here: a document big enough that dumping it would
// crowd out the conversation gets distilled into a skill and enters the turn as
// a structured index; anything smaller stays verbatim, because for a two-page
// memo the raw text is both cheaper and more faithful than a distillation of it.
//
// Both chat surfaces call `prepareDocumentContext` and use its two outputs: the
// prompt block for skills, and the attachments that should still be inlined.

import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "../chat-attachments.ts";
import { scanClusterKnowledge, type KnowledgeNode } from "../knowledge.ts";
import { documentSkillContext, ensureDocumentSkill, gardenDocumentText, shouldDistill } from "./service.ts";
import type { DocumentSkillProgress, DocumentSkillRecord } from "./types.ts";

/** Garden pages that are a document rather than authored notes. */
const SOURCE_DOCUMENT_TYPES = new Set(["source-document", "source-index"]);

export interface PrepareDocumentContextInput {
  userId: number;
  /** Canonical conversation public id, or null for the user-global build API. */
  conversationId?: string | null;
  attachments?: readonly ChatAttachment[];
  /** Present for Garden Chat: the documents the user ticked in the sidebar. */
  garden?: {
    clusterSlug: string;
    selectedDocumentSlugs: readonly string[];
  };
  baseURL?: string;
  model?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentSkillProgress & { document: string }) => void;
}

export interface PreparedDocumentContext {
  /** System-prompt block describing every skill in play. Empty when there are none. */
  context: string;
  /** Attachments small enough to keep sending verbatim. */
  inlineAttachments: ChatAttachment[];
  records: DocumentSkillRecord[];
  warnings: string[];
}

function attachmentTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || name;
}

/**
 * Garden source documents the user selected.
 *
 * A selection can name a page that is not a document at all (a note, a lesson);
 * those are left to the existing garden tools, which already handle them well.
 * Only real source documents are worth a skill.
 */
function selectedSourceDocuments(
  contentPath: string,
  clusterSlug: string,
  selectedSlugs: readonly string[],
): KnowledgeNode[] {
  if (selectedSlugs.length === 0) return [];
  const knowledge = scanClusterKnowledge(contentPath, clusterSlug);
  const wanted = new Set(selectedSlugs);
  return knowledge.nodes.filter(
    (node) =>
      wanted.has(node.slug) &&
      (SOURCE_DOCUMENT_TYPES.has(node.type) || Boolean(node.sourceFile) || Boolean(node.sourcePdf)),
  );
}

export async function prepareDocumentContext(
  input: PrepareDocumentContextInput,
): Promise<PreparedDocumentContext> {
  const records: DocumentSkillRecord[] = [];
  const warnings: string[] = [];
  const inlineAttachments: ChatAttachment[] = [];
  const runtimeScope = {
    userId: input.userId,
    gardenId: input.garden?.clusterSlug ?? null,
    conversationId: input.conversationId ?? null,
  };

  const report = (document: string) => (progress: DocumentSkillProgress) =>
    input.onProgress?.({ ...progress, document });

  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "text") {
      inlineAttachments.push(attachment);
      continue;
    }
    if (!shouldDistill(attachment.text)) {
      inlineAttachments.push(attachment);
      continue;
    }
    try {
      const result = await ensureDocumentSkill({
        userId: input.userId,
        text: attachment.text,
        title: attachmentTitle(attachment.name),
        origin: { kind: "upload", fileName: attachment.name },
        runtimeScope,
        baseURL: input.baseURL,
        model: input.model,
        signal: input.signal,
        onProgress: report(attachment.name),
      });
      records.push(result.record);
      warnings.push(...result.warnings);
    } catch (error) {
      // A failed distillation must not cost the user their document: fall back
      // to the behaviour that existed before this feature.
      warnings.push(
        `${attachment.name}: could not be distilled (${
          error instanceof Error ? error.message : "unknown error"
        }); using its raw text instead.`,
      );
      inlineAttachments.push(attachment);
    }
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (input.garden && contentPath && input.garden.selectedDocumentSlugs.length > 0) {
    const documents = selectedSourceDocuments(
      contentPath,
      input.garden.clusterSlug,
      input.garden.selectedDocumentSlugs,
    );
    for (const node of documents) {
      const body = node.content ?? "";
      if (!shouldDistill(body)) continue;
      try {
        const text = await gardenDocumentText(
          contentPath,
          input.garden.clusterSlug,
          node.relPath,
          body,
          node.sourceFile || node.sourcePdf || undefined,
          runtimeScope,
          input.signal,
        );
        const result = await ensureDocumentSkill({
          userId: input.userId,
          text,
          title: node.title || attachmentTitle(node.fileName),
          origin: {
            kind: "garden",
            clusterSlug: input.garden.clusterSlug,
            documentSlug: node.slug,
            fileName: node.sourceFile || node.fileName,
          },
          runtimeScope,
          baseURL: input.baseURL,
          model: input.model,
          signal: input.signal,
          onProgress: report(node.title || node.slug),
        });
        records.push(result.record);
        warnings.push(...result.warnings);
      } catch (error) {
        // The garden tools can still read this page, so the turn is not lost.
        warnings.push(
          `${node.title || node.slug}: could not be distilled (${
            error instanceof Error ? error.message : "unknown error"
          }); the garden tools can still read it.`,
        );
      }
    }
  }

  return {
    context: documentSkillContext(records),
    inlineAttachments,
    records,
    warnings: [...new Set(warnings)],
  };
}

/** True when a garden has a content path configured and readable. */
export function gardenContentPathAvailable(): boolean {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  return Boolean(contentPath && fs.existsSync(path.resolve(contentPath)));
}
