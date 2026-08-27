import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_VALIDATION_REPORT_BYTES = 16 * 1024 * 1024;

function validationReportFile(
  contentPath: string,
  gardenSlug: string,
): { filePath: string; size: number } | null {
  const root = path.resolve(contentPath);
  const gardenDir = path.resolve(root, gardenSlug.trim());
  if (gardenDir === root || !gardenDir.startsWith(`${root}${path.sep}`)) return null;
  const filePath = path.join(gardenDir, ".breadboard", "validation-report.md");
  try {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const realGarden = fs.realpathSync(gardenDir);
    const realFile = fs.realpathSync(filePath);
    if (!realFile.startsWith(`${realGarden}${path.sep}`)) return null;
    return { filePath: realFile, size: metadata.size };
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const report = validationReportFile(contentPath, cluster.slug);
    if (!report) {
      return NextResponse.json(
        { error: "Validation report not found" },
        { status: 404 },
      );
    }
    if (report.size > MAX_VALIDATION_REPORT_BYTES) {
      return NextResponse.json(
        { error: "Validation report exceeds the safe response limit" },
        { status: 413 },
      );
    }

    const stream = Readable.toWeb(
      fs.createReadStream(report.filePath),
    ) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Length": String(report.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
