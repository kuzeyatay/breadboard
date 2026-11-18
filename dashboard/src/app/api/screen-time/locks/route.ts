import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { changeSiteLocks, readSiteLocks, SiteLockError, type SiteLockChange } from "@/lib/screen-time/site-locks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  const known = error instanceof RouteError || error instanceof SiteLockError;
  return NextResponse.json({ error: known ? error.message : "Website locks could not be saved. Try again." },
    { status: known ? error.status : 500, headers });
}

export async function GET() {
  try { return NextResponse.json(await readSiteLocks(await requireUserId()), { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new RouteError(403, "Change website locks in Breadboard.");
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { throw new RouteError(400, "Invalid request."); }
    const text = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
    let change: SiteLockChange;
    if (body.action === "set-password") change = { action: "set-password", password: text("password"), newPassword: text("newPassword") };
    else if (body.action === "add" && (body.mode === "always" || body.mode === "daily"))
      change = { action: "add", password: text("password"), domain: text("domain"), mode: body.mode, minutes: Number(body.minutes) };
    else if (body.action === "remove") change = { action: "remove", password: text("password"), domain: text("domain") };
    else throw new RouteError(400, "Invalid request.");
    return NextResponse.json(await changeSiteLocks(userId, change), { headers });
  } catch (error) { return failure(error); }
}
