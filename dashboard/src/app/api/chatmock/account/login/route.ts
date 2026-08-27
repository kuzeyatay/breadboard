import { NextResponse } from "next/server";
import { readChatmockAccount } from "@/lib/chatmock-account";
import {
  cancelChatmockLogin,
  refreshChatmockLoginState,
  startChatmockLogin,
} from "@/lib/chatmock-login";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/** Poll target while the user completes the authorization in their browser. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(
      { login: await refreshChatmockLoginState(userId), account: readChatmockAccount() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof RouteError) return routeErrorResponse(error);
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const login = await startChatmockLogin(userId, request.signal);
    return NextResponse.json(
      { login, account: readChatmockAccount() },
      { status: login.status === "failed" ? 502 : 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    return routeErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(
      { login: await cancelChatmockLogin(userId), account: readChatmockAccount() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    return routeErrorResponse(error);
  }
}
