import { NextResponse } from "next/server";
import { readChatmockAccount, signOutChatmockAccount } from "@/lib/chatmock-account";
import { refreshChatmockLoginState } from "@/lib/chatmock-login";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/** The login job lives in the Runtime; a busy supervisor must not hold the
 * account list hostage. The panel keeps its previous login state meanwhile. */
const LOGIN_STATE_WAIT_MS = 4_000;

async function loginStateWithin(userId: number) {
  let cancel = () => {};
  try {
    return await Promise.race([
      refreshChatmockLoginState(userId),
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), LOGIN_STATE_WAIT_MS);
        cancel = () => clearTimeout(timer);
      }),
    ]);
  } finally {
    cancel();
  }
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(
      { account: readChatmockAccount(), login: await loginStateWithin(userId) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
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
