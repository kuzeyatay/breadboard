import { NextResponse } from "next/server";
import {
  providerErrorResponseInit,
  readProviderState,
  setDefaultModel,
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
    return NextResponse.json(
      { defaultModel: state.defaultModel, storedDefaultModel: state.storedDefaultModel },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * Set the model every subsystem that asks for `default` runs on. ChatMock
 * validates that a configured provider can actually serve the id, so a bad
 * choice is rejected here rather than breaking Hermes/OpenCode later.
 */
export async function PUT(request: Request) {
  try {
    await requireUserId();

    const body = (await request.json().catch(() => ({}))) as { model?: unknown };
    if (body.model !== null && typeof body.model !== "string") {
      throw new RouteError(400, "A model id is required.");
    }

    const state = await setDefaultModel(request, body.model);
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
