import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  createOrganization,
  listOrganizations,
  listReceivedInvites,
} from "@/lib/organizations/store";
import { organizationPublicId } from "@/lib/profile/brain-graph-ids.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      organizations: listOrganizations(userId).map((organization) => ({
        ...organization,
        brainScopeId: organizationPublicId(organization.id),
      })),
      invites: listReceivedInvites(userId),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const id = createOrganization(userId, name);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
