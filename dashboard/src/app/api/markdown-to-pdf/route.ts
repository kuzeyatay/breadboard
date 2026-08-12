import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import {
  parseFrontmatter,
  renderMarkdownToPdf,
  type PdfMarkdownDocument,
} from "@/lib/markdown-render/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeFileName(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "markdown-note"}.pdf`;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
      const parsed = parseFrontmatter(document.content);
      return {
        content: parsed.body,
        title:
          typeof document.title === "string" && document.title.trim()
            ? document.title.trim()
            : parsed.title || "Markdown note",
      };
    });

  if (documents.length === 0 && rawContent.trim()) {
    const parsed = parseFrontmatter(rawContent);
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

  let pdf: Buffer;
  try {
    pdf = await renderMarkdownToPdf(documents, { title, clusterSlug });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not create the PDF",
      },
      { status: 500 },
    );
  }
  const responseBody = pdf.buffer.slice(
    pdf.byteOffset,
    pdf.byteOffset + pdf.byteLength,
  ) as ArrayBuffer;

  return new Response(responseBody, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
