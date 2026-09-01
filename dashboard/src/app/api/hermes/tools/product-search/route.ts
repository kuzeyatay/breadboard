import { NextResponse } from "next/server";

import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { PRODUCT_SEARCH_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  ProductSearchError,
  searchProducts,
  type ProductSearchInput,
} from "@/lib/product-search/service.ts";
import { productSearchMarketContext } from "@/lib/product-search/market-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Internal, capability-scoped endpoint for Hermes's normal product-search tool. */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (
      !verified.ok ||
      !tokenAllows(verified.token, { tool: "product_search" })
    ) {
      throw new ApiError(
        403,
        "product_search_capability_denied",
        "Product search is not authorized.",
      );
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "product_search_session_scope_mismatch",
        "Product search session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes("product_search")) {
      throw new ApiError(
        403,
        "product_search_tool_not_granted",
        "Product search is not available on this turn.",
      );
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(
        403,
        "product_search_conversation_missing",
        "The product-search conversation is unavailable.",
      );
    }
    const body = await readJsonBody(request, 16 * 1024);
    const toolName = typeof body.tool === "string" ? body.tool : "";
    if (!PRODUCT_SEARCH_TOOLS.includes(toolName as "product_search")) {
      throw new ApiError(
        400,
        "product_search_unknown_tool",
        "Unknown product-search tool.",
      );
    }
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as unknown as ProductSearchInput)
      : ({} as ProductSearchInput);
    const market = productSearchMarketContext(session.id);
    // A model-supplied country is only a fallback for turns without an opted-in
    // current-location market. The signed session's server-owned market wins,
    // so tool arguments cannot silently redirect local purchase links.
    const data = await searchProducts(
      {
        ...args,
        ...(market ? { country: market.locale } : {}),
      },
      { signal: request.signal },
    );
    recordAuditEvent({
      eventType: "productSearch.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        query: data.query,
        productsReturned: data.productsReturned,
        sourceCount: data.sources.length,
        localizedMarket: Boolean(market),
      },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "productSearch.tool_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof ProductSearchError || error instanceof ApiError
              ? error.code
              : "product_search_failed",
        },
      });
    }
    if (error instanceof ProductSearchError) {
      const status = error.code === "product_search_invalid_arguments"
        ? 400
        : error.code === "product_search_aborted"
          ? 499
          : 502;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
