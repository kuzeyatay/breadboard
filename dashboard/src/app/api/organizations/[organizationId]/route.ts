import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  cleanOrganizationImage,
  deleteOrganization,
  renameOrganization,
} from "@/lib/organizations/store";
import { buzzBridge } from "@/lib/crumbs/service";

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
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; image?: unknown };
    const id = await organizationId(params);
    // The settings dialog sends the picture (a data URL, or null to clear it),
    // and the name when it changed. Both reach every member of a shared
    // organization through Crumbs.
    if ("image" in body) {
      await buzzBridge.updateOrganization(userId, id, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        image: cleanOrganizationImage(body.image),
      });
      return NextResponse.json({ ok: true });
    }
    const name = typeof body.name === "string" ? body.name : "";
    if (buzzBridge.crumbsOrgOf(userId, id)) await buzzBridge.updateOrganization(userId, id, { name });
    else renameOrganization(id, userId, name);
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
