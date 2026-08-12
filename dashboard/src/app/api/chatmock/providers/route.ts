import { NextResponse } from "next/server";
import {
  forgetProvider,
  isValidProviderId,
  providerErrorResponseInit,
  readProviderState,
  updateProvider,
  type ProviderUpdate,
} from "@/lib/chatmock-providers";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function failure(error: unknown): NextResponse {
  if (error instanceof RouteError) return routeErrorResponse(error);
  const { status, message } = providerErrorResponseInit(error);
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
  try {
    await requireUserId();
    const state = await readProviderState(request);
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireUserId();

    const body = (await request.json().catch(() => ({}))) as {
      providerId?: unknown;
      apiKey?: unknown;
      baseUrl?: unknown;
      enabled?: unknown;
      models?: unknown;
    };

    if (!isValidProviderId(body.providerId)) {
      throw new RouteError(400, "A provider id is required.");
    }

    const update: ProviderUpdate = {};
    // Each field is optional: omitting one leaves the stored value untouched,
    // while an empty apiKey string explicitly forgets the stored key.
    if (typeof body.apiKey === "string") update.apiKey = body.apiKey;
    if (typeof body.baseUrl === "string") update.baseUrl = body.baseUrl;
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (Array.isArray(body.models)) {
      update.models = body.models.filter(
        (model): model is string => typeof model === "string" && model.trim().length > 0,
      );
    }

    const state = await updateProvider(request, body.providerId, update);
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireUserId();

    const providerId = new URL(request.url).searchParams.get("providerId");
    if (!isValidProviderId(providerId)) {
      throw new RouteError(400, "A provider id is required.");
    }

    const state = await forgetProvider(request, providerId);
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
