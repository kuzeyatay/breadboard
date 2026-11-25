import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { NextResponse } from "next/server";

import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { fileContentResponse } from "@/lib/file-content-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUILD_FILES = new Set([
  "pdf.mjs",
  "pdf.mjs.map",
  "pdf.sandbox.mjs",
  "pdf.sandbox.mjs.map",
  "pdf.worker.mjs",
  "pdf.worker.mjs.map",
]);

const WEB_FILES = new Set([
  "pdf_viewer.css",
  "pdf_viewer.mjs",
  "pdf_viewer.mjs.map",
]);

function contentTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function safeJoin(root: string, segments: string[]): string | null {
  if (segments.some((segment) => !segment || segment.includes(".."))) {
    return null;
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...segments);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolvedPath;
}

function resolvePdfJsFile(segments: string[]): string | null {
  const [first, ...rest] = segments;
  if (!first) return null;

  const packageRoot = path.join(process.cwd(), "node_modules", "pdfjs-dist");

  if (BUILD_FILES.has(first) && rest.length === 0) {
    const file = first === "pdf.mjs" || first === "pdf.worker.mjs"
      ? first.replace(".mjs", ".min.mjs") : first;
    return safeJoin(path.join(packageRoot, "legacy", "build"), [file]);
  }

  if (WEB_FILES.has(first) && rest.length === 0) {
    return safeJoin(path.join(packageRoot, "legacy", "web"), [first]);
  }

  if (first === "images" && rest.length === 1) {
    return safeJoin(path.join(packageRoot, "legacy", "web", "images"), rest);
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const filePath = resolvePdfJsFile(pathSegments);

  const stat = filePath ? fs.statSync(filePath, { throwIfNoEntry: false }) : null;
  if (!filePath || !stat?.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return fileContentResponse(request, filePath, stat.size, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "public, max-age=31536000, immutable",
  });
}
