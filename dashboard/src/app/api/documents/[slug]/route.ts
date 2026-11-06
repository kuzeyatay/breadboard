import { readQuartzMetadata, updateQuartzMetadata } from "@/lib/quartz-document-metadata";
import { NextResponse } from "next/server";
import { quartzDocumentRevision, quartzDocumentParts } from "@/lib/quartz-document-revision";
import { decodeSlug, normalizeDocumentSlug } from "@/lib/garden-document-path";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs, externalRuntimePortableRealpath } from "@/lib/external-runtime-filesystem";
import db from "@/lib/db";
import { pageFlagColor } from "@/lib/page-understanding-types.ts";
import { markdownFolderTitle } from "@/lib/markdown-folder-title.ts";
import {
  normalizeTopicTags,
  refreshClusterIndex,
  walkClusterMarkdown,
} from "@/lib/knowledge";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease, assertGardenMutationWritePaths } from "@/lib/garden-mutation-lease";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type Frontmatter = Record<string, string | string[]>;

function json(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...API_HEADERS,
      ...init?.headers,
    },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

function frontmatterTitle(content: string): string {
  const value = readQuartzMetadata(content).title;
  return typeof value === "string" ? value : "";
}
function parseFrontmatter(content: string): Frontmatter {
  return readQuartzMetadata(content) as Frontmatter;
}

function frontmatterStringValue(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function frontmatterArrayValue(data: Frontmatter, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
}

function safeClusterDir(
  contentPath: string,
  clusterSlug: string,
): string | null {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, clusterSlug.trim());
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
}

function resolveDocument(
  contentPath: string,
  clusterSlug: string,
  slug: string,
): { slug: string; filePath: string; relPath: string } | null {
  const clusterDir = safeClusterDir(contentPath, clusterSlug);
  if (!clusterDir) return null;

  const noteSlug = normalizeDocumentSlug(clusterSlug, slug);
  if (!noteSlug) return null;

  // Note identity is the basename; the file may live in any sub-folder.
  const entries = walkClusterMarkdown(clusterDir);
  const candidateSlugs = new Set([
    noteSlug,
    slugify(noteSlug),
    slugify(decodeSlug(slug)),
  ]);

  for (const entry of entries) {
    const fileSlug = entry.entry.replace(/\.md$/i, "");
    if (candidateSlugs.has(fileSlug) || candidateSlugs.has(slugify(fileSlug))) {
      return {
        slug: fileSlug,
        filePath: entry.filePath,
        relPath: entry.relPath,
      };
    }
  }

  for (const entry of entries) {
    const title = frontmatterTitle(fs.readFileSync(entry.filePath, "utf-8"));
    if (title && candidateSlugs.has(slugify(title))) {
      const fileSlug = entry.entry.replace(/\.md$/i, "");
      return {
        slug: fileSlug,
        filePath: entry.filePath,
        relPath: entry.relPath,
      };
    }
  }

  // Not found on disk: fall back to the root path so callers 404 cleanly.
  const filePath = path.resolve(clusterDir, `${noteSlug}.md`);
  if (!filePath.startsWith(clusterDir + path.sep)) return null;
  return { slug: noteSlug, filePath, relPath: `${noteSlug}.md` };
}

function updateFrontmatterValue(content: string, key: string, value: string): string {
  return updateQuartzMetadata(content, key, value || null);
}
function updateFrontmatterArrayValue(content: string, key: string, values: string[]): string {
  return updateQuartzMetadata(content, key, values.length ? values : null);
}

