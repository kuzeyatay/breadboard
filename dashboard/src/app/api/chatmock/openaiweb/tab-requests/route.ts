import { NextResponse } from "next/server";
import {
  answerChatgptWebTabRequest,
  CHATGPT_WEB_TAB_POLL_MAX_WAIT_SECONDS,
  isChatgptWebTabNonce,
  pollChatgptWebTabRequests,
  providerErrorResponseInit,
} from "@/lib/chatmock-providers";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * The relay between ChatMock's "OpenAI (web)" provider and the desktop shell.
 *
 * ChatMock cannot ask the shell for a browser tab itself; a Breadboard page
 * can, through its preload bridge. So one page long-polls here for ChatMock's
 * tab requests (`GET`, held up to `wait` seconds), asks the shell, and posts
 * the tab's DevTools target back (`POST`). See `chatgpt-web-tab-agent.tsx`.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const params = new URL(request.url).searchParams;
    const wait = Number(params.get("wait") ?? "0");
    const cdpPort = Number(params.get("cdpPort") ?? "0");
    const result = await pollChatgptWebTabRequests(request, {
      wait: Number.isFinite(wait) ? Math.min(wait, CHATGPT_WEB_TAB_POLL_MAX_WAIT_SECONDS) : 0,
      cdpPort: Number.isInteger(cdpPort) && cdpPort > 0 ? cdpPort : null,
    });
    return NextResponse.json(result, NO_STORE);
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * `{ nonce, cdpPort, targetId }` on success (plus `lane` when the shell keeps
 * a page per lane), `{ nonce, error }` otherwise.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      nonce?: unknown;
      cdpPort?: unknown;
      targetId?: unknown;
      lane?: unknown;
      error?: unknown;
    };
    if (!isChatgptWebTabNonce(body.nonce)) throw new RouteError(400, "A request nonce is required.");
    const lane = typeof body.lane === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(body.lane) ? body.lane : undefined;
    const answer =
      Number.isInteger(body.cdpPort) &&
      (body.cdpPort as number) > 0 &&
      typeof body.targetId === "string" &&
      body.targetId.trim()
        ? { cdpPort: body.cdpPort as number, targetId: body.targetId.trim(), ...(lane ? { lane } : {}) }
        : { error: typeof body.error === "string" && body.error.trim() ? body.error.trim() : "the tab could not be opened" };
    const accepted = await answerChatgptWebTabRequest(request, body.nonce, answer);
    return NextResponse.json({ accepted }, NO_STORE);
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}
