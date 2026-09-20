// Bridge from the transcription pipeline into Breadboard's existing source
// ingestion: the same writeDocumentKnowledge flow used by uploads and URL
// imports registers the transcript Markdown under sources/, creates concept
// scaffolding, refreshes the cluster index, and republishes Quartz. ChatMock is
// only used for the surrounding knowledge extraction (topics/summary) — it
// never rewrites the transcript itself, and when it cannot produce a map the
// job fails instead of publishing a source whose summary is really the opening
// words of the transcript.

import path from "node:path";

import {
  createChatmockClient,
  extractDocumentKnowledge,
  refreshClusterIndex,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "../knowledge.ts";
import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import { acquireGardenMutationLease } from "../garden-mutation-lease.ts";
import { publishQuartzAfterMutation } from "../quartz-publish.ts";
import { sourceSlugExists } from "./video-source-store.ts";
import { deterministicTitleSuffix } from "./transcript-markdown.ts";

export interface TranscriptIngestInput {
  /** Authenticated owner persisted with the transcription job. */
  userId: number;
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
  /** Display filename or canonical URL — the visible source identity. */
  sourceFileName: string;
  sourceLabel: string;
  markdownBody: string;
  plainText: string;
  metadata: Record<string, string | string[]>;
  mediaKind: "audio" | "video";
  youtubeVideoId?: string | null;
  mediaSha256?: string | null;
  /** Retained upload to copy into the Garden before the temp file is removed. */
  mediaFilePath?: string | null;
  jobId: string;
  onProgress?: (step: string) => void;
}

export interface TranscriptIngestResult {
  sourceSlug: string;
  sourceRelPath: string;
  sourceTitle: string;
  wordCount: number;
}

/**
 * Choose the source title so its slug is deterministic on collision: when a
 * different source already owns slugify(title), append a suffix derived from
 * the video ID / media hash / job ID instead of a timestamp.
 */
export function resolveCollisionFreeTitle(input: {
  contentPath: string;
  clusterSlug: string;
  title: string;
  youtubeVideoId?: string | null;
  mediaSha256?: string | null;
  jobId: string;
}): string {
  const baseSlug = slugify(input.title);
  if (!baseSlug || !sourceSlugExists(input.contentPath, input.clusterSlug, baseSlug)) {
    return input.title;
  }
  const suffix = deterministicTitleSuffix({
    youtubeVideoId: input.youtubeVideoId,
    mediaSha256: input.mediaSha256,
    jobId: input.jobId,
  });
  return `${input.title} ${suffix}`;
}

export async function ingestTranscriptSource(
  input: TranscriptIngestInput,
): Promise<TranscriptIngestResult> {
  const client = createChatmockClient();
  const pages: DocumentPage[] = [
    { label: "Transcript", text: input.plainText },
  ];

  const extraction: KnowledgeExtraction = await extractDocumentKnowledge({
    client,
    model: GLOBAL_MODEL_SENTINEL,
    title: input.sourceTitle,
    sourceType: input.mediaKind,
    sourceLabel: input.sourceLabel,
    pages,
    text: input.plainText,
    onProgress: input.onProgress,
  });

  const sourceTitle = resolveCollisionFreeTitle({
    contentPath: input.contentPath,
    clusterSlug: input.clusterSlug,
    title: input.sourceTitle,
    youtubeVideoId: input.youtubeVideoId,
    mediaSha256: input.mediaSha256,
    jobId: input.jobId,
  });

  const saved = await writeDocumentKnowledge({
    client,
    model: GLOBAL_MODEL_SENTINEL,
    contentPath: input.contentPath,
    clusterSlug: input.clusterSlug,
    sourceTitle,
    sourceFileName: input.sourceFileName,
    sourceType: input.mediaKind,
    sourceLabel: input.sourceLabel,
    markdownText: input.markdownBody,
    plainText: input.plainText,
    pages,
    extraction,
    sourceMetadata: input.metadata,
    sourceMedia:
      input.mediaFilePath && input.mediaSha256
        ? { filePath: input.mediaFilePath, sha256: input.mediaSha256 }
        : undefined,
    publicationUserId: input.userId,
    onProgress: input.onProgress,
  });

  return {
    sourceSlug: saved.sourceSlug,
    sourceRelPath: saved.sourceRelPath,
    sourceTitle: saved.sourceTitle,
    wordCount: saved.wordCount,
  };
}

/**
 * Finish indexing for a job whose Markdown was already written but whose
 * indexing/publish step failed. Never re-transcribes and never rewrites the
 * source file.
 */
export async function resumeTranscriptIndexing({
  userId,
  contentPath,
  clusterSlug,
}: {
  userId: number;
  contentPath: string;
  clusterSlug: string;
}): Promise<void> {
  const lease = acquireGardenMutationLease(
    path.join(contentPath, clusterSlug),
    "reindex-video-transcript",
  );
  try {
    refreshClusterIndex(contentPath, clusterSlug);
  } finally {
    lease.release();
  }
  await publishQuartzAfterMutation(`re-index video transcript in ${clusterSlug}`, {
    userId,
    gardenSlug: clusterSlug,
  });
}
