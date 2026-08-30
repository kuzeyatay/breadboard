import { NextResponse } from "next/server";
import {
  DEFAULT_MODEL,
  createChatmockClient,
  extractDocumentKnowledge,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "@/lib/knowledge";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  addGardenLink,
  deleteGardenLink,
  readGardenLinks,
} from "@/lib/garden-links";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";
import { convertUrlToMarkdown } from "@/lib/url-to-markdown";
import { captureUrlSourceImages } from "@/lib/url-source-images";
import { findExistingUrlSource } from "@/lib/url-source-store";

export const dynamic = "force-dynamic";

function contentPathOrResponse(): string | NextResponse {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return NextResponse.json(
      { error: "QUARTZ_CONTENT_PATH not configured" },
      { status: 500 },
    );
  }
  return contentPath;
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireReadableClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    return NextResponse.json({
      links: readGardenLinks(contentPath, cluster.slug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster, userId } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    const rawBody = await request.json().catch(() => ({}));
    const body =
      rawBody && typeof rawBody === "object"
        ? (rawBody as Record<string, unknown>)
        : {};
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
      return NextResponse.json({
        success: true,
        duplicate: true,
        link,
        source: existingSource,
        links: readGardenLinks(contentPath, cluster.slug),
      });
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
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

    return NextResponse.json({
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save link";
    if (
      message === "Link URL is required" ||
      message === "Enter a valid link URL" ||
      message === "Only HTTP and HTTPS links are supported"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (
      message.includes("Jina Reader") ||
      message.includes("Reader returned") ||
      message.includes("Reader timed out") ||
      message.includes("Reader returned empty Markdown")
    ) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return routeErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    const body = await request.json().catch(() => ({}));
    const deleted = deleteGardenLink(contentPath, cluster.slug, body.id);

    return NextResponse.json({
      success: true,
      deleted,
      links: readGardenLinks(contentPath, cluster.slug),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete link";
    if (message === "Link id is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}
