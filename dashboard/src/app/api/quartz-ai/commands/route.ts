import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import type { CommandHubItem } from "@/lib/openharness/commands.ts";
import { listPrompts } from "@/lib/openharness/prompts.ts";
import { listApprovedSkills } from "@/lib/openharness/skills.ts";
import { corsHeaders } from "@/lib/openharness/quartz-support.ts";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";

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
    const skills: CommandHubItem[] = listApprovedSkills().map((skill) => ({ ...skill, kind: "skill", installed: true }));
    const prompts: CommandHubItem[] = listPrompts(userId ?? -1).map((prompt) => ({
      id: prompt.id,
      kind: "prompt",
      slug: prompt.slug,
      name: prompt.title,
      description: `${prompt.category} prompt`,
      installed: true,
      enabled: true,
      healthy: true,
      favorite: prompt.favorite,
    }));
    return NextResponse.json({
      groups: {
        skills,
        mcp: [{ id: "mcp:gbrain", kind: "mcp", slug: "gbrain", name: "GBrain", description: "Durable memory", installed: false, enabled: false, healthy: false, unavailableReason: "Not configured" } satisfies CommandHubItem],
        prompts,
      },
      runtime: { healthy: true },
    }, { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
