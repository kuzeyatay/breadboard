import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { normalizeDocumentSlug } from "@/lib/garden-document-path";
import { resolveGardenSourcePdfPath } from "@/lib/garden-source-pdf-path";
import { resolveSourcePdfMarkdownPath } from "@/lib/source-pdf-garden";
import { fileError, fileJson, gardenFileContext } from "@/lib/garden-files/server";

export const dynamic = "force-dynamic";

/**
 * An uploaded Word document opens in the Word viewer (view and edit), not as a PDF.
 * Its original, kept beside the source note at ingest, becomes a Garden file in
 * sources/, beside its note, the first time it is opened; later opens return that same file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const clusterSlug = new URL(request.url).searchParams.get("clusterSlug") ?? "";
    const { store, scope } = await gardenFileContext(clusterSlug, true);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    const documentSlug = normalizeDocumentSlug(scope.gardenId, slug);
    const root = contentPath ? path.resolve(/* turbopackIgnore: true */ contentPath) : "";
    const clusterDir = root ? path.resolve(/* turbopackIgnore: true */ root, scope.gardenId) : "";
    const markdownPath = documentSlug && clusterDir.startsWith(root + path.sep) ? resolveSourcePdfMarkdownPath(clusterDir, documentSlug) : null;
    if (!contentPath || !markdownPath || !fs.existsSync(/* turbopackIgnore: true */ markdownPath)) return fileJson({ error: "Document not found." }, 404);

    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(/* turbopackIgnore: true */ markdownPath, "utf-8"))?.[1] ?? "";
    const field = (key: string) => {
      const raw = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter)?.[1]?.trim() ?? "";
      try { const value = JSON.parse(raw); return typeof value === "string" ? value : ""; } catch { return raw.replace(/^["']|["']$/g, ""); }
    };
    const original = resolveGardenSourcePdfPath(contentPath, scope.gardenId, field("source_document"), /\.docx$/i);
    if (!original || !fs.existsSync(/* turbopackIgnore: true */ original)) {
      return fileJson({ error: "This Word document was added before originals were kept. Upload it again to view and edit it." }, 404);
    }

    const name = (field("original_filename") || field("source_file") || `${documentSlug}.docx`).replace(/[\\/:*?"<>|\p{Cc}]/gu, " ").trim();
    const importKey = `source-word-${createHash("sha256").update(`${scope.gardenId}/${documentSlug}`).digest("hex").slice(0, 40)}`;
    const stage = await store.stage(Readable.toWeb(fs.createReadStream(/* turbopackIgnore: true */ original)) as ReadableStream<Uint8Array>, request.signal);
    try {
      return fileJson({ file: store.import(scope, `sources/${/\.docx$/i.test(name) ? name : `${name}.docx`}`, stage, importKey) });
    } finally { store.discard(stage); }
  } catch (error) {
    return fileError(error);
  }
}
