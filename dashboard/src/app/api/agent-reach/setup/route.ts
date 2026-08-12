// The Agent Reach settings panel's endpoint. GET describes what can be set up
// and what doctor currently reports; POST performs one user-initiated action.
//
// Unlike a chat run, these actions install software and write credentials, so
// they are only reachable from an authenticated session and only ever run the
// fixed argv defined in lib/agent-reach/setup.ts.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { doctor, runtimeAvailability } from "@/lib/agent-reach/runtime.ts";
import {
  configure,
  importCookies,
  install,
  setupCatalog,
  SetupError,
} from "@/lib/agent-reach/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(error: unknown): NextResponse {
  if (error instanceof SetupError) {
    return NextResponse.json(
      { ok: false, error: error.code, reason: error.message },
      { status: error.status },
    );
  }
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireUserId();
    const availability = runtimeAvailability();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const channels = availability.available ? await doctor({ force: refresh }) : [];
    return NextResponse.json({
      ok: true,
      available: availability.available,
      cloned: availability.cloned,
      reason: availability.reason ?? null,
      channels: channels.map((channel) => ({
        channel: channel.channel,
        status: channel.status,
        tier: channel.tier,
        backends: channel.backends,
        activeBackend: channel.activeBackend,
        message: channel.message,
      })),
      ...setupCatalog(),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const result =
      body.action === "install"
        ? await install(body.target)
        : body.action === "configure"
          ? await configure(body.key, body.value)
          : body.action === "import-cookies"
            ? await importCookies(body.browser, body.platform)
            : null;
    if (!result) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    // The next doctor read must see the new state, not the cached one.
    const channels = result.ok ? await doctor({ force: true }) : await doctor();
    return NextResponse.json({
      ok: result.ok,
      output: result.output,
      channels: channels.map((channel) => ({
        channel: channel.channel,
        status: channel.status,
        tier: channel.tier,
        backends: channel.backends,
        activeBackend: channel.activeBackend,
        message: channel.message,
      })),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    return fail(error);
  }
}
