import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { NextResponse } from "next/server";
import { fileContentResponse } from "@/lib/file-content-response";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimeStat,
} from "@/lib/external-runtime-filesystem";
import {
  documentValidator,
  matchesValidator,
  parseRangeHeader,
  rangeIsStillValid,
} from "@/lib/http-range";
import db from "@/lib/db";
import { contentDisposition } from "@/lib/content-disposition";
import { sourcePdfFileName } from "@/lib/garden-source-display";
import { normalizeDocumentSlug } from "@/lib/garden-document-path";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { readSourceFrontmatter, resolveSourcePdfMarkdownPath } from "@/lib/source-pdf-garden";
import { resolveGardenSourcePdfPath as resolveSourcePdfPath } from "@/lib/garden-source-pdf-path";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type AccessMode = "read" | "write";
type SourcePdfContext = {
  gardenDir: string;
  clusterId: number;
  clusterSlug: string;
  documentSlug: string;
  fileName: string;
  /**
   * The file the viewer reads and writes. An OCR'd upload keeps its original
   * bytes at `source_pdf` for Learn and gets a `searchable_pdf` twin with the
   * text layer; that twin is what people select text in and annotate.
   */
  pdfPath: string;
  sourcePdf: string;
  userId: number;
};
type SourcePdfRecord = {
  id: number;
  byte_length: number;
  updated_at: string;
};

const MAX_PDF_BYTES = 100 * 1024 * 1024;

function safeClusterDir(
  contentPath: string,
  clusterSlug: string,
): string | null {
  const root = path.resolve(/* turbopackIgnore: true */ contentPath);
  const clusterDir = path.resolve(
    /* turbopackIgnore: true */ root,
    clusterSlug.trim(),
  );
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
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
    return NextResponse.json(
      { error: "clusterSlug is required" },
      { status: 400 },
    );
  }

  const { cluster, userId } =
    access === "read"
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
  const requestedDocumentSlug = normalizeDocumentSlug(cluster.slug, slug);
  if (!clusterDir || !requestedDocumentSlug) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Some older source links used the asset-derived slug (for example,
  // `math-1-source-pdf`) instead of the source note slug (`math-1`). Keep
  // those links readable while preferring an exact note match whenever one
  // exists.
  let documentSlug = requestedDocumentSlug;
  let markdownPath = resolveSourcePdfMarkdownPath(clusterDir, documentSlug);
  if (!markdownPath && /-source-pdf$/i.test(documentSlug)) {
    const fallbackSlug = documentSlug.replace(/-source-pdf$/i, "");
    const fallbackPath = resolveSourcePdfMarkdownPath(clusterDir, fallbackSlug);
    if (fallbackPath) {
      documentSlug = fallbackSlug;
      markdownPath = fallbackPath;
    }
  }
  if (
    !markdownPath ||
    !fs.existsSync(/* turbopackIgnore: true */ markdownPath)
  ) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const frontmatter = readSourceFrontmatter(markdownPath);
  const sourcePdf = frontmatter.source_pdf ?? "";
  const originalPath = resolveSourcePdfPath(
    contentPath,
    cluster.slug,
    sourcePdf,
  );
  if (
    !originalPath ||
    !fs.existsSync(/* turbopackIgnore: true */ originalPath)
  ) {
    return NextResponse.json(
      { error: "Source PDF not found" },
      { status: 404 },
    );
  }
  const searchablePath = resolveSourcePdfPath(
    contentPath,
    cluster.slug,
    frontmatter.searchable_pdf ?? "",
  );
  const useSearchable =
    !!searchablePath &&
    fs.existsSync(/* turbopackIgnore: true */ searchablePath);

  return {
    gardenDir: clusterDir,
    clusterId: cluster.id,
    clusterSlug: cluster.slug,
    documentSlug,
    fileName: sourcePdfFileName(frontmatter.source_file || path.basename(originalPath)),
    pdfPath: useSearchable ? searchablePath : originalPath,
    // Saved edits are keyed by the file they were made on, so a restore from
    // history lands on the twin and never on the original.
    sourcePdf: useSearchable ? (frontmatter.searchable_pdf ?? "") : sourcePdf,
    userId,
  };
}

function isSourcePdfContext(
  value: SourcePdfContext | NextResponse,
): value is SourcePdfContext {
  return "pdfPath" in value;
}

