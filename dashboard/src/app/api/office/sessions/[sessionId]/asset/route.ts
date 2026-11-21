import { officeAsset, officeSession } from "@/lib/office/editor-sessions.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** md-asset:// images: the Markdown editor's own protocol handler answers, scoped to the open document. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const session = officeSession((await params).sessionId, await requireUserId());
    // The URL's encoded path is kept as written: the handler decodes it itself.
    const raw = request.url.slice(request.url.indexOf("url=") + 4);
    if (!raw.startsWith("md-asset://")) return new Response(null, { status: 400 });
    const asset = await officeAsset(session, raw);
    return new Response(asset.status === 200 ? new Uint8Array(asset.body) : null, { status: asset.status, headers: { "Content-Type": asset.type, "Cache-Control": "private, max-age=60" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
