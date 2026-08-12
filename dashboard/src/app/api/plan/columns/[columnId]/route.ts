import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ columnId: string }> },
) {
  try {
    const userId = await requireUserId();
    const columnId = readId((await params).columnId, "column id");
    const body = await readJsonBody(request);
    const column = getPlanStore().updateColumn(userId, columnId, {
      name: typeof body.name === "string" ? body.name : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
      isFinal: typeof body.isFinal === "boolean" ? body.isFinal : undefined,
    });
    return NextResponse.json({ column });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The column goes; its cards move to the first remaining column. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ columnId: string }> },
) {
  try {
    const userId = await requireUserId();
    getPlanStore().deleteColumn(userId, readId((await params).columnId, "column id"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
