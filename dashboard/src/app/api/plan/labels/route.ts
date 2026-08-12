import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ labels: getPlanStore().listLabels(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const label = getPlanStore().createLabel(userId, {
      name: typeof body.name === "string" ? body.name : "",
      color: typeof body.color === "string" ? body.color : undefined,
    });
    return NextResponse.json({ label }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
