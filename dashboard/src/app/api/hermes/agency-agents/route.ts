import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  loadAgencyAgentsCatalog,
  presentAgencyAgent,
} from "@/lib/hermes/agency-agents.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    requireEnabled();
    const catalog = loadAgencyAgentsCatalog();
    const payload = {
      ok: catalog.status === "ready",
      agents: catalog.agents.map(presentAgencyAgent),
      divisions: catalog.divisions,
      diagnostics: {
        skippedCount: catalog.diagnostics.length,
      },
      configuration: {
        status: catalog.status,
        message: catalog.message,
      },
    };
    return NextResponse.json(payload, {
      status: catalog.status === "ready" ? 200 : 503,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
