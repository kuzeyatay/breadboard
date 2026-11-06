import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { decideGardenProposal } from "@/lib/hermes/proposal-decisions.ts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string; proposalId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { gardenId, proposalId } = await params;
    const body = await readJsonBody(request);
    return NextResponse.json(await decideGardenProposal({ userId, gardenId, proposalId: Number(proposalId), decision: body.decision }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
