import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { drive } from "@/lib/crumbs/service.ts";
import { DriveError } from "@/lib/drive/drive-client.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const failure = (error: unknown) => error instanceof DriveError
  ? NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  : routeErrorResponse(error);

/** Whether Google Drive is connected, for sharing files in organizations. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(drive.status(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

/**
 * `{ action: "connect" }` answers the Google consent address, opened in the
 * system browser; `{ action: "disconnect" }` forgets and revokes the access.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action === "connect") return NextResponse.json({ url: drive.authUrl(userId, new URL(request.url).origin) });
    if (body.action === "disconnect") { await drive.disconnect(userId); return NextResponse.json(drive.status(userId)); }
    return NextResponse.json({ error: "invalid_action", message: "Choose connect or disconnect." }, { status: 400 });
  } catch (error) { return failure(error); }
}
