import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";

export const dynamic = "force-dynamic";

/** The project rail: every live project with its open and overdue counts. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const projects = getPlanStore().listProjectsEnsuringDefault(userId);
    return NextResponse.json({ projects });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const project = getPlanStore().createProject(userId, {
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : null,
      color: typeof body.color === "string" ? body.color : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
