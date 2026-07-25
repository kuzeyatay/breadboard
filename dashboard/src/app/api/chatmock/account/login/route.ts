import { NextResponse } from "next/server";
import { readChatmockAccount } from "@/lib/chatmock-account";
import {
  cancelChatmockLogin,
  readChatmockLoginState,
  startChatmockLogin,
} from "@/lib/chatmock-login";
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
    await requireUserId();
    return NextResponse.json(
      { login: readChatmockLoginState(), account: readChatmockAccount() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return routeErrorResponse(error);
  }
}

export async function POST() {
  try {
    await requireUserId();
    const login = await startChatmockLogin();
    return NextResponse.json(
      { login, account: readChatmockAccount() },
      { status: login.status === "failed" ? 502 : 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    await requireUserId();
    return NextResponse.json(
      { login: cancelChatmockLogin(), account: readChatmockAccount() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
