import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { getSocialsManagerStore } from "@/lib/socials-manager/instance.ts";
import { SocialsManagerError } from "@/lib/socials-manager/store.ts";
import { SOCIALS_MANAGER_PROVIDERS } from "@/lib/socials-manager/providers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof SocialsManagerError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      ok: true,
      channels: getSocialsManagerStore().listChannels(userId),
      networks: SOCIALS_MANAGER_PROVIDERS,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const channel = getSocialsManagerStore().createChannel(userId, {
      providerId: typeof body.providerId === "string" ? body.providerId : "",
      handle: typeof body.handle === "string" ? body.handle : "",
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    });
    return NextResponse.json({ ok: true, channel }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
