import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin";
import { readPdfPinImage, removePdfPinImages, savePdfPinImage } from "@/lib/pdf-pin-images.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { dataUrl } → { id }: an image attached to a PDF pin's note. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot attach pin images.");
    const userId = await requireUserId();
    const body = await readJsonBody(request, 9 * 1024 * 1024);
    return Response.json({ id: savePdfPinImage(userId, body.dataUrl) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** GET ?id= → the image bytes. Only the owner's own images are served. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const image = readPdfPinImage(userId, new URL(request.url).searchParams.get("id") ?? "");
    if (!image) return Response.json({ error: "image_not_found" }, { status: 404 });
    return new Response(new Uint8Array(image.data), {
      headers: { "content-type": image.mimeType, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** DELETE ?id=a&id=b: images removed from a note, or a deleted pin's images. */
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request, "This origin cannot remove pin images.");
    const userId = await requireUserId();
    return Response.json({ removed: removePdfPinImages(userId, new URL(request.url).searchParams.getAll("id")) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
