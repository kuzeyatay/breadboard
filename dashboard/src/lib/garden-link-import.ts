import {
  DEFAULT_MODEL,
  createChatmockClient,
  extractDocumentKnowledge,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "./knowledge.ts";

import {
  addGardenLink,
  readGardenLinks,
} from "./garden-links.ts";
import { convertUrlToMarkdown } from "./url-to-markdown.ts";
import { captureUrlSourceImages } from "./url-source-images.ts";
import { findExistingUrlSource } from "./url-source-store.ts";

function titleFromInput(value: unknown, fallback: string): string {
  const title = typeof value === "string" ? value.trim() : "";
  return (title || fallback).slice(0, 180);
}

function fallbackTitleForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathTitle = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, " ")
      .trim();
    return pathTitle || parsed.hostname || url;
  } catch {
    return url;
  }
}

function fallbackExtraction(
  title: string,
  markdown: string,
): KnowledgeExtraction {
  const summary = markdown.trim()
    ? markdown.trim().replace(/\s+/g, " ").slice(0, 300)
    : `Imported URL source ${title}.`;
  return {
    documentTitle: title,
    summary,
    topics: [],
    relationships: [],
    suggestedTags: [],
  };
}

export async function importGardenLink(input: {
  contentPath: string;
  cluster: { slug: string };
  userId: number;
  baseURL: string;
  url: string;
  title?: string;
}) {
  const { contentPath, cluster, userId, baseURL } = input;
  const body = input;
  const converted = await convertUrlToMarkdown({
    url: typeof body.url === "string" ? body.url : "",
  });
  const sourceTitle = titleFromInput(
    body.title,
    converted.title || fallbackTitleForUrl(converted.originalUrl),
  );
  const existingSource = findExistingUrlSource({
    contentPath,
    clusterSlug: cluster.slug,
    contentHash: converted.contentHash,
    originalUrl: converted.originalUrl,
  });

  if (existingSource) {
    const link = addGardenLink(contentPath, cluster.slug, {
      title: sourceTitle,
      url: converted.originalUrl,
      sourceSlug: existingSource.sourceSlug,
      sourceRelPath: existingSource.sourceRelPath,
      contentHash: converted.contentHash,
      importedAt: converted.fetchedAt,
      provider: converted.provider,
    });
    return {
      success: true,
      duplicate: true,
      link,
      source: existingSource,
      links: readGardenLinks(contentPath, cluster.slug),
    };
  }

  const client = createChatmockClient(baseURL);
  const extractionPages: DocumentPage[] = [
    { label: "URL", text: converted.markdown },
  ];
  const imageCapturePromise = captureUrlSourceImages({
    markdown: converted.markdown,
    pageUrl: converted.originalUrl,
    canonicalUrl: converted.canonicalUrl,
    contentHash: converted.contentHash,
    clusterSlug: cluster.slug,
  }).catch(() => ({
    markdown: converted.markdown,
    images: [],
    referencedImageCount: 0,
    warningCount: 1,
  }));
  let extraction: KnowledgeExtraction;
  try {
    extraction = await extractDocumentKnowledge({
      client,
      model: DEFAULT_MODEL,
      title: sourceTitle,
      sourceType: "url",
      sourceLabel: converted.originalUrl,
      pages: extractionPages,
      text: converted.markdown,
    });
  } catch {
    extraction = fallbackExtraction(sourceTitle, converted.markdown);
  }
  const captured = await imageCapturePromise;
  const pages: DocumentPage[] = [
    { label: "URL", text: captured.markdown },
    ...captured.images.map((image, index) => ({
      label: image.alt || `Embedded figure ${index + 1}`,
      text: image.context || image.alt,
      imagePath: image.publicPath,
      imageAlt: image.alt,
    })),
  ];

  const sourceFileName = `${slugify(sourceTitle) || "url-source"}.url.md`;
  const saved = await writeDocumentKnowledge({
    client,
    model: DEFAULT_MODEL,
    contentPath,
    clusterSlug: cluster.slug,
    sourceTitle,
    sourceFileName,
    sourceType: "url",
    sourceLabel: converted.originalUrl,
    markdownText: captured.markdown,
    plainText: captured.markdown,
    pages,
    extraction,
    publicationUserId: userId,
    sourceAssets: captured.images.map((image) => ({
      relativePath: image.relativePath,
      bytes: image.bytes,
    })),
    sourceMetadata: {
      original_url: converted.originalUrl,
      canonical_url: converted.canonicalUrl ?? "",
      fetched_at: converted.fetchedAt,
      converter: converted.provider,
      content_hash: converted.contentHash,
      reader_content_type: converted.contentType ?? "",
      image_capture_completed: "true",
      captured_image_count: String(captured.images.length),
      referenced_image_count: String(captured.referencedImageCount),
      image_capture_warning_count: String(captured.warningCount),
      source_image_urls: captured.images.map((image) => image.originalUrl),
    },
  });

  const link = addGardenLink(contentPath, cluster.slug, {
    title: sourceTitle,
    url: converted.originalUrl,
    sourceSlug: saved.sourceSlug,
    sourceRelPath: saved.sourceRelPath,
    contentHash: converted.contentHash,
    importedAt: converted.fetchedAt,
    provider: converted.provider,
  });

  return {
    success: true,
    link,
    source: {
      sourceSlug: saved.sourceSlug,
      sourceRelPath: saved.sourceRelPath,
      sourceTitle: saved.sourceTitle,
      wordCount: saved.wordCount,
    },
    capturedImages: captured.images.length,
    referencedImages: captured.referencedImageCount,
    imageCaptureWarnings: captured.warningCount,
    links: readGardenLinks(contentPath, cluster.slug),
  };
}