function removePathInside(root: string, target: string): void {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  if (!targetPath.startsWith(rootPath + path.sep)) return;
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

// `relSlug` is the note's path relative to the cluster dir, without the `.md`
// extension (e.g. "caches/direct-mapped"). For root-level notes it is just the slug.
function removeQuartzPublicArtifacts(
  contentPath: string,
  clusterSlug: string,
  relSlug: string,
): void {
  const publicRoot = path.resolve(contentPath, "..", "public");
  const clusterPublicDir = path.resolve(publicRoot, clusterSlug.trim());
  if (!clusterPublicDir.startsWith(publicRoot + path.sep)) return;

  removePathInside(
    clusterPublicDir,
    path.join(clusterPublicDir, `${relSlug}.html`),
  );
  removePathInside(
    clusterPublicDir,
    path.join(clusterPublicDir, `${relSlug}-og-image.webp`),
  );
  removePathInside(clusterPublicDir, path.join(clusterPublicDir, relSlug));
}

function contentAssetPath(
  contentPath: string,
  clusterSlug: string,
  assetUrl: string,
): string | null {
  const clusterDir = safeClusterDir(contentPath, clusterSlug);
  if (!clusterDir) return null;

  const normalized = assetUrl.trim().replace(/\\/g, "/");
  const prefix = `/${clusterSlug.trim()}/assets/`;
  if (!normalized.startsWith(prefix)) return null;

  const assetName = normalized.slice(prefix.length);
  if (!assetName || assetName.includes("/")) return null;

  const assetPath = path.resolve(clusterDir, "assets", assetName);
  if (!assetPath.startsWith(clusterDir + path.sep)) return null;
  return assetPath;
}

function removeQuartzPublicAsset(
  contentPath: string,
  clusterSlug: string,
  assetUrl: string,
): void {
  const publicRoot = path.resolve(contentPath, "..", "public");
  const clusterPublicDir = path.resolve(publicRoot, clusterSlug.trim());
  if (!clusterPublicDir.startsWith(publicRoot + path.sep)) return;

  const normalized = assetUrl.trim().replace(/\\/g, "/");
  const prefix = `/${clusterSlug.trim()}/assets/`;
  if (!normalized.startsWith(prefix)) return;

  const assetName = normalized.slice(prefix.length);
  if (!assetName || assetName.includes("/")) return;
  removePathInside(
    clusterPublicDir,
    path.join(clusterPublicDir, "assets", assetName),
  );
}

function documentsToDeleteForSource(
  contentPath: string,
  clusterSlug: string,
  sourceSlug: string,
  sourceData: Frontmatter,
): { slugs: string[]; assetUrls: string[] } {
  const clusterDir = safeClusterDir(contentPath, clusterSlug);
  if (!clusterDir || !fs.existsSync(clusterDir)) {
    return {
      slugs: [sourceSlug],
      assetUrls: [
        ...frontmatterArrayValue(sourceData, "source_images"),
        frontmatterStringValue(sourceData, "source_pdf"),
        frontmatterStringValue(sourceData, "source_presentation"),
        frontmatterStringValue(sourceData, "source_media"),
      ].filter(Boolean),
    };
  }

  const sourceFile = frontmatterStringValue(sourceData, "source_file");
  const slugs = new Set<string>([
    sourceSlug,
    ...frontmatterArrayValue(sourceData, "topics"),
  ]);
  const assetUrls = new Set<string>(
    frontmatterArrayValue(sourceData, "source_images"),
  );
  const sourcePdf = frontmatterStringValue(sourceData, "source_pdf");
  if (sourcePdf) assetUrls.add(sourcePdf);
  const sourcePresentation = frontmatterStringValue(sourceData, "source_presentation");
  if (sourcePresentation) assetUrls.add(sourcePresentation);
  const sourceMedia = frontmatterStringValue(sourceData, "source_media");
  if (sourceMedia) assetUrls.add(sourceMedia);

  for (const item of walkClusterMarkdown(clusterDir)) {
    const slug = item.entry.replace(/\.md$/i, "");
    const filePath = item.filePath;

    const data = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
    const sourceDocument = frontmatterStringValue(data, "source_document");
    const topicSourceFile = frontmatterStringValue(data, "source_file");

    if (
      slug === sourceSlug ||
      sourceDocument === sourceSlug ||
      (sourceFile && topicSourceFile === sourceFile)
    ) {
      slugs.add(slug);
      for (const assetUrl of frontmatterArrayValue(data, "source_images"))
        assetUrls.add(assetUrl);
    }
  }

  return { slugs: [...slugs], assetUrls: [...assetUrls] };
}

async function getDocumentRequestContext(
  request: Request,
  params: Promise<{ slug: string }>,
  access: "read" | "write",
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const clusterSlug = searchParams.get("clusterSlug");

  if (!clusterSlug) {
    return {
      error: json({ error: "clusterSlug is required" }, { status: 400 }),
    };
  }
  if (!slug) {
    return { error: json({ error: "slug is required" }, { status: 400 }) };
  }

  let clusterId: number;
  let ownedClusterSlug: string;
  let userId: number;
  let canEdit = false;
  try {
    const authorized =
      access === "read"
        ? await requireReadableClusterFromSlug(clusterSlug)
        : await requireOwnedClusterFromSlug(clusterSlug);
    const { cluster } = authorized;
    userId = authorized.userId;
    canEdit = cluster.user_id === userId;
    clusterId = cluster.id;
    ownedClusterSlug = cluster.slug;
  } catch (error) {
    return { error: routeErrorResponse(error) };
  }

  const normalizedSlug = normalizeDocumentSlug(ownedClusterSlug, slug);
  if (!normalizedSlug) {
    return {
      error: json({ error: "Document path is not editable" }, { status: 400 }),
    };
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return {
      error: json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      ),
    };
  }

  const document = resolveDocument(
    contentPath,
    ownedClusterSlug,
    normalizedSlug,
  );
  if (!document) {
    return { error: json({ error: "Invalid path" }, { status: 400 }) };
  }

  if (!fs.existsSync(document.filePath)) {
    return { error: json({ error: "Document not found" }, { status: 404 }) };
  }

  return {
    clusterId,
    userId,
    canEdit,
    slug: document.slug,
    clusterSlug: ownedClusterSlug,
    contentPath,
    filePath: document.filePath,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const context = await getDocumentRequestContext(request, params, "write");
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({}));
  const gardenDir = path.resolve(context.contentPath, context.clusterSlug);
  let lease: ReturnType<typeof acquireGardenMutationLease>;
  try {
    lease = acquireGardenMutationLease(gardenDir, "update-document", {
      paths: [path.relative(externalRuntimePortableRealpath(gardenDir), externalRuntimePortableRealpath(context.filePath))],
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
  try {
    let content = fs.readFileSync(context.filePath, "utf-8");
    const previousContent = content;
    const previousRevision = quartzDocumentRevision(content);
    if (body.baseRevision !== undefined && body.baseRevision !== previousRevision) {
      return json({ error: "This page changed since your last save.", revision: previousRevision,
        body: quartzDocumentParts(content).body, title: frontmatterTitle(content) || context.slug,
        tags: frontmatterArrayValue(parseFrontmatter(content), "semanticHints") }, { status: 409 });
    }
    let tags = frontmatterArrayValue(
      parseFrontmatter(content),
      "semanticHints",
    );

    if (Object.prototype.hasOwnProperty.call(body, "content")) {
      if (typeof body.content !== "string") {
        return json({ error: "content must be a string" }, { status: 400 });
      }
      content = body.content;
    } else if (Object.prototype.hasOwnProperty.call(body, "body")) {
      // Replace only the note body, preserving hidden frontmatter (date,
      // knowledge_type, etc.). Title/tags below still edit the frontmatter.
      if (typeof body.body !== "string") {
        return json({ error: "body must be a string" }, { status: 400 });
      }
      content = quartzDocumentParts(content).prefix + body.body;
    }

    let title = frontmatterTitle(content) || context.slug;
    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      if (typeof body.title !== "string") {
        return json({ error: "title must be a string" }, { status: 400 });
      }
      title = body.title.trim().replace(/\s+/g, " ").slice(0, 160);
      if (!title) {
        return json({ error: "title cannot be empty" }, { status: 400 });
      }
      content = updateFrontmatterValue(content, "title", title);
    }

    let flagColor = "";
    if (Object.prototype.hasOwnProperty.call(body, "flagColor")) {
      flagColor =
        typeof body.flagColor === "string" ? body.flagColor.trim() : "";
      if (flagColor && !/^#[0-9a-fA-F]{6}$/.test(flagColor)) {
        return json(
          { error: "flagColor must be a hex color like #facc15" },
          { status: 400 },
        );
      }
      if (flagColor && !pageFlagColor(flagColor)) {
        return json({ error: "Green is reserved for understood pages. Use the understanding checkbox." }, { status: 400 });
      }
      content = updateFrontmatterValue(content, "flag_color", flagColor);
    }

    if (Object.prototype.hasOwnProperty.call(body, "tags")) {
      if (
        !Array.isArray(body.tags) ||
        body.tags.some((tag: unknown) => typeof tag !== "string")
      ) {
        return json(
          { error: "tags must be an array of strings" },
          { status: 400 },
        );
      }
      tags = normalizeTopicTags(
        body.tags.map((tag: string) => tag.trim()),
        content,
        5,
        `${frontmatterTitle(content)}\n${content}`,
      );
      content = updateFrontmatterArrayValue(content, "tags", []);
      content = updateFrontmatterArrayValue(content, "semanticHints", tags);
    }

    if (content === previousContent) return json({ success: true, slug: context.slug, title, flagColor, tags, revision: previousRevision });
    fs.writeFileSync(context.filePath, content, "utf-8");
    refreshClusterIndex(context.contentPath, context.clusterSlug, { migrateSources: false });
    lease.release();
    void publishQuartzAfterMutation(
      `update document ${context.clusterSlug}/${context.slug}`,
      { userId: context.userId, gardenSlug: context.clusterSlug },
    ).catch(error => console.error("[garden] Document saved; publication failed:", error));

    return json({ success: true, slug: context.slug, title, flagColor, tags, revision: quartzDocumentRevision(content) });
  } finally {
    lease.release();
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const context = await getDocumentRequestContext(request, params, "read");
  if ("error" in context) return context.error;

  const content = fs.readFileSync(context.filePath, "utf-8");
  const { body } = quartzDocumentParts(content);
  const reader = new URL(request.url).searchParams.get("render") === "1"
    ? await (await import("@/lib/generated/quartz-reader.mjs")).renderQuartzDocument({
        content,
        relativePath: path.relative(externalRuntimePortableRealpath(context.contentPath), externalRuntimePortableRealpath(context.filePath)).replace(/\\/g, "/"),
        contentRoot: externalRuntimePortableRealpath(context.contentPath).replace(/\\/g, "/"),
        allFiles: walkClusterMarkdown(context.contentPath).map(page => page.relPath),
      })
    : undefined;
  return json({
    success: true,
    revision: quartzDocumentRevision(content),
    canEdit: context.canEdit,
    accountId: String(context.userId),
    slug: context.slug,
    fileName: path.basename(context.filePath),
    sourceSlug: path.relative(context.contentPath, context.filePath).replace(/\\/g, "/").replace(/\.md$/i, ""),
    content,
    title: frontmatterTitle(content) || context.slug,
    folderTitle: markdownFolderTitle(context.contentPath, context.filePath),
    tags: frontmatterArrayValue(parseFrontmatter(content), "semanticHints"),
    body,
    reader,
  });
}

/** Render draft objects through Quartz without writing a file or publishing. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const context = await getDocumentRequestContext(request, params, "write");
  if ("error" in context) return context.error;
  const input = await request.json().catch(() => null);
  if (!Array.isArray(input?.fragments) || input.fragments.length > 32 ||
      input.fragments.some((item: unknown) => !item || typeof item !== "object" || typeof (item as { source?: unknown }).source !== "string") ||
      JSON.stringify(input).length > 10_000_000) return json({ error: "Invalid preview request" }, { status: 400 });
  const { renderQuartzDocument } = await import("@/lib/generated/quartz-reader.mjs");
  const shared = {
    relativePath: path.relative(externalRuntimePortableRealpath(context.contentPath), externalRuntimePortableRealpath(context.filePath)).replace(/\\/g, "/"),
    contentRoot: externalRuntimePortableRealpath(context.contentPath).replace(/\\/g, "/"),
    allFiles: walkClusterMarkdown(context.contentPath).map(page => page.relPath),
  };
  const fragments = [];
  for (const item of input.fragments) {
    const reader = await renderQuartzDocument({ ...shared, content: item.source });
    fragments.push({ id: item.id, html: reader.html });
  }
  return json({ success: true, fragments });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const context = await getDocumentRequestContext(request, params, "write");
  if ("error" in context) return context.error;

  const clusterDir = safeClusterDir(context.contentPath, context.clusterSlug);
  if (!clusterDir) return json({ error: "Invalid path" }, { status: 400 });

  let lease: ReturnType<typeof acquireGardenMutationLease>;
  try {
    const beforeDelete = parseFrontmatter(fs.readFileSync(context.filePath, "utf-8"));
    lease = acquireGardenMutationLease(clusterDir, "delete-document", {
      // Source deletion can cascade into managed documents and assets.
      paths: frontmatterStringValue(beforeDelete, "knowledge_type") === "source-document"
        ? undefined
        : [path.relative(externalRuntimePortableRealpath(clusterDir), externalRuntimePortableRealpath(context.filePath))],
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
  try {
    const data = parseFrontmatter(fs.readFileSync(context.filePath, "utf-8"));
    const knowledgeType = frontmatterStringValue(data, "knowledge_type");
    const isSourceDocument = knowledgeType === "source-document";
    const deletePlan = isSourceDocument
      ? documentsToDeleteForSource(
          context.contentPath,
          context.clusterSlug,
          context.slug,
          data,
        )
      : {
          slugs: [context.slug],
          assetUrls: frontmatterArrayValue(data, "source_images"),
        };

    const deletedSlugs: string[] = [];
    const deletedPaths: string[] = [];

    // Resolve each basename slug to its on-disk location (any sub-folder).
    const entryBySlug = new Map<
      string,
      { filePath: string; relPath: string }
    >();
    for (const item of walkClusterMarkdown(clusterDir)) {
      entryBySlug.set(item.entry.replace(/\.md$/i, ""), {
        filePath: item.filePath,
        relPath: item.relPath,
      });
    }

    try {
      assertGardenMutationWritePaths(lease, clusterDir, [
        ...deletePlan.slugs.map(slug => entryBySlug.get(slug)?.relPath ?? ""),
        ...(isSourceDocument ? ["sources"] : []),
      ]);
      for (const slug of deletePlan.slugs) {
        const found = entryBySlug.get(slug);
        if (!found || !fs.existsSync(found.filePath)) continue;
        fs.unlinkSync(found.filePath);
        deletedSlugs.push(slug);
        deletedPaths.push(found.relPath);
        removeQuartzPublicArtifacts(
          context.contentPath,
          context.clusterSlug,
          found.relPath.replace(/\.md$/i, ""),
        );
      }

      if (deletedSlugs.length === 0) {
        return json({ error: "Document not found" }, { status: 404 });
      }

      if (isSourceDocument) {
        for (const assetUrl of deletePlan.assetUrls) {
          const assetPath = contentAssetPath(
            context.contentPath,
            context.clusterSlug,
            assetUrl,
          );
          if (assetPath) removePathInside(clusterDir, assetPath);
          removeQuartzPublicAsset(
            context.contentPath,
            context.clusterSlug,
            assetUrl,
          );
        }
      }

      const deleteSavedPdf = db.prepare(
        "DELETE FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?",
      );
      for (const slug of deletePlan.slugs) {
        deleteSavedPdf.run(context.clusterId, slug);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return json({ error: "Document not found" }, { status: 404 });
      }
      return json(
        { error: `Failed to delete document: ${(err as Error).message}` },
        { status: 500 },
      );
    }

    refreshClusterIndex(context.contentPath, context.clusterSlug, { migrateSources: false });
    lease.release();
    void publishQuartzAfterMutation(
      `delete document ${context.clusterSlug}/${context.slug}`,
      { userId: context.userId, gardenSlug: context.clusterSlug },
    ).catch(error => console.error("[garden] Document deleted; publication failed:", error));
    return json({ success: true, slug: context.slug, deletedSlugs, deletedPaths });
  } finally {
    lease.release();
  }
}
