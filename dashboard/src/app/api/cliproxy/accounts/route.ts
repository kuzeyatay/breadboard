import { NextResponse } from "next/server";
import {
  CliproxyRequestError,
  CliproxyUnavailableError,
  deleteAccount,
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
 * Sign one subscription account out.
 *
 * Removing the credential is the whole of signing out here: the proxy holds no
 * other state for an account, and Breadboard never had the token. It cannot be
 * undone from the app — the account has to go through OAuth again — so the
 * panel confirms before calling this.
 */
export async function DELETE(request: Request) {
  try {
    await requireUserId();

    const file = new URL(request.url).searchParams.get("file");
    if (!file?.trim()) throw new RouteError(400, "A credential file is required.");

    await deleteAccount(file.trim());
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
