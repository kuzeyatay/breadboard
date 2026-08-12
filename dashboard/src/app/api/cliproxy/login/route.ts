import { NextResponse } from "next/server";
import {
  CliproxyRequestError,
  CliproxyUnavailableError,
  isLoginComplete,
  startLogin,
} from "@/lib/cliproxy/management";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function failure(error: unknown): NextResponse {
  if (error instanceof RouteError) return routeErrorResponse(error);
  if (error instanceof CliproxyUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof CliproxyRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return routeErrorResponse(error);
}

/**
 * Start a subscription sign-in. Claude links the official Claude Code login;
 * the remaining providers return CLIProxyAPI's browser/device flow. No
 * credential is returned to or stored by this route.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();

    const body = (await request.json().catch(() => ({}))) as { provider?: unknown };
    if (typeof body.provider !== "string" || !body.provider.trim()) {
      throw new RouteError(400, "A subscription provider is required.");
    }

    return NextResponse.json(await startLogin(body.provider.trim()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Poll until the credential owner (Claude Code or CLIProxyAPI) reports ready. */
export async function GET(request: Request) {
  try {
    await requireUserId();

    const state = new URL(request.url).searchParams.get("state");
    if (!state?.trim()) throw new RouteError(400, "A sign-in state is required.");

    return NextResponse.json(
      { complete: await isLoginComplete(state) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
