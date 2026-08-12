import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { composioIntegrationCatalog } from "@/lib/composio/catalog.ts";
import { composioConnectedIntegrationSlugs } from "@/lib/composio/service.ts";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [catalog, connectedSlugs] = await Promise.all([
      composioIntegrationCatalog(),
      composioConnectedIntegrationSlugs(userId, false),
    ]);
    const connected = new Set(connectedSlugs);
    const integrations = catalog.map((integration) => ({
      ...integration,
      connected: connected.has(integration.slug),
    }));
    return NextResponse.json({ integrations, count: integrations.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
