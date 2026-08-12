import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readId } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

/** The whole board: the project, its columns in order, and their cards. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const userId = await requireUserId();
    const projectId = readId((await params).projectId, "project id");
    return NextResponse.json({ board: getPlanStore().getBoard(userId, projectId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const userId = await requireUserId();
    const projectId = readId((await params).projectId, "project id");
    const body = await readJsonBody(request);
    const project = getPlanStore().updateProject(userId, projectId, {
      name: typeof body.name === "string" ? body.name : undefined,
      description:
        "description" in body
          ? typeof body.description === "string"
            ? body.description
            : null
          : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
      archived: typeof body.archived === "boolean" ? body.archived : undefined,
    });
    return NextResponse.json({ project });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const userId = await requireUserId();
    getPlanStore().deleteProject(userId, readId((await params).projectId, "project id"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
