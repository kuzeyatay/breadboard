import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { registryItemsForUser } from "@/lib/hermes/commands.ts";
import { corsHeaders } from "@/lib/hermes/quartz-support.ts";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    const userId = await optionalUserId();
    const items = registryItemsForUser(userId, {
      mode: "knowledge",
      surface: "quartz_ai",
    });
    // Public Quartz receives only bundled compatible skills. Private prompts
    // and connections are included only for an authenticated reader, and no
    // memory placeholder is fabricated when an adapter is absent.
    return NextResponse.json({
      groups: {
        skills: items.filter((item) => item.kind === "skill"),
        mcp: userId === null ? [] : items.filter((item) => item.kind === "mcp"),
        prompts: userId === null ? [] : items.filter((item) => item.kind === "prompt"),
      },
      capability: { mode: "knowledge", expiresAt: null, taskScoped: false },
    }, { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
