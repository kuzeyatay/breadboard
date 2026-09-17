import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";
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
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import { resolveSourcePdfMarkdownPath } from "@/lib/source-pdf-garden";
import { resolveGardenSourcePdfPath as resolveSourcePdfPath } from "@/lib/garden-source-pdf-path";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type Frontmatter = Record<string, string>;
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

function normalizeDocumentSlug(
  clusterSlug: string,
  slug: string,
): string | null {
  const cluster = clusterSlug.trim();
  const cleaned = decodeSlug(slug)
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .trim();
  let segments = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const clusterIndex = segments.findIndex((segment) => segment === cluster);
  // A bare document slug can legitimately equal the garden slug (for
  // example, the Math 1 source note is `math-1` in garden `math-1`). Only
  // remove the garden prefix when another path segment follows it.
  if (clusterIndex > 0 || (clusterIndex === 0 && segments.length > 1)) {
    segments = segments.slice(clusterIndex + 1);
  }
  if (segments[0] === "garden" && segments[1] === cluster)
    segments = segments.slice(2);
  const noteSlug = segments.at(-1);
  if (
    !noteSlug ||
    noteSlug.toLowerCase() === "index" ||
    noteSlug.toLowerCase() === "_index"
  ) {
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

  const frontmatter = parseFrontmatter(
    fs.readFileSync(/* turbopackIgnore: true */ markdownPath, "utf-8"),
  );
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
    fileName: contentDispositionName(
      frontmatter.source_file ?? path.basename(originalPath),
    ),
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

/** Headers every PDF response carries, whatever its source or range. */
function pdfHeaders(context: SourcePdfContext, validator: string): Headers {
  return new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${context.fileName}"`,
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
  const bytes = Buffer.from(savedPdf.pdf_data);
  const validator = documentValidator({
    size: bytes.length,
    modifiedAtMs: Date.parse(String(savedPdf.updated_at ?? "")) || 0,
    revision: "db",
  });
  const headers = pdfHeaders(context, validator);
  headers.set("X-PDF-Source", "database");
  if (matchesValidator(request.headers.get("if-none-match"), validator)) {
    return notModified(headers);
  }
  const requested = rangeIsStillValid(request.headers.get("if-range"), validator)
    ? parseRangeHeader(request.headers.get("range"), bytes.length)
    : ({ kind: "whole" } as const);
  if (requested.kind === "unsatisfiable") {
    return unsatisfiableRange(headers, bytes.length);
  }
  if (requested.kind === "range") {
    const { start, end } = requested.range;
    headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
  }
  headers.set("Content-Length", String(bytes.length));
  return new Response(bytes, { headers });
}

/** The stored document, streamed rather than read whole into memory. */
function storedPdfResponse(request: Request, context: SourcePdfContext): Response {
  const stats = externalRuntimeStat(context.pdfPath);
  const size = stats.size;
  const validator = documentValidator({ size, modifiedAtMs: stats.mtimeMs });
  const headers = pdfHeaders(context, validator);
  headers.set("X-PDF-Source", "file");
  if (matchesValidator(request.headers.get("if-none-match"), validator)) {
    return notModified(headers);
  }
  const requested = rangeIsStillValid(request.headers.get("if-range"), validator)
    ? parseRangeHeader(request.headers.get("range"), size)
    : ({ kind: "whole" } as const);
  if (requested.kind === "unsatisfiable") return unsatisfiableRange(headers, size);

  const range = requested.kind === "range"
    ? requested.range
    : { start: 0, end: Math.max(0, size - 1) };
  if (requested.kind === "range") {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }
  headers.set("Content-Length", String(size === 0 ? 0 : range.end - range.start + 1));
  if (size === 0) return new Response(null, { headers });
  const stream = Readable.toWeb(
    fs.createReadStream(/* turbopackIgnore: true */ context.pdfPath, {
      start: range.start,
      end: range.end,
    }),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: requested.kind === "range" ? 206 : 200,
    headers,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = await getSourcePdfContext(request, params, "read");
    if (!isSourcePdfContext(context)) return context;

    // An unsaved local edit is always the newer document (PDF-06): it is
    // read from the database and served from memory. An untouched document
    // is streamed off disk instead of being read whole into a Buffer, which
    // is what used to block the server while a shelf of textbooks restored
    // into tabs at startup (IO-03).
    const savedPdf = latestSavedPdf(context);
    return savedPdf
      ? savedPdfResponse(request, context, savedPdf)
      : storedPdfResponse(request, context);
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

        db.prepare(
          `
        DELETE FROM pdf_document_edit_history
        WHERE cluster_id = ? AND document_slug = ?
          AND id NOT IN (
            SELECT id FROM pdf_document_edit_history
            WHERE cluster_id = ? AND document_slug = ?
            ORDER BY id DESC
            LIMIT 50
          )
      `,
        ).run(
          context.clusterId,
          context.documentSlug,
          context.clusterId,
          context.documentSlug,
        );
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
