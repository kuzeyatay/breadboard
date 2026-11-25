import { fileContentResponse } from "@/lib/file-content-response";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { artifactFile, getArtifactForUser, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { presentArtifact } from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { withInteractiveVisualizerWheelZoom } from "@/lib/hermes/interactive-visualizer-wheel.ts";
import { withInteractiveVisualizerInlineLayout } from "@/lib/hermes/interactive-visualizer-inline.ts";
import { keepFullRoundCorners, SQUIRCLE_DOCUMENT_CSS } from "@/lib/squircle-corner";

export const dynamic = "force-dynamic";

const INTERACTIVE_PREVIEW_GUARDS = `<style data-breadboard-visualizer-guards>
[hidden]{display:none!important}
[data-action]{isolation:isolate;line-height:0}
[data-action]>svg{display:block;width:min(20px,55%);height:min(20px,55%);margin:auto}
${SQUIRCLE_DOCUMENT_CSS}
</style>`;

/**
 * Preview-time guards repair presentation invariants for every stored bundle,
 * including already-published artifacts produced by an older runtime. The
 * sandbox stays immutable on disk and the downloaded artifact is untouched.
 */
function guardInteractiveVisualizerPreview(source: string): string {
  source = withInteractiveVisualizerWheelZoom(source);
  if (source.includes("data-breadboard-visualizer-guards")) return source;
  // Squircle corners like the rest of Breadboard; bundles from before that
  // change keep their circles and pills round.
  source = keepFullRoundCorners(source);
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
    // A .pptx without a stored HTML snapshot is drawn from the file itself.
    // The markup is generated here with every text run escaped; the one inline
    // script only scales slides to the frame, so scripts are allowed and
    // nothing else is (no network, no same-origin in the viewer's sandbox).
    if (url.searchParams.get("render") === "pptx") {
      if (!artifact.filename.toLowerCase().endsWith(".pptx")) {
        throw new ApiError(422, "artifact_pptx_render_unsupported", "Only .pptx artifacts can be rendered as slides.");
      }
      const source = artifactFile({ artifact, version: requestedVersion, purpose: "download" });
      const html = await renderedPptx(source.path);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": "inline",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'; form-action 'none'; base-uri 'none'",
        },
      });
    }
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
    if (!interactive) return fileContentResponse(request, file.path, file.size, baseHeaders);
    let body = guardInteractiveVisualizerPreview(await fs.promises.readFile(file.path, "utf8"));
    if (url.searchParams.get("presentation") === "inline") {
      body = withInteractiveVisualizerInlineLayout(body);
    }
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
    const { saveArtifactPdfBytes } = await import("@/lib/hermes/artifact-pdf-save.ts");
    const saved = await saveArtifactPdfBytes(artifact, bytes);
    return Response.json({ artifact: presentArtifact(saved) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status, headers: { "Content-Type": "application/json" } });
    return apiErrorResponse(error);
  }
}

// Rendering a deck parses the whole package; keep the last few by file
// identity (path, size, mtime) so reopening the panel is instant.
const renderedPptxCache = new Map<string, string>();
async function renderedPptx(filePath: string): Promise<string> {
  const stat = fs.statSync(filePath);
  const key = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  const cached = renderedPptxCache.get(key);
  if (cached) return cached;
  const { renderPptxPreviewHtml } = await import("@/lib/genoffice/pptx-preview.ts");
  const html = await renderPptxPreviewHtml(new Uint8Array(fs.readFileSync(filePath)), { fitToWidth: true });
  renderedPptxCache.set(key, html);
  while (renderedPptxCache.size > 8) renderedPptxCache.delete(renderedPptxCache.keys().next().value!);
  return html;
}
