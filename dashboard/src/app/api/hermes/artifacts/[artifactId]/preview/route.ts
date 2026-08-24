import fs from "node:fs";
import { Readable } from "node:stream";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { artifactFile, getArtifactForUser, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { presentArtifact } from "@/lib/hermes/artifact-store.ts";
import { saveArtifactPdfBytes } from "@/lib/hermes/artifact-document-editor.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";

export const dynamic = "force-dynamic";

const INTERACTIVE_PREVIEW_GUARDS = `<style data-breadboard-visualizer-guards>
[hidden]{display:none!important}
[data-action]{isolation:isolate;line-height:0}
[data-action]>svg{display:block;width:min(20px,55%);height:min(20px,55%);margin:auto}
</style>`;

/**
 * Preview-time guards repair presentation invariants for every stored bundle,
 * including already-published artifacts produced by an older runtime. The
 * sandbox stays immutable on disk and the downloaded artifact is untouched.
 */
function guardInteractiveVisualizerPreview(source: string): string {
  if (source.includes("data-breadboard-visualizer-guards")) return source;
  return /<\/head\s*>/i.test(source)
    ? source.replace(/<\/head\s*>/i, `${INTERACTIVE_PREVIEW_GUARDS}</head>`)
    : `${INTERACTIVE_PREVIEW_GUARDS}${source}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
    const { artifactId } = await params;
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    const requestedVersion = Number(url.searchParams.get("version") ?? artifact.current_version);
    if (!Number.isInteger(requestedVersion) || requestedVersion <= 0) throw new ApiError(400, "invalid_artifact_version", "A valid version is required.");
    const file = artifactFile({ artifact, version: requestedVersion, purpose: "preview" });
    const interactive = artifact.renderer_id === "interactive-visualizer";
    const contentSecurityPolicy = interactive
      ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
      : "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; media-src 'self' https: data:; frame-ancestors 'self'; form-action 'none'; base-uri 'none'";
    const baseHeaders: Record<string, string> = {
      "Content-Type": file.mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": contentSecurityPolicy,
      ...(interactive ? {
        "Permissions-Policy": "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()",
        "Cross-Origin-Resource-Policy": "same-site",
        "X-Frame-Options": "SAMEORIGIN",
      } : {}),
    };
    if (/^(?:audio|video)\//i.test(file.mimeType)) {
      const stat = fs.statSync(file.path);
      const range = parseRange(request.headers.get("range"), stat.size);
      const stream = fs.createReadStream(
        file.path,
        range ? { start: range.start, end: range.end } : undefined,
      );
      return new Response(
        Readable.toWeb(stream) as ReadableStream,
        {
          status: range ? 206 : 200,
          headers: {
            ...baseHeaders,
            "Accept-Ranges": "bytes",
            "Content-Length": String(
              range ? range.end - range.start + 1 : stat.size,
            ),
            ...(range
              ? {
                  "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
                }
              : {}),
          },
        },
      );
    }
    const body = interactive
      ? guardInteractiveVisualizerPreview(fs.readFileSync(file.path, "utf8"))
      : fs.readFileSync(file.path);
    return new Response(body, {
      headers: {
        ...baseHeaders,
      },
    });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status, headers: { "Content-Type": "application/json" } });
    return apiErrorResponse(error);
  }
}

/** Persist PDF.js annotation/editor output as a new artifact version. */
export async function PUT(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
    if (!/^application\/pdf(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      throw new ApiError(415, "artifact_pdf_content_type", "The PDF editor must send application/pdf.");
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 128 * 1024 * 1024) {
      throw new ApiError(413, "artifact_editor_pdf_size", "The edited PDF is too large.");
    }
    const { artifactId } = await params;
    const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const saved = await saveArtifactPdfBytes(artifact, bytes);
    return Response.json({ artifact: presentArtifact(saved) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status, headers: { "Content-Type": "application/json" } });
    return apiErrorResponse(error);
  }
}

function parseRange(
  value: string | null,
  size: number,
): { start: number; end: number } | null {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size <= 0) return null;
  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (
    (requestedStart !== null && !Number.isSafeInteger(requestedStart)) ||
    (requestedEnd !== null && !Number.isSafeInteger(requestedEnd))
  ) {
    return null;
  }
  let start: number;
  let end: number;
  if (requestedStart === null) {
    const suffix = Math.min(requestedEnd ?? 0, size);
    if (suffix <= 0) return null;
    start = size - suffix;
    end = size - 1;
  } else {
    start = requestedStart;
    end = Math.min(requestedEnd ?? size - 1, size - 1);
  }
  return start >= 0 && start <= end && start < size
    ? { start, end }
    : null;
}
