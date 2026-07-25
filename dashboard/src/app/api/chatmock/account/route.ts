import { NextResponse } from "next/server";
import { readChatmockAccount, signOutChatmockAccount } from "@/lib/chatmock-account";
import { readChatmockLoginState } from "@/lib/chatmock-login";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(
      { account: readChatmockAccount(), login: readChatmockLoginState() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return routeErrorResponse(error);
  }
}

/** Sign out of the active ChatGPT profile so a different account can sign in. */
export async function DELETE() {
  try {
    await requireUserId();
    const result = signOutChatmockAccount();
    return NextResponse.json(
      { ...result, account: readChatmockAccount() },
      { status: result.signedOut ? 200 : 409, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
