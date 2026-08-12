import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { nangoIntegrationCatalog } from "@/lib/nango/catalog.ts";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const integrations = nangoIntegrationCatalog();
    return NextResponse.json({
      integrations,
      count: integrations.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
