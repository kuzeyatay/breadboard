// Bridge from the transcription pipeline into Breadboard's existing source
// ingestion: the same writeDocumentKnowledge flow used by uploads and URL
// imports registers the transcript Markdown under sources/, creates concept
// scaffolding, refreshes the cluster index, and republishes Quartz. ChatMock is
// only used for the surrounding knowledge extraction (topics/summary) with a
// deterministic fallback — it never rewrites the transcript itself.

import {
  DEFAULT_MODEL,
  createChatmockClient,
  extractDocumentKnowledge,
  refreshClusterIndex,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "../knowledge";
import { publishQuartzAfterMutation } from "../quartz-publish";
import { sourceSlugExists } from "./video-source-store";
import { deterministicTitleSuffix } from "./transcript-markdown";

export interface TranscriptIngestInput {
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
  /** Display filename or canonical URL — the visible source identity. */
  sourceFileName: string;
  sourceLabel: string;
  markdownBody: string;
  plainText: string;
  metadata: Record<string, string | string[]>;
  youtubeVideoId?: string | null;
  mediaSha256?: string | null;
  jobId: string;
  onProgress?: (step: string) => void;
}

export interface TranscriptIngestResult {
  sourceSlug: string;
  sourceRelPath: string;
  sourceTitle: string;
  wordCount: number;
}

function fallbackExtraction(
  title: string,
  plainText: string,
): KnowledgeExtraction {
  const summary = plainText.trim()
    ? plainText.trim().replace(/\s+/g, " ").slice(0, 300)
    : `Imported video transcript ${title}.`;
  return {
    documentTitle: title,
    summary,
    topics: [],
    relationships: [],
    suggestedTags: [],
  };
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

  let extraction: KnowledgeExtraction;
  try {
    extraction = await extractDocumentKnowledge({
      client,
      model: DEFAULT_MODEL,
      title: input.sourceTitle,
      sourceType: "video",
      sourceLabel: input.sourceLabel,
      pages,
      text: input.plainText,
      onProgress: input.onProgress,
    });
  } catch {
    // ChatMock being down must not block the faithful transcript source.
    extraction = fallbackExtraction(input.sourceTitle, input.plainText);
  }

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
    model: DEFAULT_MODEL,
    contentPath: input.contentPath,
    clusterSlug: input.clusterSlug,
    sourceTitle,
    sourceFileName: input.sourceFileName,
    sourceType: "video",
    sourceLabel: input.sourceLabel,
    markdownText: input.markdownBody,
    plainText: input.plainText,
    pages,
    extraction,
    sourceMetadata: input.metadata,
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
  contentPath,
  clusterSlug,
}: {
  contentPath: string;
  clusterSlug: string;
}): Promise<void> {
  refreshClusterIndex(contentPath, clusterSlug);
  await publishQuartzAfterMutation(`re-index video transcript in ${clusterSlug}`);
}
