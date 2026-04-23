import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type Frontmatter = Record<string, string>;
type AccessMode = "read" | "write";
type SourcePdfContext = {
  clusterId: number;
  clusterSlug: string;
  documentSlug: string;
  fileName: string;
  pdfPath: string;
  sourcePdf: string;
  userId: number;
};
type SourcePdfRecord = {
  pdf_data: Buffer;
  byte_length: number;
  updated_at: string;
};

const MAX_PDF_BYTES = 100 * 1024 * 1024;

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

function normalizeDocumentSlug(clusterSlug: string, slug: string): string | null {
  const cluster = clusterSlug.trim();
  const cleaned = decodeSlug(slug)
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .trim();
  let segments = cleaned.split("/").map((segment) => segment.trim()).filter(Boolean);
  const clusterIndex = segments.findIndex((segment) => segment === cluster);
  if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
  if (segments[0] === "garden" && segments[1] === cluster) segments = segments.slice(2);
  const noteSlug = segments.at(-1);
  if (!noteSlug || noteSlug.toLowerCase() === "index" || noteSlug.toLowerCase() === "_index") {
    return null;
  }
  return noteSlug;
}

function parseYamlString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const data: Frontmatter = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = parseYamlString(line.slice(index + 1));
    data[key] = value;
  }
  return data;
}

function safeClusterDir(contentPath: string, clusterSlug: string): string | null {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, clusterSlug.trim());
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
}

function resolveMarkdownPath(clusterDir: string, slug: string): string | null {
  if (!slug || slug.includes("/") || slug.includes("\\")) return null;
  const filePath = path.resolve(clusterDir, `${slug}.md`);
  if (!filePath.startsWith(clusterDir + path.sep)) return null;
  return filePath;
}

function resolveSourcePdfPath(
  contentPath: string,
  clusterSlug: string,
  sourcePdf: string,
): string | null {
  const clusterDir = safeClusterDir(contentPath, clusterSlug);
  if (!clusterDir) return null;

  const normalized = sourcePdf.trim().replace(/\\/g, "/");
  const prefix = `/${clusterSlug.trim()}/assets/`;
  if (!normalized.startsWith(prefix)) return null;

  const assetName = normalized.slice(prefix.length);
  if (!assetName || assetName.includes("/") || !assetName.toLowerCase().endsWith(".pdf")) {
    return null;
  }

  const pdfPath = path.resolve(clusterDir, "assets", assetName);
  if (!pdfPath.startsWith(clusterDir + path.sep)) return null;
  return pdfPath;
}

