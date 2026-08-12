import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const userId = await requireUserId();
    const projectId = readId((await params).projectId, "project id");
    const body = await readJsonBody(request);
    const column = getPlanStore().createColumn(userId, projectId, {
      name: typeof body.name === "string" ? body.name : "",
      color: typeof body.color === "string" ? body.color : undefined,
      isFinal: body.isFinal === true,
    });
    return NextResponse.json({ column }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
