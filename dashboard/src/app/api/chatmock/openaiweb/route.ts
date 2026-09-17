import { NextResponse } from "next/server";
import {
  isChatgptWebAction,
  providerErrorResponseInit,
  readChatgptWebSession,
  runChatgptWebAction,
} from "@/lib/chatmock-providers";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * The "OpenAI (web)" sign-in: who is signed in to chatgpt.com in the browser
 * tab ChatMock drives, and which models that page offers.
 *
 * `?refresh=1` asks the live page rather than ChatMock's last note of it,
 * which may open the tab; the settings panel uses it while a sign-in is
 * pending and for an explicit "Sync models".
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const session = await readChatgptWebSession(request, { refresh });
    return NextResponse.json(session, NO_STORE);
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}

/** `{ action: "login" | "cancel-login" | "logout" | "sync" }`. */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (!isChatgptWebAction(body.action)) {
      throw new RouteError(400, "An action is required.");
    }
    const session = await runChatgptWebAction(request, body.action);
    return NextResponse.json(session, NO_STORE);
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}