function contentDispositionName(value: string): string {
  return value.replace(/[\r\n"]/g, "_") || "document.pdf";
}

async function getSourcePdfContext(
  request: Request,
  params: Promise<{ slug: string }>,
  access: AccessMode,
): Promise<SourcePdfContext | NextResponse> {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const clusterSlug = searchParams.get("clusterSlug");

  if (!clusterSlug) {
    return NextResponse.json({ error: "clusterSlug is required" }, { status: 400 });
  }

  const { cluster, userId } = access === "read"
    ? await requireReadableClusterFromSlug(clusterSlug)
    : await requireOwnedClusterFromSlug(clusterSlug);
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return NextResponse.json(
      { error: "QUARTZ_CONTENT_PATH not configured" },
      { status: 500 },
    );
  }

  const clusterDir = safeClusterDir(contentPath, cluster.slug);
  const documentSlug = normalizeDocumentSlug(cluster.slug, slug);
  if (!clusterDir || !documentSlug) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const markdownPath = resolveMarkdownPath(clusterDir, documentSlug);
  if (!markdownPath || !fs.existsSync(markdownPath)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const frontmatter = parseFrontmatter(fs.readFileSync(markdownPath, "utf-8"));
  const sourcePdf = frontmatter.source_pdf ?? "";
  const pdfPath = resolveSourcePdfPath(contentPath, cluster.slug, sourcePdf);
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return NextResponse.json({ error: "Source PDF not found" }, { status: 404 });
  }

  return {
    clusterId: cluster.id,
    clusterSlug: cluster.slug,
    documentSlug,
    fileName: contentDispositionName(frontmatter.source_file ?? path.basename(pdfPath)),
    pdfPath,
    sourcePdf,
    userId,
  };
}

function isSourcePdfContext(
  value: SourcePdfContext | NextResponse,
): value is SourcePdfContext {
  return "pdfPath" in value;
}

function latestSavedPdf(context: SourcePdfContext): SourcePdfRecord | undefined {
  return db
    .prepare(
      `SELECT pdf_data, byte_length, updated_at
       FROM pdf_document_edits
       WHERE cluster_id = ? AND document_slug = ? AND source_pdf_path = ?`,
    )
    .get(context.clusterId, context.documentSlug, context.sourcePdf) as
    | SourcePdfRecord
    | undefined;
}

function isPdf(bytes: Buffer): boolean {
  return bytes.length > 5 && bytes.subarray(0, 5).toString("utf-8") === "%PDF-";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getSourcePdfContext(request, params, "read");
    if (!isSourcePdfContext(context)) return context;

    const savedPdf = latestSavedPdf(context);
    const pdfBytes = savedPdf
      ? Buffer.from(savedPdf.pdf_data)
      : fs.readFileSync(context.pdfPath);

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${context.fileName}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Length": String(pdfBytes.length),
        "X-PDF-Source": savedPdf ? "database" : "file",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getSourcePdfContext(request, params, "write");
    if (!isSourcePdfContext(context)) return context;

    const arrayBuffer = await request.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);
    if (pdfBytes.length === 0) {
      return NextResponse.json({ error: "PDF payload is required" }, { status: 400 });
    }
    if (pdfBytes.length > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF payload is too large" }, { status: 413 });
    }
    if (!isPdf(pdfBytes)) {
      return NextResponse.json({ error: "Payload is not a PDF" }, { status: 400 });
    }

    // Push current version to history before overwriting — isolated so any failure never blocks the save
    try {
      db.prepare(`
        INSERT INTO pdf_document_edit_history
          (cluster_id, document_slug, source_pdf_path, pdf_data, byte_length, saved_by_user_id, saved_at)
        SELECT cluster_id, document_slug, source_pdf_path, pdf_data, byte_length, updated_by_user_id, updated_at
        FROM pdf_document_edits
        WHERE cluster_id = ? AND document_slug = ?
          AND NOT EXISTS (
            SELECT 1 FROM pdf_document_edit_history h
            WHERE h.cluster_id = ? AND h.document_slug = ?
              AND h.saved_at > datetime('now', '-30 seconds')
          )
      `).run(context.clusterId, context.documentSlug, context.clusterId, context.documentSlug);

      db.prepare(`
        DELETE FROM pdf_document_edit_history
        WHERE cluster_id = ? AND document_slug = ?
          AND id NOT IN (
            SELECT id FROM pdf_document_edit_history
            WHERE cluster_id = ? AND document_slug = ?
            ORDER BY id DESC
            LIMIT 50
          )
      `).run(context.clusterId, context.documentSlug, context.clusterId, context.documentSlug);
    } catch {
      // History push is best-effort; never block the main save
    }

    const updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(context.pdfPath), { recursive: true });
    fs.writeFileSync(context.pdfPath, pdfBytes);
    db.prepare(
      `INSERT INTO pdf_document_edits (
         cluster_id,
         document_slug,
         source_pdf_path,
         pdf_data,
         byte_length,
         updated_by_user_id,
         updated_at
       )
       VALUES (
         ?,
         ?,
         ?,
         ?,
         ?,
         ?,
         ?
       )
       ON CONFLICT(cluster_id, document_slug) DO UPDATE SET
         source_pdf_path = excluded.source_pdf_path,
         pdf_data = excluded.pdf_data,
         byte_length = excluded.byte_length,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`,
    ).run(
      context.clusterId,
      context.documentSlug,
      context.sourcePdf,
      pdfBytes,
      pdfBytes.length,
      context.userId,
      updatedAt,
    );
    await publishQuartzAfterMutation(
      `update source PDF ${context.clusterSlug}/${context.documentSlug}`,
    );

    return NextResponse.json({
      success: true,
      slug: context.documentSlug,
      byteLength: pdfBytes.length,
      updatedAt,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
