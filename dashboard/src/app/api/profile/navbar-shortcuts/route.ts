import { NextResponse } from "next/server";

import {
  getNavbarFlowers,
  getNavbarShortcuts,
  updateNavbarFlowers,
  updateNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      shortcuts: getNavbarShortcuts(userId),
      flowers: getNavbarFlowers(userId),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    // An unreadable body is treated as an empty patch, which the store leaves
    // the settings unchanged for rather than resetting them.
    const body = (await request.json().catch(() => ({}))) as unknown;
    const flowers =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { flowers?: unknown }).flowers === "boolean"
        ? updateNavbarFlowers(userId, (body as { flowers: boolean }).flowers)
        : getNavbarFlowers(userId);
    return NextResponse.json({
      shortcuts: updateNavbarShortcuts(userId, body),
      flowers,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
