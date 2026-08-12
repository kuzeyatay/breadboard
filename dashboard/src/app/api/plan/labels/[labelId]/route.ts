import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ labelId: string }> },
) {
  try {
    const userId = await requireUserId();
    getPlanStore().deleteLabel(userId, readId((await params).labelId, "label id"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
