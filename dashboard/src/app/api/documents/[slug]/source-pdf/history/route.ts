import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type HistoryRecord = {
  id: number;
  source_pdf_path: string;
  pdf_data: Buffer;
  byte_length: number;
  saved_by_user_id: number | null;
  saved_at: string;
};

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
  let segments = cleaned.split("/").map((s) => s.trim()).filter(Boolean);
  const clusterIndex = segments.findIndex((s) => s === cluster);
  if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
  if (segments[0] === "garden" && segments[1] === cluster) segments = segments.slice(2);
  const noteSlug = segments.at(-1);
  if (!noteSlug || noteSlug.toLowerCase() === "index" || noteSlug.toLowerCase() === "_index") {
    return null;
  }
  return noteSlug;
}

function safeClusterDir(contentPath: string, clusterSlug: string): string | null {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, clusterSlug.trim());
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
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

async function getHistoryContext(
  request: Request,
  params: Promise<{ slug: string }>,
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const clusterSlug = searchParams.get("clusterSlug");

  if (!clusterSlug) {
    return NextResponse.json({ error: "clusterSlug is required" }, { status: 400 });
  }

  const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);
  const documentSlug = normalizeDocumentSlug(cluster.slug, slug);
  if (!documentSlug) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  return { clusterId: cluster.id, clusterSlug: cluster.slug, documentSlug, userId };
}

function isContext(
  value: { clusterId: number; clusterSlug: string; documentSlug: string; userId: number } | NextResponse,
): value is { clusterId: number; clusterSlug: string; documentSlug: string; userId: number } {
  return "clusterId" in value;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getHistoryContext(request, params);
    if (!isContext(context)) return context;

    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM pdf_document_edit_history
         WHERE cluster_id = ? AND document_slug = ?`,
      )
      .get(context.clusterId, context.documentSlug) as { count: number };

    return NextResponse.json({ count: row.count });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getHistoryContext(request, params);
    if (!isContext(context)) return context;

    const entry = db
      .prepare(
        `SELECT id, source_pdf_path, pdf_data, byte_length, saved_by_user_id, saved_at
         FROM pdf_document_edit_history
         WHERE cluster_id = ? AND document_slug = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(context.clusterId, context.documentSlug) as HistoryRecord | undefined;

    if (!entry) {
      return NextResponse.json({ error: "No history available" }, { status: 404 });
    }

    const pdfBytes = Buffer.from(entry.pdf_data);
    const restoredAt = new Date().toISOString();

    // Restore to disk — best-effort, never blocks the DB restore
    try {
      const contentPath = process.env.QUARTZ_CONTENT_PATH;
      if (contentPath) {
        const pdfPath = resolveSourcePdfPath(contentPath, context.clusterSlug, entry.source_pdf_path);
        if (pdfPath) {
          fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
          fs.writeFileSync(pdfPath, pdfBytes);
        }
      }
    } catch {
      // Disk sync is best-effort; DB is the source of truth for GET
    }

    // Restore to current in DB (upsert so it works even if current row was deleted)
    db.prepare(
      `INSERT INTO pdf_document_edits
         (cluster_id, document_slug, source_pdf_path, pdf_data, byte_length, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id, document_slug) DO UPDATE SET
         source_pdf_path    = excluded.source_pdf_path,
         pdf_data           = excluded.pdf_data,
         byte_length        = excluded.byte_length,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at         = excluded.updated_at`,
    ).run(
      context.clusterId,
      context.documentSlug,
      entry.source_pdf_path,
      pdfBytes,
      entry.byte_length,
      context.userId,
      restoredAt,
    );

    // Remove this entry from history
    db.prepare(`DELETE FROM pdf_document_edit_history WHERE id = ?`).run(entry.id);

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Length": String(pdfBytes.length),
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
