import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveSocialsManagerConfig } from "@/lib/socials-manager/config.ts";
import { stackStatus, startStack, stopStack } from "@/lib/socials-manager/stack.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const config = resolveSocialsManagerConfig();
    if (config.mode !== "stack") {
      return NextResponse.json({
        ok: true,
        mode: config.mode,
        status: { state: "stopped", reachable: false },
      });
    }
    return NextResponse.json({
      ok: true,
      mode: config.mode,
      url: config.baseUrl,
      status: await stackStatus(config),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

/**
 * Start or stop the stack by hand. Starting is normally implicit — a Postiz run
 * brings the containers up on its own — but a Settings-style control needs it,
 * and stopping has to be explicit because nothing else will do it.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "start";
    const config = resolveSocialsManagerConfig();
    if (config.mode !== "stack") {
      return NextResponse.json(
        { ok: false, error: "socials_manager_stack_disabled" },
        { status: 409 },
      );
    }
    if (action === "stop") {
      return NextResponse.json({ ok: true, stopped: await stopStack(config) });
    }
    return NextResponse.json({ ok: true, status: await startStack(config) });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
