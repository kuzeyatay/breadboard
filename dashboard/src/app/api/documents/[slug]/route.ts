import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import db from "@/lib/db";
import {
  normalizeTopicTags,
  refreshClusterIndex,
  walkClusterMarkdown,
} from "@/lib/knowledge";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
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

function decodeSlug(value: string): string {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function candidateSlugInputs(slug: string): string[] {
  const decoded = decodeSlug(slug);
  const candidates = [decoded];

  try {
    const url = new URL(decoded, "http://second-brain.local");
    const note = url.searchParams.get("note");
    if (note) candidates.unshift(decodeSlug(note));
    candidates.push(url.pathname);
  } catch {
    // Plain slugs are handled by the decoded candidate.
  }

  return [...new Set(candidates)];
}

function normalizeDocumentSlug(
  clusterSlug: string,
  slug: string,
): string | null {
  const cluster = clusterSlug.trim();

  for (const candidate of candidateSlugInputs(slug)) {
    const cleaned = candidate
      .replace(/\\/g, "/")
      .replace(/[?#].*$/, "")
      .replace(/\.md$/i, "")
      .trim();
    let segments = cleaned
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const clusterIndex = segments.findIndex((segment) => segment === cluster);
    if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
    if (segments[0] === "garden" && segments[1] === cluster)
      segments = segments.slice(2);
    if (segments.length === 0) continue;

    const noteSlug = segments.at(-1);
    if (!noteSlug) continue;
    if (
      noteSlug.toLowerCase() === "index" ||
      noteSlug.toLowerCase() === "_index"
    )
      return null;
    return noteSlug;
  }

  return null;
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
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const titleLine = (match[1] ?? "")
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("title:"));
  if (!titleLine) return "";
  return titleLine
    .slice(titleLine.indexOf(":") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    return parseYamlArray(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
}

/** Split a note into its frontmatter block (without trailing newlines) and body. */
function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = content.match(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: content };
  return {
    frontmatter: match[1] ?? "",
    body: (match[2] ?? "").replace(/^\r?\n/, ""),
  };
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const data: Frontmatter = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    data[key] = parseYamlValue(value);
  }
  return data;
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

function updateFrontmatterValue(
  content: string,
  key: string,
  value: string,
): string {
  const field = `${key}: ${JSON.stringify(value)}`;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return value ? `---\n${field}\n---\n\n${content}` : content;
  }

  const body = content.slice(match[0].length).replace(/^\r?\n/, "");
  const lines = (match[1] ?? "").split(/\r?\n/);
  let found = false;
  const nextLines: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith(`${key}:`)) {
      found = true;
      if (value) nextLines.push(field);
    } else {
      nextLines.push(line);
    }
  }

  if (!found && value) nextLines.push(field);

  return `---\n${nextLines.join("\n").trimEnd()}\n---\n\n${body}`;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\r/g, ""));
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => yamlQuote(value)).join(", ")}]`;
}

function updateFrontmatterArrayValue(
  content: string,
  key: string,
  values: string[],
): string {
  const field = `${key}: ${yamlArray(values)}`;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return values.length > 0 ? `---\n${field}\n---\n\n${content}` : content;
  }

  const body = content.slice(match[0].length).replace(/^\r?\n/, "");
  const lines = (match[1] ?? "").split(/\r?\n/);
  let found = false;
  const nextLines: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith(`${key}:`)) {
      found = true;
      if (values.length > 0) nextLines.push(field);
    } else {
      nextLines.push(line);
    }
  }

  if (!found && values.length > 0) nextLines.push(field);

  return `---\n${nextLines.join("\n").trimEnd()}\n---\n\n${body}`;
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
  try {
    const authorized =
      access === "read"
        ? await requireReadableClusterFromSlug(clusterSlug)
        : await requireOwnedClusterFromSlug(clusterSlug);
    const { cluster } = authorized;
    userId = authorized.userId;
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
    lease = acquireGardenMutationLease(gardenDir, "update-document");
  } catch (error) {
    return routeErrorResponse(error);
  }
  try {
    let content = fs.readFileSync(context.filePath, "utf-8");
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
      const { frontmatter } = splitFrontmatter(content);
      const nextBody = body.body.replace(/^\s+/, "");
      content = frontmatter ? `${frontmatter}\n\n${nextBody}` : nextBody;
    }

    let title = frontmatterTitle(content);
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

    fs.writeFileSync(context.filePath, content, "utf-8");
    refreshClusterIndex(context.contentPath, context.clusterSlug);
    await publishQuartzAfterMutation(
      `update document ${context.clusterSlug}/${context.slug}`,
      { userId: context.userId, gardenSlug: context.clusterSlug },
    );

    return json({ success: true, slug: context.slug, title, flagColor, tags });
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
  const { body } = splitFrontmatter(content);
  return json({
    success: true,
    slug: context.slug,
    fileName: path.basename(context.filePath),
    content,
    title: frontmatterTitle(content),
    tags: frontmatterArrayValue(parseFrontmatter(content), "semanticHints"),
    body,
  });
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
    lease = acquireGardenMutationLease(clusterDir, "delete-document");
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
      for (const slug of deletePlan.slugs) {
        const found = entryBySlug.get(slug);
        if (!found || !fs.existsSync(found.filePath)) continue;
        fs.unlinkSync(found.filePath);
        deletedSlugs.push(slug);
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
      return json({ error: "Failed to delete document" }, { status: 500 });
    }

    refreshClusterIndex(context.contentPath, context.clusterSlug);
    await publishQuartzAfterMutation(
      `delete document ${context.clusterSlug}/${context.slug}`,
      { userId: context.userId, gardenSlug: context.clusterSlug },
    );
    return json({ success: true, slug: context.slug, deletedSlugs });
  } finally {
    lease.release();
  }
}
