import {
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
import { selectedModelForUser } from "./selected-model.ts";
import { convertUrlToMarkdown, contentHashForMarkdown, normalizeSourceUrl } from "./url-to-markdown.ts";
import { convertWebsiteToMarkdown, websiteCrawlRoot, websiteSnapshotMarkdown, type WebsiteSnapshot } from "./website-to-markdown.ts";
import { captureUrlSourceImages } from "./url-source-images.ts";
import { findExistingUrlSource } from "./url-source-store.ts";

function throwIfCanceled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Link import canceled");
  error.name = "AbortError";
  throw error;
}

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

export async function importGardenLink(input: {
  contentPath: string;
  cluster: { slug: string };
  userId: number;
  baseURL: string;
  url: string;
  title?: string;
  /** Overrides the profile default model for this import. */
  model?: string;
  /** Aborted when the caller cancels; nothing is published after that. */
  signal?: AbortSignal;
  /** Website links include all discoverable same-site pages by default. */
  scope?: "page" | "site" | "section";
  onProgress?: (message: string) => void;
  /** A previously verified crawl, used by resumable local imports. */
  websiteSnapshot?: WebsiteSnapshot;
}) {
  const { contentPath, cluster, userId, baseURL, signal } = input;
  // The profile default, like every other ingest path. A hardcoded product
  // default here sent imports to a model the user had not chosen.
  const model = input.model?.trim() || selectedModelForUser(userId);
  const body = input;
  const scope = input.scope ?? "site";
  const website = scope !== "page"
    ? input.websiteSnapshot ?? await convertWebsiteToMarkdown({ url: body.url, scope, signal, onProgress: input.onProgress })
    : undefined;
  if (website && (!website.complete || website.failures.length || website.pages.length === 0 ||
      website.rootUrl !== websiteCrawlRoot(body.url, scope === "section" ? "section" : "site"))) {
    throw new Error("A complete matching website snapshot is required before importing");
  }
  const websiteMarkdown = website ? websiteSnapshotMarkdown(website) : "";
  const converted = website ? {
    ...website.pages[0],
    originalUrl: normalizeSourceUrl(body.url),
    title: `${body.title?.trim() || website.pages[0].title || new URL(website.rootUrl).hostname} — ${scope === "section" ? "Full Section" : "Full Website"}`,
    markdown: websiteMarkdown,
    contentHash: contentHashForMarkdown(website.rootUrl, websiteMarkdown),
  } : await convertUrlToMarkdown({ url: typeof body.url === "string" ? body.url : "", signal });
  throwIfCanceled(signal);
  const sourceTitle = titleFromInput(
    website ? converted.title : body.title,
    converted.title || fallbackTitleForUrl(converted.originalUrl),
  );
  const existingSource = findExistingUrlSource({
    contentPath,
    clusterSlug: cluster.slug,
    contentHash: converted.contentHash,
    originalUrl: converted.originalUrl,
    importScope: scope,
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
      importScope: scope,
      pageCount: website?.pages.length ?? 1,
      links: readGardenLinks(contentPath, cluster.slug),
    };
  }

  const client = createChatmockClient(baseURL);
  const extractionPages: DocumentPage[] = website
    ? website.pages.map(page => ({ label: page.originalUrl, text: page.markdown }))
    : [{ label: "URL", text: converted.markdown }];
  const imageCapturePromise = captureUrlSourceImages({
    markdown: converted.markdown,
    pageUrl: converted.originalUrl,
    canonicalUrl: converted.canonicalUrl,
    contentHash: converted.contentHash,
    clusterSlug: cluster.slug,
    // Multi-page imports have no aggregate figure/count/deadline cap.
    // Individual downloads retain their size checks, timeouts and cancellation.
    maxImages: website ? Infinity : undefined,
    maxTotalImageBytes: website ? Infinity : undefined,
    captureTimeoutMs: website ? Infinity : undefined,
    signal,
  }).catch(() => ({
    markdown: converted.markdown,
    images: [],
    referencedImageCount: 0,
    warningCount: 1,
  }));
  // A link whose concepts could not be extracted is not a saved link. Saving
  // it anyway produced a source whose "summary" was the first few hundred
  // characters of the page and whose concepts were its headings, which is what
  // made importing a link look like it had worked when it had not.
  const extraction: KnowledgeExtraction = await extractDocumentKnowledge({
    client,
    model,
    title: sourceTitle,
    sourceType: "url",
    sourceLabel: converted.originalUrl,
    pages: extractionPages,
    text: converted.markdown,
    onProgress: input.onProgress,
  });
  throwIfCanceled(signal);
  const captured = await imageCapturePromise;
  throwIfCanceled(signal);
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
    model,
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
    abortSignal: signal,
    onProgress: input.onProgress,
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
      import_scope: scope,
      ...(website ? {
        website_root_url: website.rootUrl,
        website_page_count: String(website.pages.length),
        website_crawl_complete: "true",
        website_page_urls: website.pages.map(page => page.originalUrl),
        website_alias_urls: Object.keys(website.aliases),
      } : {}),
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
    importScope: scope,
    pageCount: website?.pages.length ?? 1,
    links: readGardenLinks(contentPath, cluster.slug),
  };
}
