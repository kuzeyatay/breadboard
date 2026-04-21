import { NextResponse } from "next/server";
import {
  CHATMOCK_TARGET_COOKIE,
  normalizeChatmockTarget,
} from "@/lib/chatmock-target";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireUserId();

    const body = (await request.json().catch(() => ({}))) as {
      target?: unknown;
    };
    const target = normalizeChatmockTarget(body.target);

    const response = NextResponse.json({ success: true, target });
    response.cookies.set({
      name: CHATMOCK_TARGET_COOKIE,
      value: target,
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
