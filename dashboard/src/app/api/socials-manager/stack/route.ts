import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { activateStack, deactivateStack, observeStack } from "@/lib/socials-manager/activation.ts";
import { resolveSocialsManagerConfig } from "@/lib/socials-manager/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only, and read-only in the strong sense: this route never starts Docker,
 * never runs Compose, and never wakes the container engine. It is safe to poll.
 *
 * `?probe=docker` opts into a read-only engine check for diagnostics. That
 * still starts nothing — it is `docker info`, which fails rather than launching
 * anything when the daemon is down.
 */
export async function GET(request: Request) {
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
    const probeDocker = new URL(request.url).searchParams.get("probe") === "docker";
    return NextResponse.json({
      ok: true,
      mode: config.mode,
      url: config.baseUrl,
      status: await observeStack(config, { probeDocker }),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

/**
 * Start or stop the stack by hand.
 *
 * This is an explicit, authenticated user action — the "Start Postiz" control —
 * and it is one of the handful of paths allowed to wake Docker. Both directions
 * go through the lifecycle owner rather than running Compose here, so a manual
 * start cannot race a run that is already activating the stack.
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
      return NextResponse.json({ ok: true, stopped: await deactivateStack(config) });
    }
    const outcome = await activateStack(config, {
      reason: "manual",
      timeoutMs: config.readyTimeoutMs,
    });
    return NextResponse.json({ ok: true, status: outcome });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
