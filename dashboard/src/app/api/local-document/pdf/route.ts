import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { readDocument, readOpenDocument } from "@/lib/document-structure/index.ts";
import { renderMarkdownPdfDownloadViaRuntime } from "@/lib/office/runtime-v2";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 64 * 1024 * 1024;
const FORMATS = ["docx", "xlsx", "pptx", "odt", "ods", "odp"] as const;

/**
 * Turns an office file opened from disk into a PDF for the built-in viewer and
 * hands the bytes straight back. Nothing is kept: the render's staging file is
 * removed before the response is sent, so closing the tab really forgets it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file was sent." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "This file is too large to open here." }, { status: 413 });
    const format = file.name.split(".").pop()?.toLowerCase() as (typeof FORMATS)[number];
    if (!FORMATS.includes(format)) return Response.json({ error: "Breadboard can't open this kind of file." }, { status: 415 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const structure = format.startsWith("od") ? await readOpenDocument(buffer) : readDocument(format, buffer);
    const title = file.name.replace(/\.[^.]+$/, "") || "Document";
    // ponytail: figures render as labelled placeholders; embed them when the PDF renderer accepts in-memory images.
    const content = structure.markdown.trim() || "_This file has no readable text._";

    const staged = await renderMarkdownPdfDownloadViaRuntime(
      { userId, gardenId: null, conversationId: null },
      { documents: [{ content, title }], title, filename: "document.pdf" },
      { signal: request.signal },
    );
    try {
      return new Response(fs.readFileSync(staged.filePath), {
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
      });
    } finally {
      staged.cleanup();
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
