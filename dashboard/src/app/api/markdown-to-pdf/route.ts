import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { parseMarkdownFrontmatter } from "@/lib/markdown-render/frontmatter";
import { renderMarkdownPdfDownloadViaRuntime } from "@/lib/office/runtime-v2";
import { dashboardDataDir } from "@/lib/runtime-paths";
import {
  requireReadableCluster,
  requireUserId,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PDF_BYTES = 128 * 1024 * 1024;

type PdfMarkdownDocument = { content: string; title: string };

function sanitizeFileName(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "markdown-note"}.pdf`;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directPdf(filePath: string): Stats | null {
  try {
    const metadata = fs.lstatSync(filePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 5 ||
      metadata.size > MAX_PDF_BYTES ||
      !samePath(fs.realpathSync.native(filePath), filePath)
    ) return null;
    const descriptor = fs.openSync(filePath, "r");
    try {
      const signature = Buffer.alloc(5);
      if (fs.readSync(descriptor, signature, 0, signature.byteLength, 0) !== signature.byteLength) return null;
      if (signature.toString("ascii") !== "%PDF-") return null;
    } finally {
      fs.closeSync(descriptor);
    }
    return metadata;
  } catch {
    return null;
  }
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !["EACCES", "EINVAL", "EPERM"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function durableExportPath(userId: number, requestDigest: string): string {
  return path.join(
    dashboardDataDir(),
    "exports",
    "markdown-pdf",
    `user-${userId}`,
    `${requestDigest}.pdf`,
  );
}

function promotePdf(source: string, target: string): Stats {
  const existing = directPdf(target);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // A crash can leave an older, invalid file at this exact digest. It has no
  // recovery authority and must not prevent a newly completed job from being
  // promoted.
  fs.rmSync(target, { force: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (!directPdf(temporary)) throw new Error("Runtime returned an invalid PDF file.");
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      const raced = directPdf(target);
      if (!raced) throw error;
      fs.rmSync(temporary, { force: true });
      return raced;
    }
    fsyncDirectory(path.dirname(target));
    const promoted = directPdf(target);
    if (!promoted) throw new Error("The completed PDF could not be promoted durably.");
    return promoted;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function pdfResponse(filePath: string, fileName: string, metadata: Stats): Response {
  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(metadata.size),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let userId: number;
  try {
    userId = await requireUserId();
  } catch (error) {
    return routeErrorResponse(error);
  }

  const body = await request.json().catch(() => ({}));
  const rawContent = typeof body.content === "string" ? body.content : "";
  const rawDocuments: unknown[] = Array.isArray(body.documents)
    ? body.documents
    : [];
  if (rawDocuments.length > 500) {
    return Response.json(
      { error: "A folder PDF can contain at most 500 Markdown notes" },
      { status: 400 },
    );
  }

  const documents: PdfMarkdownDocument[] = rawDocuments
    .filter(
      (document: unknown): document is { content: string; title?: string } =>
        Boolean(
          document &&
            typeof document === "object" &&
            typeof (document as { content?: unknown }).content === "string",
        ),
    )
    .map((document) => {
      const parsed = parseMarkdownFrontmatter(document.content);
      return {
        content: parsed.body,
        title:
          typeof document.title === "string" && document.title.trim()
            ? document.title.trim()
            : parsed.title || "Markdown note",
      };
    });

  if (documents.length === 0 && rawContent.trim()) {
    const parsed = parseMarkdownFrontmatter(rawContent);
    documents.push({
      content: parsed.body,
      title: parsed.title || "Markdown note",
    });
  }

  if (documents.length === 0) {
    return Response.json(
      { error: "content or documents is required" },
      { status: 400 },
    );
  }

  const totalContentLength = documents.reduce(
    (total, document) => total + document.content.length,
    0,
  );
  if (totalContentLength > 10_000_000) {
    return Response.json(
      { error: "The selected Markdown notes are too large for one PDF" },
      { status: 413 },
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : documents[0].title;
  const clusterSlug =
    typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
  const requestedName =
    typeof body.fileName === "string"
      ? body.fileName.replace(/\.md$/i, "")
      : title;
  const fileName = sanitizeFileName(requestedName || title);
  let gardenId: string | null = null;
  if (clusterSlug) {
    try {
      gardenId = requireReadableCluster(userId, clusterSlug).slug;
    } catch (error) {
      return routeErrorResponse(error);
    }
  }
  const requestDigest = createHash("sha256").update(JSON.stringify({
    protocolVersion: 1,
    userId,
    gardenId,
    title,
    fileName,
    documents,
  }), "utf8").digest("hex");
  const durablePath = durableExportPath(userId, requestDigest);
  const recovered = directPdf(durablePath);
  if (recovered) return pdfResponse(durablePath, fileName, recovered);

  let staged: Awaited<ReturnType<typeof renderMarkdownPdfDownloadViaRuntime>> | null = null;
  try {
    staged = await renderMarkdownPdfDownloadViaRuntime(
      { userId, gardenId, conversationId: null },
      { documents, title, filename: fileName },
      { idempotencySeed: requestDigest, signal: request.signal },
    );
    const promoted = promotePdf(staged.filePath, durablePath);
    return pdfResponse(durablePath, fileName, promoted);
  } catch (error) {
    return routeErrorResponse(error);
  } finally {
    staged?.cleanup();
  }
}
