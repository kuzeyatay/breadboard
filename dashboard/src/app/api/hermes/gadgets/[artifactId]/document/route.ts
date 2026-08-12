import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { getArtifactForUser, ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { GadgetServiceError, renderStoredGadget } from "@/lib/hermes/gadget-service.ts";

export const dynamic = "force-dynamic";

/**
 * The runnable document for one gadget.
 *
 * Composed on demand rather than served off disk: the stored artifact is the
 * package (manifest + files), and the bridge client injected into the page is
 * generated from the gadget's declared bindings. Rendering here means a gadget
 * published before a bridge fix picks the fix up on next open.
 *
 * The CSP is the second lock. The frame is already `sandbox="allow-scripts"`,
 * which gives it an opaque origin; `connect-src 'none'` additionally means that
 * even if generated code slipped a fetch past the validator, there is nowhere
 * for it to go. Every route out of the frame is postMessage to the embedder.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    if (!conversationId) {
      throw new ApiError(
        400,
        "gadget_conversation_required",
        "conversationId is required.",
      );
    }
    const { artifactId } = await params;
    const artifact = getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    if (artifact.renderer_id !== "gadget") {
      throw new ApiError(404, "gadget_not_found", "That artifact is not a gadget.");
    }
    const document = renderStoredGadget(artifactId);
    return new Response(document, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": [
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          "img-src data:",
          "font-src data:",
          "connect-src 'none'",
          "media-src 'none'",
          "worker-src 'none'",
          "child-src 'none'",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'self'",
        ].join("; "),
        "Permissions-Policy": [
          "accelerometer=()", "ambient-light-sensor=()", "autoplay=()", "battery=()",
          "camera=()", "clipboard-read=()", "clipboard-write=()", "display-capture=()",
          "geolocation=()", "gyroscope=()", "hid=()", "idle-detection=()",
          "local-fonts=()", "magnetometer=()", "microphone=()", "midi=()",
          "payment=()", "publickey-credentials-get=()", "screen-wake-lock=()",
          "serial=()", "usb=()", "web-share=()", "xr-spatial-tracking=()",
        ].join(", "),
        "Cross-Origin-Resource-Policy": "same-site",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof GadgetServiceError || error instanceof ArtifactStoreError) {
      return Response.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
