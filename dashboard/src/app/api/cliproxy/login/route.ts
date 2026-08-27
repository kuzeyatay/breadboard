import { NextResponse } from "next/server";
import {
  CliproxyRequestError,
  CliproxyUnavailableError,
  isLoginComplete,
  startLogin,
} from "@/lib/cliproxy/management";
import { cliproxyProvider } from "@/lib/cliproxy/config";
import {
  beginCliproxyLogin,
  pollCliproxyLogin,
  releaseCliproxyLogin,
} from "@/lib/cliproxy/runtime-lease";
import { isClaudeCodeLoginState } from "@/lib/claude-code";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const LOGIN_STATE_PATTERN = /^[A-Za-z0-9._~:-]{1,512}$/;

function loginState(request: Request): string {
  const state = new URL(request.url).searchParams.get("state")?.trim() ?? "";
  if (!LOGIN_STATE_PATTERN.test(state)) {
    throw new RouteError(400, "A valid sign-in state is required.");
  }
  return state;
}

function failure(error: unknown): NextResponse {
  const runtimeResponse = runtimeAuthorityErrorResponse(error);
  if (runtimeResponse) return runtimeResponse;
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
    const userId = await requireUserId();

    const body = (await request.json().catch(() => ({}))) as { provider?: unknown };
    if (typeof body.provider !== "string" || !body.provider.trim()) {
      throw new RouteError(400, "A subscription provider is required.");
    }

    const provider = cliproxyProvider(body.provider.trim());
    if (!provider) throw new RouteError(400, "Unknown subscription provider.");
    const result = provider.id === "claude"
      ? await startLogin(userId, provider.id, request.signal)
      : await beginCliproxyLogin(userId, () => startLogin(userId, provider.id, request.signal));
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Poll until the credential owner (Claude Code or CLIProxyAPI) reports ready. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const state = loginState(request);

    return NextResponse.json(
      {
        complete: isClaudeCodeLoginState(state)
          ? await isLoginComplete(userId, state, request.signal)
          : await pollCliproxyLogin(
              userId,
              state,
              () => isLoginComplete(userId, state, request.signal),
            ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const state = loginState(request);
    if (!isClaudeCodeLoginState(state)) {
      await releaseCliproxyLogin(userId, state);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
