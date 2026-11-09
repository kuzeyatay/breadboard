import path from "node:path";
import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { contentDisposition } from "@/lib/content-disposition";
import {
  audioAttachmentFormat,
  audioFormatMimeType,
} from "@/lib/audio-attachments.ts";
import { scanClusterKnowledgeCooperatively } from "@/lib/knowledge.ts";
import { getVideoTranscriptionStore } from "@/lib/scriberr/instance";
import {
  RouteError,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";
import {
  videoAttachmentFormat,
  videoFormatMimeType,
} from "@/lib/video-attachments.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestedRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start >= size
  ) {
    return null;
  }
  return { start, end };
}

function mediaMimeType(filename: string): string {
  const audioFormat = audioAttachmentFormat(filename);
  if (audioFormat) return audioFormatMimeType(audioFormat);
  const videoFormat = videoAttachmentFormat(filename);
  if (videoFormat) return videoFormatMimeType(videoFormat);
  return "application/octet-stream";
}

function inlineDisposition(filename: string): string {
  const base = path.basename(filename.replace(/\\/g, "/")) || "media";
  return contentDisposition(base);
}

/** Stream one retained Garden media source, including seekable range requests. */
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ gardenId: string; sourceSlug: string }> },
) {
  try {
    const { gardenId, sourceSlug } = await params;
    const { userId, cluster } = await requireReadableClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      throw new RouteError(500, "QUARTZ_CONTENT_PATH not configured");
    }

    const source = (await scanClusterKnowledgeCooperatively(contentPath, cluster.slug)).nodes.find(
      (node) =>
        node.type === "source-document" && node.slug === sourceSlug.trim(),
    );
    if (!source?.sourceMedia) {
      throw new RouteError(404, "Media source not found");
    }

    const normalized = source.sourceMedia.trim().replace(/\\/g, "/");
    let mediaPath: string;
    if (normalized.startsWith("origin:")) {
      // The note names a job, not a path. The job row holds the path, and only
      // the person who imported the file can stream it, even in a shared Garden.
      const job = getVideoTranscriptionStore().getJobForCluster(
        normalized.slice("origin:".length),
        cluster.id,
      );
      if (!job?.mediaOriginPath || job.userId !== userId || job.sourceSlug !== source.slug) {
        throw new RouteError(404, "Media source not found");
      }
      mediaPath = job.mediaOriginPath;
      if (!fs.existsSync(mediaPath)) {
        throw new RouteError(404, `The original file is no longer at ${mediaPath}`);
      }
    } else {
      const assetPrefix = `/${cluster.slug}/assets/`;
      const assetName = normalized.startsWith(assetPrefix)
        ? normalized.slice(assetPrefix.length)
        : "";
      if (!assetName || assetName.includes("/")) {
        throw new RouteError(404, "Media source not found");
      }
      const clusterDir = path.resolve(contentPath, cluster.slug);
      mediaPath = path.resolve(clusterDir, "assets", assetName);
      if (!mediaPath.startsWith(`${clusterDir}${path.sep}`)) {
        throw new RouteError(404, "Media source not found");
      }
    }
    const metadata = fs.lstatSync(mediaPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RouteError(404, "Media source not found");
    }

    const filename = source.sourceFile || path.basename(mediaPath);
    const headers: Record<string, string> = {
      "Content-Type": mediaMimeType(filename),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": inlineDisposition(filename),
      "X-Content-Type-Options": "nosniff",
    };
    const range = requestedRange(request.headers.get("range"), metadata.size);
    const stream = fs.createReadStream(mediaPath, range ?? undefined);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return range
      ? new Response(body, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${range.start}-${range.end}/${metadata.size}`,
            "Content-Length": String(range.end - range.start + 1),
          },
        })
      : new Response(body, {
          headers: { ...headers, "Content-Length": String(metadata.size) },
        });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
