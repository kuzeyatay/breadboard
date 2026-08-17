import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  deleteOrganization,
  renameOrganization,
} from "@/lib/organizations/store";

export const dynamic = "force-dynamic";

async function organizationId(
  params: Promise<{ organizationId: string }>,
): Promise<number> {
  const { organizationId: raw } = await params;
  return Number(raw);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    renameOrganization(
      await organizationId(params),
      userId,
      typeof body.name === "string" ? body.name : "",
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const userId = await requireUserId();
    deleteOrganization(await organizationId(params), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
