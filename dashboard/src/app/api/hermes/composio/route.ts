import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  beginComposioProviderConnection,
  composioConnectionStatus,
  removeComposioConnection,
} from "@/lib/composio/service.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
} from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_connected_app", `${field} is required.`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new ApiError(400, "invalid_connected_app", `${field} is invalid.`);
  }
  return result;
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await composioConnectionStatus(userId, true));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 32 * 1024);
    const integrationValue = requiredText(
      body.integrationId ?? body.slug,
      "Integration",
      120,
    );
    const result = await beginComposioProviderConnection(
      userId,
      integrationValue,
      new URL(request.url).origin,
    );
    recordAuditEvent({
      eventType: "connected_app.oauth_started",
      userId,
      payload: { integrationId: integrationValue, broker: "composio" },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const slug = new URL(request.url).searchParams.get("slug")?.trim();
    const removed = await removeComposioConnection(userId, slug || undefined);
    if (!removed) {
      throw new ApiError(
        404,
        "connected_app_not_found",
        slug ? "That app is not connected." : "No connected apps were found.",
      );
    }
    recordAuditEvent({
      eventType: "connected_app.connection_removed",
      userId,
      payload: { slug: slug || null, removed, broker: "composio" },
    });
    return NextResponse.json({ removed: true, count: removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
