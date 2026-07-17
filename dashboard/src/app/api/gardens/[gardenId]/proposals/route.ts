import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/openharness/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/openharness/session-service.ts";
import { listProposalsForGarden } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

// List agent-generated proposals for a garden the user can access. Proposals are
// how garden/quartz agents suggest changes — they are never applied silently.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { gardenId } = await params;
    authorizeGardenAccess(userId, gardenId);
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const proposals = listProposalsForGarden(gardenId, status).map((row) => ({
      id: row.id,
      kind: row.kind,
      pageSlug: row.page_slug,
      rationale: row.rationale,
      payload: JSON.parse(row.payload),
      evidenceAnchors: row.evidence_anchors ? JSON.parse(row.evidence_anchors) : [],
      status: row.status,
      createdAt: row.created_at,
    }));
    return NextResponse.json({ proposals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