function latestSavedPdf(
  context: SourcePdfContext,
): SourcePdfRecord | undefined {
  return db
    .prepare(
      `SELECT id, length(pdf_data) AS byte_length, updated_at
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

/** Headers every PDF response carries, whatever its source or range. */
function pdfHeaders(context: SourcePdfContext, validator: string): Headers {
  return new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(context.fileName),
    // The viewer must always see the current document, but an unchanged one
    // revalidates to a 304 instead of being sent again (IO-04/IO-05).
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Accept-Ranges": "bytes",
    ETag: validator,
  });
}

function notModified(headers: Headers): Response {
  return new Response(null, { status: 304, headers });
}

function unsatisfiableRange(headers: Headers, size: number): Response {
  headers.set("Content-Range", `bytes */${size}`);
  return new Response(null, { status: 416, headers });
}

/** A document with an unsaved or saved local edit, held in the database. */
function savedPdfResponse(
  request: Request,
  context: SourcePdfContext,
  savedPdf: SourcePdfRecord,
): Response {
  const size = savedPdf.byte_length;
  const validator = documentValidator({
    size,
    modifiedAtMs: Date.parse(String(savedPdf.updated_at ?? "")) || 0,
    revision: "db",
  });
  const headers = pdfHeaders(context, validator);
  headers.set("X-PDF-Source", "database");
  if (matchesValidator(request.headers.get("if-none-match"), validator)) {
    return notModified(headers);
  }
  const requested = rangeIsStillValid(request.headers.get("if-range"), validator)
    ? parseRangeHeader(request.headers.get("range"), size)
    : ({ kind: "whole" } as const);
  if (requested.kind === "unsatisfiable") {
    return unsatisfiableRange(headers, size);
  }
  if (requested.kind === "range") {
    const { start, end } = requested.range;
    const length = end - start + 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(length));
    const slice = request.method === "HEAD" ? null : db.prepare(
      "SELECT substr(pdf_data, ?, ?) FROM pdf_document_edits WHERE id = ?",
    ).pluck().get(start + 1, length, savedPdf.id) as Buffer<ArrayBuffer>;
    return new Response(slice, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  const body = request.method === "HEAD" ? null : db.prepare(
    "SELECT pdf_data FROM pdf_document_edits WHERE id = ?",
  ).pluck().get(savedPdf.id) as Buffer<ArrayBuffer>;
  return new Response(body, { headers });
}

/** The stored document, streamed rather than read whole into memory. */
function storedPdfResponse(request: Request, context: SourcePdfContext): Response {
  const stats = externalRuntimeStat(context.pdfPath);
  const size = stats.size;
  const validator = documentValidator({ size, modifiedAtMs: stats.mtimeMs });
  const headers = pdfHeaders(context, validator);
  headers.set("X-PDF-Source", "file");
  return fileContentResponse(request, context.pdfPath, size, headers);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getSourcePdfContext(request, params, "read");
    if (!isSourcePdfContext(context)) return context;

    // Keep the validator and the requested bytes in the same SQLite snapshot
    // if another tab saves an edit while a reader is seeking.
    const saved = db.transaction(() => {
      const record = latestSavedPdf(context);
      return record ? savedPdfResponse(request, context, record) : null;
    })();
    return saved ?? storedPdfResponse(request, context);
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
      return NextResponse.json(
        { error: "PDF payload is required" },
        { status: 400 },
      );
    }
    if (pdfBytes.length > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF payload is too large" },
        { status: 413 },
      );
    }
    if (!isPdf(pdfBytes)) {
      return NextResponse.json(
        { error: "Payload is not a PDF" },
        { status: 400 },
      );
    }

    const gardenDir = context.gardenDir;
    const lease = acquireGardenMutationLease(gardenDir, "update-source-pdf", {
      paths: [path.relative(gardenDir, context.pdfPath)],
    });
    const updatedAt = new Date().toISOString();
    try {
      // Push current version to history before overwriting — isolated so any failure never blocks the save
      try {
        db.prepare(
          `
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
      `,
        ).run(
          context.clusterId,
          context.documentSlug,
          context.clusterId,
          context.documentSlug,
        );

        // Immutable revisions are deduplicated by idle storage maintenance.
        // Saving a new revision must not silently discard an older undo point.
      } catch {
        // History push is best-effort; never block the main save
      }

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
    } finally {
      lease.release();
    }
    void publishQuartzAfterMutation(
      `update source PDF ${context.clusterSlug}/${context.documentSlug}`,
      { userId: context.userId, gardenSlug: context.clusterSlug },
    ).catch(error => console.error("[garden] PDF saved; publication failed:", error));
    return NextResponse.json({ success: true, slug: context.documentSlug, byteLength: pdfBytes.length, updatedAt });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
